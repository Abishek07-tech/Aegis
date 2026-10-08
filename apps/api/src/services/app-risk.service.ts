import {
  APP_SIGNAL_THRESHOLDS,
  SIMILARITY_THRESHOLDS,
  type SimilarityLevel,
} from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";
import { getSimilarityLevel, normalizeText, similarityScore } from "./similarity.service";
import {
  collectOfficialDomains,
  containmentScore,
  extractDomains,
  matchesOfficialDomain,
} from "./social-risk.service";
import {
  buildBrandIdentityText,
  compareTextToIdentity,
} from "./text-analysis.service";

export type AppSignalSeverity = SimilarityLevel;

export type AppSignalName =
  | "APP_NAME_SIMILARITY"
  | "APP_DESCRIPTION_MATCH"
  | "PACKAGE_IDENTIFIER_SIMILARITY"
  | "OFFICIAL_APP_MATCH"
  | "OFFICIAL_DOMAIN_MATCH"
  | "EXTERNAL_DOMAIN"
  | "APP_BRAND_IMPERSONATION";

export type UnavailableAppSignalName = AppSignalName | "DIFFERENT_PUBLISHER";

export interface AppSignal {
  signal: AppSignalName;
  severity: AppSignalSeverity;
  score: number;
  reason: string;
}

export interface UnavailableAppSignal {
  signal: UnavailableAppSignalName;
  reason: string;
}

export interface AppRiskResult {
  candidateId: string;
  type: "APP";
  signals: AppSignal[];
  signalCount: number;
  hasHighSeverity: boolean;
  unavailableSignals: UnavailableAppSignal[];
}

export type AppRiskFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "APP_ANALYSIS_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type AppRiskOutcome =
  | { ok: true; data: AppRiskResult }
  | { ok: false; code: AppRiskFailureCode };

export interface AppSignalInput {
  candidate: Pick<CandidateAsset, "value" | "name" | "description">;
  brand: Pick<Brand, "name" | "website">;
  assets: OfficialAsset[];
}

export interface AppIdentityMatch {
  officialValue: string;
  score: number;
  level: SimilarityLevel;
  containment: number | null;
}

export interface AppSignalsBundle {
  signals: AppSignal[];
  unavailableSignals: UnavailableAppSignal[];
}

const APP_ASSET_TYPE = "APP";
const PUBLISHER_UNAVAILABLE_REASON =
  "Publisher/developer metadata is not present in the current data model — comparison unavailable (DIFFERENT_PUBLISHER).";

const APP_NAME_REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate app name is highly similar to the protected brand or an official app.",
  MEDIUM: "Candidate app name is moderately similar to the protected brand or an official app.",
  LOW: "Candidate app name shows some similarity to the protected brand or an official app.",
};

const APP_DESCRIPTION_REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate app description strongly references the protected brand identity.",
  MEDIUM: "Candidate app description moderately references the protected brand identity.",
  LOW: "Candidate app description weakly references the protected brand identity.",
};

const PACKAGE_REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate package identifier is highly similar to an official app identifier.",
  MEDIUM: "Candidate package identifier is moderately similar to an official app identifier.",
  LOW: "Candidate package identifier shows some similarity to an official app identifier.",
};

const OFFICIAL_APP_REASON =
  "Candidate value exactly matches a registered official app asset — treated as the official app, not flagged.";

const IMPERSONATION_REASON =
  "Multiple strong similarities (app name, description, and/or package identifier) indicate this app closely imitates the protected brand identity.";

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const getOfficialAppValues = (assets: OfficialAsset[]): string[] =>
  assets
    .filter((asset) => asset.type === APP_ASSET_TYPE)
    .map((asset) => asset.value)
    .filter((value) => normalizeText(value) !== "");

export const isOfficialAppIdentity = (
  candidateValue: string,
  officialAppValues: string[],
): boolean => {
  const normalized = normalizeText(candidateValue);
  if (normalized === "") {
    return false;
  }
  return officialAppValues.some(
    (officialValue) => normalizeText(officialValue) === normalized,
  );
};

export const findBestAppIdentityMatch = (
  candidateValue: string,
  officialValues: string[],
): AppIdentityMatch | null => {
  let best: AppIdentityMatch | null = null;

  for (const officialValue of officialValues) {
    const containment = containmentScore(candidateValue, officialValue);
    const score = Math.max(
      similarityScore(candidateValue, officialValue),
      containment ?? 0,
    );
    if (best === null || score > best.score) {
      best = {
        officialValue,
        score: round2(score),
        level: getSimilarityLevel(score),
        containment,
      };
    }
  }

  return best;
};

export const buildAppDescriptionText = (
  candidate: Pick<CandidateAsset, "name" | "description">,
): string =>
  [candidate.name, candidate.description]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim())
    .join(" ");

export const buildAppSignals = (input: AppSignalInput): AppSignalsBundle => {
  const signals: AppSignal[] = [];
  const unavailableSignals: UnavailableAppSignal[] = [
    { signal: "DIFFERENT_PUBLISHER", reason: PUBLISHER_UNAVAILABLE_REASON },
  ];

  const officialAppValues = getOfficialAppValues(input.assets);
  const isOfficialApp = isOfficialAppIdentity(
    input.candidate.value,
    officialAppValues,
  );

  // 1. APP_NAME_SIMILARITY — candidate app name vs brand name + official APP values
  const candidateAppName =
    typeof input.candidate.name === "string" && input.candidate.name.trim() !== ""
      ? input.candidate.name.trim()
      : input.candidate.value;
  const officialNameValues = [input.brand.name, ...officialAppValues].filter(
    (value) => normalizeText(value) !== "",
  );

  let nameMatch: AppIdentityMatch | null = null;
  if (officialNameValues.length === 0) {
    unavailableSignals.push({
      signal: "APP_NAME_SIMILARITY",
      reason: "No official name identity is available to compare the app name against.",
    });
  } else if (!isOfficialApp) {
    nameMatch = findBestAppIdentityMatch(candidateAppName, officialNameValues);
    if (
      nameMatch &&
      (nameMatch.score >= APP_SIGNAL_THRESHOLDS.NAME_SIMILARITY_MIN ||
        nameMatch.containment !== null)
    ) {
      signals.push({
        signal: "APP_NAME_SIMILARITY",
        severity: nameMatch.level,
        score: nameMatch.score,
        reason: APP_NAME_REASONS[nameMatch.level],
      });
    }
  }

  // 2. APP_DESCRIPTION_MATCH — Task 7 text similarity (name + description only; generic words stay silent)
  let descriptionScore: number | null = null;
  let descriptionLevel: SimilarityLevel | null = null;
  if (!isOfficialApp) {
    const descriptionText = buildAppDescriptionText(input.candidate);
    const identityText = buildBrandIdentityText(input.brand, input.assets);
    if (descriptionText === "") {
      unavailableSignals.push({
        signal: "APP_DESCRIPTION_MATCH",
        reason: "Candidate app has no usable name/description text to compare.",
      });
    } else if (identityText === "") {
      unavailableSignals.push({
        signal: "APP_DESCRIPTION_MATCH",
        reason: "Target brand has no usable identity information to compare the description against.",
      });
    } else {
      const { score: rawScore } = compareTextToIdentity(descriptionText, identityText);
      descriptionScore = round2(rawScore);
      descriptionLevel = getSimilarityLevel(descriptionScore);
      if (descriptionLevel !== "LOW") {
        signals.push({
          signal: "APP_DESCRIPTION_MATCH",
          severity: descriptionLevel,
          score: descriptionScore,
          reason: APP_DESCRIPTION_REASONS[descriptionLevel],
        });
      }
    }
  }

  // 3. PACKAGE_IDENTIFIER_SIMILARITY — candidate.value vs official APP identifiers
  let packageMatch: AppIdentityMatch | null = null;
  if (!isOfficialApp) {
    const identifier = input.candidate.value.trim();
    if (identifier === "") {
      unavailableSignals.push({
        signal: "PACKAGE_IDENTIFIER_SIMILARITY",
        reason: "Candidate has no package identifier/value to compare.",
      });
    } else if (officialAppValues.length === 0) {
      unavailableSignals.push({
        signal: "PACKAGE_IDENTIFIER_SIMILARITY",
        reason: "No official APP assets are registered — package identifier comparison unavailable.",
      });
    } else {
      packageMatch = findBestAppIdentityMatch(identifier, officialAppValues);
      if (
        packageMatch &&
        (packageMatch.score >= APP_SIGNAL_THRESHOLDS.NAME_SIMILARITY_MIN ||
          packageMatch.containment !== null)
      ) {
        signals.push({
          signal: "PACKAGE_IDENTIFIER_SIMILARITY",
          severity: packageMatch.level,
          score: packageMatch.score,
          reason: PACKAGE_REASONS[packageMatch.level],
        });
      }
    }
  }

  // 4. OFFICIAL_APP_MATCH — exact official app (impersonation signals suppressed above)
  if (isOfficialApp) {
    signals.push({
      signal: "OFFICIAL_APP_MATCH",
      severity: "LOW",
      score: APP_SIGNAL_THRESHOLDS.OFFICIAL_APP_SCORE,
      reason: OFFICIAL_APP_REASON,
    });
  }

  // 5/6. OFFICIAL_DOMAIN_MATCH / EXTERNAL_DOMAIN — reuse Task 9 domain machinery
  // Only scan name+description for domains; value is the package identifier, not a URL
  const domainScanText = buildAppDescriptionText(input.candidate);
  const officialDomains = collectOfficialDomains(input.brand, input.assets);
  const discoveredDomains = extractDomains(domainScanText);
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
      score: APP_SIGNAL_THRESHOLDS.OFFICIAL_DOMAIN_SCORE,
      reason: `Candidate app metadata references an official brand domain (${matchedDomains.join(", ")}) — consistent with a legitimate app.`,
    });
  }

  if (externalDomains.length > 0) {
    signals.push({
      signal: "EXTERNAL_DOMAIN",
      severity: getSimilarityLevel(APP_SIGNAL_THRESHOLDS.EXTERNAL_DOMAIN_SCORE),
      score: APP_SIGNAL_THRESHOLDS.EXTERNAL_DOMAIN_SCORE,
      reason: `Candidate app metadata references an external domain that is not registered as an official brand asset: ${externalDomains.join(", ")}.`,
    });
  }

  // 7. APP_BRAND_IMPERSONATION — >= 2 strong indicators (still evidence, not a verdict)
  const nameStrong =
    nameMatch !== null &&
    (nameMatch.level === "HIGH" || nameMatch.containment !== null);
  const descriptionStrong =
    descriptionLevel !== null &&
    descriptionScore !== null &&
    descriptionScore >= SIMILARITY_THRESHOLDS.HIGH;
  const packageStrong =
    packageMatch !== null &&
    (packageMatch.level === "HIGH" || packageMatch.containment !== null);
  const strongCount = [nameStrong, descriptionStrong, packageStrong].filter(
    Boolean,
  ).length;

  if (strongCount >= 2) {
    signals.push({
      signal: "APP_BRAND_IMPERSONATION",
      severity: getSimilarityLevel(APP_SIGNAL_THRESHOLDS.IMPERSONATION_SCORE),
      score: APP_SIGNAL_THRESHOLDS.IMPERSONATION_SCORE,
      reason: IMPERSONATION_REASON,
    });
  }

  return { signals, unavailableSignals };
};

export const buildAppRiskResult = (
  candidateId: string,
  bundle: AppSignalsBundle,
): AppRiskResult => ({
  candidateId,
  type: "APP",
  signals: bundle.signals,
  signalCount: bundle.signals.length,
  hasHighSeverity: bundle.signals.some((signal) => signal.severity === "HIGH"),
  unavailableSignals: bundle.unavailableSignals,
});

export const analyzeCandidateAppRisk = async (
  candidateId: string,
): Promise<AppRiskOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  if (candidate.type.trim().toUpperCase() !== APP_ASSET_TYPE) {
    return { ok: false, code: "APP_ANALYSIS_NOT_APPLICABLE" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  const assets = await listOfficialAssets(brand.id);
  const bundle = buildAppSignals({ candidate, brand, assets });

  return { ok: true, data: buildAppRiskResult(candidate.id, bundle) };
};
