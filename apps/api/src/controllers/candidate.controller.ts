import {
  ASSET_TYPES,
  CANDIDATE_STATUSES,
  isAssetType,
  isCandidateStatus,
  type AssetType,
  type CandidateStatus,
} from "../config/constants";
import { asyncHandler } from "../middleware/async.middleware";
import { ApiError } from "../middleware/error.middleware";
import { getBrandById } from "../services/brand.service";
import {
  createCandidate,
  deleteCandidateById,
  getCandidateById,
  listCandidates,
  updateCandidateStatus,
} from "../services/candidate.service";
import {
  analyzeCandidateName,
  type NameAnalysisFailureCode,
} from "../services/name-analysis.service";
import {
  analyzeCandidateText,
  type TextAnalysisFailureCode,
} from "../services/text-analysis.service";
import {
  analyzeCandidateLogo,
  type LogoAnalysisFailureCode,
} from "../services/logo-analysis.service";
import {
  analyzeCandidateSocialRisk,
  type SocialRiskFailureCode,
} from "../services/social-risk.service";
import {
  analyzeCandidateAppRisk,
  type AppRiskFailureCode,
} from "../services/app-risk.service";
import {
  analyzeCandidateEvidence,
  type EvidenceFailureCode,
} from "../services/evidence.service";
import {
  analyzeCandidateRisk,
  type RiskFailureCode,
} from "../services/risk-engine.service";
import {
  analyzeCandidateExplanation,
  type ExplanationFailureCode,
} from "../services/explanation.service";
import {
  analyzeCandidateCorrelation,
  type CorrelationFailureCode,
} from "../services/correlation.service";

const NAME_ANALYSIS_FAILURE_MESSAGES: Record<
  Exclude<NameAnalysisFailureCode, "CANDIDATE_NOT_FOUND">,
  string
> = {
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot compare against official assets.",
  NO_OFFICIAL_ASSETS:
    "Target brand has no official assets to compare against.",
  EMPTY_CANDIDATE_VALUE:
    "Candidate value is empty after normalization — nothing to compare.",
  NO_COMPARABLE_ASSETS:
    "No comparable official assets with non-empty values.",
};

const TEXT_ANALYSIS_FAILURE_MESSAGES: Record<
  Exclude<TextAnalysisFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot compare against official brand identity.",
  NO_USABLE_CANDIDATE_TEXT:
    "Candidate has no usable text — name, description, and value are all empty.",
  NO_BRAND_IDENTITY:
    "Target brand has no usable identity information (name and official asset values are all empty).",
};

const LOGO_ANALYSIS_FAILURE_MESSAGES: Record<
  Exclude<
    LogoAnalysisFailureCode,
    "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND"
  >,
  string
> = {
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — logo comparison unavailable.",
  NO_OFFICIAL_LOGO:
    "Target brand has no official logo (brand.logoUrl) — logo comparison unavailable.",
  NO_CANDIDATE_LOGO:
    "Candidate has no logo/image reference in the current data model — logo comparison unavailable. A dedicated candidate logo field is required for real logo comparison.",
  LOGO_UNAVAILABLE:
    "Logo image reference could not be fetched or decoded — logo comparison unavailable.",
};

const SOCIAL_RISK_FAILURE_MESSAGES: Record<
  Exclude<SocialRiskFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  SOCIAL_ANALYSIS_NOT_APPLICABLE:
    "Social risk analysis is only applicable to SOCIAL candidates.",
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot compare social signals against official assets.",
};

const APP_RISK_FAILURE_MESSAGES: Record<
  Exclude<AppRiskFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  APP_ANALYSIS_NOT_APPLICABLE:
    "App risk analysis is only applicable to APP candidates.",
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot compare app signals against official assets.",
};

const EVIDENCE_FAILURE_MESSAGES: Record<
  Exclude<EvidenceFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  EVIDENCE_ANALYSIS_NOT_APPLICABLE:
    "Evidence analysis is only applicable to SOCIAL and APP candidates.",
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot collect multimodal evidence against official assets.",
};

const RISK_FAILURE_MESSAGES: Record<
  Exclude<RiskFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  RISK_ANALYSIS_NOT_APPLICABLE:
    "Risk analysis is only applicable to SOCIAL and APP candidates.",
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot assess risk against official assets.",
};

const EXPLANATION_FAILURE_MESSAGES: Record<
  Exclude<ExplanationFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  EXPLANATION_NOT_APPLICABLE:
    "Explanation analysis is only applicable to SOCIAL and APP candidates.",
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot explain risk against official assets.",
};

const CORRELATION_FAILURE_MESSAGES: Record<
  Exclude<CorrelationFailureCode, "CANDIDATE_NOT_FOUND" | "BRAND_NOT_FOUND">,
  string
> = {
  CORRELATION_NOT_APPLICABLE:
    "Correlation analysis is only applicable to SOCIAL and APP candidates.",
  NO_TARGET_BRAND:
    "Candidate has no target brand (brandId is missing) — cannot correlate against other candidates of the brand.",
};

const readOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw ApiError.badRequest(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const parseType = (raw: unknown): (typeof ASSET_TYPES)[number] => {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw ApiError.badRequest("type is required");
  }

  const type = raw.trim().toUpperCase();
  if (!isAssetType(type)) {
    throw ApiError.badRequest(`type must be one of: ${ASSET_TYPES.join(", ")}`);
  }

  return type;
};

const readQueryFilter = (value: unknown, field: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw ApiError.badRequest(`${field} filter must be a single value`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const createCandidateHandler = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const type = parseType(body.type);

  const rawValue = body.value;
  if (typeof rawValue !== "string") {
    throw ApiError.badRequest("value must be a string");
  }
  const value = rawValue.trim();
  if (value === "") {
    throw ApiError.badRequest("value is required and cannot be empty");
  }

  const name = readOptionalString(body.name, "name");
  const description = readOptionalString(body.description, "description");
  const brandId = readOptionalString(body.brandId, "brandId");

  if (brandId !== undefined) {
    const brand = await getBrandById(brandId);
    if (!brand) {
      throw ApiError.notFound(`Brand not found: ${brandId}`);
    }
  }

  const candidate = await createCandidate({
    type,
    value,
    name,
    description,
    brandId,
  });

  res.status(201).json({ success: true, data: candidate });
});

export const listCandidatesHandler = asyncHandler(async (req, res) => {
  const rawStatus = readQueryFilter(req.query.status, "status");
  const rawType = readQueryFilter(req.query.type, "type");
  const brandId = readQueryFilter(req.query.brandId, "brandId");

  let status: CandidateStatus | undefined;
  if (rawStatus !== undefined) {
    const normalized = rawStatus.toUpperCase();
    if (!isCandidateStatus(normalized)) {
      throw ApiError.badRequest(
        `status must be one of: ${CANDIDATE_STATUSES.join(", ")}`,
      );
    }
    status = normalized;
  }

  let type: AssetType | undefined;
  if (rawType !== undefined) {
    const normalized = rawType.toUpperCase();
    if (!isAssetType(normalized)) {
      throw ApiError.badRequest(
        `type must be one of: ${ASSET_TYPES.join(", ")}`,
      );
    }
    type = normalized;
  }

  const candidates = await listCandidates({ status, type, brandId });

  res
    .status(200)
    .json({ success: true, count: candidates.length, data: candidates });
});

export const getCandidateHandler = asyncHandler(async (req, res) => {
  const candidate = await getCandidateById(req.params.id);
  if (!candidate) {
    throw ApiError.notFound(`Candidate not found: ${req.params.id}`);
  }

  res.status(200).json({ success: true, data: candidate });
});

export const updateCandidateStatusHandler = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const rawStatus = body.status;
  if (typeof rawStatus !== "string" || rawStatus.trim() === "") {
    throw ApiError.badRequest("status is required");
  }

  const status = rawStatus.trim().toUpperCase();
  if (!isCandidateStatus(status)) {
    throw ApiError.badRequest(
      `status must be one of: ${CANDIDATE_STATUSES.join(", ")}`,
    );
  }

  const candidate = await getCandidateById(req.params.id);
  if (!candidate) {
    throw ApiError.notFound(`Candidate not found: ${req.params.id}`);
  }

  const updated = await updateCandidateStatus(req.params.id, status);

  res.status(200).json({ success: true, data: updated });
});

export const deleteCandidateHandler = asyncHandler(async (req, res) => {
  const candidate = await deleteCandidateById(req.params.id);
  if (!candidate) {
    throw ApiError.notFound(`Candidate not found: ${req.params.id}`);
  }

  res
    .status(200)
    .json({ success: true, data: { id: candidate.id, deleted: true } });
});

export const analyzeCandidateNameHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateName(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    throw ApiError.badRequest(NAME_ANALYSIS_FAILURE_MESSAGES[outcome.code]);
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateTextHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateText(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    if (outcome.code === "BRAND_NOT_FOUND") {
      throw ApiError.notFound("Target brand referenced by the candidate does not exist.");
    }
    throw ApiError.badRequest(TEXT_ANALYSIS_FAILURE_MESSAGES[outcome.code]);
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateLogoHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateLogo(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    if (outcome.code === "BRAND_NOT_FOUND") {
      throw ApiError.notFound("Target brand referenced by the candidate does not exist.");
    }
    throw ApiError.badRequest(LOGO_ANALYSIS_FAILURE_MESSAGES[outcome.code]);
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateSocialRiskHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateSocialRisk(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    if (outcome.code === "BRAND_NOT_FOUND") {
      throw ApiError.notFound("Target brand referenced by the candidate does not exist.");
    }
    throw ApiError.badRequest(SOCIAL_RISK_FAILURE_MESSAGES[outcome.code], {
      code: outcome.code,
    });
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateAppRiskHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateAppRisk(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    if (outcome.code === "BRAND_NOT_FOUND") {
      throw ApiError.notFound("Target brand referenced by the candidate does not exist.");
    }
    throw ApiError.badRequest(APP_RISK_FAILURE_MESSAGES[outcome.code], {
      code: outcome.code,
    });
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateEvidenceHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateEvidence(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    if (outcome.code === "BRAND_NOT_FOUND") {
      throw ApiError.notFound("Target brand referenced by the candidate does not exist.");
    }
    throw ApiError.badRequest(EVIDENCE_FAILURE_MESSAGES[outcome.code], {
      code: outcome.code,
    });
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateRiskHandler = asyncHandler(async (req, res) => {
  const candidateId = req.params.candidateId;
  const outcome = await analyzeCandidateRisk(candidateId);

  if (!outcome.ok) {
    if (outcome.code === "CANDIDATE_NOT_FOUND") {
      throw ApiError.notFound(`Candidate not found: ${candidateId}`);
    }
    if (outcome.code === "BRAND_NOT_FOUND") {
      throw ApiError.notFound("Target brand referenced by the candidate does not exist.");
    }
    throw ApiError.badRequest(RISK_FAILURE_MESSAGES[outcome.code], {
      code: outcome.code,
    });
  }

  res.status(200).json({ success: true, data: outcome.data });
});

export const analyzeCandidateExplanationHandler = asyncHandler(
  async (req, res) => {
    const candidateId = req.params.candidateId;
    const outcome = await analyzeCandidateExplanation(candidateId);

    if (!outcome.ok) {
      if (outcome.code === "CANDIDATE_NOT_FOUND") {
        throw ApiError.notFound(`Candidate not found: ${candidateId}`);
      }
      if (outcome.code === "BRAND_NOT_FOUND") {
        throw ApiError.notFound(
          "Target brand referenced by the candidate does not exist.",
        );
      }
      throw ApiError.badRequest(EXPLANATION_FAILURE_MESSAGES[outcome.code], {
        code: outcome.code,
      });
    }

    res.status(200).json({ success: true, data: outcome.data });
  },
);

export const analyzeCandidateCorrelationHandler = asyncHandler(
  async (req, res) => {
    const candidateId = req.params.candidateId;
    const outcome = await analyzeCandidateCorrelation(candidateId);

    if (!outcome.ok) {
      if (outcome.code === "CANDIDATE_NOT_FOUND") {
        throw ApiError.notFound(`Candidate not found: ${candidateId}`);
      }
      if (outcome.code === "BRAND_NOT_FOUND") {
        throw ApiError.notFound(
          "Target brand referenced by the candidate does not exist.",
        );
      }
      throw ApiError.badRequest(CORRELATION_FAILURE_MESSAGES[outcome.code], {
        code: outcome.code,
      });
    }

    res.status(200).json({ success: true, data: outcome.data });
  },
);
