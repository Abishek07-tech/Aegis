/* Social Risk Signals (Task 9) — pure helper tests. No database required.
   Run: npm run build && npm test */
const path = require("path");
const fs = require("fs");

const svcPath = path.join(__dirname, "..", "dist", "services", "social-risk.service.js");
if (!fs.existsSync(svcPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  normalizeDomain,
  extractDomains,
  isDomainLike,
  collectOfficialDomains,
  matchesOfficialDomain,
  detectSupportLanguage,
  getSupportLanguageSeverity,
  isOfficialSocialIdentity,
  containmentScore,
  findBestOfficialSocialMatch,
  buildSocialSignals,
  buildSocialRiskResult,
} = require(svcPath);

let passed = 0;
let failed = 0;
const failures = [];

const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
};

const approx = (label, actual, expected) => {
  if (actual === expected) passed++;
  else {
    failed++;
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
};

/* ---------- domain normalization ---------- */
check("normalize https", normalizeDomain("https://paysecure.com"), "paysecure.com");
check("normalize http+path", normalizeDomain("http://paysecure.com/login"), "paysecure.com");
check("normalize www", normalizeDomain("www.paysecure.com"), "paysecure.com");
check("normalize upper+query", normalizeDomain("HTTPS://PaySecure.COM/a?b=1#c"), "paysecure.com");
check("normalize trailing dot", normalizeDomain("paysecure.com."), "paysecure.com");
check("normalize port", normalizeDomain("paysecure.com:8080"), "paysecure.com");
check("normalize empty", normalizeDomain("   "), "");
check("isDomainLike ok", isDomainLike("paysecure.com"), true);
check("isDomainLike handle", isDomainLike("paysecure"), false);
check("isDomainLike empty", isDomainLike(""), false);

/* ---------- domain extraction ---------- */
check(
  "extract from URL sentence",
  extractDomains("Visit https://paysecure.com for account information."),
  ["paysecure.com"],
);
check(
  "extract mixed + dedupe",
  extractDomains("See www.foo.com, http://bar.org/x and foo.com again"),
  ["foo.com", "bar.org"],
);
check("extract none", extractDomains("no links here at all"), []);
check("extract from email", extractDomains("write to user@paysecure.com"), ["paysecure.com"]);
check(
  "extract hyphenated domain in URL",
  extractDomains("Verify at https://paysecure-help.com/x"),
  ["paysecure-help.com"],
);

/* ---------- official domain comparison ---------- */
const officialDomains = collectOfficialDomains(
  { website: "https://paysecure.com" },
  [
    { type: "DOMAIN", value: "paysecure.com" },
    { type: "WEBSITE", value: "https://paysecure.com" },
    { type: "SOCIAL", value: "@PaySecure" },
  ],
);
check("official domains collected", officialDomains, ["paysecure.com"]);
check("exact official match", matchesOfficialDomain("paysecure.com", officialDomains), true);
check("subdomain official match", matchesOfficialDomain("login.paysecure.com", officialDomains), true);
check("external not official", matchesOfficialDomain("paysecure-help.com", officialDomains), false);
check(
  "official domain from assets only (no website)",
  collectOfficialDomains({ website: null }, [{ type: "DOMAIN", value: "paysecure.com" }]),
  ["paysecure.com"],
);

/* ---------- support language ---------- */
const s1 = detectSupportLanguage("Customer support and help community.");
check("support keywords (test 5)", s1.keywords, ["customer support", "help"]);
approx("support score (test 5)", s1.score, 0.6);
check("support severity (test 5)", getSupportLanguageSeverity(s1.score), "MEDIUM");

const s2 = detectSupportLanguage(
  "PaySecure Support Official PaySecure customer support. Verify your account at https://paysecure-help.com @PaySecure_Support",
);
check(
  "support keywords (test 1)",
  s2.keywords,
  ["customer support", "help"],
);
approx("support score (test 1)", s2.score, 0.6);

check("support none (test 3)", detectSupportLanguage("Photography community for students.").keywords, []);
check("support none (test 4)", detectSupportLanguage("Visit https://paysecure.com for account information.").keywords, []);
check("helpdesk not a keyword", detectSupportLanguage("Join our helpdesk today").keywords, []);
check("disclaimer not a keyword", detectSupportLanguage("Read the disclaimer").keywords, []);
check(
  "single keyword scores base",
  detectSupportLanguage("urgent matters only").score,
  0.5,
);
check(
  "five keywords cap high",
  detectSupportLanguage("customer support help refund urgent complaint").keywords.length >= 5,
  true,
);
check(
  "five keywords severity HIGH",
  getSupportLanguageSeverity(detectSupportLanguage("customer support help refund urgent complaint").score),
  "HIGH",
);
check("severity LOW at 0.5", getSupportLanguageSeverity(0.5), "LOW");
check("severity MEDIUM at 0.6", getSupportLanguageSeverity(0.6), "MEDIUM");
check("severity HIGH at 0.85", getSupportLanguageSeverity(0.85), "HIGH");

/* ---------- official social identity matching ---------- */
check("exact official", isOfficialSocialIdentity("@PaySecure", ["@PaySecure"]), true);
check("normalized official (case)", isOfficialSocialIdentity("PaySecure", ["@PaySecure"]), true);
check("normalized official (underscore)", isOfficialSocialIdentity("@Pay_Secure", ["PaySecure"]), true);
check("not official", isOfficialSocialIdentity("@PaySecure_Support", ["@PaySecure"]), false);
check("no official assets", isOfficialSocialIdentity("@PaySecure", []), false);
check("empty candidate value", isOfficialSocialIdentity("", ["@PaySecure"]), false);

/* ---------- containment ---------- */
approx("containment suffix", containmentScore("@PaySecure_Support", "@PaySecure"), 0.56);
check("containment unrelated", containmentScore("@travel_photos", "@PaySecure"), null);
check("containment equal -> null", containmentScore("@PaySecure", "@PaySecure"), null);
check("containment too short", containmentScore("@ab", "@abcd"), null);
approx("containment prefix", containmentScore("@PaySecure", "@PaySecureTeam"), 0.69);

/* ---------- best official social match (Task 6 reuse) ---------- */
const best1 = findBestOfficialSocialMatch("@PaySecure_Support", ["@PaySecure"]);
check("best match asset value", best1.officialValue, "@PaySecure");
approx("best match score (test 1)", best1.score, 0.56);
check("best match level (test 1)", best1.level, "LOW");
approx("best match containment (test 1)", best1.containment, 0.56);
const bestNone = findBestOfficialSocialMatch("@travel_photos", ["@PaySecure"]);
check("best match unrelated low score", bestNone.score < 0.5, true);
check("best match unrelated no containment", bestNone.containment, null);
check("best match with no official values", findBestOfficialSocialMatch("@anything", []), null);
const bestExact = findBestOfficialSocialMatch("@PaySecure", ["@PaySecure"]);
approx("best match exact score", bestExact.score, 1);
check("best match exact level", bestExact.level, "HIGH");

/* ---------- signal building: fixtures ---------- */
const brand = { name: "PaySecure", website: "https://paysecure.com" };
const assets = [
  { id: "a1", brandId: "b1", type: "SOCIAL", value: "@PaySecure", createdAt: new Date() },
  { id: "a2", brandId: "b1", type: "DOMAIN", value: "paysecure.com", createdAt: new Date() },
  { id: "a3", brandId: "b1", type: "WEBSITE", value: "https://paysecure.com", createdAt: new Date() },
];

const names = (signals) => signals.map((s) => s.signal);
const get = (signals, name) => signals.find((s) => s.signal === name);

/* Test 1 — obvious impersonation */
const t1 = buildSocialSignals({
  candidate: {
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description:
      "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
  },
  brand,
  assets,
});
check(
  "T1 signals",
  names(t1),
  [
    "NAME_SIMILARITY",
    "BRAND_TEXT_MATCH",
    "SUPPORT_LANGUAGE",
    "EXTERNAL_DOMAIN",
    "OFFICIAL_IDENTITY_CONFLICT",
  ],
);
approx("T1 name score", get(t1, "NAME_SIMILARITY").score, 0.56);
check("T1 name severity", get(t1, "NAME_SIMILARITY").severity, "LOW");
check("T1 name reason", get(t1, "NAME_SIMILARITY").reason, "Candidate handle shows some similarity to an official social identity.");
check("T1 brand text severity", get(t1, "BRAND_TEXT_MATCH").severity, "HIGH");
approx("T1 brand text score", get(t1, "BRAND_TEXT_MATCH").score, 1);
check("T1 support severity", get(t1, "SUPPORT_LANGUAGE").severity, "MEDIUM");
approx("T1 support score", get(t1, "SUPPORT_LANGUAGE").score, 0.6);
check("T1 support reason", get(t1, "SUPPORT_LANGUAGE").reason, "Profile uses customer-support language commonly associated with impersonation accounts.");
check("T1 external severity", get(t1, "EXTERNAL_DOMAIN").severity, "MEDIUM");
approx("T1 external score", get(t1, "EXTERNAL_DOMAIN").score, 0.7);
check(
  "T1 external reason mentions domain",
  get(t1, "EXTERNAL_DOMAIN").reason.includes("paysecure-help.com"),
  true,
);
check("T1 conflict severity", get(t1, "OFFICIAL_IDENTITY_CONFLICT").severity, "HIGH");
approx("T1 conflict score", get(t1, "OFFICIAL_IDENTITY_CONFLICT").score, 0.9);
check(
  "T1 conflict reason",
  get(t1, "OFFICIAL_IDENTITY_CONFLICT").reason,
  "Candidate closely resembles an official social identity but is not the registered official account.",
);
check("T1 no official domain match", get(t1, "OFFICIAL_DOMAIN_MATCH"), undefined);
const t1result = buildSocialRiskResult("c123", t1);
check("T1 result type", t1result.type, "SOCIAL");
check("T1 result candidateId", t1result.candidateId, "c123");
check("T1 signalCount", t1result.signalCount, 5);
check("T1 hasHighSeverity", t1result.hasHighSeverity, true);

/* Test 2 — legitimate official account */
const t2 = buildSocialSignals({
  candidate: {
    value: "@PaySecure",
    name: "PaySecure",
    description: "Official PaySecure account.",
  },
  brand,
  assets,
});
check("T2 no signals", names(t2), []);
const t2result = buildSocialRiskResult("c2", t2);
check("T2 signalCount", t2result.signalCount, 0);
check("T2 hasHighSeverity", t2result.hasHighSeverity, false);

/* Test 2b — official account that uses support language (only benign/support signals) */
const t2b = buildSocialSignals({
  candidate: {
    value: "@PaySecure",
    name: "PaySecure",
    description: "Official customer support for PaySecure.",
  },
  brand,
  assets,
});
check("T2b signals", names(t2b), ["SUPPORT_LANGUAGE"]);

/* Test 3 — harmless unrelated account */
const t3 = buildSocialSignals({
  candidate: {
    value: "@travel_photos",
    name: "Student Travel Photography",
    description: "Photography community for students.",
  },
  brand,
  assets,
});
check("T3 no signals", names(t3), []);

/* Test 4 — legitimate official domain */
const t4 = buildSocialSignals({
  candidate: {
    value: "@PS_AccountInfo",
    name: "PaySecure Info",
    description: "Visit https://paysecure.com for account information.",
  },
  brand,
  assets,
});
check("T4 has no EXTERNAL_DOMAIN", names(t4).includes("EXTERNAL_DOMAIN"), false);
check("T4 has OFFICIAL_DOMAIN_MATCH", names(t4).includes("OFFICIAL_DOMAIN_MATCH"), true);
check("T4 no conflict", names(t4).includes("OFFICIAL_IDENTITY_CONFLICT"), false);
check("T4 official domain severity LOW", get(t4, "OFFICIAL_DOMAIN_MATCH").severity, "LOW");

/* Test 5 — support language alone */
const t5 = buildSocialSignals({
  candidate: {
    value: "@helpcommunity",
    name: "Help Community",
    description: "Customer support and help community.",
  },
  brand,
  assets,
});
check("T5 signals", names(t5), ["SUPPORT_LANGUAGE"]);
check("T5 not high severity", buildSocialRiskResult("c5", t5).hasHighSeverity, false);

/* Test 6 — no brand social assets: no identity signals, no crash */
const t6 = buildSocialSignals({
  candidate: { value: "@someone", name: "Someone", description: "hello world" },
  brand: { name: "PaySecure", website: null },
  assets: [],
});
check("T6 no signals", names(t6), []);

/* FP guards */
const t7 = buildSocialSignals({
  candidate: { value: "@unrelated_handle", name: "Unrelated", description: "Just a normal account." },
  brand,
  assets,
});
check("T7 no signals for harmless account", names(t7), []);

const t8 = buildSocialSignals({
  candidate: { value: "@PaySecure", name: "PaySecure", description: "" },
  brand,
  assets,
});
check("T8 official account never conflicts", names(t8).includes("OFFICIAL_IDENTITY_CONFLICT"), false);

/* HIGH similarity without containment still produces conflict */
const t9 = buildSocialSignals({
  candidate: { value: "@PaySecura", name: "Pay Secura", description: "" },
  brand,
  assets,
});
check("T9 name severity HIGH", get(t9, "NAME_SIMILARITY").severity, "HIGH");
check(
  "T9 high name reason",
  get(t9, "NAME_SIMILARITY").reason,
  "Candidate handle is highly similar to an official social identity.",
);
check("T9 conflict via HIGH similarity", names(t9).includes("OFFICIAL_IDENTITY_CONFLICT"), true);

/* deterministic repeat */
const again = buildSocialSignals({
  candidate: {
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description:
      "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
  },
  brand,
  assets,
});
check("deterministic repeat", JSON.stringify(again), JSON.stringify(t1));

/* ---------- report ---------- */
console.log(`\npassed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
console.log("ALL PURE TESTS PASSED");
