import { PLAYBOOK_THRESHOLDS } from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById, listCandidates } from "./candidate.service";
import {
  assembleInvestigationInput,
  clip,
  collectFacts,
  deriveThreatIntent,
  plural,
  type AIInvestigatorInput,
  type InvestigationFacts,
  type ThreatIntent,
} from "./ai-investigator.service";
import type { Campaign } from "./campaign.service";

// ---------------------------------------------------------------------------
// Playbook types — predictions consume Tasks 11–16 structured results only.
// ---------------------------------------------------------------------------

// Fixed vocabulary of predicted next attacker actions. Order is significant:
// it is the deterministic tie-break for equally-supported predictions.
export type PlaybookAction =
  | "CREATE_LOOKALIKE_SOCIAL_ACCOUNT"
  | "CREATE_IMPERSONATION_PAGE"
  | "DISTRIBUTE_PHISHING_URL"
  | "PUBLISH_IMPERSONATING_APP"
  | "EXPAND_CAMPAIGN_TO_NEW_PLATFORM"
  | "CREATE_FAKE_SUPPORT_ACCOUNT"
  | "TARGET_VICTIMS_WITH_SUPPORT_LURE"
  | "DEPLOY_PHISHING_DOMAIN"
  | "UNKNOWN_NEXT_STEP";

const ACTION_RANK: Record<PlaybookAction, number> = {
  CREATE_LOOKALIKE_SOCIAL_ACCOUNT: 0,
  CREATE_IMPERSONATION_PAGE: 1,
  DISTRIBUTE_PHISHING_URL: 2,
  PUBLISH_IMPERSONATING_APP: 3,
  EXPAND_CAMPAIGN_TO_NEW_PLATFORM: 4,
  CREATE_FAKE_SUPPORT_ACCOUNT: 5,
  TARGET_VICTIMS_WITH_SUPPORT_LURE: 6,
  DEPLOY_PHISHING_DOMAIN: 7,
  UNKNOWN_NEXT_STEP: 8,
};

export interface PlaybookPrediction {
  action: PlaybookAction;
  confidence: number;
  rationale: string;
  supportingSignals: string[];
}

export interface PlaybookLimitation {
  issue: string;
  reason: string;
}

export interface PlaybookResult {
  candidateId: string;
  predictions: PlaybookPrediction[];
  overallConfidence: number;
  limitations: PlaybookLimitation[];
}

export type PlaybookFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "PLAYBOOK_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type PlaybookOutcome =
  | { ok: true; data: PlaybookResult }
  | { ok: false; code: PlaybookFailureCode };

// ---------------------------------------------------------------------------
// Gate table — each action fires only on existing structured observations.
// ---------------------------------------------------------------------------

interface GateContext {
  facts: InvestigationFacts;
  campaign: Campaign | null;
  campaignDetected: boolean;
  platformCount: number;
  relatedCount: number;
  sharedInfrastructure: boolean;
}

interface GateDefinition {
  action: PlaybookAction;
  // true when a detected campaign of the right shape corroborates the action
  // (raises its confidence via the campaign component and adds a rationale clause)
  corroborated: boolean;
  // candidate supporting-signal vocabulary, in fixed priority order
  signals: readonly string[];
  // true when the signal pool comes from campaign indicators, not evidence
  signalsFromCampaign: boolean;
  intents: ReadonlySet<ThreatIntent>;
  fires: (ctx: GateContext) => boolean;
}

// Actions a detected campaign can corroborate. Support-lure, phishing-domain
// and fake-support actions describe this asset's own behaviour, so a campaign
// never inflates them.
const CAMPAIGN_CORROBORATED: ReadonlySet<PlaybookAction> = new Set([
  "EXPAND_CAMPAIGN_TO_NEW_PLATFORM",
  "PUBLISH_IMPERSONATING_APP",
  "CREATE_LOOKALIKE_SOCIAL_ACCOUNT",
  "CREATE_IMPERSONATION_PAGE",
  "DISTRIBUTE_PHISHING_URL",
]);

const ALL_MALICIOUS_INTENTS: ReadonlySet<ThreatIntent> = new Set<ThreatIntent>([
  "BRAND_IMPERSONATION",
  "ACCOUNT_IMPERSONATION",
  "APP_IMPERSONATION",
  "PHISHING_LURE",
  "SUPPORT_SCAM_PATTERN",
]);

const CAMPAIGN_INDICATOR_POOL = [
  "SHARED_SUSPICIOUS_INFRASTRUCTURE",
  "SHARED_VISUAL_EVIDENCE",
  "CROSS_PLATFORM_PRESENCE",
  "CONSISTENT_BRAND_IMPERSONATION",
  "MULTI_CANDIDATE_CLUSTER",
] as const;

const GATES: readonly GateDefinition[] = [
  {
    action: "CREATE_LOOKALIKE_SOCIAL_ACCOUNT",
    corroborated: true,
    signals: [
      "NAME_SIMILARITY",
      "OFFICIAL_IDENTITY_CONFLICT",
      "TEXT_IDENTITY_MATCH",
      "LOGO_SIMILARITY",
    ],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>([
      "BRAND_IMPERSONATION",
      "ACCOUNT_IMPERSONATION",
      "SUPPORT_SCAM_PATTERN",
    ]),
    fires: (ctx) =>
      ctx.facts.type === "SOCIAL" &&
      ctx.facts.identityMed &&
      (ctx.campaignDetected || ctx.relatedCount >= 1),
  },
  {
    action: "CREATE_IMPERSONATION_PAGE",
    corroborated: true,
    signals: ["TEXT_IDENTITY_MATCH", "BRAND_TEXT_MATCH", "LOGO_SIMILARITY", "EXTERNAL_DOMAIN"],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>(["BRAND_IMPERSONATION", "PHISHING_LURE"]),
    fires: (ctx) => ctx.facts.brandMaterial && ctx.facts.externalDomain,
  },
  {
    action: "DISTRIBUTE_PHISHING_URL",
    corroborated: true,
    signals: ["EXTERNAL_DOMAIN", "SUPPORT_LANGUAGE", "TEXT_IDENTITY_MATCH"],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>(["PHISHING_LURE", "SUPPORT_SCAM_PATTERN"]),
    fires: (ctx) =>
      ctx.facts.externalDomain && (ctx.facts.supportLure || ctx.sharedInfrastructure),
  },
  {
    action: "PUBLISH_IMPERSONATING_APP",
    corroborated: true,
    signals: [
      "APP_NAME_SIMILARITY",
      "PACKAGE_IDENTIFIER_SIMILARITY",
      "APP_BRAND_IMPERSONATION",
      "APP_DESCRIPTION_MATCH",
    ],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>(["APP_IMPERSONATION"]),
    fires: (ctx) => ctx.facts.appIdentity,
  },
  {
    action: "EXPAND_CAMPAIGN_TO_NEW_PLATFORM",
    corroborated: true,
    signals: CAMPAIGN_INDICATOR_POOL,
    signalsFromCampaign: true,
    intents: ALL_MALICIOUS_INTENTS,
    fires: (ctx) => ctx.campaignDetected && ctx.platformCount >= 2,
  },
  {
    action: "CREATE_FAKE_SUPPORT_ACCOUNT",
    corroborated: false,
    signals: ["SUPPORT_LANGUAGE", "NAME_SIMILARITY", "OFFICIAL_IDENTITY_CONFLICT"],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>(["SUPPORT_SCAM_PATTERN", "ACCOUNT_IMPERSONATION"]),
    fires: (ctx) =>
      ctx.facts.supportLure && (ctx.facts.accountIdentity || ctx.facts.identityHigh),
  },
  {
    action: "TARGET_VICTIMS_WITH_SUPPORT_LURE",
    corroborated: false,
    signals: ["SUPPORT_LANGUAGE", "EXTERNAL_DOMAIN", "NAME_SIMILARITY", "TEXT_IDENTITY_MATCH"],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>(["SUPPORT_SCAM_PATTERN", "PHISHING_LURE"]),
    fires: (ctx) =>
      ctx.facts.supportLure && (ctx.facts.externalDomain || ctx.facts.identityHigh),
  },
  {
    action: "DEPLOY_PHISHING_DOMAIN",
    corroborated: false,
    signals: ["EXTERNAL_DOMAIN", "NAME_SIMILARITY", "TEXT_IDENTITY_MATCH", "LOGO_SIMILARITY"],
    signalsFromCampaign: false,
    intents: new Set<ThreatIntent>(["PHISHING_LURE"]),
    fires: (ctx) =>
      ctx.facts.externalDomain && ctx.facts.identityHigh && !ctx.facts.supportLure,
  },
];

// ---------------------------------------------------------------------------
// Deterministic derivation
// ---------------------------------------------------------------------------

const UNKNOWN_RATIONALE =
  "UNKNOWN_NEXT_STEP — the available evidence does not support a specific predicted " +
  "next action; this assessment is predicted from observed evidence only.";

const DISCLAIMER_ISSUE = "Predictions are probabilistic";
const DISCLAIMER_REASON =
  "Playbook predictions are heuristic assessments derived from observed structured " +
  "results and are not guaranteed outcomes.";

// ---------------------------------------------------------------------------
// Deterministic derivation
// ---------------------------------------------------------------------------

const observedSignals = (
  gate: GateDefinition,
  input: AIInvestigatorInput,
  indicatorTypes: ReadonlySet<string>,
): string[] => {
  const pool = gate.signals;
  if (gate.signalsFromCampaign) {
    return pool.filter((signal) => indicatorTypes.has(signal));
  }
  const evidenceSignals = new Set(input.evidence.evidence.map((item) => item.signal));
  return pool.filter((signal) => evidenceSignals.has(signal));
};

const intentSupportFor = (
  intents: ReadonlySet<ThreatIntent>,
  primary: ThreatIntent,
  supported: readonly ThreatIntent[],
): number => {
  if (intents.has(primary)) return 1;
  if (supported.some((intent) => intents.has(intent))) return 0.5;
  return 0;
};

const predictionConfidence = (opts: {
  signalCount: number;
  intentSupport: number;
  campaignSupport: number;
  evidenceCount: number;
  relatedCount: number;
}): number => {
  const { CONFIDENCE, MAX_PREDICTION } = PLAYBOOK_THRESHOLDS;
  const score =
    CONFIDENCE.SIGNAL_WEIGHT * Math.min(1, opts.signalCount / CONFIDENCE.SIGNAL_DIVISOR) +
    CONFIDENCE.INTENT_WEIGHT * opts.intentSupport +
    CONFIDENCE.CAMPAIGN_WEIGHT * opts.campaignSupport +
    CONFIDENCE.EVIDENCE_WEIGHT * Math.min(1, opts.evidenceCount / CONFIDENCE.EVIDENCE_DIVISOR) +
    CONFIDENCE.CORRELATION_WEIGHT *
      Math.min(1, opts.relatedCount / CONFIDENCE.CORRELATION_DIVISOR);
  return Math.min(MAX_PREDICTION, Math.round(score));
};

const rationaleFor = (opts: {
  action: PlaybookAction;
  signals: readonly string[];
  intentSupport: number;
  primary: ThreatIntent;
  corroborated: boolean;
  campaign: Campaign | null;
  relatedCount: number;
}): string => {
  if (opts.action === "UNKNOWN_NEXT_STEP") return UNKNOWN_RATIONALE;

  let text = `Likely next step: ${opts.action} — predicted from observed evidence (${opts.signals.join(", ")})`;
  if (opts.intentSupport > 0) text += `; observed intent ${opts.primary}`;
  if (opts.corroborated && opts.campaign !== null) {
    text += `; ${opts.campaign.campaignType} campaign at ${opts.campaign.confidenceScore}/100`;
  }
  if (opts.relatedCount > 0) {
    text += `; ${plural(opts.relatedCount, "correlated candidate")}`;
  }
  text += ".";
  return clip(text, PLAYBOOK_THRESHOLDS.LIMITS.RATIONALE_MAX);
};

interface BuiltPrediction extends PlaybookPrediction {
  corroborated: boolean;
}

const buildLimitations = (
  input: AIInvestigatorInput,
  ctx: GateContext,
  usedUnknown: boolean,
): PlaybookLimitation[] => {
  const limitations: PlaybookLimitation[] = [];
  const push = (issue: string, reason: string): void => {
    if (limitations.length >= PLAYBOOK_THRESHOLDS.LIMITS.LIMITATIONS) return;
    limitations.push({ issue, reason });
  };

  push(DISCLAIMER_ISSUE, DISCLAIMER_REASON);

  if (ctx.facts.isOfficialCandidate) {
    push(
      "Official asset protection present",
      `Protective official-asset signals observed: ${ctx.facts.protectiveSignals.join(", ")}.`,
    );
  }
  if (usedUnknown) {
    push(
      "Insufficient evidence for a specific prediction",
      "No playbook action gate matched the observed evidence — only an unknown-next-step placeholder is reported.",
    );
  }
  const logoUnavailable = input.evidence.unavailable.find((entry) => entry.source === "LOGO");
  if (logoUnavailable !== undefined) {
    push("Logo evidence unavailable", logoUnavailable.reason);
  }
  if (!ctx.sharedInfrastructure) {
    push(
      "No shared infrastructure evidence",
      "No external domain or URL is shared between this candidate and its related candidates.",
    );
  }
  if (!ctx.campaignDetected) {
    push("No coordinated campaign detected", input.campaign.explanation);
  }
  if (ctx.relatedCount === 0) {
    push(
      "No correlated candidates",
      "No other candidate of this brand correlates with this asset.",
    );
  }
  if (input.evidence.evidenceCount < 3) {
    push(
      "Limited evidence coverage",
      `Only ${plural(input.evidence.evidenceCount, "evidence item")} observed for this candidate — coverage is limited.`,
    );
  }
  return limitations;
};

/**
 * Deterministic playbook prediction. Every gate, signal, intent set, score and
 * rationale references only existing Task 11–16 structured results — nothing is
 * re-detected, and no model ever supplies a prediction or confidence.
 */
export const derivePlaybook = (input: AIInvestigatorInput): PlaybookResult => {
  const facts = collectFacts(input);
  const { primary, supported } = deriveThreatIntent(input);
  const campaign = input.campaign.campaignDetected ? input.campaign.campaign : null;
  const indicatorTypes = new Set(
    campaign?.indicators.map((indicator) => indicator.type) ?? [],
  );
  const relatedCount = input.correlation.relatedCandidates.length;
  const sharedInfrastructure = input.correlation.relatedCandidates.some((related) =>
    related.links.some(
      (link) => link.type === "SHARED_DOMAIN" || link.type === "SHARED_URL",
    ),
  );
  const ctx: GateContext = {
    facts,
    campaign,
    campaignDetected: campaign !== null,
    platformCount: campaign?.platformCount ?? 0,
    relatedCount,
    sharedInfrastructure,
  };

  const built: BuiltPrediction[] = [];

  // Official-asset protection suppresses every prediction: nothing is predicted
  // against an asset the engines identified as an official source.
  if (!facts.isOfficialCandidate) {
    for (const gate of GATES) {
      if (!gate.fires(ctx)) continue;

      const signals = observedSignals(gate, input, indicatorTypes);
      const intentSupport = intentSupportFor(gate.intents, primary, supported);
      const corroborated =
        CAMPAIGN_CORROBORATED.has(gate.action) && campaign !== null;
      const confidence = predictionConfidence({
        signalCount: signals.length,
        intentSupport,
        campaignSupport: corroborated ? campaign.confidenceScore / 100 : 0,
        evidenceCount: input.evidence.evidenceCount,
        relatedCount,
      });

      built.push({
        action: gate.action,
        confidence,
        rationale: rationaleFor({
          action: gate.action,
          signals,
          intentSupport,
          primary,
          corroborated,
          campaign,
          relatedCount,
        }),
        supportingSignals: signals.slice(0, PLAYBOOK_THRESHOLDS.LIMITS.SIGNALS),
        corroborated,
      });
    }

    if (built.length === 0) {
      built.push({
        action: "UNKNOWN_NEXT_STEP",
        confidence: predictionConfidence({
          signalCount: 0,
          intentSupport: 0,
          campaignSupport: 0,
          evidenceCount: input.evidence.evidenceCount,
          relatedCount,
        }),
        rationale: UNKNOWN_RATIONALE,
        supportingSignals: [],
        corroborated: false,
      });
    }
  }

  // Confidence desc → campaign-corroborated first → vocabulary order (stable).
  built.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      Number(b.corroborated) - Number(a.corroborated) ||
      ACTION_RANK[a.action] - ACTION_RANK[b.action],
  );
  const kept = built.slice(0, PLAYBOOK_THRESHOLDS.LIMITS.PREDICTIONS);
  const usedUnknown = kept.some((entry) => entry.action === "UNKNOWN_NEXT_STEP");

  const predictions: PlaybookPrediction[] = kept.map(({ corroborated: _c, ...entry }) => entry);
  const overallConfidence =
    predictions.length === 0
      ? 0
      : Math.round(
          predictions.reduce((sum, entry) => sum + entry.confidence, 0) /
            predictions.length,
        );

  return {
    candidateId: input.candidate.id,
    predictions,
    overallConfidence,
    limitations: buildLimitations(input, ctx, usedUnknown),
  };
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export const computePlaybook = async (
  subject: CandidateAsset,
  brand: Brand,
  assets: OfficialAsset[],
  candidates: CandidateAsset[],
): Promise<PlaybookResult> => {
  const input = await assembleInvestigationInput(subject, brand, assets, candidates);
  return derivePlaybook(input);
};

export const analyzeCandidatePlaybook = async (
  candidateId: string,
): Promise<PlaybookOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "PLAYBOOK_NOT_APPLICABLE" };
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
    data: await computePlaybook(candidate, brand, assets, candidates),
  };
};
