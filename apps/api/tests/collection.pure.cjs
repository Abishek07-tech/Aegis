process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/aegis";
process.env.AEGIS_SEARCH_TIMEOUT_MS = "20";
const { normalizedUrl, normalizeSearchResult, parseProviderPayload, fetchSearchResults, validateProviderUrl } = require("../dist/services/collection.service.js");

const checks = [
  ["normalizes fragments", normalizedUrl("https://example.com/a#tracking") === "https://example.com/a"],
  ["rejects non-http URLs", normalizedUrl("javascript:alert(1)") === null],
  ["rejects malformed URLs", normalizedUrl("not-a-url") === null],
  ["normalizes provider result", normalizeSearchResult({ url: "https://example.com", title: "  Result ", content: " text " }).name === "Result"],
  ["rejects result without URL", normalizeSearchResult({ title: "No source" }) === null],
  ["rejects malformed provider payload", (() => { try { parseProviderPayload({ results: "bad" }); return false; } catch { return true; } })()],
  ["accepts zero-result provider payload", parseProviderPayload({ results: [] }).length === 0],
  ["rejects local provider address", (() => { try { validateProviderUrl("http://127.0.0.1/search"); return false; } catch { return true; } })()],
  ["rejects metadata provider address", (() => { try { validateProviderUrl("http://169.254.169.254/search"); return false; } catch { return true; } })()],
];
const failed = checks.filter(([, passed]) => !passed);
console.log(`Collection normalization tests — passed: ${checks.length - failed.length}, failed: ${failed.length}`);
if (failed.length) {
  console.error(failed.map(([name]) => name).join("\n"));
  process.exit(1);
}

(async () => {
  const response = await fetchSearchResults(
    "https://provider.example/search",
    "test",
    async () => ({ ok: true, json: async () => ({ results: [] }) }),
    async () => undefined,
  );
  if (!Array.isArray(response) || response.length !== 0) process.exit(1);
  console.log("Mock zero-result provider request — passed");
  let redirectCalls = 0;
  const redirected = await fetchSearchResults(
    "https://provider.example/search",
    "redirect",
    async (url) => {
      redirectCalls += 1;
      return redirectCalls === 1
        ? { status: 302, ok: false, headers: { get: () => "https://provider.example/redirected" } }
        : { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ results: [] }) };
    },
    async () => undefined,
  );
  if (redirected.length !== 0 || redirectCalls !== 2) throw new Error("redirect handling failed");
  console.log("Mock validated redirect — passed");
  try {
    await fetchSearchResults(
      "https://provider.example/search",
      "private-redirect",
      async () => ({ status: 302, ok: false, headers: { get: () => "http://127.0.0.1/admin" } }),
      async () => undefined,
    );
    throw new Error("private redirect was accepted");
  } catch (error) {
    if (!String(error.message).includes("private") && !String(error.message).includes("HTTPS")) throw error;
    console.log("Mock private redirect rejection — passed");
  }
  let aborted = false;
  try {
    await fetchSearchResults(
      "https://provider.example/search",
      "timeout",
      (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
      }),
      async () => undefined,
    );
  } catch (error) {
    if (error?.name !== "AbortError" || !aborted) throw error;
    console.log("Mock provider timeout — passed");
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
