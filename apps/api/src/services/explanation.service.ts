import { RISK_ENGINE_THRESHOLDS } from "../config/constants";
import {
  analyzeCandidateRisk,
  classifyEvidence,
  isProtectiveSignal,
  type EvidenceCategory,
  type RiskLevel,
  type RiskReason,
  type RiskResult,
} from "./risk-engine.service";
import type { EvidenceItem, EvidenceSource } from "./evidence.service";

export interface WhyFlaggedEntry {
  category: EvidenceCategory;
  signal: string;
  source: EvidenceSource;
  impact: number;
  explanation: string;
}

export interface WhyNotFlaggedEntry {
  category: EvidenceCategory | "ASSESSMENT";
  signal: string;
  source: EvidenceSource | "NONE";
  protection: string;
  explanation: string;
}

export interface ExplanationResult {
  candidateId: string;
  type: "SOCIAL" | "APP";
  riskScore: number;
  riskLevel: RiskLevel;
  confidence: number;
  summary: string;
  whyFlagged: WhyFlaggedEntry[];
  whyNotFlagged: WhyNotFlaggedEntry[];
  protectiveSignals: string[];
  evidenceCount: number;
  independentSourceCount: number;
}

export type ExplanationFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "EXPLANATION_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type ExplanationOutcome =
  | { ok: true; data: ExplanationResult }
  | { ok: false; code: ExplanationFailureCode };

// Confidence below this → the flag rests on thin coverage (explanation-layer judgement only,
// never applied to the risk score itself).
const LOW_CONFIDENCE_THRESHOLD = 0.5;

// Human-readable labels for known signals; unknown future signals display as-is.
const SIGNAL_LABELS: Record<string, string> = {
  NAME_SIMILARITY: "Name/handle similarity",
  APP_NAME_SIMILARITY: "App name similarity",
  PACKAGE_IDENTIFIER_SIMILARITY: "Package identifier similarity",
  APP_BRAND_IMPERSONATION: "Brand-imitation indicators in the app listing",
  OFFICIAL_IDENTITY_CONFLICT: "Official identity conflict",
  TEXT_IDENTITY_MATCH: "Text/brand identity similarity",
  BRAND_TEXT_MATCH: "Brand text reference",
  APP_DESCRIPTION_MATCH: "App description similarity",
  SUPPORT_LANGUAGE: "Customer-support language pattern",
  LOGO_SIMILARITY: "Logo similarity",
  EXTERNAL_DOMAIN: "External domain reference",
  OFFICIAL_DOMAIN_MATCH: "Official domain match",
  OFFICIAL_ACCOUNT_MATCH: "Exact official account match",
  OFFICIAL_APP_MATCH: "Exact official app match",
};

const signalLabel = (signal: string): string => SIGNAL_LABELS[signal] ?? signal;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const categoryWord = (count: number): string =>
  `${count} independent ${count === 1 ? "category" : "categories"}`;

// A reason is only explainable when a real evidence item backs it (same signal + same
// reason text); first match in source order wins. Reasons without backing evidence are
// skipped rather than invented.
const findBackingEvidence = (
  evidence: EvidenceItem[],
  reason: RiskReason,
): EvidenceItem | undefined =>
  evidence.find(
    (item) => item.signal === reason.signal && item.reason === reason.reason,
  );

const buildWhyFlagged = (risk: RiskResult): WhyFlaggedEntry[] => {
  const entries: WhyFlaggedEntry[] = [];
  const seen = new Set<string>();

  // risk.reasons is already sorted strongest-first and excludes protective signals.
  for (const reason of risk.reasons) {
    const item = findBackingEvidence(risk.evidence, reason);
    if (!item) continue;

    const explanation =
      `${signalLabel(reason.signal)} — ${item.source} evidence at ` +
      `${item.severity} strength contributed ${plural(reason.impact, "point")} ` +
      `to the ${risk.riskScore}/100 ${risk.riskLevel} risk. ` +
      `Evidence: ${reason.reason}`;

    if (seen.has(explanation)) continue;
    seen.add(explanation);
    entries.push({
      category: reason.category,
      signal: reason.signal,
      source: item.source,
      impact: reason.impact,
      explanation,
    });
  }

  return entries;
};

const buildProtectiveEntry = (
  item: EvidenceItem,
  risk: RiskResult,
): WhyNotFlaggedEntry => {
  const category = classifyEvidence(item);

  if (item.signal === "OFFICIAL_DOMAIN_MATCH") {
    const factor = RISK_ENGINE_THRESHOLDS.PROTECTIVE_DOMAIN_FACTOR;
    const percent = Math.round((1 - factor) * 100);
    const effect =
      risk.riskScore > 0
        ? "Because the candidate references the brand's registered domain, " +
          `official domain evidence reduced the total risk by ${percent}% ` +
          `(×${factor}) — the score stands at ${risk.riskScore}/100 ${risk.riskLevel}.`
        : "Because the candidate references the brand's registered domain, " +
          "this protective evidence adds no risk to the score.";
    return {
      category,
      signal: item.signal,
      source: item.source,
      protection: "Official domain match",
      explanation: `${item.reason} ${effect}`,
    };
  }

  // OFFICIAL_ACCOUNT_MATCH / OFFICIAL_APP_MATCH — exact official identity (cap rule).
  const cap = RISK_ENGINE_THRESHOLDS.OFFICIAL_IDENTITY_CAP;
  const effect =
    risk.riskScore >= cap
      ? `Official identity evidence reduced the risk because the candidate ` +
        `matches a registered official asset — the score was capped at ${cap}/100 ` +
        "(LOW ceiling)."
      : `Official identity evidence reduced the risk because the candidate ` +
        `matches a registered official asset — the score is bounded to at most ` +
        `${cap}/100 (LOW ceiling) and is ${risk.riskScore}/100.`;
  return {
    category,
    signal: item.signal,
    source: item.source,
    protection:
      item.signal === "OFFICIAL_APP_MATCH"
        ? "Exact official app match"
        : "Exact official identity match",
    explanation: `${item.reason} ${effect}`,
  };
};

const buildWhyNotFlagged = (
  risk: RiskResult,
  protectiveItems: EvidenceItem[],
  protectiveSignals: string[],
  whyFlaggedCount: number,
): WhyNotFlaggedEntry[] => {
  const entries: WhyNotFlaggedEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: WhyNotFlaggedEntry): void => {
    if (seen.has(entry.explanation)) return;
    seen.add(entry.explanation);
    entries.push(entry);
  };

  // 1. Protective/benign evidence actually present in the Task 11 evidence list.
  for (const item of protectiveItems) {
    push(buildProtectiveEntry(item, risk));
  }

  const protectivePresent = protectiveSignals.length > 0;

  // 2. No risk reasons and no protective evidence → say the evidence is insufficient.
  if (whyFlaggedCount === 0 && !protectivePresent) {
    const coverage =
      risk.evidenceCount === 0
        ? risk.unavailable.length > 0
          ? `no comparative evidence could be collected (unavailable: ${risk.unavailable
              .map((entry) => entry.source)
              .join(", ")})`
          : "no comparative evidence could be collected"
        : `${plural(risk.evidenceCount, "collected evidence item")} across ` +
          `${categoryWord(risk.independentSourceCount)} produced ` +
          "no risk-contributing signals";
    push({
      category: "ASSESSMENT",
      signal: "INSUFFICIENT_EVIDENCE",
      source: "NONE",
      protection: "Weak or insufficient evidence",
      explanation:
        `There is insufficient evidence to flag this candidate: ${coverage} ` +
        `— risk ${risk.riskScore}/100 ${risk.riskLevel}.`,
    });
    return entries;
  }

  // 3. Protective and risk evidence both present → surface the conflict honestly.
  if (whyFlaggedCount > 0 && protectivePresent) {
    const effects: string[] = [];
    if (protectiveSignals.includes("OFFICIAL_DOMAIN_MATCH")) {
      const percent = Math.round(
        (1 - RISK_ENGINE_THRESHOLDS.PROTECTIVE_DOMAIN_FACTOR) * 100,
      );
      effects.push(`official domain evidence reduces the total by ${percent}%`);
    }
    if (
      protectiveSignals.includes("OFFICIAL_ACCOUNT_MATCH") ||
      protectiveSignals.includes("OFFICIAL_APP_MATCH")
    ) {
      effects.push(
        `official identity is bounded to at most ` +
          `${RISK_ENGINE_THRESHOLDS.OFFICIAL_IDENTITY_CAP}/100`,
      );
    }
    push({
      category: "ASSESSMENT",
      signal: "CONFLICTING_EVIDENCE",
      source: "NONE",
      protection: "Conflicting protective evidence",
      explanation:
        `Protective evidence (${protectiveSignals.join(", ")}) is present ` +
        `alongside ${plural(whyFlaggedCount, "risk signal")} — the evidence is ` +
        `mixed${effects.length > 0 ? `, and ${effects.join("; ")}` : ""}. ` +
        `The score stands at ${risk.riskScore}/100 ${risk.riskLevel} ` +
        `(confidence ${risk.confidence}).`,
    });
  }

  // 4. Flagged, but coverage is thin → confidence caveat (explanation only).
  if (whyFlaggedCount > 0 && risk.confidence < LOW_CONFIDENCE_THRESHOLD) {
    push({
      category: "ASSESSMENT",
      signal: "LIMITED_SUPPORT",
      source: "NONE",
      protection: "Limited evidence coverage",
      explanation:
        `Assessment confidence is limited (${risk.confidence}/1) because the ` +
        `flag rests on ${plural(risk.evidenceCount, "evidence item")} across ` +
        `${categoryWord(risk.independentSourceCount)} — ` +
        `${plural(whyFlaggedCount, "risk signal")} only. The evidence is ` +
        `insufficient to support a stronger flag ` +
        `(risk ${risk.riskScore}/100 ${risk.riskLevel}).`,
    });
  }

  return entries;
};

const buildSummary = (
  risk: RiskResult,
  whyFlaggedCount: number,
  protectiveSignals: string[],
): string => {
  const { riskScore, riskLevel, confidence, evidenceCount, independentSourceCount } = risk;
  const hasProtection = protectiveSignals.length > 0;

  if (hasProtection && riskLevel === "LOW") {
    return (
      `Official/protective evidence prevents inappropriate escalation: ` +
      `${protectiveSignals.join(", ")} present — ` +
      `risk ${riskScore}/100 ${riskLevel} (confidence ${confidence}).`
    );
  }

  if (whyFlaggedCount === 0) {
    if (evidenceCount === 0) {
      return (
        `Insufficient evidence: no comparative evidence could be collected — ` +
        `risk ${riskScore}/100 ${riskLevel}.`
      );
    }
    return (
      `Weak/limited evidence: ${plural(evidenceCount, "evidence item")} produced ` +
      `no risk-contributing signals — risk ${riskScore}/100 ${riskLevel}.`
    );
  }

  const strength =
    riskLevel === "CRITICAL" || riskLevel === "HIGH"
      ? "Strong evidence"
      : riskLevel === "MEDIUM"
        ? "Moderate evidence"
        : "Weak evidence";
  const independence =
    independentSourceCount >= 2
      ? `${independentSourceCount} independent evidence categories`
      : "a single evidence category (limited source independence)";
  const protectionNote = hasProtection
    ? "; protective official evidence reduced the score"
    : "";

  return (
    `${strength}: ${plural(whyFlaggedCount, "risk signal")} across ` +
    `${independence} — risk ${riskScore}/100 ${riskLevel}, ` +
    `confidence ${confidence}, ${plural(evidenceCount, "evidence item")}` +
    `${protectionNote}.`
  );
};

/**
 * Deterministic explanation layer over Tasks 11/12 — no LLM, no scoring:
 *   whyFlagged     = one entry per Task 12 risk reason (strongest first), each backed
 *                    by its actual evidence item (signal + reason text), never invented
 *   whyNotFlagged  = protective evidence present (official identity/domain/app, with the
 *                    Task 12 cap/dampening effect stated) + assessment entries for
 *                    insufficient evidence, conflicting evidence, and limited coverage
 *   summary        = one-line verdict derived from risk level, counts, and protection
 * riskScore/riskLevel/confidence are copied from Task 12 unchanged.
 */
export const buildExplanation = (risk: RiskResult): ExplanationResult => {
  const protectiveItems = risk.evidence.filter((item) =>
    isProtectiveSignal(item.signal),
  );
  const protectiveSignals = [
    ...new Set(protectiveItems.map((item) => item.signal)),
  ];
  const whyFlagged = buildWhyFlagged(risk);
  const whyNotFlagged = buildWhyNotFlagged(
    risk,
    protectiveItems,
    protectiveSignals,
    whyFlagged.length,
  );

  return {
    candidateId: risk.candidateId,
    type: risk.type,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    confidence: risk.confidence,
    summary: buildSummary(risk, whyFlagged.length, protectiveSignals),
    whyFlagged,
    whyNotFlagged,
    protectiveSignals,
    evidenceCount: risk.evidenceCount,
    independentSourceCount: risk.independentSourceCount,
  };
};

export const analyzeCandidateExplanation = async (
  candidateId: string,
): Promise<ExplanationOutcome> => {
  const riskOutcome = await analyzeCandidateRisk(candidateId);
  if (!riskOutcome.ok) {
    switch (riskOutcome.code) {
      case "RISK_ANALYSIS_NOT_APPLICABLE":
        return { ok: false, code: "EXPLANATION_NOT_APPLICABLE" };
      case "CANDIDATE_NOT_FOUND":
      case "NO_TARGET_BRAND":
      case "BRAND_NOT_FOUND":
        return { ok: false, code: riskOutcome.code };
    }
  }

  return { ok: true, data: buildExplanation(riskOutcome.data) };
};
