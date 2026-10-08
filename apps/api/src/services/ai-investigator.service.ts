import {
  CAMPAIGN_THRESHOLDS,
  INVESTIGATION_THRESHOLDS,
  RISK_ENGINE_THRESHOLDS,
  type SimilarityLevel,
} from "../config/constants";
import type {
  Brand,
  CandidateAsset,
  OfficialAsset,
} from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById, listCandidates } from "./candidate.service";
import {
  EVIDENCE_SOURCE_ORDER,
  buildEvidenceResult,
  collectEvidence,
  type EvidenceItem,
  type EvidenceResult,
  type EvidenceSource,
} from "./evidence.service";
import {
  buildRiskResult,
  isProtectiveSignal,
  type RiskResult,
} from "./risk-engine.service";
import {
  buildExplanation,
  type ExplanationResult,
} from "./explanation.service";
import {
  buildCorrelationResult,
  type CorrelationResult,
} from "./correlation.service";
import {
  computeCampaignAnalysis,
  type CampaignResult,
  type CampaignType,
} from "./campaign.service";

// ---------------------------------------------------------------------------
// Investigation types
// ---------------------------------------------------------------------------

// Conservative behavioural classifications derived ONLY from existing evidence.
// CREDENTIAL_TARGETING is intentionally listed but never forced: no Task 11
// signal records credential/OTP harvesting today, so the predicate is
// unreachable rather than inferred from look-alike evidence.
export type ThreatIntent =
  | "BRAND_IMPERSONATION"
  | "ACCOUNT_IMPERSONATION"
  | "APP_IMPERSONATION"
  | "PHISHING_LURE"
  | "SUPPORT_SCAM_PATTERN"
  | "CREDENTIAL_TARGETING"
  | "UNKNOWN";

// Investigation confidence has its own three-level ladder so it can never be
// confused with Task 12 risk (LOW/MEDIUM/HIGH/CRITICAL) or Task 15 campaign
// confidence (…/VERY_HIGH).
export type InvestigationConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export type InvestigationImportance = "HIGH" | "MEDIUM" | "LOW";
export type InvestigationPriority = "HIGH" | "MEDIUM" | "LOW";

// "DETERMINISTIC" = fallback investigator produced the narrative.
// "AI" = a validated model interpretation was merged over the deterministic
// base (structured facts — confidence, campaign assessment, strongest evidence
// — always remain deterministic).
export type InvestigationSource = "DETERMINISTIC" | "AI";

export interface InvestigationKeyFinding {
  finding: string;
  evidence: string;
  importance: InvestigationImportance;
}

export interface StrongestEvidenceEntry {
  source: EvidenceSource;
  signal: string;
  strength: SimilarityLevel;
  explanation: string;
}

export interface CampaignAssessment {
  detected: boolean;
  campaignType: CampaignType | null;
  confidence: number | null;
  memberCount: number;
  explanation: string;
}

export interface AttackPathStep {
  step: string;
  evidence: string;
}

export interface Uncertainty {
  issue: string;
  reason: string;
}

export interface RecommendedAction {
  priority: InvestigationPriority;
  action: string;
  reason: string;
}

export interface Investigation {
  headline: string;
  assessment: string;
  threatIntent: ThreatIntent;
  secondaryIntents: ThreatIntent[];
  confidence: number;
  confidenceLevel: InvestigationConfidenceLevel;
  keyFindings: InvestigationKeyFinding[];
  strongestEvidence: StrongestEvidenceEntry[];
  campaignAssessment: CampaignAssessment;
  attackPath: AttackPathStep[];
  uncertainties: Uncertainty[];
  recommendedActions: RecommendedAction[];
  source: InvestigationSource;
}

export interface InvestigationResult {
  candidateId: string;
  investigation: Investigation;
}

// Every input field is an existing structured result — nothing is recomputed.
export interface AIInvestigatorInput {
  candidate: CandidateAsset;
  brand: Brand;
  officialAssets: OfficialAsset[];
  evidence: EvidenceResult;
  risk: RiskResult;
  explanation: ExplanationResult;
  correlation: CorrelationResult;
  campaign: CampaignResult;
}

export type InvestigationFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "INVESTIGATION_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type InvestigationOutcome =
  | { ok: true; data: InvestigationResult }
  | { ok: false; code: InvestigationFailureCode };

// ---------------------------------------------------------------------------
// Signal vocabularies (classification inputs — not new detection signals)
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<SimilarityLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

const APP_IDENTITY_SIGNALS = [
  "APP_NAME_SIMILARITY",
  "PACKAGE_IDENTIFIER_SIMILARITY",
  "APP_BRAND_IMPERSONATION",
  "APP_DESCRIPTION_MATCH",
] as const;

const IDENTITY_RESEMBLANCE_SIGNALS = [
  "NAME_SIMILARITY",
  "OFFICIAL_IDENTITY_CONFLICT",
  "TEXT_IDENTITY_MATCH",
  "LOGO_SIMILARITY",
] as const;

const BRAND_MATERIAL_SIGNALS = [
  "TEXT_IDENTITY_MATCH",
  "BRAND_TEXT_MATCH",
  "LOGO_SIMILARITY",
] as const;

const ACCOUNT_IDENTITY_SIGNALS = ["NAME_SIMILARITY", "OFFICIAL_IDENTITY_CONFLICT"] as const;

// Campaign types whose own derivation already indicates brand-impersonation.
const BRAND_IMPERSONATION_CAMPAIGN_TYPES: ReadonlySet<CampaignType> = new Set([
  "CROSS_PLATFORM_IMPERSONATION",
  "SOCIAL_IMPERSONATION",
  "APP_IMPERSONATION",
  "MULTI_ASSET_BRAND_IMPERSONATION",
]);

// Attack-path step labels (fixed vocabulary — the model may only pick from it).
export const ATTACK_PATH_STEPS = {
  IDENTITY: "Impersonated brand identity",
  SOCIAL: "User-facing social account",
  APP_LISTING: "User-facing application listing",
  SUPPORT_LURE: "Support-oriented lure",
  EXTERNAL_DOMAIN: "External domain reference",
  CAMPAIGN: "Coordinated campaign assets",
} as const;

// Narrative hygiene rules — applied to deterministic and model prose alike.
const FORBIDDEN_PROSE = /\b(fake|scam|malicious|definitely|certainly)\b/i;
const FORBIDDEN_ACTION =
  /\b(ban|block|takedown|take down|suspend|remove the account|contact the platform|accuse)\b/i;
const DOMAIN_TOKEN_PATTERN = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/gi;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const typeLabel = (campaignType: CampaignType): string =>
  campaignType.toLowerCase().replace(/_/g, " ");

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Domain-like tokens used for narrative validation only (never detection):
// every dot-separated label must be ≥2 chars so "e.g"/"0.75" never count.
export const domainTokens = (text: string): string[] =>
  (text.toLowerCase().match(DOMAIN_TOKEN_PATTERN) ?? []).filter((token) =>
    token.split(".").every((part) => part.length >= 2),
  );

export const getInvestigationConfidenceLevel = (
  score: number,
): InvestigationConfidenceLevel => {
  const { MEDIUM, HIGH } = INVESTIGATION_THRESHOLDS.LEVEL;
  if (score >= HIGH) return "HIGH";
  if (score >= MEDIUM) return "MEDIUM";
  return "LOW";
};

// ---------------------------------------------------------------------------
// Facts + threat intent + investigation confidence (deterministic)
// ---------------------------------------------------------------------------

interface InvestigationFacts {
  type: "SOCIAL" | "APP";
  value: string;
  name: string | null;
  brandName: string;
  isOfficialCandidate: boolean;
  protectiveSignals: string[];
  appIdentity: boolean;
  supportLure: boolean;
  externalDomain: boolean;
  identityHigh: boolean;
  brandMaterial: boolean;
  accountIdentity: boolean;
  campaignType: CampaignType | null;
  campaignBrandImpersonation: boolean;
}

const collectFacts = (input: AIInvestigatorInput): InvestigationFacts => {
  const { evidence, explanation, campaign } = input;
  const items = evidence.evidence;
  const protectiveSignals = explanation.protectiveSignals;

  const present = (signal: string, min: SimilarityLevel = "LOW"): boolean =>
    items.some(
      (item) =>
        item.signal === signal && SEVERITY_RANK[item.severity] >= SEVERITY_RANK[min],
    );
  const presentAny = (signals: readonly string[], min: SimilarityLevel): boolean =>
    signals.some((signal) => present(signal, min));

  const campaignType = campaign.campaign?.campaignType ?? null;

  return {
    type: evidence.type,
    value: input.candidate.value,
    name: input.candidate.name ?? null,
    brandName: input.brand.name,
    isOfficialCandidate:
      protectiveSignals.includes("OFFICIAL_ACCOUNT_MATCH") ||
      protectiveSignals.includes("OFFICIAL_APP_MATCH"),
    protectiveSignals,
    appIdentity:
      evidence.type === "APP" && presentAny(APP_IDENTITY_SIGNALS, "MEDIUM"),
    supportLure: present("SUPPORT_LANGUAGE", "MEDIUM"),
    // EXTERNAL_DOMAIN is emitted at a fixed MEDIUM score by Tasks 9/10 — its
    // presence (any severity) is the infrastructure observation.
    externalDomain: present("EXTERNAL_DOMAIN"),
    identityHigh: presentAny(IDENTITY_RESEMBLANCE_SIGNALS, "HIGH"),
    brandMaterial: presentAny(BRAND_MATERIAL_SIGNALS, "MEDIUM"),
    accountIdentity:
      evidence.type === "SOCIAL" && presentAny(ACCOUNT_IDENTITY_SIGNALS, "MEDIUM"),
    campaignType,
    campaignBrandImpersonation:
      campaignType !== null && BRAND_IMPERSONATION_CAMPAIGN_TYPES.has(campaignType),
  };
};

/**
 * Conservative threat-intent selection — first supported predicate wins, in
 * fixed priority order. Each predicate references only existing evidence;
 * nothing is inferred when the evidence does not support the classification.
 */
export const deriveThreatIntent = (
  input: AIInvestigatorInput,
): { primary: ThreatIntent; supported: ThreatIntent[] } => {
  const facts = collectFacts(input);
  const supported: ThreatIntent[] = [];

  // 1. CREDENTIAL_TARGETING — requires credential/OTP-harvesting evidence.
  //    No Task 11 signal records that behaviour today, so it is never emitted.

  if (facts.appIdentity) supported.push("APP_IMPERSONATION");
  if (facts.supportLure && facts.externalDomain) supported.push("SUPPORT_SCAM_PATTERN");
  if (facts.externalDomain && facts.identityHigh) supported.push("PHISHING_LURE");
  if (facts.brandMaterial || facts.campaignBrandImpersonation) {
    supported.push("BRAND_IMPERSONATION");
  }
  if (
    facts.accountIdentity &&
    (facts.supportLure || facts.externalDomain)
  ) {
    supported.push("ACCOUNT_IMPERSONATION");
  }

  return { primary: supported[0] ?? "UNKNOWN", supported };
};

/**
 * Investigation confidence ∈ [0,100] — breadth/strength of the supplied
 * evidence plus corroboration. Deliberately NOT the Task 12 risk score,
 * NOT the Task 12 confidence (0..1) and NOT the Task 15 campaign confidence;
 * an LLM never supplies this number.
 */
export const deriveInvestigationConfidence = (
  input: AIInvestigatorInput,
): { confidence: number; confidenceLevel: InvestigationConfidenceLevel } => {
  const { evidence, risk, campaign, correlation } = input;
  const count = evidence.evidenceCount;
  const meanScore =
    count > 0
      ? evidence.evidence.reduce((sum, item) => sum + clamp01(item.score), 0) / count
      : 0;
  const weights = INVESTIGATION_THRESHOLDS.CONFIDENCE;
  const campaignScore =
    campaign.campaignDetected && campaign.campaign
      ? campaign.campaign.confidenceScore
      : 0;
  const raw =
    weights.EVIDENCE_WEIGHT * Math.min(1, count / weights.EVIDENCE_DIVISOR) +
    weights.CATEGORY_WEIGHT *
      Math.min(1, risk.independentSourceCount / weights.CATEGORY_DIVISOR) +
    weights.STRENGTH_WEIGHT * meanScore +
    weights.CAMPAIGN_WEIGHT * (campaignScore / 100) +
    weights.CORRELATION_WEIGHT *
      Math.min(1, correlation.relatedCandidates.length / weights.CORRELATION_DIVISOR);
  const confidence = Math.min(
    INVESTIGATION_THRESHOLDS.MAX_SCORE,
    Math.max(0, Math.round(raw)),
  );
  return { confidence, confidenceLevel: getInvestigationConfidenceLevel(confidence) };
};

// ---------------------------------------------------------------------------
// Deterministic fallback investigator
// ---------------------------------------------------------------------------

interface InvestigationContext {
  input: AIInvestigatorInput;
  facts: InvestigationFacts;
  intent: { primary: ThreatIntent; supported: ThreatIntent[] };
  confidence: number;
  confidenceLevel: InvestigationConfidenceLevel;
}

const itemFor = (
  items: EvidenceItem[],
  signal: string,
): EvidenceItem | undefined => items.find((item) => item.signal === signal);

const strongestIdentityItem = (
  items: EvidenceItem[],
): EvidenceItem | undefined => {
  const candidates = items.filter(
    (item) =>
      !isProtectiveSignal(item.signal) &&
      (IDENTITY_RESEMBLANCE_SIGNALS as readonly string[]).includes(item.signal),
  );
  return candidates.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.score - a.score ||
      a.signal.localeCompare(b.signal),
  )[0];
};

const buildHeadline = (ctx: InvestigationContext): string => {
  const { input, facts } = ctx;
  const { risk, campaign } = input;
  const limits = INVESTIGATION_THRESHOLDS.PROSE;

  if (facts.isOfficialCandidate) {
    return clip(
      `${facts.value}: protective official-asset evidence (${facts.protectiveSignals.join(", ")}) ` +
        `bounds this investigation — risk ${risk.riskScore}/100 ${risk.riskLevel}`,
      limits.HEADLINE_MAX,
    );
  }
  if (campaign.campaignDetected && campaign.campaign) {
    return clip(
      `${facts.value}: evidence is consistent with a coordinated ` +
        `${typeLabel(campaign.campaign.campaignType)} campaign against ${facts.brandName} ` +
        `(${plural(campaign.campaign.assetCount, "asset")}, ` +
        `campaign confidence ${campaign.campaign.confidenceScore}/100)`,
      limits.HEADLINE_MAX,
    );
  }
  if (risk.reasons.length > 0) {
    return clip(
      `${facts.value}: observed indicators suggest impersonation risk against ` +
        `${facts.brandName} (risk ${risk.riskScore}/100 ${risk.riskLevel}, ` +
        `${plural(risk.reasons.length, "risk signal")}) — no coordinated campaign detected`,
      limits.HEADLINE_MAX,
    );
  }
  return clip(
    `${facts.value}: the available evidence is insufficient to indicate impersonation ` +
      `of ${facts.brandName} (risk ${risk.riskScore}/100 ${risk.riskLevel})`,
    limits.HEADLINE_MAX,
  );
};

const buildAssessment = (ctx: InvestigationContext): string => {
  const { input, facts, intent, confidence, confidenceLevel } = ctx;
  const { evidence, risk, correlation, campaign } = input;
  const limits = INVESTIGATION_THRESHOLDS.PROSE;
  const parts: string[] = [];

  parts.push(
    `${facts.type} candidate ${facts.value}${facts.name ? ` ("${facts.name}")` : ""} ` +
      `assessed against ${facts.brandName} with ` +
      `${plural(input.officialAssets.length, "registered official asset")}.`,
  );

  if (evidence.evidence.length > 0) {
    const listed = evidence.evidence
      .slice(0, INVESTIGATION_THRESHOLDS.LIMITS.STRONGEST_EVIDENCE)
      .map((item) => `${item.signal} (${item.severity}, ${item.source})`)
      .join(", ");
    parts.push(
      `Evidence: ${listed}${listed.length < evidence.evidence.length ? ", …" : ""}.`,
    );
  } else {
    parts.push(
      `No comparative evidence could be collected${
        evidence.unavailable.length > 0
          ? ` (unavailable: ${evidence.unavailable.map((entry) => entry.source).join(", ")})`
          : ""
      }.`,
    );
  }

  parts.push(
    `The deterministic risk engine scores this candidate ${risk.riskScore}/100 ` +
      `${risk.riskLevel} (confidence ${risk.confidence}) from ` +
      `${plural(risk.evidenceCount, "evidence item")}.`,
  );

  if (risk.reasons.length > 0) {
    const signals = risk.reasons
      .slice(0, INVESTIGATION_THRESHOLDS.LIMITS.REASONS_NOTED)
      .map((reason) => reason.signal)
      .join(", ");
    parts.push(`Strongest risk contributions: ${signals}.`);
  }

  if (correlation.relatedCandidates.length > 0) {
    const top = correlation.relatedCandidates[0];
    parts.push(
      `${plural(correlation.relatedCandidates.length, "related candidate")} of the ` +
        `same brand share evidence — strongest relationship ` +
        `${top.relationshipScore}/100 ${top.relationshipLevel}` +
        `${campaign.campaignDetected ? "" : "; no coordinated campaign detected"}.`,
    );
  } else {
    parts.push(`No other candidate of the same brand shares evidence with this candidate.`);
  }

  if (campaign.campaignDetected && campaign.campaign) {
    parts.push(
      `The observed indicators suggest a ${typeLabel(campaign.campaign.campaignType)} ` +
        `campaign across ${plural(campaign.campaign.assetCount, "asset")} — ` +
        `campaign confidence ${campaign.campaign.confidenceScore}/100 ` +
        `(${campaign.campaign.confidenceLevel}).`,
    );
  }

  if (facts.protectiveSignals.length > 0) {
    parts.push(
      `Protective evidence (${facts.protectiveSignals.join(", ")}) is present and ` +
        `official-asset protection keeps the assessment bounded.`,
    );
  }

  if (intent.primary === "UNKNOWN") {
    parts.push(`The available evidence does not support a specific threat intent.`);
  } else {
    const secondary = intent.supported.slice(
      1,
      1 + INVESTIGATION_THRESHOLDS.LIMITS.SECONDARY_INTENTS,
    );
    parts.push(
      `The observed indicators suggest ${intent.primary} as the primary threat intent` +
        `${secondary.length > 0 ? `; also consistent with ${secondary.join(", ")}` : ""}.`,
    );
  }

  parts.push(
    `Investigation confidence ${confidence}/100 (${confidenceLevel}).`,
  );

  return clip(parts.join(" "), limits.ASSESSMENT_MAX);
};

const buildKeyFindings = (ctx: InvestigationContext): InvestigationKeyFinding[] => {
  const { input } = ctx;
  const { evidence, risk, correlation, campaign } = input;
  const limits = INVESTIGATION_THRESHOLDS.LIMITS;
  const findings: InvestigationKeyFinding[] = [];

  if (campaign.campaignDetected && campaign.campaign) {
    findings.push({
      finding:
        `Coordinated campaign: ${typeLabel(campaign.campaign.campaignType)} across ` +
        `${plural(campaign.campaign.assetCount, "asset")}`,
      evidence: campaign.explanation,
      importance: "HIGH",
    });
  }

  for (const reason of risk.reasons.slice(0, limits.REASONS_NOTED)) {
    const backing = evidence.evidence.find(
      (item) => item.signal === reason.signal && item.reason === reason.reason,
    );
    findings.push({
      finding:
        `${reason.signal} at ${backing ? backing.severity : "MEDIUM"} severity ` +
        `contributed ${plural(reason.impact, "point")} to the risk`,
      evidence: reason.reason,
      importance:
        reason.impact >= RISK_ENGINE_THRESHOLDS.SEVERITY_WEIGHT.MEDIUM
          ? "HIGH"
          : reason.impact >= 10
            ? "MEDIUM"
            : "LOW",
    });
    if (findings.length >= limits.KEY_FINDINGS) break;
  }

  if (correlation.relatedCandidates.length > 0 && findings.length < limits.KEY_FINDINGS) {
    const top = correlation.relatedCandidates[0];
    const topLink = top.links[0];
    findings.push({
      finding:
        `${plural(correlation.relatedCandidates.length, "related candidate")} share ` +
        `infrastructure or brand evidence`,
      evidence:
        topLink?.explanation ??
        `Strongest relationship ${top.relationshipScore}/100 ${top.relationshipLevel}.`,
      importance: top.relationshipScore >= CAMPAIGN_THRESHOLDS.LEVEL.HIGH ? "HIGH" : "MEDIUM",
    });
  }

  if (ctx.facts.protectiveSignals.length > 0 && findings.length < limits.KEY_FINDINGS) {
    const PROTECTIVE_WHY_NOT = [
      "OFFICIAL_ACCOUNT_MATCH",
      "OFFICIAL_APP_MATCH",
      "OFFICIAL_DOMAIN_MATCH",
    ];
    const entry = input.explanation.whyNotFlagged.find((item) =>
      PROTECTIVE_WHY_NOT.includes(item.signal),
    );
    findings.push({
      finding: `Protective official evidence present: ${ctx.facts.protectiveSignals.join(", ")}`,
      evidence:
        entry?.explanation ??
        `Official-asset protection applies (${ctx.facts.protectiveSignals.join(", ")}).`,
      importance: "HIGH",
    });
  }

  return findings.slice(0, limits.KEY_FINDINGS);
};

const buildStrongestEvidence = (
  ctx: InvestigationContext,
): StrongestEvidenceEntry[] => {
  const items = [...ctx.input.evidence.evidence];
  items.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.score - a.score ||
      EVIDENCE_SOURCE_ORDER.indexOf(a.source) - EVIDENCE_SOURCE_ORDER.indexOf(b.source) ||
      a.signal.localeCompare(b.signal),
  );
  return items.slice(0, INVESTIGATION_THRESHOLDS.LIMITS.STRONGEST_EVIDENCE).map((item) => ({
    source: item.source,
    signal: item.signal,
    strength: item.severity,
    explanation: item.reason,
  }));
};

const buildCampaignAssessment = (input: AIInvestigatorInput): CampaignAssessment => {
  const { campaign } = input;
  if (campaign.campaignDetected && campaign.campaign) {
    return {
      detected: true,
      campaignType: campaign.campaign.campaignType,
      confidence: campaign.campaign.confidenceScore,
      memberCount: campaign.campaign.assetCount,
      explanation: campaign.explanation,
    };
  }
  return {
    detected: false,
    campaignType: null,
    confidence: null,
    memberCount: 0,
    explanation: campaign.explanation,
  };
};

const buildAttackPath = (ctx: InvestigationContext): AttackPathStep[] => {
  const { input, facts } = ctx;
  const items = input.evidence.evidence;
  if (facts.isOfficialCandidate) return [];

  const lead: AttackPathStep[] = [];
  const identityItem = strongestIdentityItem(items);
  const leadSupported =
    facts.brandMaterial || (facts.identityHigh && (facts.supportLure || facts.externalDomain));
  if (leadSupported && identityItem) {
    lead.push({ step: ATTACK_PATH_STEPS.IDENTITY, evidence: identityItem.reason });
  }

  const channel: AttackPathStep[] = [];
  const supportItem = itemFor(items, "SUPPORT_LANGUAGE");
  if (facts.supportLure && supportItem) {
    channel.push({ step: ATTACK_PATH_STEPS.SUPPORT_LURE, evidence: supportItem.reason });
  }
  const domainItem = itemFor(items, "EXTERNAL_DOMAIN");
  if (facts.externalDomain && domainItem) {
    channel.push({ step: ATTACK_PATH_STEPS.EXTERNAL_DOMAIN, evidence: domainItem.reason });
  }

  const tail: AttackPathStep[] = [];
  if (input.campaign.campaignDetected) {
    tail.push({ step: ATTACK_PATH_STEPS.CAMPAIGN, evidence: input.campaign.explanation });
  }

  if (lead.length + channel.length + tail.length === 0) return [];

  const staging: AttackPathStep =
    facts.type === "SOCIAL"
      ? {
          step: ATTACK_PATH_STEPS.SOCIAL,
          evidence: `Candidate ${facts.value} is a SOCIAL candidate associated with ${facts.brandName}.`,
        }
      : {
          step: ATTACK_PATH_STEPS.APP_LISTING,
          evidence: `Candidate ${facts.value} is an APP candidate associated with ${facts.brandName}.`,
        };

  return [
    ...lead,
    staging,
    ...channel,
    ...tail,
  ].slice(0, INVESTIGATION_THRESHOLDS.LIMITS.ATTACK_PATH);
};

const buildUncertainties = (ctx: InvestigationContext): Uncertainty[] => {
  const { input, facts, confidence, confidenceLevel } = ctx;
  const { evidence, risk, correlation, campaign } = input;
  const limits = INVESTIGATION_THRESHOLDS.LIMITS;
  const entries: Uncertainty[] = [];

  if (facts.protectiveSignals.length > 0) {
    entries.push({
      issue: "Official asset protection present",
      reason:
        `Protective evidence (${facts.protectiveSignals.join(", ")}) is present — ` +
        `escalation is bounded by official-asset protection.`,
    });
  }

  const logoUnavailable = evidence.unavailable.find((entry) => entry.source === "LOGO");
  if (logoUnavailable) {
    entries.push({
      issue: "Logo evidence unavailable",
      reason:
        "The target brand has no registered official logo, so no logo " +
        "similarity evidence could be collected for this candidate.",
    });
  }

  if (!facts.externalDomain && !campaign.campaignDetected) {
    entries.push({
      issue: "No shared infrastructure evidence",
      reason:
        `No external domain or URL was found in this candidate's evidence, and no ` +
        `campaign shares infrastructure with it.`,
    });
  }

  if (correlation.relatedCandidates.length === 0 && !campaign.campaignDetected) {
    entries.push({
      issue: "No correlated candidates",
      reason: `No other candidate of the same brand shares evidence with this candidate.`,
    });
  }

  if (campaign.campaignDetected && campaign.campaign) {
    const { confidenceScore, confidenceLevel: level } = campaign.campaign;
    if (confidenceScore < CAMPAIGN_THRESHOLDS.LEVEL.HIGH) {
      entries.push({
        issue: "Campaign confidence below HIGH",
        reason:
          `Campaign confidence ${confidenceScore}/100 (${level}) is below the HIGH ` +
          `threshold (${CAMPAIGN_THRESHOLDS.LEVEL.HIGH}/100).`,
      });
    }
  }

  if (evidence.evidenceCount <= 2) {
    entries.push({
      issue: "Limited evidence coverage",
      reason:
        `${plural(evidence.evidenceCount, "evidence item")} across ` +
        `${plural(risk.independentSourceCount, "categor")} — the assessment rests on ` +
        `thin coverage.`,
    });
  }

  if (!facts.name && !input.candidate.description) {
    entries.push({
      issue: "Insufficient candidate metadata",
      reason: `Candidate has no name or description — only the value could be analyzed.`,
    });
  }

  if (confidenceLevel === "LOW") {
    entries.push({
      issue: "Investigation confidence is LOW",
      reason:
        `Investigation confidence ${confidence}/100 reflects limited evidence ` +
        `breadth and strength.`,
    });
  }

  return entries.slice(0, limits.UNCERTAINTIES);
};

const buildRecommendedActions = (ctx: InvestigationContext): RecommendedAction[] => {
  const { input, facts } = ctx;
  const { evidence, risk, correlation, campaign } = input;
  const limits = INVESTIGATION_THRESHOLDS.LIMITS;
  const actions: RecommendedAction[] = [];

  if (campaign.campaignDetected && campaign.campaign) {
    const infra = campaign.campaign.indicators.find(
      (indicator) => indicator.type === "SHARED_SUSPICIOUS_INFRASTRUCTURE",
    );
    if (infra) {
      actions.push({
        priority: "HIGH",
        action: `Review the shared external domain and URL infrastructure referenced by the campaign`,
        reason: infra.explanation,
      });
    }
    if (campaign.campaign.appAssetCount > 0) {
      actions.push({
        priority: "HIGH",
        action: `Verify the publisher or developer identity of the related application`,
        reason: campaign.explanation,
      });
    }
  }

  if (risk.riskLevel === "HIGH" || risk.riskLevel === "CRITICAL") {
    actions.push({
      priority: "HIGH",
      action: `Prioritize analyst investigation of this candidate`,
      reason:
        `Deterministic risk ${risk.riskScore}/100 ${risk.riskLevel} from ` +
        `${plural(risk.evidenceCount, "evidence item")}.`,
    });
  }

  const highSignals = [
    ...new Set(
      evidence.evidence
        .filter((item) => !isProtectiveSignal(item.signal) && item.severity === "HIGH")
        .map((item) => item.signal),
    ),
  ].sort();
  if (highSignals.length > 0) {
    actions.push({
      priority: "HIGH",
      action: `Preserve screenshots and source evidence for this candidate`,
      reason: `High-severity evidence recorded: ${highSignals.join(", ")}.`,
    });
  }

  if (correlation.relatedCandidates.length > 0) {
    const top = correlation.relatedCandidates[0];
    actions.push({
      priority: "MEDIUM",
      action: `Review the connected candidate accounts and assets`,
      reason:
        `Strongest relationship ${top.relationshipScore}/100 ` +
        `(${top.relationshipLevel}) with ` +
        `${plural(correlation.relatedCandidates.length, "related candidate")}.`,
    });
  }

  if (facts.externalDomain) {
    const domainItem = itemFor(evidence.evidence, "EXTERNAL_DOMAIN");
    actions.push({
      priority: "MEDIUM",
      action: `Verify ownership of the referenced external infrastructure`,
      reason: domainItem?.reason ?? `Candidate references an external domain.`,
    });
  }

  if (correlation.relatedCandidates.length > 0 && !campaign.campaignDetected) {
    actions.push({
      priority: "MEDIUM",
      action: `Monitor related assets for coordinated behavior`,
      reason:
        `Correlation cluster of ${plural(correlation.cluster.size, "candidate")} ` +
        `without a detected campaign.`,
    });
  }

  if (!facts.name && !input.candidate.description) {
    actions.push({
      priority: "LOW",
      action: `Gather more metadata before escalation`,
      reason: `Candidate has no name or description — only the value could be analyzed.`,
    });
  }

  actions.push({
    priority: "LOW",
    action: `Continue monitoring this candidate`,
    reason: input.explanation.summary,
  });

  return actions.slice(0, limits.RECOMMENDED_ACTIONS);
};

/**
 * Deterministic fallback investigator — every claim is derived from the
 * supplied structured results (Tasks 11–15); no LLM, no invented facts,
 * no risk recomputation, no enforcement recommendations.
 */
export const deterministicInvestigation = (
  input: AIInvestigatorInput,
): Investigation => {
  const facts = collectFacts(input);
  const intent = deriveThreatIntent(input);
  const { confidence, confidenceLevel } = deriveInvestigationConfidence(input);
  const ctx: InvestigationContext = { input, facts, intent, confidence, confidenceLevel };

  return {
    headline: buildHeadline(ctx),
    assessment: buildAssessment(ctx),
    threatIntent: intent.primary,
    secondaryIntents: intent.supported
      .slice(1, 1 + INVESTIGATION_THRESHOLDS.LIMITS.SECONDARY_INTENTS),
    confidence,
    confidenceLevel,
    keyFindings: buildKeyFindings(ctx),
    strongestEvidence: buildStrongestEvidence(ctx),
    campaignAssessment: buildCampaignAssessment(input),
    attackPath: buildAttackPath(ctx),
    uncertainties: buildUncertainties(ctx),
    recommendedActions: buildRecommendedActions(ctx),
    source: "DETERMINISTIC",
  };
};

// ---------------------------------------------------------------------------
// AI provider interface (optional — isolated behind this boundary)
// ---------------------------------------------------------------------------

export interface AIProviderRequest {
  system: string;
  user: string;
}

export interface AIProvider {
  readonly name: string;
  /** Returns raw model text, or null on any transport/provider failure. */
  complete(request: AIProviderRequest): Promise<string | null>;
}

export interface AIProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

// Read from process.env at call time (dotenv is loaded by config/env before
// routes run). No key → no provider → deterministic fallback, always.
export const readAIProviderConfig = (
  env: Record<string, string | undefined> = process.env,
): AIProviderConfig | null => {
  const apiKey = (env.AEGIS_AI_API_KEY ?? "").trim();
  if (apiKey === "") return null;
  const baseUrl = (env.AEGIS_AI_BASE_URL ?? "https://api.openai.com/v1")
    .trim()
    .replace(/\/+$/, "");
  const model = (env.AEGIS_AI_MODEL ?? "").trim() || "gpt-4o-mini";
  const rawTimeout = Number(env.AEGIS_AI_TIMEOUT_MS ?? "8000");
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.min(rawTimeout, 60_000)
      : 8000;
  return { apiKey, baseUrl, model, timeoutMs };
};

// Minimal OpenAI-compatible chat-completions transport — no SDK dependency.
// The key is only ever placed in the Authorization header; failures return
// null without logging config, prompts or response bodies.
export const createOpenAICompatibleProvider = (
  config: AIProviderConfig,
  fetchImpl: typeof fetch = fetch,
): AIProvider => ({
  name: "openai-compatible",
  async complete(request: AIProviderRequest): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(
        `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload?.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
});

export const resolveProvider = (
  env: Record<string, string | undefined> = process.env,
): AIProvider | null => {
  const config = readAIProviderConfig(env);
  return config === null ? null : createOpenAICompatibleProvider(config);
};

// ---------------------------------------------------------------------------
// Prompt + strict response validation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are a digital-risk investigation assistant.",
  "You may only reason from the supplied structured evidence.",
  "Never invent evidence, relationships, domains, accounts, applications, people, or events.",
  "Do not override deterministic risk or official-asset protection.",
  "Distinguish evidence from inference.",
  "Use cautious language when evidence is incomplete (for example: 'Evidence is consistent with...', 'The observed indicators suggest...', 'The available evidence supports...').",
  "Never use absolute verdict language: no 'fake', 'scam', 'malicious', 'definitely' or 'certainly'.",
  "Return valid structured JSON only, optionally using these keys: headline, assessment, threatIntent, secondaryIntents, keyFindings, uncertainties, recommendedActions, attackPath.",
  "threatIntent must be chosen from the allowedIntents list; attackPath steps must be chosen from the allowedAttackSteps list (in the given order).",
  "Omit any key you cannot support from the supplied evidence.",
].join(" ");

const PROMPT_FIELD_CLIP = 300;

export const buildAIValidationContext = (
  input: AIInvestigatorInput,
  base: Investigation,
): AIValidationContext => {
  const { primary, supported } = deriveThreatIntent(input);
  const texts: string[] = [
    input.candidate.value,
    input.candidate.name ?? "",
    input.candidate.description ?? "",
    input.brand.website ?? "",
    input.brand.logoUrl ?? "",
    ...input.officialAssets.map((asset) => asset.value),
    ...input.evidence.evidence.map((item) => item.reason),
    ...input.evidence.unavailable.map((entry) => entry.reason),
    ...input.risk.reasons.map((reason) => reason.reason),
    input.explanation.summary,
    ...input.explanation.whyFlagged.map((entry) => entry.explanation),
    ...input.explanation.whyNotFlagged.map((entry) => entry.explanation),
    input.correlation.cluster.candidateIds.join(" "),
    ...input.correlation.relatedCandidates.flatMap((related) =>
      related.links.map((link) => link.explanation),
    ),
    input.campaign.explanation,
    ...(input.campaign.campaign?.indicators.map((indicator) => indicator.explanation) ??
      []),
    ...(input.campaign.campaign?.relationships.flatMap((relationship) =>
      relationship.links.map((link) => link.explanation),
    ) ?? []),
  ];
  const allowedDomains = new Set(
    texts.flatMap((text) => domainTokens(text)),
  );
  return {
    allowedDomains,
    allowedIntents: [...supported, "UNKNOWN"],
    primaryIntent: primary,
    allowedAttackSteps: base.attackPath.map((step) => step.step),
  };
};

export interface AIValidationContext {
  allowedDomains: Set<string>;
  allowedIntents: ThreatIntent[];
  primaryIntent: ThreatIntent;
  allowedAttackSteps: string[];
}

export const buildProviderRequest = (
  input: AIInvestigatorInput,
  context: AIValidationContext,
): AIProviderRequest => {
  const { evidence, risk, explanation, correlation, campaign } = input;
  const prompt = {
    candidate: {
      id: input.candidate.id,
      type: evidence.type,
      value: clip(input.candidate.value, 160),
      name: input.candidate.name,
      description:
        input.candidate.description === null
          ? null
          : clip(input.candidate.description, PROMPT_FIELD_CLIP),
    },
    brand: {
      name: input.brand.name,
      website: input.brand.website,
      logoRegistered: input.brand.logoUrl !== null,
    },
    officialAssets: input.officialAssets.slice(0, 12).map((asset) => ({
      type: asset.type,
      value: clip(asset.value, 160),
    })),
    evidence: evidence.evidence.slice(0, 12).map((item) => ({
      source: item.source,
      signal: item.signal,
      severity: item.severity,
      score: item.score,
      reason: clip(item.reason, PROMPT_FIELD_CLIP),
    })),
    unavailable: evidence.unavailable.map((entry) => ({
      source: entry.source,
      reason: clip(entry.reason, PROMPT_FIELD_CLIP),
    })),
    risk: {
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      confidence: risk.confidence,
      reasons: risk.reasons.slice(0, 6).map((reason) => ({
        signal: reason.signal,
        impact: reason.impact,
        reason: clip(reason.reason, PROMPT_FIELD_CLIP),
      })),
    },
    explanation: {
      summary: clip(explanation.summary, PROMPT_FIELD_CLIP),
      protectiveSignals: explanation.protectiveSignals,
      whyNotFlagged: explanation.whyNotFlagged.slice(0, 4).map((entry) => ({
        signal: entry.signal,
        explanation: clip(entry.explanation, PROMPT_FIELD_CLIP),
      })),
    },
    correlation: {
      cluster: correlation.cluster,
      relatedCandidates: correlation.relatedCandidates.slice(0, 6).map((related) => ({
        candidateId: related.candidateId,
        relationshipScore: related.relationshipScore,
        relationshipLevel: related.relationshipLevel,
        links: related.links.map((link) => ({
          type: link.type,
          strength: link.strength,
          explanation: clip(link.explanation, PROMPT_FIELD_CLIP),
        })),
      })),
    },
    campaign: campaign.campaignDetected && campaign.campaign
      ? {
          campaignDetected: true,
          campaignType: campaign.campaign.campaignType,
          confidenceScore: campaign.campaign.confidenceScore,
          confidenceLevel: campaign.campaign.confidenceLevel,
          candidateIds: campaign.campaign.candidateIds,
          indicators: campaign.campaign.indicators.slice(0, 6).map((indicator) => ({
            type: indicator.type,
            strength: indicator.strength,
            explanation: clip(indicator.explanation, PROMPT_FIELD_CLIP),
          })),
          explanation: clip(campaign.explanation, PROMPT_FIELD_CLIP),
        }
      : { campaignDetected: false, explanation: campaign.explanation },
    allowedIntents: context.allowedIntents,
    allowedAttackSteps: context.allowedAttackSteps,
  };
  return { system: SYSTEM_PROMPT, user: JSON.stringify(prompt) };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const proseOk = (
  value: unknown,
  max: number,
  context: AIValidationContext,
): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !FORBIDDEN_PROSE.test(value) &&
  !FORBIDDEN_ACTION.test(value) &&
  domainTokens(value).every((token) => context.allowedDomains.has(token));

/**
 * Strict model-response validation. ANY violation (invalid JSON, wrong types,
 * unknown keys — including attempts to inject risk/confidence/campaign fields,
 * invented domains, verdict language, unsupported intents or attack steps)
 * returns null and the caller falls back to the deterministic investigation.
 */
export const parseAIProviderResponse = (
  raw: string | null | undefined,
  context: AIValidationContext,
): Partial<Investigation> | null => {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const limits = INVESTIGATION_THRESHOLDS.LIMITS;
  const prose = INVESTIGATION_THRESHOLDS.PROSE;
  const allowedKeys = new Set([
    "headline",
    "assessment",
    "threatIntent",
    "secondaryIntents",
    "keyFindings",
    "uncertainties",
    "recommendedActions",
    "attackPath",
  ]);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) return null;
  }

  const out: Partial<Investigation> = {};

  if ("headline" in parsed) {
    if (!proseOk(parsed.headline, prose.HEADLINE_MAX, context)) return null;
    out.headline = parsed.headline;
  }
  if ("assessment" in parsed) {
    if (!proseOk(parsed.assessment, prose.ASSESSMENT_MAX, context)) return null;
    out.assessment = parsed.assessment;
  }

  if ("threatIntent" in parsed) {
    if (
      typeof parsed.threatIntent !== "string" ||
      !context.allowedIntents.includes(parsed.threatIntent as ThreatIntent)
    ) {
      return null;
    }
    out.threatIntent = parsed.threatIntent as ThreatIntent;
  }

  if ("secondaryIntents" in parsed) {
    const list = parsed.secondaryIntents;
    if (!Array.isArray(list) || list.length > limits.SECONDARY_INTENTS) return null;
    const seen = new Set<ThreatIntent>();
    const chosen: ThreatIntent[] = [];
    for (const entry of list) {
      if (
        typeof entry !== "string" ||
        !context.allowedIntents.includes(entry as ThreatIntent)
      ) {
        return null;
      }
      const intent = entry as ThreatIntent;
      if (intent === (out.threatIntent ?? context.primaryIntent) || seen.has(intent)) {
        return null;
      }
      seen.add(intent);
      chosen.push(intent);
    }
    out.secondaryIntents = chosen;
  }

  if ("keyFindings" in parsed) {
    const list = parsed.keyFindings;
    if (!Array.isArray(list) || list.length > limits.KEY_FINDINGS) return null;
    const findings: InvestigationKeyFinding[] = [];
    for (const entry of list) {
      if (
        !isPlainObject(entry) ||
        !exactKeys(entry, ["evidence", "finding", "importance"]) ||
        !proseOk(entry.finding, prose.FIELD_MAX, context) ||
        !proseOk(entry.evidence, prose.FIELD_MAX * 2, context) ||
        !["HIGH", "MEDIUM", "LOW"].includes(String(entry.importance))
      ) {
        return null;
      }
      findings.push({
        finding: entry.finding as string,
        evidence: entry.evidence as string,
        importance: entry.importance as InvestigationImportance,
      });
    }
    out.keyFindings = findings;
  }

  if ("uncertainties" in parsed) {
    const list = parsed.uncertainties;
    if (!Array.isArray(list) || list.length > limits.UNCERTAINTIES) return null;
    const entries: Uncertainty[] = [];
    for (const entry of list) {
      if (
        !isPlainObject(entry) ||
        !exactKeys(entry, ["issue", "reason"]) ||
        !proseOk(entry.issue, prose.FIELD_MAX, context) ||
        !proseOk(entry.reason, prose.FIELD_MAX * 2, context)
      ) {
        return null;
      }
      entries.push({ issue: entry.issue as string, reason: entry.reason as string });
    }
    out.uncertainties = entries;
  }

  if ("recommendedActions" in parsed) {
    const list = parsed.recommendedActions;
    if (!Array.isArray(list) || list.length > limits.RECOMMENDED_ACTIONS) return null;
    const entries: RecommendedAction[] = [];
    for (const entry of list) {
      if (
        !isPlainObject(entry) ||
        !exactKeys(entry, ["action", "priority", "reason"]) ||
        !proseOk(entry.action, prose.FIELD_MAX, context) ||
        !proseOk(entry.reason, prose.FIELD_MAX * 2, context) ||
        !["HIGH", "MEDIUM", "LOW"].includes(String(entry.priority))
      ) {
        return null;
      }
      entries.push({
        priority: entry.priority as InvestigationPriority,
        action: entry.action as string,
        reason: entry.reason as string,
      });
    }
    out.recommendedActions = entries;
  }

  if ("attackPath" in parsed) {
    const list = parsed.attackPath;
    if (!Array.isArray(list) || list.length > limits.ATTACK_PATH) return null;
    const chosen = new Set<string>();
    const steps: AttackPathStep[] = [];
    for (const entry of list) {
      if (
        !isPlainObject(entry) ||
        !exactKeys(entry, ["evidence", "step"]) ||
        typeof entry.step !== "string" ||
        !context.allowedAttackSteps.includes(entry.step) ||
        !proseOk(entry.evidence, prose.FIELD_MAX * 2, context)
      ) {
        return null;
      }
      if (chosen.has(entry.step)) return null;
      chosen.add(entry.step);
      steps.push({ step: entry.step, evidence: entry.evidence as string });
    }
    // normalize to the deterministic path order — the model can only drop steps
    steps.sort(
      (a, b) =>
        context.allowedAttackSteps.indexOf(a.step) -
        context.allowedAttackSteps.indexOf(b.step),
    );
    out.attackPath = steps;
  }

  return Object.keys(out).length > 0 ? out : null;
};

/**
 * Provider selection + merge. Structured fields (confidence, campaign
 * assessment, strongest evidence) always come from the deterministic base —
 * the model may only supply validated narrative/interpretive fields, and any
 * failure (no key, timeout, transport error, invalid or over-reaching output)
 * silently falls back to the deterministic investigator. `source` records
 * which path produced the result; provider payloads and keys are never logged.
 */
export const runInvestigation = async (
  input: AIInvestigatorInput,
  provider?: AIProvider | null,
): Promise<Investigation> => {
  const base = deterministicInvestigation(input);
  const resolved = provider === undefined ? resolveProvider() : provider;
  if (resolved === null) return base;

  const context = buildAIValidationContext(input, base);
  let raw: string | null = null;
  try {
    raw = await resolved.complete(buildProviderRequest(input, context));
  } catch {
    raw = null;
  }
  const parsed = parseAIProviderResponse(raw, context);
  if (parsed === null) return base;

  const merged: Investigation = { ...base, ...parsed, source: "AI" };
  if (parsed.keyFindings !== undefined) {
    // Deterministic findings stay first; model findings are appended within
    // the same cap so narrative additions can never displace observed facts.
    const limits = INVESTIGATION_THRESHOLDS.LIMITS;
    const seen = new Set(base.keyFindings.map((finding) => finding.finding));
    const added = parsed.keyFindings.filter(
      (finding) => !seen.has(finding.finding),
    );
    merged.keyFindings = [...base.keyFindings, ...added].slice(
      0,
      limits.KEY_FINDINGS,
    );
  }
  return merged;
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Assembles the Task 11–15 structured results for one candidate and runs the
 * investigation layer over them. Existing engines are invoked exactly as the
 * other analyze endpoints invoke them — no value is recomputed or overridden.
 */
export const computeInvestigation = async (
  subject: CandidateAsset,
  brand: Brand,
  assets: OfficialAsset[],
  candidates: CandidateAsset[],
  provider?: AIProvider | null,
): Promise<InvestigationResult> => {
  const type = subject.type.trim().toUpperCase() as "SOCIAL" | "APP";
  const { items, unavailable } = await collectEvidence(subject, brand, assets, type);
  const evidence = buildEvidenceResult(subject.id, type, items, unavailable);
  const risk = buildRiskResult(evidence);
  const explanation = buildExplanation(risk);
  const correlation = await buildCorrelationResult(subject, brand, assets, candidates);
  const campaign = await computeCampaignAnalysis(subject, brand, assets, candidates);

  const input: AIInvestigatorInput = {
    candidate: subject,
    brand,
    officialAssets: assets,
    evidence,
    risk,
    explanation,
    correlation,
    campaign,
  };

  return {
    candidateId: subject.id,
    investigation: await runInvestigation(input, provider),
  };
};

export const analyzeCandidateInvestigation = async (
  candidateId: string,
): Promise<InvestigationOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "INVESTIGATION_NOT_APPLICABLE" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  const assets = await listOfficialAssets(brand.id);
  const candidates = await listCandidates({ brandId: brand.id });

  return {
    ok: true,
    data: await computeInvestigation(candidate, brand, assets, candidates),
  };
};
