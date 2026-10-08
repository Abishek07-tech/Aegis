import { CORRELATION_THRESHOLDS } from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById, listCandidates } from "./candidate.service";
import {
  EVIDENCE_SOURCE_ORDER,
  buildEvidenceResult,
  collectEvidence,
  type EvidenceItem,
  type EvidenceSource,
} from "./evidence.service";
import { classifyEvidence, isProtectiveSignal } from "./risk-engine.service";
import {
  collectOfficialDomains,
  extractDomains,
  extractUrls,
  getOfficialSocialValues,
  isOfficialSocialIdentity,
  matchesOfficialDomain,
  normalizeDomain,
} from "./social-risk.service";
import { getOfficialAppValues, isOfficialAppIdentity } from "./app-risk.service";
import { buildCandidateText } from "./text-analysis.service";

// Correlation link types actually supported by the current data model.
// SHARED_CONTACT and SHARED_PUBLISHER are intentionally absent: the CandidateAsset
// schema has no email/phone/publisher fields — correlating them would require
// inventing data.
export type CorrelationLinkType =
  | "SHARED_DOMAIN"
  | "SHARED_URL"
  | "SHARED_BRAND_IDENTITY"
  | "SHARED_VISUAL_EVIDENCE"
  | "SHARED_STRONG_SIGNALS";

export type CorrelationLinkStrength = "STRONG" | "MEDIUM" | "WEAK";

export type RelationshipLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export interface CorrelationLink {
  type: CorrelationLinkType;
  source: EvidenceSource;
  strength: CorrelationLinkStrength;
  explanation: string;
}

export interface RelatedCandidate {
  candidateId: string;
  relationshipScore: number;
  relationshipLevel: RelationshipLevel;
  links: CorrelationLink[];
}

export interface CorrelationResult {
  candidateId: string;
  relatedCandidates: RelatedCandidate[];
  cluster: {
    candidateIds: string[];
    size: number;
  };
}

export type CorrelationFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "CORRELATION_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type CorrelationOutcome =
  | { ok: true; data: CorrelationResult }
  | { ok: false; code: CorrelationFailureCode };

// Everything needed to correlate one candidate — derived from candidate fields plus
// existing Task 11 evidence; no detection logic is re-run or duplicated here.
export interface CorrelationFingerprint {
  candidateId: string;
  type: string;
  brandId: string | null;
  // normalized domains/URLs that are NOT registered official brand assets
  externalDomains: string[];
  urls: string[];
  evidence: EvidenceItem[];
  // exact official identity (SOCIAL/APP) or a value on an official domain (WEBSITE/DOMAIN)
  isExactOfficial: boolean;
}

interface ScoredLink extends CorrelationLink {
  weight: number;
}

const strengthFor = (weight: number): CorrelationLinkStrength => {
  const { STRONG, MEDIUM } = CORRELATION_THRESHOLDS.STRENGTH;
  if (weight >= STRONG) return "STRONG";
  if (weight >= MEDIUM) return "MEDIUM";
  return "WEAK";
};

export const getRelationshipLevel = (score: number): RelationshipLevel => {
  const { MEDIUM, HIGH, VERY_HIGH } = CORRELATION_THRESHOLDS.LEVEL;
  if (score >= VERY_HIGH) return "VERY_HIGH";
  if (score >= HIGH) return "HIGH";
  if (score >= MEDIUM) return "MEDIUM";
  return "LOW";
};

const sortedIntersection = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): string[] => [...left].filter((value) => right.has(value)).sort();

// HIGH-severity non-protective signals in identity/content categories: both candidates
// strongly resemble the same registered brand. Exported for Task 15 campaign indicators
// (shared evidence inspection only — no correlation logic is re-implemented there).
export const strongBrandSignals = (evidence: EvidenceItem[]): Set<string> => {
  const signals = new Set<string>();
  for (const item of evidence) {
    if (isProtectiveSignal(item.signal) || item.severity !== "HIGH") continue;
    const category = classifyEvidence(item);
    if (category === "IDENTITY" || category === "CONTENT") {
      signals.add(item.signal);
    }
  }
  return signals;
};

// All HIGH-severity non-protective signals (any category).
const highSignals = (evidence: EvidenceItem[]): Set<string> => {
  const signals = new Set<string>();
  for (const item of evidence) {
    if (!isProtectiveSignal(item.signal) && item.severity === "HIGH") {
      signals.add(item.signal);
    }
  }
  return signals;
};

const firstSourceFor = (
  evidence: EvidenceItem[],
  signals: ReadonlySet<string>,
): EvidenceSource => {
  let best: EvidenceSource | null = null;
  let bestIndex = Number.MAX_SAFE_INTEGER;
  for (const item of evidence) {
    if (!signals.has(item.signal)) continue;
    const index = EVIDENCE_SOURCE_ORDER.indexOf(item.source);
    if (index < bestIndex) {
      best = item.source;
      bestIndex = index;
    }
  }
  return best ?? "TEXT";
};

const categoryOfSignal = (
  evidence: EvidenceItem[],
  signal: string,
): ReturnType<typeof classifyEvidence> | null => {
  const item = evidence.find((entry) => entry.signal === signal);
  return item ? classifyEvidence(item) : null;
};

/**
 * Pairwise correlation between two candidates — deterministic and explainable.
 * Score model (documented in docs/DEVELOPMENT_MEMORY.md):
 *   - each link type contributes its base weight from CORRELATION_THRESHOLDS.LINK_WEIGHT
 *   - SHARED_DOMAIN + SHARED_URL are one underlying infrastructure observation: the
 *     weaker (URL) is damped by INFRA_OVERLAP_DAMPING (URL is a refinement of domain)
 *   - SHARED_STRONG_SIGNALS only carries signals not already explained by another
 *     link (domains, brand identity, visual) — no double counting of the same evidence
 *   - relationshipScore = min(100, Σ effective weights); risk score plays no part
 */
const buildScoredLinks = (
  a: CorrelationFingerprint,
  b: CorrelationFingerprint,
  brandName: string,
): ScoredLink[] => {
  const links: ScoredLink[] = [];
  const weights = CORRELATION_THRESHOLDS.LINK_WEIGHT;
  const damping = CORRELATION_THRESHOLDS.INFRA_OVERLAP_DAMPING;

  // SHARED_DOMAIN — same external (non-official) domain in both candidates' content
  const sharedDomains = a.externalDomains
    .filter((domain) => b.externalDomains.includes(domain))
    .sort();
  const domainLink: ScoredLink | null =
    sharedDomains.length > 0
      ? {
          type: "SHARED_DOMAIN",
          source: "TEXT",
          weight: weights.SHARED_DOMAIN,
          strength: strengthFor(weights.SHARED_DOMAIN),
          explanation:
            `Both candidates reference the same external domain` +
            `${sharedDomains.length > 1 ? "s" : ""} not registered as an ` +
            `official brand asset: ${sharedDomains.join(", ")}.`,
        }
      : null;

  // SHARED_URL — same normalized URL (official-domain URLs are filtered upstream)
  const sharedUrls = a.urls
    .filter((url) => b.urls.includes(url))
    .sort();
  const urlLink: ScoredLink | null =
    sharedUrls.length > 0
      ? {
          type: "SHARED_URL",
          source: "TEXT",
          weight: weights.SHARED_URL,
          strength: strengthFor(weights.SHARED_URL),
          explanation:
            `Both candidates contain the same normalized URL` +
            `${sharedUrls.length > 1 ? "s" : ""}: ${sharedUrls.join(", ")}.`,
        }
      : null;

  // Infrastructure grouping: domain + URL describe the same underlying hosting.
  const infra: (ScoredLink | null)[] = [domainLink, urlLink];
  const presentInfra = infra.filter((link): link is ScoredLink => link !== null);
  if (presentInfra.length > 1) {
    presentInfra.sort(
      (x, y) =>
        y.weight - x.weight ||
        (x.type === "SHARED_DOMAIN" ? 0 : 1) - (y.type === "SHARED_DOMAIN" ? 0 : 1),
    );
    for (let index = 1; index < presentInfra.length; index++) {
      const link = presentInfra[index];
      link.weight = Math.round(link.weight * damping);
      link.strength = strengthFor(link.weight);
      link.explanation +=
        " (same underlying infrastructure as the shared domain link — counted at reduced weight)";
    }
  }
  links.push(...presentInfra);

  // SHARED_BRAND_IDENTITY — both strongly resemble the same registered brand.
  // Same-brand scope is guaranteed by the caller's universe; brandId is still checked
  // so sharing a brand registry alone can never create this link without evidence.
  const strongA = strongBrandSignals(a.evidence);
  const strongB = strongBrandSignals(b.evidence);
  let brandLink: ScoredLink | null = null;
  if (
    a.brandId !== null &&
    a.brandId === b.brandId &&
    strongA.size > 0 &&
    strongB.size > 0
  ) {
    const sharedStrong = sortedIntersection(strongA, strongB);
    brandLink = {
      type: "SHARED_BRAND_IDENTITY",
      source: firstSourceFor(a.evidence, strongA),
      weight: weights.SHARED_BRAND_IDENTITY,
      strength: strengthFor(weights.SHARED_BRAND_IDENTITY),
      explanation:
        `Both candidates strongly resemble the same registered brand (${brandName}).` +
        (sharedStrong.length > 0
          ? ` Shared strong signals: ${sharedStrong.join(", ")}.`
          : ""),
    };
    links.push(brandLink);
  }

  // SHARED_VISUAL_EVIDENCE — both have HIGH logo similarity to the same official logo
  // (consumes Task 8/11 LOGO evidence; no logo algorithm of our own)
  const visualA = a.evidence.some(
    (item) => item.signal === "LOGO_SIMILARITY" && item.severity === "HIGH",
  );
  const visualB = b.evidence.some(
    (item) => item.signal === "LOGO_SIMILARITY" && item.severity === "HIGH",
  );
  if (visualA && visualB) {
    links.push({
      type: "SHARED_VISUAL_EVIDENCE",
      source: "LOGO",
      weight: weights.SHARED_VISUAL_EVIDENCE,
      strength: strengthFor(weights.SHARED_VISUAL_EVIDENCE),
      explanation: "Both candidates show HIGH logo similarity to the same official brand logo.",
    });
  }

  // SHARED_STRONG_SIGNALS — compatible HIGH evidence, minus signals already covered
  // by another link type (avoids counting one underlying observation twice).
  const sharedHigh = sortedIntersection(
    highSignals(a.evidence),
    highSignals(b.evidence),
  );
  const covered = new Set<string>();
  if (domainLink) covered.add("EXTERNAL_DOMAIN");
  if (brandLink) {
    for (const signal of sharedHigh) {
      const category = categoryOfSignal(a.evidence, signal);
      if (category === "IDENTITY" || category === "CONTENT") covered.add(signal);
    }
  }
  if (links.some((link) => link.type === "SHARED_VISUAL_EVIDENCE")) {
    covered.add("LOGO_SIMILARITY");
  }
  const remaining = sharedHigh.filter((signal) => !covered.has(signal));
  if (remaining.length > 0) {
    const remainingSet = new Set(remaining);
    links.push({
      type: "SHARED_STRONG_SIGNALS",
      source: firstSourceFor(a.evidence, remainingSet),
      weight: weights.SHARED_STRONG_SIGNALS,
      strength: strengthFor(weights.SHARED_STRONG_SIGNALS),
      explanation:
        `Both candidates share the same HIGH-severity evidence signals: ` +
        `${remaining.join(", ")}.`,
    });
  }

  links.sort((x, y) => y.weight - x.weight || x.type.localeCompare(y.type));
  return links;
};

const scoreLinks = (links: ScoredLink[]): number =>
  Math.min(
    CORRELATION_THRESHOLDS.MAX_SCORE,
    links.reduce((sum, link) => sum + link.weight, 0),
  );

const stripWeights = (links: ScoredLink[]): CorrelationLink[] =>
  links.map(({ weight: _weight, ...link }) => link);

/**
 * Correlate a subject fingerprint against same-brand peers and compute the
 * connected component (cluster) containing the subject.
 * Exact-official subjects and exact-official peers are excluded (false-positive
 * protection): official assets are protective evidence, never threat links.
 */
export const correlateFingerprints = (
  subject: CorrelationFingerprint,
  others: CorrelationFingerprint[],
  brandName: string,
): Pick<CorrelationResult, "relatedCandidates" | "cluster"> => {
  if (subject.isExactOfficial) {
    return {
      relatedCandidates: [],
      cluster: { candidateIds: [subject.candidateId], size: 1 },
    };
  }

  const universe = others.filter(
    (other) => other.candidateId !== subject.candidateId && !other.isExactOfficial,
  );
  const members = [subject, ...universe];

  // Undirected weighted graph over all same-brand candidates.
  const adjacency = new Map<
    string,
    Array<{ id: string; score: number; links: ScoredLink[] }>
  >();
  for (const member of members) {
    adjacency.set(member.candidateId, []);
  }
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const links = buildScoredLinks(members[i], members[j], brandName);
      if (links.length === 0) continue;
      const score = scoreLinks(links);
      adjacency.get(members[i].candidateId)?.push({
        id: members[j].candidateId,
        score,
        links,
      });
      adjacency.get(members[j].candidateId)?.push({
        id: members[i].candidateId,
        score,
        links,
      });
    }
  }

  const relatedCandidates = (adjacency.get(subject.candidateId) ?? [])
    .map((edge) => ({
      candidateId: edge.id,
      relationshipScore: edge.score,
      relationshipLevel: getRelationshipLevel(edge.score),
      links: stripWeights(edge.links),
    }))
    .sort(
      (x, y) =>
        y.relationshipScore - x.relationshipScore ||
        x.candidateId.localeCompare(y.candidateId),
    );

  // Connected component from the subject (deterministic BFS: score desc, then id asc).
  const clusterIds: string[] = [subject.candidateId];
  const seen = new Set<string>([subject.candidateId]);
  const queue: string[] = [subject.candidateId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const neighbors = [...(adjacency.get(current) ?? [])].sort(
      (x, y) => y.score - x.score || x.id.localeCompare(y.id),
    );
    for (const neighbor of neighbors) {
      if (seen.has(neighbor.id)) continue;
      seen.add(neighbor.id);
      clusterIds.push(neighbor.id);
      queue.push(neighbor.id);
    }
  }

  return {
    relatedCandidates,
    cluster: { candidateIds: clusterIds, size: clusterIds.length },
  };
};

export const buildCorrelationFingerprint = async (
  candidate: CandidateAsset,
  brand: Brand,
  assets: OfficialAsset[],
): Promise<CorrelationFingerprint> => {
  const normalizedType = candidate.type.trim().toUpperCase();
  const text = buildCandidateText(candidate);
  const officialDomains = collectOfficialDomains(brand, assets);

  // Only non-official domains/URLs are correlation material — official references
  // are protective and must never become threat links.
  const externalDomains = extractDomains(text).filter(
    (domain) => !matchesOfficialDomain(domain, officialDomains),
  );
  const urls = extractUrls(text).filter(
    (url) => !matchesOfficialDomain(normalizeDomain(url), officialDomains),
  );

  let evidence: EvidenceItem[] = [];
  let isExactOfficial = false;

  if (normalizedType === "SOCIAL" || normalizedType === "APP") {
    const { items, unavailable } = await collectEvidence(
      candidate,
      brand,
      assets,
      normalizedType,
    );
    evidence = buildEvidenceResult(
      candidate.id,
      normalizedType,
      items,
      unavailable,
    ).evidence;
    isExactOfficial =
      normalizedType === "SOCIAL"
        ? isOfficialSocialIdentity(candidate.value, getOfficialSocialValues(assets))
        : isOfficialAppIdentity(candidate.value, getOfficialAppValues(assets));
  } else {
    const valueDomain = normalizeDomain(candidate.value);
    isExactOfficial =
      valueDomain !== "" && matchesOfficialDomain(valueDomain, officialDomains);
  }

  return {
    candidateId: candidate.id,
    type: normalizedType,
    brandId: candidate.brandId,
    externalDomains,
    urls,
    evidence,
    isExactOfficial,
  };
};

export const buildCorrelationResult = async (
  subject: CandidateAsset,
  brand: Brand,
  assets: OfficialAsset[],
  candidates: CandidateAsset[],
): Promise<CorrelationResult> => {
  const fingerprints = await Promise.all(
    candidates.map((candidate) =>
      buildCorrelationFingerprint(candidate, brand, assets),
    ),
  );

  const subjectFingerprint =
    fingerprints.find((fp) => fp.candidateId === subject.id) ??
    (await buildCorrelationFingerprint(subject, brand, assets));
  const others = fingerprints.filter((fp) => fp.candidateId !== subject.id);

  const { relatedCandidates, cluster } = correlateFingerprints(
    subjectFingerprint,
    others,
    brand.name,
  );

  return { candidateId: subject.id, relatedCandidates, cluster };
};

export const analyzeCandidateCorrelation = async (
  candidateId: string,
): Promise<CorrelationOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "CORRELATION_NOT_APPLICABLE" };
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
    data: await buildCorrelationResult(candidate, brand, assets, candidates),
  };
};
