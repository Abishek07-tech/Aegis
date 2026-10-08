import {
  SOCIAL_SIGNAL_THRESHOLDS,
  type SimilarityLevel,
} from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";
import { buildAppSignals } from "./app-risk.service";
import {
  computeCandidateLogoAnalysis,
  type LogoAnalysisComputeCode,
} from "./logo-analysis.service";
import {
  computeNameAnalysis,
  type NameAnalysisComputeCode,
} from "./name-analysis.service";
import { buildSocialSignals } from "./social-risk.service";
import {
  computeTextAnalysis,
  type TextAnalysisComputeCode,
} from "./text-analysis.service";

export type EvidenceSource = "NAME" | "TEXT" | "LOGO" | "SOCIAL" | "APP";

export const EVIDENCE_SOURCE_ORDER: readonly EvidenceSource[] = [
  "NAME",
  "TEXT",
  "LOGO",
  "SOCIAL",
  "APP",
];

export interface EvidenceItem {
  source: EvidenceSource;
  signal: string;
  severity: SimilarityLevel;
  score: number;
  reason: string;
}

export interface UnavailableEvidence {
  source: EvidenceSource;
  reason: string;
}

export interface EvidenceResult {
  candidateId: string;
  type: "SOCIAL" | "APP";
  evidence: EvidenceItem[];
  evidenceCount: number;
  highSeverityCount: number;
  hasHighSeverity: boolean;
  unavailable: UnavailableEvidence[];
}

export type EvidenceFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "EVIDENCE_ANALYSIS_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type EvidenceOutcome =
  | { ok: true; data: EvidenceResult }
  | { ok: false; code: EvidenceFailureCode };

const NAME_UNAVAILABLE_REASONS: Record<NameAnalysisComputeCode, string> = {
  NO_OFFICIAL_ASSETS: "Target brand has no official assets to compare against.",
  EMPTY_CANDIDATE_VALUE:
    "Candidate value is empty after normalization — nothing to compare.",
  NO_COMPARABLE_ASSETS: "No comparable official assets with non-empty values.",
};

const TEXT_UNAVAILABLE_REASONS: Record<TextAnalysisComputeCode, string> = {
  NO_USABLE_CANDIDATE_TEXT:
    "Candidate has no usable text — name, description, and value are all empty.",
  NO_BRAND_IDENTITY:
    "Target brand has no usable identity information (name and official asset values are all empty).",
};

const LOGO_UNAVAILABLE_REASONS: Record<LogoAnalysisComputeCode, string> = {
  NO_OFFICIAL_LOGO:
    "Target brand has no official logo (brand.logoUrl) — logo comparison unavailable.",
  NO_CANDIDATE_LOGO:
    "Candidate has no logo/image reference in the current data model — logo comparison unavailable.",
  LOGO_UNAVAILABLE:
    "Logo image reference could not be fetched or decoded — logo comparison unavailable.",
};

const APP_NOT_APPLICABLE_REASON =
  "App risk analysis is only applicable to APP candidates — not evaluated for this SOCIAL candidate.";

const SOCIAL_NOT_APPLICABLE_REASON =
  "Social risk analysis is only applicable to SOCIAL candidates — not evaluated for this APP candidate.";

export const dedupeEvidence = (items: EvidenceItem[]): EvidenceItem[] => {
  const seen = new Set<string>();
  const result: EvidenceItem[] = [];

  for (const item of items) {
    const key = JSON.stringify([
      item.signal,
      item.severity,
      item.score,
      item.reason,
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
};

export const buildEvidenceResult = (
  candidateId: string,
  type: "SOCIAL" | "APP",
  evidence: EvidenceItem[],
  unavailable: UnavailableEvidence[],
): EvidenceResult => {
  const deduped = dedupeEvidence(evidence);
  const highSeverityCount = deduped.filter(
    (item) => item.severity === "HIGH",
  ).length;

  return {
    candidateId,
    type,
    evidence: deduped,
    evidenceCount: deduped.length,
    highSeverityCount,
    hasHighSeverity: highSeverityCount > 0,
    unavailable,
  };
};

export const collectEvidence = async (
  candidate: Pick<
    CandidateAsset,
    "id" | "value" | "name" | "description" | "type"
  >,
  brand: Pick<Brand, "name" | "website" | "logoUrl">,
  assets: OfficialAsset[],
  type: "SOCIAL" | "APP",
): Promise<{ items: EvidenceItem[]; unavailable: UnavailableEvidence[] }> => {
  const items: EvidenceItem[] = [];
  const unavailable: UnavailableEvidence[] = [];

  const nameOutcome = computeNameAnalysis(candidate.value, assets);
  if (nameOutcome.ok) {
    if (nameOutcome.data.score >= SOCIAL_SIGNAL_THRESHOLDS.NAME_SIMILARITY_MIN) {
      items.push({
        source: "NAME",
        signal: "NAME_SIMILARITY",
        severity: nameOutcome.data.level,
        score: nameOutcome.data.score,
        reason: nameOutcome.data.reason,
      });
    }
  } else {
    unavailable.push({
      source: "NAME",
      reason: NAME_UNAVAILABLE_REASONS[nameOutcome.code],
    });
  }

  const textOutcome = computeTextAnalysis(candidate, brand, assets);
  if (textOutcome.ok) {
    if (textOutcome.data.level !== "LOW") {
      items.push({
        source: "TEXT",
        signal: "TEXT_IDENTITY_MATCH",
        severity: textOutcome.data.level,
        score: textOutcome.data.score,
        reason: textOutcome.data.reason,
      });
    }
  } else {
    unavailable.push({
      source: "TEXT",
      reason: TEXT_UNAVAILABLE_REASONS[textOutcome.code],
    });
  }

  const logoOutcome = await computeCandidateLogoAnalysis(
    brand,
    candidate,
    candidate.id,
  );
  if (logoOutcome.ok) {
    items.push({
      source: "LOGO",
      signal: "LOGO_SIMILARITY",
      severity: logoOutcome.data.level,
      score: logoOutcome.data.score,
      reason: logoOutcome.data.reason,
    });
  } else {
    unavailable.push({
      source: "LOGO",
      reason: LOGO_UNAVAILABLE_REASONS[logoOutcome.code],
    });
  }

  if (type === "SOCIAL") {
    const socialSignals = buildSocialSignals({ candidate, brand, assets });
    for (const signal of socialSignals) {
      items.push({
        source: "SOCIAL",
        signal: signal.signal,
        severity: signal.severity,
        score: signal.score,
        reason: signal.reason,
      });
    }
    unavailable.push({ source: "APP", reason: APP_NOT_APPLICABLE_REASON });
  } else {
    unavailable.push({ source: "SOCIAL", reason: SOCIAL_NOT_APPLICABLE_REASON });
    const appBundle = buildAppSignals({ candidate, brand, assets });
    for (const signal of appBundle.signals) {
      items.push({
        source: "APP",
        signal: signal.signal,
        severity: signal.severity,
        score: signal.score,
        reason: signal.reason,
      });
    }
  }

  return { items, unavailable };
};

export const analyzeCandidateEvidence = async (
  candidateId: string,
): Promise<EvidenceOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "EVIDENCE_ANALYSIS_NOT_APPLICABLE" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  const assets = await listOfficialAssets(brand.id);
  const { items, unavailable } = await collectEvidence(
    candidate,
    brand,
    assets,
    normalizedType,
  );

  return {
    ok: true,
    data: buildEvidenceResult(candidate.id, normalizedType, items, unavailable),
  };
};
