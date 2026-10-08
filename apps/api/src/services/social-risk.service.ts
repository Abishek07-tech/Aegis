import {
  SOCIAL_SIGNAL_THRESHOLDS,
  type SimilarityLevel,
} from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";
import { getSimilarityLevel, normalizeText, similarityScore } from "./similarity.service";
import {
  buildBrandIdentityText,
  buildCandidateText,
  compareTextToIdentity,
} from "./text-analysis.service";

export type SocialSignalSeverity = SimilarityLevel;

export type SocialSignalName =
  | "NAME_SIMILARITY"
  | "BRAND_TEXT_MATCH"
  | "SUPPORT_LANGUAGE"
  | "EXTERNAL_DOMAIN"
  | "OFFICIAL_DOMAIN_MATCH"
  | "OFFICIAL_IDENTITY_CONFLICT";

export interface SocialSignal {
  signal: SocialSignalName;
  severity: SocialSignalSeverity;
  score: number;
  reason: string;
}

export interface SocialRiskResult {
  candidateId: string;
  type: "SOCIAL";
  signals: SocialSignal[];
  signalCount: number;
  hasHighSeverity: boolean;
}

export type SocialRiskFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "SOCIAL_ANALYSIS_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type SocialRiskOutcome =
  | { ok: true; data: SocialRiskResult }
  | { ok: false; code: SocialRiskFailureCode };

export interface SocialSignalInput {
  candidate: Pick<CandidateAsset, "value" | "name" | "description">;
  brand: Pick<Brand, "name" | "website">;
  assets: OfficialAsset[];
}

export interface OfficialSocialMatch {
  officialValue: string;
  score: number;
  level: SimilarityLevel;
  containment: number | null;
}

export const SUPPORT_LANGUAGE_KEYWORDS = [
  "customer support",
  "customer care",
  "account verification",
  "verify account",
  "security team",
  "contact us",
  "refund",
  "complaint",
  "claim",
  "urgent",
  "support",
  "help",
] as const;

const NAME_REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate handle is highly similar to an official social identity.",
  MEDIUM: "Candidate handle is moderately similar to an official social identity.",
  LOW: "Candidate handle shows some similarity to an official social identity.",
};

const BRAND_TEXT_REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate profile text strongly references the protected brand identity.",
  MEDIUM: "Candidate profile text moderately references the protected brand identity.",
  LOW: "Candidate profile text weakly references the protected brand identity.",
};

const SUPPORT_LANGUAGE_REASON =
  "Profile uses customer-support language commonly associated with impersonation accounts.";

const IDENTITY_CONFLICT_REASON =
  "Candidate closely resembles an official social identity but is not the registered official account.";

const SOCIAL_ASSET_TYPE = "SOCIAL";
const WEB_ASSET_TYPES = ["WEBSITE", "DOMAIN"];

const URL_LIKE_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const DOMAIN_LIKE_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const DOMAIN_VALUE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const isDomainLike = (value: string): boolean =>
  DOMAIN_VALUE_PATTERN.test(value);

export const normalizeDomain = (raw: string): string => {
  let value = raw.trim().toLowerCase();
  if (value === "") {
    return "";
  }

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0];

  const atIndex = value.lastIndexOf("@");
  if (atIndex >= 0) {
    value = value.slice(atIndex + 1);
  }

  const colonIndex = value.indexOf(":");
  if (colonIndex >= 0) {
    value = value.slice(0, colonIndex);
  }

  value = value.replace(/^[^a-z0-9.-]+/, "");
  value = value.replace(/[^a-z0-9.-]+$/, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/^[.-]+/, "");
  value = value.replace(/[.-]+$/, "");

  return value;
};

export const extractDomains = (text: string): string[] => {
  const domains: string[] = [];

  const add = (raw: string): void => {
    const domain = normalizeDomain(raw);
    if (domain !== "" && isDomainLike(domain) && !domains.includes(domain)) {
      domains.push(domain);
    }
  };

  for (const match of text.matchAll(URL_LIKE_PATTERN)) {
    add(match[0]);
  }
  for (const match of text.matchAll(DOMAIN_LIKE_PATTERN)) {
    add(match[0]);
  }

  return domains;
};

// Deterministic URL normalization for correlation: strip trailing punctuation and
// fragments, lowercase scheme/host, drop a leading "www." host prefix (same stance
// as normalizeDomain), drop a trailing slash, and reject unparseable input.
export const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim().replace(/[.,;:!?)\]}]+$/, "");
  if (trimmed === "") {
    return "";
  }

  const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;

  try {
    const parsed = new URL(candidate);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    const normalized = parsed.toString();
    return normalized.endsWith("/") && (parsed.pathname === "/" || parsed.pathname === "")
      ? normalized.slice(0, -1)
      : normalized;
  } catch {
    return "";
  }
};

export const extractUrls = (text: string): string[] => {
  const urls: string[] = [];

  for (const match of text.matchAll(URL_LIKE_PATTERN)) {
    const url = normalizeUrl(match[0]);
    if (url !== "" && !urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
};

export const collectOfficialDomains = (
  brand: Pick<Brand, "website">,
  assets: OfficialAsset[],
): string[] => {
  const domains: string[] = [];

  const add = (raw: string | null | undefined): void => {
    if (typeof raw !== "string") {
      return;
    }
    const domain = normalizeDomain(raw);
    if (domain !== "" && isDomainLike(domain) && !domains.includes(domain)) {
      domains.push(domain);
    }
  };

  add(brand.website);
  for (const asset of assets) {
    if (WEB_ASSET_TYPES.includes(asset.type)) {
      add(asset.value);
    }
  }

  return domains;
};

export const matchesOfficialDomain = (
  domain: string,
  officialDomains: string[],
): boolean =>
  officialDomains.some(
    (official) => domain === official || domain.endsWith(`.${official}`),
  );

export const detectSupportLanguage = (
  text: string,
): { keywords: string[]; score: number } => {
  const matched = SUPPORT_LANGUAGE_KEYWORDS.filter((keyword) =>
    new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(text),
  );

  const keywords = matched.filter(
    (keyword) =>
      !matched.some((other) => other !== keyword && other.includes(keyword)),
  );

  if (keywords.length === 0) {
    return { keywords: [], score: 0 };
  }

  const rawScore =
    SOCIAL_SIGNAL_THRESHOLDS.SUPPORT_LANGUAGE_BASE +
    SOCIAL_SIGNAL_THRESHOLDS.SUPPORT_LANGUAGE_STEP * (keywords.length - 1);
  const score = Math.min(
    SOCIAL_SIGNAL_THRESHOLDS.SUPPORT_LANGUAGE_MAX,
    round2(rawScore),
  );

  return { keywords, score };
};

export const getSupportLanguageSeverity = (
  score: number,
): SocialSignalSeverity => {
  if (score >= SOCIAL_SIGNAL_THRESHOLDS.SUPPORT_LANGUAGE_HIGH) {
    return "HIGH";
  }
  if (score >= SOCIAL_SIGNAL_THRESHOLDS.SUPPORT_LANGUAGE_MEDIUM) {
    return "MEDIUM";
  }
  return "LOW";
};

export const getOfficialSocialValues = (assets: OfficialAsset[]): string[] =>
  assets
    .filter((asset) => asset.type === SOCIAL_ASSET_TYPE)
    .map((asset) => asset.value)
    .filter((value) => normalizeText(value) !== "");

export const isOfficialSocialIdentity = (
  candidateValue: string,
  officialSocialValues: string[],
): boolean => {
  const normalized = normalizeText(candidateValue);
  if (normalized === "") {
    return false;
  }
  return officialSocialValues.some(
    (officialValue) => normalizeText(officialValue) === normalized,
  );
};

export const containmentScore = (
  left: string,
  right: string,
): number | null => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (a === "" || b === "" || a === b) {
    return null;
  }

  const minLength = Math.min(a.length, b.length);
  if (minLength < SOCIAL_SIGNAL_THRESHOLDS.MIN_CONTAINMENT_LENGTH) {
    return null;
  }
  if (!a.includes(b) && !b.includes(a)) {
    return null;
  }

  return round2(minLength / Math.max(a.length, b.length));
};

export const findBestOfficialSocialMatch = (
  candidateValue: string,
  officialSocialValues: string[],
): OfficialSocialMatch | null => {
  let best: OfficialSocialMatch | null = null;

  for (const officialValue of officialSocialValues) {
    const containment = containmentScore(candidateValue, officialValue);
    const score = Math.max(similarityScore(candidateValue, officialValue), containment ?? 0);
    if (best === null || score > best.score) {
      best = {
        officialValue,
        score,
        level: getSimilarityLevel(score),
        containment,
      };
    }
  }

  return best;
};

export const buildSocialSignals = (input: SocialSignalInput): SocialSignal[] => {
  const signals: SocialSignal[] = [];
  const candidateText = buildCandidateText(input.candidate);

  const officialSocialValues = getOfficialSocialValues(input.assets);

  const isOfficialAccount = isOfficialSocialIdentity(
    input.candidate.value,
    officialSocialValues,
  );
  const bestMatch = isOfficialAccount
    ? null
    : findBestOfficialSocialMatch(input.candidate.value, officialSocialValues);

  if (
    bestMatch &&
    (bestMatch.score >= SOCIAL_SIGNAL_THRESHOLDS.NAME_SIMILARITY_MIN ||
      bestMatch.containment !== null)
  ) {
    signals.push({
      signal: "NAME_SIMILARITY",
      severity: bestMatch.level,
      score: bestMatch.score,
      reason: NAME_REASONS[bestMatch.level],
    });
  }

  if (!isOfficialAccount) {
    const identityText = buildBrandIdentityText(input.brand, input.assets);
    const { score } = compareTextToIdentity(candidateText, identityText);
    const level = getSimilarityLevel(score);
    if (level !== "LOW") {
      signals.push({
        signal: "BRAND_TEXT_MATCH",
        severity: level,
        score,
        reason: BRAND_TEXT_REASONS[level],
      });
    }
  }

  const support = detectSupportLanguage(candidateText);
  if (support.keywords.length > 0) {
    signals.push({
      signal: "SUPPORT_LANGUAGE",
      severity: getSupportLanguageSeverity(support.score),
      score: support.score,
      reason: SUPPORT_LANGUAGE_REASON,
    });
  }

  const officialDomains = collectOfficialDomains(input.brand, input.assets);
  const discoveredDomains = extractDomains(candidateText);
  const matchedDomains = discoveredDomains.filter((domain) =>
    matchesOfficialDomain(domain, officialDomains),
  );
  const externalDomains = discoveredDomains.filter(
    (domain) => !matchedDomains.includes(domain),
  );

  if (matchedDomains.length > 0) {
    signals.push({
      signal: "OFFICIAL_DOMAIN_MATCH",
      severity: "LOW",
      score: SOCIAL_SIGNAL_THRESHOLDS.OFFICIAL_DOMAIN_SCORE,
      reason: `Candidate profile references an official brand domain (${matchedDomains.join(", ")}) — consistent with a legitimate account.`,
    });
  }

  if (externalDomains.length > 0) {
    signals.push({
      signal: "EXTERNAL_DOMAIN",
      severity: getSimilarityLevel(SOCIAL_SIGNAL_THRESHOLDS.EXTERNAL_DOMAIN_SCORE),
      score: SOCIAL_SIGNAL_THRESHOLDS.EXTERNAL_DOMAIN_SCORE,
      reason: `Candidate profile references an external domain that is not registered as an official brand asset: ${externalDomains.join(", ")}.`,
    });
  }

  if (bestMatch && (bestMatch.level === "HIGH" || bestMatch.containment !== null)) {
    signals.push({
      signal: "OFFICIAL_IDENTITY_CONFLICT",
      severity: getSimilarityLevel(SOCIAL_SIGNAL_THRESHOLDS.IDENTITY_CONFLICT_SCORE),
      score: SOCIAL_SIGNAL_THRESHOLDS.IDENTITY_CONFLICT_SCORE,
      reason: IDENTITY_CONFLICT_REASON,
    });
  }

  return signals;
};

export const buildSocialRiskResult = (
  candidateId: string,
  signals: SocialSignal[],
): SocialRiskResult => ({
  candidateId,
  type: "SOCIAL",
  signals,
  signalCount: signals.length,
  hasHighSeverity: signals.some((signal) => signal.severity === "HIGH"),
});

export const analyzeCandidateSocialRisk = async (
  candidateId: string,
): Promise<SocialRiskOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  if (candidate.type.trim().toUpperCase() !== SOCIAL_ASSET_TYPE) {
    return { ok: false, code: "SOCIAL_ANALYSIS_NOT_APPLICABLE" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  const assets = await listOfficialAssets(brand.id);
  const signals = buildSocialSignals({ candidate, brand, assets });

  return { ok: true, data: buildSocialRiskResult(candidate.id, signals) };
};
