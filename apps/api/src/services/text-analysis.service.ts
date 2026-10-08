import { SIMILARITY_THRESHOLDS, type SimilarityLevel } from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import {
  getSimilarityLevel,
  similarityScore,
  tokenizeText,
} from "./similarity.service";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";

export type TextAnalysisFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND"
  | "NO_USABLE_CANDIDATE_TEXT"
  | "NO_BRAND_IDENTITY";

export type TextAnalysisComputeCode = Extract<
  TextAnalysisFailureCode,
  "NO_USABLE_CANDIDATE_TEXT" | "NO_BRAND_IDENTITY"
>;

export interface TextComparisonResult {
  score: number;
  matchedTerms: string[];
}

export interface TextAnalysisResult {
  candidateId: string;
  score: number;
  level: SimilarityLevel;
  isSuspiciousSimilarity: boolean;
  matchedTerms: string[];
  reason: string;
}

export type TextAnalysisComputeResult = Omit<TextAnalysisResult, "candidateId">;

export type TextAnalysisComputeOutcome =
  | { ok: true; data: TextAnalysisComputeResult }
  | { ok: false; code: TextAnalysisComputeCode };

export type TextAnalysisOutcome =
  | { ok: true; data: TextAnalysisResult }
  | { ok: false; code: TextAnalysisFailureCode };

const REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate text contains strong similarity to the official brand identity.",
  MEDIUM: "Candidate text shows moderate identity similarity to the official brand.",
  LOW: "Candidate text shows low identity similarity to the official brand.",
};

const joinUsable = (parts: Array<string | null | undefined>): string =>
  parts
    .filter((part): part is string => typeof part === "string" && tokenizeText(part).length > 0)
    .map((part) => part.trim())
    .join(" ");

export const buildCandidateText = (
  candidate: Pick<CandidateAsset, "name" | "description" | "value">,
): string => joinUsable([candidate.name, candidate.description, candidate.value]);

export const buildBrandIdentityText = (
  brand: Pick<Brand, "name">,
  assets: OfficialAsset[],
): string => joinUsable([brand.name, ...assets.map((asset) => asset.value)]);

export const compareTextToIdentity = (
  candidateText: string,
  identityText: string,
): TextComparisonResult => {
  const candidateTokens = tokenizeText(candidateText);
  const identityTokens = tokenizeText(identityText);

  if (candidateTokens.length === 0 || identityTokens.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const identitySet = new Set(identityTokens);
  const matchedScores = new Map<string, number>();
  let bestTokenScore = 0;

  for (const token of candidateTokens) {
    let tokenScore = identitySet.has(token) ? 1 : 0;

    if (tokenScore < 1) {
      for (const identityToken of identityTokens) {
        const score = similarityScore(token, identityToken);
        if (score > tokenScore) {
          tokenScore = score;
        }
      }
    }

    if (tokenScore >= SIMILARITY_THRESHOLDS.MEDIUM) {
      const previous = matchedScores.get(token);
      if (previous === undefined || tokenScore > previous) {
        matchedScores.set(token, tokenScore);
      }
    }

    if (tokenScore > bestTokenScore) {
      bestTokenScore = tokenScore;
    }
  }

  const fullTextScore = similarityScore(candidateText, identityText);
  const score = Math.max(bestTokenScore, fullTextScore);

  const matchedTerms = [...matchedScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term);

  return { score, matchedTerms };
};

export const computeTextAnalysis = (
  candidate: Pick<CandidateAsset, "name" | "description" | "value">,
  brand: Pick<Brand, "name">,
  assets: OfficialAsset[],
): TextAnalysisComputeOutcome => {
  const candidateText = buildCandidateText(candidate);
  if (tokenizeText(candidateText).length === 0) {
    return { ok: false, code: "NO_USABLE_CANDIDATE_TEXT" };
  }

  const identityText = buildBrandIdentityText(brand, assets);
  if (tokenizeText(identityText).length === 0) {
    return { ok: false, code: "NO_BRAND_IDENTITY" };
  }

  const { score: rawScore, matchedTerms } = compareTextToIdentity(
    candidateText,
    identityText,
  );
  const score = Math.round(rawScore * 100) / 100;
  const level = getSimilarityLevel(score);

  return {
    ok: true,
    data: {
      score,
      level,
      isSuspiciousSimilarity: level === "HIGH",
      matchedTerms,
      reason: REASONS[level],
    },
  };
};

export const analyzeCandidateText = async (
  candidateId: string,
): Promise<TextAnalysisOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  const assets = await listOfficialAssets(brand.id);
  const computed = computeTextAnalysis(candidate, brand, assets);
  if (!computed.ok) {
    return computed;
  }

  return {
    ok: true,
    data: {
      candidateId: candidate.id,
      ...computed.data,
    },
  };
};
