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

export const RISK_ENGINE_THRESHOLDS = {
  // base weight applied to each risk-contributing evidence item: contribution = weight × evidence.score
  SEVERITY_WEIGHT: { LOW: 10, MEDIUM: 20, HIGH: 35 },
  // risk levels: LOW 0–24, MEDIUM 25–49, HIGH 50–74, CRITICAL 75–100
  LEVEL: { MEDIUM: 25, HIGH: 50, CRITICAL: 75 },
  // overlapping evidence inside one category keeps only this fraction of its contribution
  OVERLAP_DAMPING: 0.25,
  // protective official-domain evidence multiplies the total risk by this factor
  PROTECTIVE_DOMAIN_FACTOR: 0.75,
  // an exact official identity can never score above this value (LOW ceiling)
  OFFICIAL_IDENTITY_CAP: 24,
  MAX_SCORE: 100,
  // confidence ∈ [0,1] = ITEM_W·min(1, evidence/ITEM_DIV) + GROUP_W·min(1, groups/GROUP_DIV) + STRENGTH_W·meanScore
  CONFIDENCE: {
    ITEM_WEIGHT: 0.4,
    ITEM_DIVISOR: 4,
    GROUP_WEIGHT: 0.4,
    GROUP_DIVISOR: 3,
    STRENGTH_WEIGHT: 0.2,
  },
} as const;

export const CORRELATION_THRESHOLDS = {
  // per-type base weight of a correlation link; effective weights are summed and capped
  LINK_WEIGHT: {
    SHARED_DOMAIN: 45,
    SHARED_URL: 45,
    SHARED_BRAND_IDENTITY: 30,
    SHARED_VISUAL_EVIDENCE: 25,
    SHARED_STRONG_SIGNALS: 20,
  },
  // domain + URL describe the same underlying infrastructure: only the strongest counts fully
  INFRA_OVERLAP_DAMPING: 0.25,
  MAX_SCORE: 100,
  // link strength label from the effective weight: >= STRONG → STRONG, >= MEDIUM → MEDIUM, else WEAK
  STRENGTH: { STRONG: 40, MEDIUM: 25 },
  // relationship levels: LOW 0–24, MEDIUM 25–49, HIGH 50–74, VERY_HIGH 75–100
  LEVEL: { MEDIUM: 25, HIGH: 50, VERY_HIGH: 75 },
} as const;

export const CAMPAIGN_THRESHOLDS = {
  // membership: campaign members are reachable from the subject through correlation
  // edges at least this strong — weak brand-lookalike links (e.g. shared branding
  // alone at 30) can never pull a candidate into a campaign
  MIN_RELATIONSHIP_SCORE: 45,
  // campaign confidence = min(100, Σ components); a bounded deterministic formula
  // that is deliberately NOT the Task 12 candidate risk score. Components:
  //   SIZE      = SIZE_WEIGHT × min(1, (members − 1) / SIZE_DIVISOR)
  //   EDGE      = EDGE_WEIGHT × mean(campaign edge scores) / 100
  //   TYPE      = TYPE_WEIGHT × min(1, independent signal families / TYPE_DIVISOR)
  //   INFRA     = INFRA_WEIGHT when any campaign edge shares a domain/URL
  //   CROSS     = CROSS_WEIGHT when both social and app members are present
  //   EVIDENCE  = EVIDENCE_WEIGHT × (members with HIGH impersonation evidence / eligible)
  // Sum of maxima (115) intentionally exceeds 100 → hard cap at MAX_SCORE.
  // Signal families dedupe SHARED_DOMAIN + SHARED_URL into one infrastructure
  // family so the same underlying hosting never counts twice.
  CONFIDENCE: {
    SIZE_WEIGHT: 25,
    SIZE_DIVISOR: 2,
    EDGE_WEIGHT: 25,
    TYPE_WEIGHT: 20,
    TYPE_DIVISOR: 3,
    INFRA_WEIGHT: 15,
    CROSS_WEIGHT: 10,
    EVIDENCE_WEIGHT: 20,
  },
  MAX_SCORE: 100,
  // confidence levels reuse the correlation ladder: LOW 0–24, MEDIUM 25–49, HIGH 50–74, VERY_HIGH 75–100
  LEVEL: CORRELATION_THRESHOLDS.LEVEL,
} as const;

export const INVESTIGATION_THRESHOLDS = {
  // investigation confidence = min(100, Σ components); a bounded deterministic
  // narrative-confidence field that is deliberately NOT the Task 12 risk score,
  // NOT the Task 12 confidence (0..1) and NOT the Task 15 campaign confidence.
  // The model (when configured) never supplies this number. Components:
  //   EVIDENCE    = EVIDENCE_WEIGHT × min(1, evidenceItems / EVIDENCE_DIVISOR)
  //   CATEGORY    = CATEGORY_WEIGHT × min(1, evidenceCategories / CATEGORY_DIVISOR)
  //   STRENGTH    = STRENGTH_WEIGHT × mean(evidence scores)
  //   CAMPAIGN    = CAMPAIGN_WEIGHT × campaignConfidence / 100   (0 when no campaign)
  //   CORRELATION = CORRELATION_WEIGHT × min(1, relatedCandidates / CORRELATION_DIVISOR)
  // Sum of maxima = 100 (already bounded).
  CONFIDENCE: {
    EVIDENCE_WEIGHT: 30,
    EVIDENCE_DIVISOR: 4,
    CATEGORY_WEIGHT: 25,
    CATEGORY_DIVISOR: 3,
    STRENGTH_WEIGHT: 20,
    CAMPAIGN_WEIGHT: 15,
    CORRELATION_WEIGHT: 10,
    CORRELATION_DIVISOR: 2,
  },
  MAX_SCORE: 100,
  // investigation confidence levels: LOW 0–39, MEDIUM 40–69, HIGH 70–100
  LEVEL: { MEDIUM: 40, HIGH: 70 },
  // hard caps so a single request can never emit unbounded narrative output
  LIMITS: {
    KEY_FINDINGS: 6,
    STRONGEST_EVIDENCE: 5,
    ATTACK_PATH: 6,
    UNCERTAINTIES: 6,
    RECOMMENDED_ACTIONS: 6,
    SECONDARY_INTENTS: 4,
    RELATED_CANDIDATES_NOTED: 3,
    REASONS_NOTED: 3,
  },
  // length bounds enforced on every narrative field (deterministic and model-sourced)
  PROSE: {
    HEADLINE_MAX: 400,
    ASSESSMENT_MAX: 2000,
    FIELD_MAX: 500,
  },
} as const;
