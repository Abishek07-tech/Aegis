import { env } from "../config/env";
import { prisma } from "../config/database";
import { getBrandById } from "./brand.service";
import { createCandidate } from "./candidate.service";
import dns from "node:dns/promises";
import net from "node:net";

type SearchResult = { title?: unknown; url?: unknown; content?: unknown; engine?: unknown };
type ProviderPayload = { results?: SearchResult[] };

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 ||
    parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) || parts[0] === 198 && parts[1] === 51 && parts[2] === 100 ||
    parts[0] === 203 && parts[1] === 0 && parts[2] === 113;
};

const isPrivateAddress = (host: string): boolean => {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(normalized)) return isPrivateIpv4(normalized);
  if (!net.isIPv6(normalized)) return false;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:192.168.") || normalized.startsWith("::ffff:172.16.");
};

export const validateProviderUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !env.isProduction)) {
    throw new Error("Search provider must use HTTPS in production");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateAddress(hostname) ||
      hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    throw new Error("Search provider must not resolve to a private or local address");
  }
  url.hash = "";
  return url;
};

const validateProviderNetwork = async (url: URL): Promise<void> => {
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    const host = address.address.toLowerCase();
    if (isPrivateAddress(host)) {
      throw new Error("Search provider resolved to a private or local address");
    }
  }
};

const timeoutFor = () => {
  const value = Number(env.AEGIS_SEARCH_TIMEOUT_MS ?? 8000);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 30000) : 8000;
};
const minInterval = () => {
  const value = Number(env.AEGIS_SEARCH_MIN_INTERVAL_MS ?? 500);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 10000) : 500;
};
let lastRequestAt = 0;

export const parseProviderPayload = (payload: unknown): SearchResult[] => {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as ProviderPayload).results)) {
    throw new Error("Search provider returned an invalid result shape");
  }
  return (payload as ProviderPayload).results!;
};

export const fetchSearchResults = async (
  configured: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
  networkValidator: (url: URL) => Promise<void> = validateProviderNetwork,
): Promise<SearchResult[]> => {
  const url = validateProviderUrl(configured);
  await networkValidator(url);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor());
  try {
      let current = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await fetchImpl(current, { redirect: "manual", headers: { Accept: "application/json" }, signal: controller.signal });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirects === 3) throw new Error("Search provider returned an unsafe or excessive redirect");
          current = validateProviderUrl(new URL(location, current).toString());
          await networkValidator(current);
          continue;
        }
        if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}`);
        return parseProviderPayload(await response.json());
      }
      throw new Error("Search provider redirect validation failed");
  } finally {
    clearTimeout(timer);
  }
};

const search = async (query: string): Promise<SearchResult[]> => {
  const configured = env.AEGIS_SEARCH_URL?.trim();
  if (!configured) throw new Error("No search provider configured (set AEGIS_SEARCH_URL)");
  const wait = minInterval() - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  return fetchSearchResults(configured, query);
};

export const normalizedUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
};

export const normalizeSearchResult = (result: SearchResult) => {
  const sourceUrl = normalizedUrl(result.url);
  if (!sourceUrl) return null;
  return {
    sourceUrl,
    name: typeof result.title === "string" ? result.title.trim().slice(0, 240) || undefined : undefined,
    description: typeof result.content === "string" ? result.content.trim().slice(0, 1000) || undefined : undefined,
  };
};

export const runCollection = async (jobId: string, brandId?: string): Promise<void> => {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (!env.AEGIS_SEARCH_URL?.trim()) {
    await prisma.scanJob.update({ where: { id: jobId }, data: { status: "UNAVAILABLE", errorMessage: "No search provider configured", completedAt: new Date(), progress: 100 } });
    return;
  }
  const brands = brandId ? [await getBrandById(brandId)] : await prisma.brand.findMany({ orderBy: { createdAt: "asc" }, take: 20 });
  const usable = brands.filter((brand): brand is NonNullable<typeof brand> => Boolean(brand));
  if (!usable.length) {
    await prisma.scanJob.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date(), progress: 100 } });
    return;
  }
  let findings = 0; let errors = 0; let analyzed = 0;
  for (const brand of usable) {
    try {
      const results = await search(`"${brand.name}" impersonation`);
      for (const result of results.slice(0, 25)) {
        const normalized = normalizeSearchResult(result);
        if (!normalized) continue;
        const { sourceUrl } = normalized;
        const exists = await prisma.candidateAsset.findFirst({ where: { brandId: brand.id, sourceUrl } });
        if (exists) continue;
        try {
          await createCandidate({
            type: "WEBSITE",
            value: sourceUrl,
            name: normalized.name,
            description: normalized.description,
            brandId: brand.id, sourceUrl, collectedAt: new Date(),
          });
          findings++;
        } catch (error) {
          if (!(error instanceof Error && error.message.includes("Unique constraint"))) throw error;
        }
      }
      analyzed++;
    } catch { errors++; }
    await prisma.scanJob.update({ where: { id: jobId }, data: { progress: Math.round((analyzed / usable.length) * 100), assetsAnalyzed: analyzed, findings, errors } });
  }
  await prisma.scanJob.update({ where: { id: jobId }, data: { status: errors ? (analyzed ? "PARTIAL" : "FAILED") : "COMPLETED", completedAt: new Date(), progress: 100, assetsAnalyzed: analyzed, findings, errors, errorMessage: errors ? "One or more provider requests failed" : null } });
};
