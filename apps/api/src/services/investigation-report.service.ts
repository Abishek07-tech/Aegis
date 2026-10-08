import { REPORT_THRESHOLDS } from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById, listCandidates } from "./candidate.service";
import {
  assembleInvestigationInput,
  buildAIValidationContext,
  clip,
  isPlainObject,
  plural,
  proseOk,
  resolveProvider,
  runInvestigation,
  type AIInvestigatorInput,
  type AIProvider,
  type AIProviderRequest,
  type AIValidationContext,
  type AttackPathStep,
  type Investigation,
  type InvestigationSource,
  type RecommendedAction,
  type Uncertainty,
} from "./ai-investigator.service";
import { derivePlaybook, type PlaybookPrediction } from "./playbook.service";
import type { CampaignResult } from "./campaign.service";
import type { EvidenceResult } from "./evidence.service";
import type { RiskResult } from "./risk-engine.service";

// ---------------------------------------------------------------------------
// Report types — a single deterministic report assembled from Tasks 6–17
// structured results; a model may only rewrite the two narrative fields.
// ---------------------------------------------------------------------------

export interface ReportTargetBrand {
  id: string;
  name: string;
  website: string | null;
  logoRegistered: boolean;
}

export interface ReportCandidateAsset {
  id: string;
  type: string;
  value: string;
  name: string | null;
  description: string | null;
  status: string;
}

export type ReportRiskAssessment = Pick<
  RiskResult,
  "riskScore" | "riskLevel" | "confidence" | "evidenceCount" | "independentSourceCount" | "reasons"
>;

export type ReportKeyEvidence = Pick<
  EvidenceResult,
  "evidenceCount" | "highSeverityCount" | "evidence" | "unavailable"
>;

export interface InvestigationReport {
  candidateId: string;
  generatedAt: string;
  executiveSummary: string;
  targetBrand: ReportTargetBrand;
  candidateAsset: ReportCandidateAsset;
  riskAssessment: ReportRiskAssessment;
  investigation: Investigation;
  campaign: CampaignResult;
  keyEvidence: ReportKeyEvidence;
  predictedNextActions: PlaybookPrediction[];
  attackPath: AttackPathStep[];
  uncertainties: Uncertainty[];
  recommendedActions: RecommendedAction[];
  analystConclusion: string;
  source: InvestigationSource;
}

export type ReportFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "REPORT_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type ReportOutcome =
  | { ok: true; data: InvestigationReport }
  | { ok: false; code: ReportFailureCode };

// ---------------------------------------------------------------------------
// Deterministic narrative builders
// ---------------------------------------------------------------------------

const candidateLabel = (input: AIInvestigatorInput): string => {
  const name = input.candidate.name?.trim();
  return name !== undefined && name !== "" ? name : input.candidate.value;
};

const isOfficialProtected = (input: AIInvestigatorInput): boolean =>
  input.explanation.protectiveSignals.includes("OFFICIAL_ACCOUNT_MATCH") ||
  input.explanation.protectiveSignals.includes("OFFICIAL_APP_MATCH");

// Exactly four deterministic sentences: risk, correlation/campaign context,
// investigation confidence, playbook outlook. Sentence boundaries are safe:
// periods inside domain-like values are never followed by a space.
const buildExecutiveSummary = (
  input: AIInvestigatorInput,
  investigation: Investigation,
  playbookPredictions: readonly PlaybookPrediction[],
  overallConfidence: number,
): string => {
  const { brand, risk, explanation, correlation, campaign } = input;

  const sentences: string[] = [];

  let first = `${brand.name} candidate ${candidateLabel(input)} is assessed ${risk.riskScore}/100 ${risk.riskLevel} with ${plural(risk.evidenceCount, "evidence item")} across ${plural(risk.independentSourceCount, "independent source")}`;
  if (explanation.protectiveSignals.length > 0) {
    first += `; protective signals present: ${explanation.protectiveSignals.join(", ")}`;
  }
  sentences.push(`${first}.`);

  const relatedCount = correlation.relatedCandidates.length;
  const detectedCampaign = campaign.campaignDetected ? campaign.campaign : null;
  if (detectedCampaign !== null && relatedCount > 0) {
    sentences.push(
      `It correlates with ${plural(relatedCount, "other candidate")} and a detected ${detectedCampaign.campaignType} campaign at ${detectedCampaign.confidenceScore}/100.`,
    );
  } else if (detectedCampaign !== null) {
    sentences.push(
      `A detected ${detectedCampaign.campaignType} campaign at ${detectedCampaign.confidenceScore}/100 includes this asset.`,
    );
  } else if (relatedCount > 0) {
    sentences.push(
      `It correlates with ${plural(relatedCount, "other candidate")} but no coordinated campaign was detected.`,
    );
  } else {
    sentences.push("No correlated candidates or coordinated campaign were found for this asset.");
  }

  sentences.push(
    `Investigation confidence is ${investigation.confidence}/100 (${investigation.confidenceLevel}) with primary intent ${investigation.threatIntent}.`,
  );

  if (playbookPredictions.length > 0) {
    sentences.push(
      `${plural(playbookPredictions.length, "predicted next action")} recorded with overall playbook confidence ${overallConfidence}/100.`,
    );
  } else {
    sentences.push("No playbook next actions are predicted for this candidate.");
  }

  return clip(sentences.join(" "), REPORT_THRESHOLDS.PROSE.EXECUTIVE_SUMMARY_MAX);
};

// Deterministic, evidence-bounded conclusion. Official protection always
// suppresses escalation language; zero evidence never claims a threat.
const buildAnalystConclusion = (
  input: AIInvestigatorInput,
  investigation: Investigation,
): string => {
  const { risk, explanation, correlation, campaign } = input;

  if (isOfficialProtected(input)) {
    return (
      `Official-asset protection (${explanation.protectiveSignals.join(", ")}) indicates ` +
      "this candidate matches a registered official source, so the available evidence " +
      "supports continued monitoring rather than escalation."
    );
  }

  if (risk.evidenceCount === 0) {
    return (
      "The available evidence is insufficient to support a specific threat assessment for " +
      "this candidate; no detection signals were observed, so continued monitoring is " +
      "recommended."
    );
  }

  const relatedCount = correlation.relatedCandidates.length;
  const detectedCampaign = campaign.campaignDetected ? campaign.campaign : null;
  const campaignClause =
    detectedCampaign !== null
      ? ` and a ${detectedCampaign.campaignType} campaign at ${detectedCampaign.confidenceScore}/100`
      : "";

  return (
    `The available evidence supports further investigation of this candidate: risk ` +
    `${risk.riskScore}/100 ${risk.riskLevel} with ${plural(risk.evidenceCount, "evidence item")}, ` +
    `${plural(relatedCount, "correlated candidate")}${campaignClause}, and investigation ` +
    `confidence ${investigation.confidence}/100 (${investigation.confidenceLevel}).`
  );
};

// Task 13 why-not-flagged entries first, then Task 16 uncertainties, then
// Task 17 playbook limitations — deduplicated by issue (first wins), capped.
const mergeUncertainties = (
  input: AIInvestigatorInput,
  investigation: Investigation,
  playbookLimitations: readonly { issue: string; reason: string }[],
): Uncertainty[] => {
  const merged: Uncertainty[] = [];
  const seen = new Set<string>();
  const push = (issue: string, reason: string): void => {
    if (seen.has(issue) || merged.length >= REPORT_THRESHOLDS.LIMITS.UNCERTAINTIES) return;
    seen.add(issue);
    merged.push({ issue, reason });
  };

  for (const entry of input.explanation.whyNotFlagged) {
    push(entry.signal, entry.explanation);
  }
  for (const entry of investigation.uncertainties) {
    push(entry.issue, entry.reason);
  }
  for (const entry of playbookLimitations) {
    push(entry.issue, entry.reason);
  }
  return merged;
};

export const buildDeterministicReport = (
  input: AIInvestigatorInput,
  investigation: Investigation,
  playbook: ReturnType<typeof derivePlaybook>,
  generatedAt: string = new Date().toISOString(),
): InvestigationReport => {
  const { candidate, brand, risk, evidence, campaign } = input;

  return {
    candidateId: candidate.id,
    generatedAt,
    executiveSummary: buildExecutiveSummary(
      input,
      investigation,
      playbook.predictions,
      playbook.overallConfidence,
    ),
    targetBrand: {
      id: brand.id,
      name: brand.name,
      website: brand.website,
      logoRegistered: brand.logoUrl !== null,
    },
    candidateAsset: {
      id: candidate.id,
      type: candidate.type,
      value: candidate.value,
      name: candidate.name,
      description: candidate.description,
      status: candidate.status,
    },
    riskAssessment: {
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      confidence: risk.confidence,
      evidenceCount: risk.evidenceCount,
      independentSourceCount: risk.independentSourceCount,
      reasons: risk.reasons,
    },
    investigation,
    campaign,
    keyEvidence: {
      evidenceCount: evidence.evidenceCount,
      highSeverityCount: evidence.highSeverityCount,
      evidence: evidence.evidence,
      unavailable: evidence.unavailable,
    },
    predictedNextActions: playbook.predictions,
    attackPath: investigation.attackPath,
    uncertainties: mergeUncertainties(input, investigation, playbook.limitations),
    recommendedActions: investigation.recommendedActions,
    analystConclusion: buildAnalystConclusion(input, investigation),
    source: "DETERMINISTIC",
  };
};

// ---------------------------------------------------------------------------
// Optional AI prose path — narrative fields only, strict validation, silent
// fallback to the deterministic report on any failure.
// ---------------------------------------------------------------------------

const REPORT_SYSTEM_PROMPT = [
  "You are a digital-risk investigation report writer.",
  "You may only rewrite the two supplied narrative fields from the structured facts provided.",
  "Never invent evidence, relationships, domains, accounts, applications, people, or events.",
  "Do not override deterministic risk, confidence, campaign assessment, or playbook predictions.",
  "Use cautious language when evidence is incomplete (for example: 'Evidence is consistent with...', 'The observed indicators suggest...', 'The available evidence supports...').",
  "Never use absolute verdict language: no 'fake', 'scam', 'malicious', 'definitely' or 'certainly'.",
  "Do not recommend enforcement actions such as banning, blocking, suspending, or removing accounts.",
  "Only mention domains that appear in the allowedDomains list.",
  "Return valid structured JSON with exactly these keys: executiveSummary, analystConclusion.",
  "executiveSummary: 3-5 sentences summarizing risk, correlation or campaign context, investigation confidence, and the playbook prediction outlook.",
  "analystConclusion: 1-3 sentences stating what the available evidence supports next, bounded by official-asset protection when present.",
].join(" ");

const REPORT_PROMPT_FIELD_CLIP = 300;

export const buildReportProviderRequest = (
  input: AIInvestigatorInput,
  base: InvestigationReport,
  context: AIValidationContext,
): AIProviderRequest => {
  const prompt = {
    candidate: {
      type: base.candidateAsset.type,
      value: clip(base.candidateAsset.value, 160),
      name: base.candidateAsset.name,
    },
    brand: {
      name: base.targetBrand.name,
      website: base.targetBrand.website,
      logoRegistered: base.targetBrand.logoRegistered,
    },
    risk: {
      riskScore: base.riskAssessment.riskScore,
      riskLevel: base.riskAssessment.riskLevel,
    },
    keyEvidence: {
      evidenceCount: base.keyEvidence.evidenceCount,
      highSeverityCount: base.keyEvidence.highSeverityCount,
      signals: base.keyEvidence.evidence
        .slice(0, 12)
        .map((item) => `${item.source}:${item.signal}:${item.severity}`),
    },
    investigation: {
      threatIntent: base.investigation.threatIntent,
      confidence: base.investigation.confidence,
      confidenceLevel: base.investigation.confidenceLevel,
      attackSteps: base.attackPath.map((step) => step.step),
    },
    correlation: {
      relatedCandidates: input.correlation.relatedCandidates.length,
    },
    campaign: base.campaign.campaignDetected && base.campaign.campaign !== null
      ? {
          detected: true,
          campaignType: base.campaign.campaign.campaignType,
          confidenceScore: base.campaign.campaign.confidenceScore,
        }
      : { detected: false },
    playbook: {
      predictions: base.predictedNextActions.map((prediction) => ({
        action: prediction.action,
        confidence: prediction.confidence,
      })),
      overallConfidence:
        base.predictedNextActions.length === 0
          ? 0
          : Math.round(
              base.predictedNextActions.reduce((sum, p) => sum + p.confidence, 0) /
                base.predictedNextActions.length,
            ),
    },
    allowedDomains: [...context.allowedDomains].sort(),
    keys: ["executiveSummary", "analystConclusion"],
    rules: [
      "3-5 sentences for executiveSummary; 1-3 sentences for analystConclusion",
      `executiveSummary max ${REPORT_THRESHOLDS.PROSE.EXECUTIVE_SUMMARY_MAX} characters`,
      `analystConclusion max ${REPORT_THRESHOLDS.PROSE.ANALYST_CONCLUSION_MAX} characters`,
      "cautious language only; no absolute verdicts; no enforcement recommendations",
      `prose field clip ${REPORT_PROMPT_FIELD_CLIP}`,
    ],
  };
  return { system: REPORT_SYSTEM_PROMPT, user: JSON.stringify(prompt) };
};

/**
 * Strict model-response validation for the two report prose fields. ANY
 * violation (invalid JSON, non-object, unknown or extra keys, empty text,
 * over-length text, verdict language, enforcement language, or any domain
 * outside allowedDomains) returns null and the caller keeps the
 * deterministic narrative.
 */
export const parseAIReportResponse = (
  raw: string | null | undefined,
  context: AIValidationContext,
): Partial<InvestigationReport> | null => {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const allowedKeys = new Set(["executiveSummary", "analystConclusion"]);
  const keys = Object.keys(parsed);
  if (keys.length === 0) return null;
  for (const key of keys) {
    if (!allowedKeys.has(key)) return null;
  }

  const prose = REPORT_THRESHOLDS.PROSE;
  const out: Partial<InvestigationReport> = {};

  if ("executiveSummary" in parsed) {
    const value = parsed.executiveSummary;
    if (!proseOk(value, prose.EXECUTIVE_SUMMARY_MAX, context)) return null;
    out.executiveSummary = value;
  }
  if ("analystConclusion" in parsed) {
    const value = parsed.analystConclusion;
    if (!proseOk(value, prose.ANALYST_CONCLUSION_MAX, context)) return null;
    out.analystConclusion = value;
  }
  return out;
};

/**
 * Report assembly with the optional AI prose pass. Structured fields — risk,
 * evidence, campaign, investigation confidence, predictions, uncertainties —
 * always remain deterministic; only executiveSummary/analystConclusion may be
 * replaced by a validated model response. `source` records which path produced
 * the narrative; provider payloads and keys are never logged.
 */
export const runReport = async (
  input: AIInvestigatorInput,
  provider?: AIProvider | null,
): Promise<InvestigationReport> => {
  const resolved = provider === undefined ? resolveProvider() : provider;
  const investigation = await runInvestigation(input, resolved);
  const playbook = derivePlaybook(input);
  const base = buildDeterministicReport(input, investigation, playbook);
  if (resolved === null) return base;

  const context = buildAIValidationContext(input, investigation);
  let raw: string | null = null;
  try {
    raw = await resolved.complete(buildReportProviderRequest(input, base, context));
  } catch {
    raw = null;
  }
  const parsed = parseAIReportResponse(raw, context);
  if (parsed === null) return base;

  return { ...base, ...parsed, source: "AI" };
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export const computeReport = async (
  subject: CandidateAsset,
  brand: Brand,
  assets: OfficialAsset[],
  candidates: CandidateAsset[],
  provider?: AIProvider | null,
): Promise<InvestigationReport> => {
  const input = await assembleInvestigationInput(subject, brand, assets, candidates);
  return runReport(input, provider);
};

export const analyzeCandidateReport = async (
  candidateId: string,
): Promise<ReportOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "REPORT_NOT_APPLICABLE" };
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
    data: await computeReport(candidate, brand, assets, candidates),
  };
};
