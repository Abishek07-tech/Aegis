import { prisma } from "../config/database";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";
import {
  analyzeCandidateInvestigation,
  resolveProvider,
  type AIProvider,
  type Investigation,
} from "./ai-investigator.service";

export type AIAnalysisStatus = "PENDING" | "COMPLETED" | "FAILED" | "UNAVAILABLE";

export interface AIAnalysisResult {
  candidateId: string;
  status: AIAnalysisStatus;
  threatIntent: string | null;
  riskScore: number | null;
  confidence: number | null;
  summary: string | null;
  analyzedAt: Date | null;
  source: "AI" | "DETERMINISTIC";
}

export type AIAnalysisFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "ANALYSIS_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type AIAnalysisOutcome =
  | { ok: true; data: AIAnalysisResult }
  | { ok: false; code: AIAnalysisFailureCode };

const VALID_THREAT_INTENTS = new Set([
  "BRAND_IMPERSONATION",
  "ACCOUNT_IMPERSONATION",
  "APP_IMPERSONATION",
  "PHISHING_LURE",
  "SUPPORT_SCAM_PATTERN",
  "CREDENTIAL_TARGETING",
  "UNKNOWN",
]);

export const clampRiskScore = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
};

export const clampConfidence = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
};

export const sanitizeSummary = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;
  return trimmed;
};

export const extractAnalysisFromInvestigation = (
  investigation: Investigation,
): Omit<AIAnalysisResult, "candidateId" | "status" | "analyzedAt"> => {
  const threatIntent = VALID_THREAT_INTENTS.has(investigation.threatIntent)
    ? investigation.threatIntent
    : "UNKNOWN";

  const riskScore = clampRiskScore(
    investigation.strongestEvidence.length > 0
      ? investigation.strongestEvidence.reduce(
          (sum, item) => sum + (item.strength === "HIGH" ? 35 : item.strength === "MEDIUM" ? 20 : 10),
          0,
        )
      : null,
  );

  const confidence = clampConfidence(investigation.confidence / 100);

  const summary = sanitizeSummary(investigation.assessment);

  return {
    threatIntent,
    riskScore,
    confidence,
    summary,
    source: investigation.source,
  };
};

export const runAIAnalysis = async (
  candidateId: string,
  provider?: AIProvider | null,
): Promise<AIAnalysisOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "ANALYSIS_NOT_APPLICABLE" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  const resolvedProvider = provider === undefined ? resolveProvider() : provider;

  if (resolvedProvider === null) {
    await prisma.candidateAsset.update({
      where: { id: candidateId },
      data: { aiAnalysisStatus: "UNAVAILABLE" },
    });
    return {
      ok: true,
      data: {
        candidateId,
        status: "UNAVAILABLE",
        threatIntent: null,
        riskScore: null,
        confidence: null,
        summary: null,
        analyzedAt: null,
        source: "DETERMINISTIC",
      },
    };
  }

  try {
    const outcome = await analyzeCandidateInvestigation(candidateId);

    if (!outcome.ok) {
      const codeMap: Record<string, AIAnalysisFailureCode> = {
        CANDIDATE_NOT_FOUND: "CANDIDATE_NOT_FOUND",
        BRAND_NOT_FOUND: "BRAND_NOT_FOUND",
        INVESTIGATION_NOT_APPLICABLE: "ANALYSIS_NOT_APPLICABLE",
        NO_TARGET_BRAND: "NO_TARGET_BRAND",
      };
      return { ok: false, code: codeMap[outcome.code] ?? "ANALYSIS_NOT_APPLICABLE" };
    }

    const investigation = outcome.data.investigation;
    const analysis = extractAnalysisFromInvestigation(investigation);

    await prisma.candidateAsset.update({
      where: { id: candidateId },
      data: {
        aiAnalysisStatus: "COMPLETED",
        aiThreatIntent: analysis.threatIntent,
        aiRiskScore: analysis.riskScore,
        aiConfidence: analysis.confidence,
        aiSummary: analysis.summary,
        aiAnalyzedAt: new Date(),
      },
    });

    return {
      ok: true,
      data: {
        candidateId,
        status: "COMPLETED",
        ...analysis,
        analyzedAt: new Date(),
      },
    };
  } catch {
    await prisma.candidateAsset.update({
      where: { id: candidateId },
      data: { aiAnalysisStatus: "FAILED" },
    });
    return {
      ok: true,
      data: {
        candidateId,
        status: "FAILED",
        threatIntent: null,
        riskScore: null,
        confidence: null,
        summary: null,
        analyzedAt: null,
        source: "DETERMINISTIC",
      },
    };
  }
};

export const getAIAnalysis = async (
  candidateId: string,
): Promise<AIAnalysisOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  return {
    ok: true,
    data: {
      candidateId,
      status: (candidate.aiAnalysisStatus as AIAnalysisStatus) ?? "PENDING",
      threatIntent: candidate.aiThreatIntent,
      riskScore: candidate.aiRiskScore,
      confidence: candidate.aiConfidence,
      summary: candidate.aiSummary,
      analyzedAt: candidate.aiAnalyzedAt,
      source: candidate.aiAnalyzedAt ? "AI" : "DETERMINISTIC",
    },
  };
};
