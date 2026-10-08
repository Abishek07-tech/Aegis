import { isAssetType, type SimilarityLevel } from "../config/constants";
import type { OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";
import {
  getSimilarityLevel,
  normalizeText,
  similarityScore,
} from "./similarity.service";

export type NameAnalysisFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "NO_TARGET_BRAND"
  | "NO_OFFICIAL_ASSETS"
  | "EMPTY_CANDIDATE_VALUE"
  | "NO_COMPARABLE_ASSETS";

export type NameAnalysisComputeCode = Exclude<
  NameAnalysisFailureCode,
  "CANDIDATE_NOT_FOUND" | "NO_TARGET_BRAND"
>;

export interface NameAnalysisResult {
  candidateId: string;
  matchedAssetId: string;
  score: number;
  level: SimilarityLevel;
  isLookalike: boolean;
  reason: string;
}

export type NameAnalysisComputeResult = Omit<NameAnalysisResult, "candidateId">;

export type NameAnalysisComputeOutcome =
  | { ok: true; data: NameAnalysisComputeResult }
  | { ok: false; code: NameAnalysisComputeCode };

export type NameAnalysisOutcome =
  | { ok: true; data: NameAnalysisResult }
  | { ok: false; code: NameAnalysisFailureCode };

const REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate name is highly similar to an official brand asset.",
  MEDIUM: "Candidate name is moderately similar to an official brand asset.",
  LOW: "Candidate name has low similarity to official brand assets.",
};

export const computeNameAnalysis = (
  candidateValue: string,
  assets: OfficialAsset[],
): NameAnalysisComputeOutcome => {
  if (assets.length === 0) {
    return { ok: false, code: "NO_OFFICIAL_ASSETS" };
  }

  if (normalizeText(candidateValue) === "") {
    return { ok: false, code: "EMPTY_CANDIDATE_VALUE" };
  }

  const comparableAssets = assets.filter(
    (asset) => isAssetType(asset.type) && normalizeText(asset.value) !== "",
  );
  if (comparableAssets.length === 0) {
    return { ok: false, code: "NO_COMPARABLE_ASSETS" };
  }

  let matchedAsset = comparableAssets[0];
  let bestScore = similarityScore(candidateValue, comparableAssets[0].value);

  for (let i = 1; i < comparableAssets.length; i++) {
    const score = similarityScore(candidateValue, comparableAssets[i].value);
    if (score > bestScore) {
      bestScore = score;
      matchedAsset = comparableAssets[i];
    }
  }

  const level = getSimilarityLevel(bestScore);

  return {
    ok: true,
    data: {
      matchedAssetId: matchedAsset.id,
      score: bestScore,
      level,
      isLookalike: level === "HIGH",
      reason: REASONS[level],
    },
  };
};

export const analyzeCandidateName = async (
  candidateId: string,
): Promise<NameAnalysisOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const assets = await listOfficialAssets(brand.id);
  const computed = computeNameAnalysis(candidate.value, assets);
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
