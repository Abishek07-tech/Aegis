import { CAMPAIGN_THRESHOLDS } from "../config/constants";
import type { Brand, CandidateAsset, OfficialAsset } from "../generated/prisma/client";
import { listOfficialAssets } from "./asset.service";
import { getBrandById } from "./brand.service";
import { getCandidateById, listCandidates } from "./candidate.service";
import {
  buildCorrelationFingerprint,
  correlateFingerprints,
  getRelationshipLevel,
  strongBrandSignals,
  type CorrelationFingerprint,
  type CorrelationLink,
  type CorrelationLinkStrength,
  type CorrelationResult,
} from "./correlation.service";

// Campaign types derived from actual member evidence — first match wins, most
// specific supported type preferred. Never forced when evidence is insufficient
// (a campaign must pass the detection gates before a type is derived).
export type CampaignType =
  | "CROSS_PLATFORM_IMPERSONATION"
  | "SOCIAL_IMPERSONATION"
  | "APP_IMPERSONATION"
  | "MULTI_ASSET_BRAND_IMPERSONATION"
  | "SHARED_INFRASTRUCTURE";

// Confidence levels reuse the 0–100 LOW/MEDIUM/HIGH/VERY_HIGH ladder.
export type CampaignConfidenceLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type CampaignIndicatorType =
  | "SHARED_SUSPICIOUS_INFRASTRUCTURE"
  | "SHARED_VISUAL_EVIDENCE"
  | "CROSS_PLATFORM_PRESENCE"
  | "CONSISTENT_BRAND_IMPERSONATION"
  | "MULTI_CANDIDATE_CLUSTER";

export interface CampaignIndicator {
  type: CampaignIndicatorType;
  strength: CorrelationLinkStrength;
  explanation: string;
}

// Campaign relationships are the subject's direct correlation edges that actually
// belong to the campaign — the same shape the Task 14 correlation endpoint returns.
export interface CampaignRelationship {
  candidateId: string;
  relationshipScore: number;
  relationshipLevel: ReturnType<typeof getRelationshipLevel>;
  links: CorrelationLink[];
}

export interface Campaign {
  campaignId: string;
  campaignType: CampaignType;
  confidenceScore: number;
  confidenceLevel: CampaignConfidenceLevel;
  candidateIds: string[];
  assetCount: number;
  platformCount: number;
  socialAssetCount: number;
  appAssetCount: number;
  domainCount: number;
  websiteCount: number;
  relatedCandidateCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  durationDays: number | null;
  relationships: CampaignRelationship[];
  indicators: CampaignIndicator[];
}

export interface CampaignResult {
  candidateId: string;
  campaignDetected: boolean;
  campaign: Campaign | null;
  explanation: string;
}

export type CampaignFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "CAMPAIGN_NOT_APPLICABLE"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND";

export type CampaignOutcome =
  | { ok: true; data: CampaignResult }
  | { ok: false; code: CampaignFailureCode };

// Minimal candidate metadata the campaign layer needs (type for impact/type
// derivation, createdAt for the timeline). CandidateAsset is assignable.
export interface CampaignCandidateInfo {
  id: string;
  type: string;
  createdAt: Date | null;
}

const NO_CAMPAIGN_EXPLANATION =
  "No meaningful multi-asset correlation was found.";

const DETECTED_CAMPAIGN_GATES: ReadonlySet<CorrelationLink["type"]> = new Set([
  "SHARED_DOMAIN",
  "SHARED_URL",
  "SHARED_VISUAL_EVIDENCE",
]);

const INFRA_LINK_TYPES: ReadonlySet<CorrelationLink["type"]> = new Set([
  "SHARED_DOMAIN",
  "SHARED_URL",
]);

const STRENGTH_RANK: Record<CorrelationLinkStrength, number> = {
  WEAK: 1,
  MEDIUM: 2,
  STRONG: 3,
};

export const getCampaignConfidenceLevel = (
  score: number,
): CampaignConfidenceLevel => {
  const { MEDIUM, HIGH, VERY_HIGH } = CAMPAIGN_THRESHOLDS.LEVEL;
  if (score >= VERY_HIGH) return "VERY_HIGH";
  if (score >= HIGH) return "HIGH";
  if (score >= MEDIUM) return "MEDIUM";
  return "LOW";
};

/**
 * Deterministic campaign identifier: FNV-1a over the sorted member ids.
 * Same member set → same id (for every member's perspective, in any input
 * order); no database persistence and no random ids.
 */
export const deriveCampaignId = (candidateIds: string[]): string => {
  const input = [...candidateIds].sort().join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `camp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const strongest = (
  strengths: CorrelationLinkStrength[],
): CorrelationLinkStrength =>
  strengths.reduce(
    (best, entry) => (STRENGTH_RANK[entry] > STRENGTH_RANK[best] ? entry : best),
    "WEAK" as CorrelationLinkStrength,
  );

const noCampaign = (candidateId: string): CampaignResult => ({
  candidateId,
  campaignDetected: false,
  campaign: null,
  explanation: NO_CAMPAIGN_EXPLANATION,
});

interface CampaignEdge {
  left: string;
  right: string;
  score: number;
  links: CorrelationLink[];
}

const pairKey = (x: string, y: string): string =>
  x < y ? `${x}|${y}` : `${y}|${x}`;

/**
 * All pairwise correlation edges among the given members — computed by Task 14's
 * own `correlateFingerprints` (pure, exported), never re-derived here. Each edge
 * is stored once (deduped on the unordered id pair).
 */
const collectEdges = (
  memberIds: string[],
  fingerprints: Map<string, CorrelationFingerprint>,
  brandName: string,
): Map<string, CampaignEdge> => {
  const edges = new Map<string, CampaignEdge>();
  for (const memberId of memberIds) {
    const subject = fingerprints.get(memberId);
    if (!subject) continue;
    const others = memberIds
      .filter((id) => id !== memberId)
      .map((id) => fingerprints.get(id))
      .filter((entry): entry is CorrelationFingerprint => entry !== undefined);
    const { relatedCandidates } = correlateFingerprints(
      subject,
      others,
      brandName,
    );
    for (const relation of relatedCandidates) {
      const key = pairKey(memberId, relation.candidateId);
      if (edges.has(key)) continue;
      edges.set(key, {
        left: memberId < relation.candidateId ? memberId : relation.candidateId,
        right: memberId < relation.candidateId ? relation.candidateId : memberId,
        score: relation.relationshipScore,
        links: relation.links,
      });
    }
  }
  return edges;
};

interface CampaignAdjacency {
  id: string;
  edge: CampaignEdge;
}

const buildAdjacency = (
  edges: Map<string, CampaignEdge>,
): Map<string, CampaignAdjacency[]> => {
  const adjacency = new Map<string, CampaignAdjacency[]>();
  const push = (node: string, entry: CampaignAdjacency) => {
    const bucket = adjacency.get(node);
    if (bucket) bucket.push(entry);
    else adjacency.set(node, [entry]);
  };
  for (const edge of edges.values()) {
    push(edge.left, { id: edge.right, edge });
    push(edge.right, { id: edge.left, edge });
  }
  return adjacency;
};

/**
 * Campaign membership: the same deterministic BFS Task 14 uses for its cluster,
 * re-run on the subgraph of edges at least MIN_RELATIONSHIP_SCORE strong. Weak
 * links (e.g. brand-lookalike similarity alone) can be part of the correlation
 * cluster but can never pull a candidate into a campaign.
 */
const campaignComponent = (
  subjectId: string,
  edges: Map<string, CampaignEdge>,
): string[] => {
  const adjacency = buildAdjacency(edges);
  const memberIds: string[] = [subjectId];
  const seen = new Set<string>([subjectId]);
  const queue: string[] = [subjectId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const neighbors = [...(adjacency.get(current) ?? [])]
      .filter((entry) => entry.edge.score >= CAMPAIGN_THRESHOLDS.MIN_RELATIONSHIP_SCORE)
      .sort(
        (x, y) =>
          y.edge.score - x.edge.score || x.id.localeCompare(y.id),
      );
    for (const neighbor of neighbors) {
      if (seen.has(neighbor.id)) continue;
      seen.add(neighbor.id);
      memberIds.push(neighbor.id);
      queue.push(neighbor.id);
    }
  }
  return memberIds;
};

// Independent signal families: SHARED_DOMAIN + SHARED_URL describe the same
// underlying hosting and count as ONE family (anti-double-count for confidence).
const signalFamilies = (edges: CampaignEdge[]): number => {
  let infra = false;
  let brand = false;
  let visual = false;
  let signals = false;
  for (const edge of edges) {
    for (const link of edge.links) {
      if (INFRA_LINK_TYPES.has(link.type)) infra = true;
      else if (link.type === "SHARED_BRAND_IDENTITY") brand = true;
      else if (link.type === "SHARED_VISUAL_EVIDENCE") visual = true;
      else if (link.type === "SHARED_STRONG_SIGNALS") signals = true;
    }
  }
  return (infra ? 1 : 0) + (brand ? 1 : 0) + (visual ? 1 : 0) + (signals ? 1 : 0);
};

const computeConfidenceScore = (
  memberCount: number,
  edges: CampaignEdge[],
  socialCount: number,
  appCount: number,
  impersonationCount: number,
  eligibleCount: number,
): number => {
  const weights = CAMPAIGN_THRESHOLDS.CONFIDENCE;
  const meanEdge =
    edges.length > 0
      ? edges.reduce((sum, edge) => sum + edge.score, 0) / edges.length
      : 0;
  const hasSharedInfra = edges.some((edge) =>
    edge.links.some((link) => INFRA_LINK_TYPES.has(link.type)),
  );
  const raw =
    weights.SIZE_WEIGHT *
      Math.min(1, (memberCount - 1) / weights.SIZE_DIVISOR) +
    weights.EDGE_WEIGHT * (meanEdge / 100) +
    weights.TYPE_WEIGHT *
      Math.min(1, signalFamilies(edges) / weights.TYPE_DIVISOR) +
    (hasSharedInfra ? weights.INFRA_WEIGHT : 0) +
    (socialCount > 0 && appCount > 0 ? weights.CROSS_WEIGHT : 0) +
    (eligibleCount > 0
      ? weights.EVIDENCE_WEIGHT *
        Math.min(1, impersonationCount / eligibleCount)
      : 0);
  return Math.min(
    CAMPAIGN_THRESHOLDS.MAX_SCORE,
    Math.max(0, Math.round(raw)),
  );
};

const deriveCampaignType = (
  socialCount: number,
  appCount: number,
  otherCount: number,
): CampaignType => {
  if (socialCount > 0 && appCount > 0) return "CROSS_PLATFORM_IMPERSONATION";
  if (socialCount > 0 && otherCount === 0) return "SOCIAL_IMPERSONATION";
  if (appCount > 0 && otherCount === 0) return "APP_IMPERSONATION";
  if (socialCount > 0 || appCount > 0) return "MULTI_ASSET_BRAND_IMPERSONATION";
  return "SHARED_INFRASTRUCTURE";
};

const countShared = (
  memberIds: string[],
  fingerprints: Map<string, CorrelationFingerprint>,
  pick: (fingerprint: CorrelationFingerprint) => string[],
): string[] => {
  const occurrences = new Map<string, number>();
  for (const id of memberIds) {
    const fingerprint = fingerprints.get(id);
    if (!fingerprint) continue;
    for (const value of new Set(pick(fingerprint))) {
      occurrences.set(value, (occurrences.get(value) ?? 0) + 1);
    }
  }
  return [...occurrences.entries()]
    .filter(([, count]) => count >= 2)
    .map(([value]) => value)
    .sort();
};

const buildIndicators = (
  memberIds: string[],
  fingerprints: Map<string, CorrelationFingerprint>,
  edges: CampaignEdge[],
  counts: {
    social: number;
    app: number;
    eligible: number;
    withIdentity: number;
  },
  brandName: string,
): CampaignIndicator[] => {
  const indicators: CampaignIndicator[] = [];
  const size = memberIds.length;

  const infraLinks = edges.flatMap((edge) =>
    edge.links.filter((link) => INFRA_LINK_TYPES.has(link.type)),
  );
  if (infraLinks.length > 0) {
    const domains = countShared(memberIds, fingerprints, (fp) => fp.externalDomains);
    const urls = countShared(memberIds, fingerprints, (fp) => fp.urls);
    const parts: string[] = [];
    if (domains.length > 0) {
      parts.push(
        `external domain${domains.length > 1 ? "s" : ""} ${domains.join(", ")}`,
      );
    }
    if (urls.length > 0) {
      parts.push(
        `external URL${urls.length > 1 ? "s" : ""} ${urls.join(", ")}`,
      );
    }
    const detail =
      parts.length > 0
        ? `${parts.join(" and ")} shared by ${size} of ${size} campaign candidates, none registered as an official ${brandName} asset`
        : `external infrastructure shared by the campaign candidates, none registered as an official ${brandName} asset`;
    indicators.push({
      type: "SHARED_SUSPICIOUS_INFRASTRUCTURE",
      strength: strongest(infraLinks.map((link) => link.strength)),
      explanation: `The candidates share the same ${detail}.`,
    });
  }

  const visualLinks = edges.flatMap((edge) =>
    edge.links.filter((link) => link.type === "SHARED_VISUAL_EVIDENCE"),
  );
  if (visualLinks.length > 0) {
    indicators.push({
      type: "SHARED_VISUAL_EVIDENCE",
      strength: strongest(visualLinks.map((link) => link.strength)),
      explanation: `${counts.social + counts.app > 0 ? "Members of the group" : "Candidates"} show HIGH logo similarity to the same official ${brandName} logo — shared visual brand material.`,
    });
  }

  if (counts.social > 0 && counts.app > 0) {
    indicators.push({
      type: "CROSS_PLATFORM_PRESENCE",
      strength: "STRONG",
      explanation: `The group spans ${counts.social} social and ${counts.app} app candidate${counts.app > 1 || counts.social > 1 ? "s" : ""} — the indicators appear across multiple platforms.`,
    });
  }

  if (counts.withIdentity >= 2) {
    const signals = new Set<string>();
    for (const id of memberIds) {
      const fingerprint = fingerprints.get(id);
      if (!fingerprint) continue;
      for (const signal of strongBrandSignals(fingerprint.evidence)) {
        signals.add(signal);
      }
    }
    const strength: CorrelationLinkStrength =
      counts.withIdentity >= counts.eligible ? "STRONG" : "MEDIUM";
    indicators.push({
      type: "CONSISTENT_BRAND_IMPERSONATION",
      strength,
      explanation: `${counts.withIdentity} of ${counts.eligible} impersonation-capable candidates show strong brand-impersonation evidence toward ${brandName} (HIGH severity signals observed: ${[...signals].sort().join(", ")}).`,
    });
  }

  if (size >= 3) {
    indicators.push({
      type: "MULTI_CANDIDATE_CLUSTER",
      strength: size >= 4 ? "STRONG" : "MEDIUM",
      explanation: `${size} candidates form one connected group through shared correlation links (strongest relationship ${Math.max(
        ...edges.map((edge) => edge.score),
      )}/100).`,
    });
  }

  return indicators;
};

const channelPhrase = (social: number, app: number): string | null => {
  if (social > 0 && app > 0) return "across social and app channels";
  if (social > 0) return "across social channels";
  if (app > 0) return "across app channels";
  return null;
};

const buildExplanation = (
  size: number,
  counts: {
    social: number;
    app: number;
    domain: number;
    website: number;
  },
  sharedDomains: string[],
  sharedUrls: string[],
  hasVisual: boolean,
  hasIdentity: boolean,
  brandName: string,
  confidenceScore: number,
  confidenceLevel: CampaignConfidenceLevel,
): string => {
  const channels: string[] = [];
  if (counts.social > 0) channels.push(`${counts.social} social`);
  if (counts.app > 0) channels.push(`${counts.app} app`);
  if (counts.domain > 0) channels.push(`${counts.domain} domain`);
  if (counts.website > 0) channels.push(`${counts.website} website`);

  let phrase = `${size} candidate asset${size === 1 ? "" : "s"}${
    channels.length > 0 ? ` (${channels.join(", ")})` : ""
  }`;
  if (sharedDomains.length > 0) {
    phrase += ` are linked by the same external domain ${sharedDomains.join(", ")}`;
  } else if (sharedUrls.length > 0) {
    phrase += ` are linked by the same external URL ${sharedUrls.join(", ")}`;
  } else if (hasVisual) {
    phrase += ` are linked by shared visual evidence of the official ${brandName} logo`;
  }
  if (hasIdentity) {
    phrase += ` and share strong brand-impersonation evidence${
      channelPhrase(counts.social, counts.app)
        ? ` ${channelPhrase(counts.social, counts.app)}`
        : ""
    }`;
  }
  return (
    `${phrase}. The evidence is consistent with a coordinated impersonation campaign` +
    ` — campaign confidence ${confidenceScore}/100 (${confidenceLevel}).`
  );
};

const formatTimestamp = (value: Date | null): string | null =>
  value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : null;

/**
 * Interpret Task 14 correlation output as a campaign — the higher-level question
 * "do these connected assets form one coordinated impersonation activity?".
 *
 * Gates (all deterministic):
 *   1. campaign membership = Task 14 cluster re-BFS'd on edges ≥ MIN_RELATIONSHIP_SCORE
 *      (weak brand-lookalike links never pull candidates in; official assets are
 *      already excluded from the cluster by Task 14);
 *   2. at least 2 members;
 *   3. at least one campaign edge carries suspicious coordination evidence:
 *      shared external domain/URL (official domains were filtered by Task 14 and
 *      can never appear) or shared visual brand material.
 *
 * High individual risk, same-brand membership, similar names or official branding
 * alone are deliberately NOT inputs — risk score plays no part.
 */
export const buildCampaignResult = (
  correlation: Pick<CorrelationResult, "candidateId" | "cluster">,
  candidates: CampaignCandidateInfo[],
  fingerprints: CorrelationFingerprint[],
  brandName: string,
): CampaignResult => {
  const subjectId = correlation.candidateId;
  const infoById = new Map(candidates.map((entry) => [entry.id, entry]));
  const fingerprintById = new Map(
    fingerprints.map((entry) => [entry.candidateId, entry]),
  );

  const memberIds = correlation.cluster.candidateIds.filter(
    (id) => infoById.has(id) && fingerprintById.has(id),
  );
  if (!memberIds.includes(subjectId)) {
    return noCampaign(subjectId);
  }

  const allEdges = collectEdges(memberIds, fingerprintById, brandName);
  const campaignIds = campaignComponent(subjectId, allEdges);
  if (campaignIds.length < 2) {
    return noCampaign(subjectId);
  }
  const campaignSet = new Set(campaignIds);
  const campaignEdges = [...allEdges.values()].filter(
    (edge) =>
      edge.score >= CAMPAIGN_THRESHOLDS.MIN_RELATIONSHIP_SCORE &&
      campaignSet.has(edge.left) &&
      campaignSet.has(edge.right),
  );

  const coordinationEvidence = campaignEdges.some((edge) =>
    edge.links.some((link) => DETECTED_CAMPAIGN_GATES.has(link.type)),
  );
  if (!coordinationEvidence) {
    return noCampaign(subjectId);
  }

  // ---- member metadata (type counts, timeline) ----
  const typeCounts = new Map<string, number>();
  let social = 0;
  let app = 0;
  let domain = 0;
  let website = 0;
  let firstSeen: Date | null = null;
  let lastSeen: Date | null = null;
  let timelineComplete = true;
  for (const id of campaignIds) {
    const info = infoById.get(id) as CampaignCandidateInfo;
    const normalized = info.type.trim().toUpperCase();
    typeCounts.set(normalized, (typeCounts.get(normalized) ?? 0) + 1);
    if (normalized === "SOCIAL") social += 1;
    else if (normalized === "APP") app += 1;
    else if (normalized === "DOMAIN") domain += 1;
    else if (normalized === "WEBSITE") website += 1;

    const timestamp = formatTimestamp(info.createdAt);
    if (timestamp === null) {
      timelineComplete = false;
    } else {
      const date = new Date(timestamp);
      if (firstSeen === null || date < firstSeen) firstSeen = date;
      if (lastSeen === null || date > lastSeen) lastSeen = date;
    }
  }

  // ---- brand-impersonation evidence consistency (SOCIAL/APP members only) ----
  let eligible = 0;
  let withIdentity = 0;
  for (const id of campaignIds) {
    const info = infoById.get(id) as CampaignCandidateInfo;
    const normalized = info.type.trim().toUpperCase();
    if (normalized !== "SOCIAL" && normalized !== "APP") continue;
    eligible += 1;
    const fingerprint = fingerprintById.get(id);
    if (fingerprint && strongBrandSignals(fingerprint.evidence).size > 0) {
      withIdentity += 1;
    }
  }

  const confidenceScore = computeConfidenceScore(
    campaignIds.length,
    campaignEdges,
    social,
    app,
    withIdentity,
    eligible,
  );
  const confidenceLevel = getCampaignConfidenceLevel(confidenceScore);

  const relationships: CampaignRelationship[] = campaignEdges
    .filter((edge) => edge.left === subjectId || edge.right === subjectId)
    .map((edge) => {
      const other =
        edge.left === subjectId ? edge.right : edge.left;
      return {
        candidateId: other,
        relationshipScore: edge.score,
        relationshipLevel: getRelationshipLevel(edge.score),
        links: edge.links,
      };
    })
    .sort(
      (x, y) =>
        y.relationshipScore - x.relationshipScore ||
        x.candidateId.localeCompare(y.candidateId),
    );

  const indicators = buildIndicators(
    campaignIds,
    fingerprintById,
    campaignEdges,
    { social, app, eligible, withIdentity },
    brandName,
  );

  const sharedDomains = countShared(campaignIds, fingerprintById, (fp) => fp.externalDomains);
  const sharedUrls = countShared(campaignIds, fingerprintById, (fp) => fp.urls);
  const hasVisual = campaignEdges.some((edge) =>
    edge.links.some((link) => link.type === "SHARED_VISUAL_EVIDENCE"),
  );

  const otherCount = campaignIds.length - social - app;
  const campaign: Campaign = {
    campaignId: deriveCampaignId(campaignIds),
    campaignType: deriveCampaignType(social, app, otherCount),
    confidenceScore,
    confidenceLevel,
    candidateIds: campaignIds,
    assetCount: campaignIds.length,
    platformCount: typeCounts.size,
    socialAssetCount: social,
    appAssetCount: app,
    domainCount: domain,
    websiteCount: website,
    relatedCandidateCount: relationships.length,
    firstSeen: timelineComplete ? formatTimestamp(firstSeen) : null,
    lastSeen: timelineComplete ? formatTimestamp(lastSeen) : null,
    durationDays: timelineComplete && firstSeen && lastSeen
      ? Math.floor((lastSeen.getTime() - firstSeen.getTime()) / 86_400_000)
      : null,
    relationships,
    indicators,
  };

  return {
    candidateId: subjectId,
    campaignDetected: true,
    campaign,
    explanation: buildExplanation(
      campaign.assetCount,
      { social, app, domain, website },
      sharedDomains,
      sharedUrls,
      hasVisual,
      withIdentity >= 2,
      brandName,
      confidenceScore,
      confidenceLevel,
    ),
  };
};

/**
 * Campaign analysis over candidate rows: builds Task 14 fingerprints once,
 * runs Task 14's `correlateFingerprints` for the cluster, then interprets the
 * result. No detection logic (name/text/logo/social/app/evidence/risk) is
 * re-run or duplicated — evidence inside each fingerprint is the Task 11 output.
 */
export const computeCampaignAnalysis = async (
  subject: CandidateAsset,
  brand: Brand,
  assets: OfficialAsset[],
  candidates: CandidateAsset[],
): Promise<CampaignResult> => {
  const universe = candidates.some((entry) => entry.id === subject.id)
    ? candidates
    : [subject, ...candidates];

  const fingerprintList: CorrelationFingerprint[] = [];
  const infos: CampaignCandidateInfo[] = [];
  for (const candidate of universe) {
    fingerprintList.push(
      await buildCorrelationFingerprint(candidate, brand, assets),
    );
    infos.push({
      id: candidate.id,
      type: candidate.type,
      createdAt: candidate.createdAt ?? null,
    });
  }

  const fingerprintById = new Map(
    fingerprintList.map((entry) => [entry.candidateId, entry]),
  );
  const subjectFingerprint = fingerprintById.get(subject.id);
  if (!subjectFingerprint) {
    return noCampaign(subject.id);
  }
  const others = fingerprintList.filter(
    (entry) => entry.candidateId !== subject.id,
  );
  const { cluster } = correlateFingerprints(
    subjectFingerprint,
    others,
    brand.name,
  );

  return buildCampaignResult(
    { candidateId: subject.id, cluster },
    infos,
    fingerprintList,
    brand.name,
  );
};

export const analyzeCandidateCampaign = async (
  candidateId: string,
): Promise<CampaignOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  const normalizedType = candidate.type.trim().toUpperCase();
  if (normalizedType !== "SOCIAL" && normalizedType !== "APP") {
    return { ok: false, code: "CAMPAIGN_NOT_APPLICABLE" };
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
    data: await computeCampaignAnalysis(candidate, brand, assets, candidates),
  };
};
