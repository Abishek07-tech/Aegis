import { RISK_ENGINE_THRESHOLDS } from "../config/constants";
import {
  EVIDENCE_SOURCE_ORDER,
  analyzeCandidateEvidence,
  type EvidenceItem,
  type EvidenceResult,
  type EvidenceSource,
  type UnavailableEvidence,
} from "./evidence.service";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type EvidenceCategory =
  | "IDENTITY"
  | "CONTENT"
  | "VISUAL"
  | "SOCIAL"
  | "DOMAIN";

export const EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  "IDENTITY",
  "CONTENT",
  "VISUAL",
  "SOCIAL",
  "DOMAIN",
];

export interface RiskReason {
  category: EvidenceCategory;
  signal: string;
  impact: number;
  reason: string;
}

export interface RiskResult {
  candidateId: string;
  type: "SOCIAL" | "APP";
  riskScore: number;
  riskLevel: RiskLevel;
  confidence: number;
  evidenceCount: number;
  independentSourceCount: number;
  reasons: RiskReason[];
  evidence: EvidenceItem[];
  unavailable: UnavailableEvidence[];
}

export type RiskFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "RISK_ANALYSIS_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type RiskOutcome =
  | { ok: true; data: RiskResult }
  | { ok: false; code: RiskFailureCode };

// Explicit signal → category mapping; unknown future signals fall back to their source.
const SIGNAL_CATEGORIES: Record<string, EvidenceCategory> = {
  NAME_SIMILARITY: "IDENTITY",
  APP_NAME_SIMILARITY: "IDENTITY",
  PACKAGE_IDENTIFIER_SIMILARITY: "IDENTITY",
  APP_BRAND_IMPERSONATION: "IDENTITY",
  OFFICIAL_IDENTITY_CONFLICT: "IDENTITY",
  OFFICIAL_APP_MATCH: "IDENTITY",
  OFFICIAL_ACCOUNT_MATCH: "IDENTITY",
  TEXT_IDENTITY_MATCH: "CONTENT",
  BRAND_TEXT_MATCH: "CONTENT",
  APP_DESCRIPTION_MATCH: "CONTENT",
  SUPPORT_LANGUAGE: "SOCIAL",
  LOGO_SIMILARITY: "VISUAL",
  OFFICIAL_DOMAIN_MATCH: "DOMAIN",
  EXTERNAL_DOMAIN: "DOMAIN",
};

const SOURCE_CATEGORY_FALLBACK: Record<EvidenceSource, EvidenceCategory> = {
  NAME: "IDENTITY",
  TEXT: "CONTENT",
  LOGO: "VISUAL",
  SOCIAL: "SOCIAL",
  APP: "IDENTITY",
};

// Protective (benign) evidence: never adds risk, only suppresses it.
const PROTECTIVE_SIGNALS: ReadonlySet<string> = new Set([
  "OFFICIAL_APP_MATCH",
  "OFFICIAL_ACCOUNT_MATCH",
  "OFFICIAL_DOMAIN_MATCH",
]);

export const classifyEvidence = (
  item: Pick<EvidenceItem, "signal" | "source">,
): EvidenceCategory =>
  SIGNAL_CATEGORIES[item.signal] ?? SOURCE_CATEGORY_FALLBACK[item.source];

export const isProtectiveSignal = (signal: string): boolean =>
  PROTECTIVE_SIGNALS.has(signal);

export const getRiskLevel = (score: number): RiskLevel => {
  if (score >= RISK_ENGINE_THRESHOLDS.LEVEL.CRITICAL) return "CRITICAL";
  if (score >= RISK_ENGINE_THRESHOLDS.LEVEL.HIGH) return "HIGH";
  if (score >= RISK_ENGINE_THRESHOLDS.LEVEL.MEDIUM) return "MEDIUM";
  return "LOW";
};

const clampScore = (value: number): number =>
  Math.min(1, Math.max(0, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

const sourceIndex = (source: EvidenceSource): number =>
  EVIDENCE_SOURCE_ORDER.indexOf(source);

interface ScoredItem {
  item: EvidenceItem;
  category: EvidenceCategory;
  contribution: number;
}

/**
 * Deterministic risk model (documented in docs/DEVELOPMENT_MEMORY.md):
 *   contribution      = severityWeight × clamp(evidence.score, 0, 1)
 *   category total    = strongest item + OVERLAP_DAMPING × (others in same category)
 *   protective domain = total × PROTECTIVE_DOMAIN_FACTOR (when OFFICIAL_DOMAIN_MATCH present)
 *   official identity = min(total, OFFICIAL_IDENTITY_CAP)
 *   riskScore         = round(clamp(total, 0, 100))
 *   riskLevel         = LOW < 25 ≤ MEDIUM < 50 ≤ HIGH < 75 ≤ CRITICAL
 *   confidence        = 0.4·min(1, evidence/4) + 0.4·min(1, groups/3) + 0.2·meanScore   (0..1)
 * Reasons carry each item's final impact (scaled so they sum to riskScore), sorted by
 * impact descending. Protective evidence and `unavailable` entries never add risk.
 */
export const buildRiskResult = (evidenceResult: EvidenceResult): RiskResult => {
  const { candidateId, type, evidence, unavailable } = evidenceResult;

  const riskItems = evidence.filter((item) => !isProtectiveSignal(item.signal));
  const hasProtectiveDomain = evidence.some(
    (item) => item.signal === "OFFICIAL_DOMAIN_MATCH",
  );
  const hasOfficialIdentity = evidence.some(
    (item) =>
      item.signal === "OFFICIAL_APP_MATCH" ||
      item.signal === "OFFICIAL_ACCOUNT_MATCH",
  );

  const scored: ScoredItem[] = riskItems.map((item) => ({
    item,
    category: classifyEvidence(item),
    contribution:
      RISK_ENGINE_THRESHOLDS.SEVERITY_WEIGHT[item.severity] *
      clampScore(item.score),
  }));

  // Within each category the strongest item counts fully; overlapping items are damped.
  const byCategory = new Map<EvidenceCategory, ScoredItem[]>();
  for (const entry of scored) {
    const group = byCategory.get(entry.category);
    if (group) group.push(entry);
    else byCategory.set(entry.category, [entry]);
  }

  const effective = new Map<EvidenceItem, number>();
  for (const group of byCategory.values()) {
    group.sort(
      (a, b) =>
        b.contribution - a.contribution ||
        sourceIndex(a.item.source) - sourceIndex(b.item.source) ||
        a.item.signal.localeCompare(b.item.signal),
    );
    group.forEach((entry, index) => {
      effective.set(
        entry.item,
        index === 0
          ? entry.contribution
          : entry.contribution * RISK_ENGINE_THRESHOLDS.OVERLAP_DAMPING,
      );
    });
  }

  const domainFactor = hasProtectiveDomain
    ? RISK_ENGINE_THRESHOLDS.PROTECTIVE_DOMAIN_FACTOR
    : 1;

  // raw total = Σ category contributions × protective factor
  let rawTotal = 0;
  for (const value of effective.values()) rawTotal += value;
  rawTotal *= domainFactor;

  // bounded aggregation: official-identity cap, then hard 0..100 bounds
  let total = rawTotal;
  if (hasOfficialIdentity) {
    total = Math.min(total, RISK_ENGINE_THRESHOLDS.OFFICIAL_IDENTITY_CAP);
  }
  total = Math.min(RISK_ENGINE_THRESHOLDS.MAX_SCORE, Math.max(0, total));
  const riskScore = Math.round(total);

  // Scale each item's impact proportionally so reasons sum to (≈) riskScore.
  const scale = rawTotal > 0 ? total / rawTotal : 0;
  const reasons: Array<RiskReason & { sourceIndex: number }> = [];
  for (const entry of scored) {
    const impact = Math.round(
      (effective.get(entry.item) ?? 0) * domainFactor * scale,
    );
    if (impact <= 0) continue;
    reasons.push({
      category: entry.category,
      signal: entry.item.signal,
      impact,
      reason: entry.item.reason,
      sourceIndex: sourceIndex(entry.item.source),
    });
  }
  reasons.sort(
    (a, b) =>
      b.impact - a.impact ||
      a.signal.localeCompare(b.signal) ||
      a.sourceIndex - b.sourceIndex,
  );

  const evidenceCount = evidence.length;
  const independentSourceCount = new Set(
    evidence.map((item) => classifyEvidence(item)),
  ).size;
  const meanScore =
    evidenceCount > 0
      ? evidence.reduce((sum, item) => sum + clampScore(item.score), 0) /
        evidenceCount
      : 0;
  const confidenceWeights = RISK_ENGINE_THRESHOLDS.CONFIDENCE;
  const confidence = Math.min(
    1,
    Math.max(
      0,
      round2(
        confidenceWeights.ITEM_WEIGHT *
          Math.min(1, evidenceCount / confidenceWeights.ITEM_DIVISOR) +
          confidenceWeights.GROUP_WEIGHT *
            Math.min(1, independentSourceCount / confidenceWeights.GROUP_DIVISOR) +
          confidenceWeights.STRENGTH_WEIGHT * meanScore,
      ),
    ),
  );

  return {
    candidateId,
    type,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    confidence,
    evidenceCount,
    independentSourceCount,
    reasons: reasons.map(({ sourceIndex: _order, ...reason }) => reason),
    evidence,
    unavailable,
  };
};

export const analyzeCandidateRisk = async (
  candidateId: string,
): Promise<RiskOutcome> => {
  const evidenceOutcome = await analyzeCandidateEvidence(candidateId);
  if (!evidenceOutcome.ok) {
    switch (evidenceOutcome.code) {
      case "EVIDENCE_ANALYSIS_NOT_APPLICABLE":
        return { ok: false, code: "RISK_ANALYSIS_NOT_APPLICABLE" };
      case "CANDIDATE_NOT_FOUND":
      case "NO_TARGET_BRAND":
      case "BRAND_NOT_FOUND":
        return { ok: false, code: evidenceOutcome.code };
    }
  }

  return { ok: true, data: buildRiskResult(evidenceOutcome.data) };
};
