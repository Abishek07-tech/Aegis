export const ASSET_TYPES = ["SOCIAL", "WEBSITE", "APP", "DOMAIN"] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export const isAssetType = (value: string): value is AssetType =>
  (ASSET_TYPES as readonly string[]).includes(value);

export const CANDIDATE_STATUSES = [
  "PENDING",
  "REVIEWING",
  "CONFIRMED",
  "DISMISSED",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const isCandidateStatus = (value: string): value is CandidateStatus =>
  (CANDIDATE_STATUSES as readonly string[]).includes(value);

export const SIMILARITY_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.65,
} as const;

export type SimilarityLevel = "HIGH" | "MEDIUM" | "LOW";

export const SOCIAL_SIGNAL_THRESHOLDS = {
  // NAME_SIMILARITY is emitted at/above this score, or on handle containment
  NAME_SIMILARITY_MIN: 0.5,
  // containment is only considered when BOTH normalized handles reach this length
  MIN_CONTAINMENT_LENGTH: 4,
  // SUPPORT_LANGUAGE score = BASE + STEP * (matchedKeywords - 1), capped at MAX
  SUPPORT_LANGUAGE_BASE: 0.5,
  SUPPORT_LANGUAGE_STEP: 0.1,
  SUPPORT_LANGUAGE_MAX: 0.9,
  SUPPORT_LANGUAGE_HIGH: 0.85,
  SUPPORT_LANGUAGE_MEDIUM: 0.6,
  // fixed deterministic scores for evidence that is not a similarity ratio
  EXTERNAL_DOMAIN_SCORE: 0.7,
  IDENTITY_CONFLICT_SCORE: 0.9,
  OFFICIAL_DOMAIN_SCORE: 1,
} as const;

export const APP_SIGNAL_THRESHOLDS = {
  // shared semantics with social signals — single source of truth stays in SOCIAL_SIGNAL_THRESHOLDS
  NAME_SIMILARITY_MIN: SOCIAL_SIGNAL_THRESHOLDS.NAME_SIMILARITY_MIN,
  EXTERNAL_DOMAIN_SCORE: SOCIAL_SIGNAL_THRESHOLDS.EXTERNAL_DOMAIN_SCORE,
  OFFICIAL_DOMAIN_SCORE: SOCIAL_SIGNAL_THRESHOLDS.OFFICIAL_DOMAIN_SCORE,
  OFFICIAL_APP_SCORE: SOCIAL_SIGNAL_THRESHOLDS.OFFICIAL_DOMAIN_SCORE,
  // APP_BRAND_IMPERSONATION requires >= 2 strong indicators; fixed deterministic score
  IMPERSONATION_SCORE: 0.9,
} as const;
