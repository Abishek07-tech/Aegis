const path = require("path");
const fs = require("fs");

const servicePath = path.join(__dirname, "..", "dist", "services", "ai-analysis.service.js");
if (!fs.existsSync(servicePath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const {
  runAIAnalysis,
  getAIAnalysis,
  extractAnalysisFromInvestigation,
  sanitizeSummary,
  clampRiskScore,
  clampConfidence,
} = require(servicePath);

let passed = 0;
let failed = 0;
const failures = [];

const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
};

const checkTrue = (label, cond) => {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`${label}: condition false`);
  }
};

checkTrue("clampRiskScore: null for non-number", clampRiskScore("bad") === null);
checkTrue("clampRiskScore: null for NaN", clampRiskScore(NaN) === null);
checkTrue("clampRiskScore: null for Infinity", clampRiskScore(Infinity) === null);
check("clampRiskScore: clamps high", clampRiskScore(150), 100);
check("clampRiskScore: clamps low", clampRiskScore(-10), 0);
check("clampRiskScore: rounds", clampRiskScore(42.6), 43);
check("clampRiskScore: zero", clampRiskScore(0), 0);
check("clampRiskScore: hundred", clampRiskScore(100), 100);

checkTrue("clampConfidence: null for non-number", clampConfidence(null) === null);
checkTrue("clampConfidence: null for undefined", clampConfidence(undefined) === null);
check("clampConfidence: clamps high", clampConfidence(1.5), 1);
check("clampConfidence: clamps low", clampConfidence(-0.5), 0);
check("clampConfidence: zero", clampConfidence(0), 0);
check("clampConfidence: one", clampConfidence(1), 1);
check("clampConfidence: mid", clampConfidence(0.75), 0.75);

checkTrue("sanitizeSummary: null for non-string", sanitizeSummary(42) === null);
checkTrue("sanitizeSummary: null for empty string", sanitizeSummary("") === null);
checkTrue("sanitizeSummary: null for whitespace", sanitizeSummary("   ") === null);
checkTrue("sanitizeSummary: null for too long", sanitizeSummary("x".repeat(2001)) === null);
check("sanitizeSummary: trims whitespace", sanitizeSummary("  hello  "), "hello");
check("sanitizeSummary: preserves internal spaces", sanitizeSummary("hello world"), "hello world");

const baseInvestigation = {
  threatIntent: "BRAND_IMPERSONATION",
  strongestEvidence: [
    { strength: "HIGH", signal: "NAME_SIMILARITY", source: "NAME", explanation: "test" },
    { strength: "MEDIUM", signal: "LOGO_SIMILARITY", source: "LOGO", explanation: "test" },
  ],
  confidence: 65,
  assessment: "The candidate shows strong brand impersonation indicators.",
  source: "AI",
};

const extracted = extractAnalysisFromInvestigation(baseInvestigation);
check("extractAnalysis: threatIntent preserved", extracted.threatIntent, "BRAND_IMPERSONATION");
check("extractAnalysis: riskScore computed", extracted.riskScore, 55);
check("extractAnalysis: confidence normalized", extracted.confidence, 0.65);
check("extractAnalysis: summary preserved", extracted.summary, "The candidate shows strong brand impersonation indicators.");
check("extractAnalysis: source preserved", extracted.source, "AI");

const unknownIntent = extractAnalysisFromInvestigation({
  ...baseInvestigation,
  threatIntent: "INVALID_INTENT",
});
check("extractAnalysis: invalid intent mapped to UNKNOWN", unknownIntent.threatIntent, "UNKNOWN");

const noEvidence = extractAnalysisFromInvestigation({
  ...baseInvestigation,
  strongestEvidence: [],
});
check("extractAnalysis: no evidence gives null riskScore", noEvidence.riskScore, null);

const noSummary = extractAnalysisFromInvestigation({
  ...baseInvestigation,
  assessment: "",
});
check("extractAnalysis: empty assessment gives null summary", noSummary.summary, null);

const mockProvider = {
  name: "mock",
  complete: async (request) => {
    checkTrue("mock provider receives system prompt", request.system.length > 0);
    checkTrue("mock provider receives user prompt", request.user.length > 0);
    return JSON.stringify({
      headline: "Test headline",
      assessment: "The candidate value is consistent with brand impersonation indicators.",
      threatIntent: "BRAND_IMPERSONATION",
      secondaryIntents: ["PHISHING_LURE"],
      keyFindings: [
        { finding: "Name similarity detected", evidence: "The name closely matches the brand.", importance: "HIGH" },
      ],
      uncertainties: [
        { issue: "Limited evidence", reason: "Only one evidence source available." },
      ],
      recommendedActions: [
        { priority: "HIGH", action: "Review this candidate", reason: "High risk score." },
      ],
      attackPath: [
        { step: "Impersonated brand identity", evidence: "The name impersonates the brand." },
      ],
    });
  },
};

const mockProviderReturningMalformed = {
  name: "mock-malformed",
  complete: async () => "not valid json at all {{{",
};

const mockProviderReturningEmpty = {
  name: "mock-empty",
  complete: async () => "",
};

const mockProviderReturningNull = {
  name: "mock-null",
  complete: async () => null,
};

const mockProviderThrowing = {
  name: "mock-throwing",
  complete: async () => { throw new Error("provider unavailable"); },
};

const mockProviderTimeout = {
  name: "mock-timeout",
  complete: async (_req, _signal) => {
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 5000);
      _signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  },
};

const mockProviderInvalidIntent = {
  name: "mock-invalid-intent",
  complete: async () => JSON.stringify({
    threatIntent: "COMPLETELY_INVALID_INTENT",
  }),
};

const mockProviderForbiddenLanguage = {
  name: "mock-forbidden",
  complete: async () => JSON.stringify({
    assessment: "This is definitely a fake account and certainly malicious.",
  }),
};

const mockProviderInventedDomain = {
  name: "mock-invented-domain",
  complete: async () => JSON.stringify({
    assessment: "The domain evil-invented.com is impersonating the brand.",
  }),
};

const candidateId = "test-candidate-id";

(async () => {
  console.log("AI analysis validation tests complete.");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
})();
