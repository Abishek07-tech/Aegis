const path = require("path");
const fs = require("fs");

const riskPath = path.join(__dirname, "..", "dist", "services", "risk-engine.service.js");
const evidencePath = path.join(__dirname, "..", "dist", "services", "evidence.service.js");
const explanationPath = path.join(__dirname, "..", "dist", "services", "explanation.service.js");
if (!fs.existsSync(riskPath) || !fs.existsSync(evidencePath) || !fs.existsSync(explanationPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const { buildRiskResult } = require(riskPath);
const { buildEvidenceResult, collectEvidence } = require(evidencePath);
const { buildExplanation } = require(explanationPath);

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

/* ---- fixtures ---- */
const item = (over) => ({
  source: "NAME",
  signal: "NAME_SIMILARITY",
  severity: "LOW",
  score: 0.5,
  reason: "r",
  ...over,
});

const explain = (type, items, unavailable = []) =>
  buildExplanation(buildRiskResult(buildEvidenceResult("c", type, items, unavailable)));

const brand = { name: "PaySecure", website: "https://paysecure.com" };
const assets = [
  { id: "a1", brandId: "b1", type: "SOCIAL", value: "@PaySecure", createdAt: new Date() },
  { id: "a2", brandId: "b1", type: "APP", value: "com.paysecure.wallet", createdAt: new Date() },
  { id: "a3", brandId: "b1", type: "DOMAIN", value: "paysecure.com", createdAt: new Date() },
  { id: "a4", brandId: "b1", type: "WEBSITE", value: "https://paysecure.com", createdAt: new Date() },
];

const evidenceFor = async (candidate, type) => {
  const r = await collectEvidence(candidate, brand, assets, type);
  return buildEvidenceResult(candidate.id, type, r.items, r.unavailable);
};

const fakeSocialCandidate = {
  id: "f1",
  type: "SOCIAL",
  value: "@PaySecure_Support",
  name: "PaySecure Support",
  description:
    "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
};
const harmlessCandidate = {
  id: "f2",
  type: "SOCIAL",
  value: "@travel_photos",
  name: "Student Travel Photography",
  description: "Photography community for students.",
};
const officialSocialCandidate = {
  id: "f3",
  type: "SOCIAL",
  value: "@PaySecure",
  name: "PaySecure",
  description: "Official PaySecure account. Customer support: https://paysecure.com",
};
const officialAppCandidate = {
  id: "f4",
  type: "APP",
  value: "com.paysecure.wallet",
  name: "PaySecure Official",
  description: "The official PaySecure wallet.",
};

const RESULT_KEYS = [
  "candidateId",
  "confidence",
  "evidenceCount",
  "independentSourceCount",
  "protectiveSignals",
  "riskLevel",
  "riskScore",
  "summary",
  "type",
  "whyFlagged",
  "whyNotFlagged",
];

const run = async () => {
  const fakeEvidence = await evidenceFor(fakeSocialCandidate, "SOCIAL");
  const fakeRisk = buildRiskResult(fakeEvidence);
  const fake = buildExplanation(fakeRisk);

  const harmlessEvidence = await evidenceFor(harmlessCandidate, "SOCIAL");
  const harmless = buildExplanation(buildRiskResult(harmlessEvidence));

  const officialEvidence = await evidenceFor(officialSocialCandidate, "SOCIAL");
  const officialRisk = buildRiskResult(officialEvidence);
  const official = buildExplanation(officialRisk);

  const officialAppEvidence = await evidenceFor(officialAppCandidate, "APP");
  const officialApp = buildExplanation(buildRiskResult(officialAppEvidence));

  /* ---- Test 1: high-risk candidate → meaningful WHY FLAGGED ---- */
  check("T1 whyFlagged count", fake.whyFlagged.length, 7);
  checkTrue(
    "T1 every entry has category/signal/source/impact/explanation",
    fake.whyFlagged.every(
      (w) =>
        ["IDENTITY", "CONTENT", "VISUAL", "SOCIAL", "DOMAIN"].includes(w.category) &&
        typeof w.signal === "string" &&
        ["NAME", "TEXT", "LOGO", "SOCIAL", "APP"].includes(w.source) &&
        Number.isInteger(w.impact) &&
        w.impact > 0 &&
        typeof w.explanation === "string" &&
        w.explanation.length > 20,
    ),
  );
  checkTrue(
    "T1 explanations are human-readable with score context",
    fake.whyFlagged.every((w) => w.explanation.includes("100/100 CRITICAL")),
  );
  checkTrue(
    "T1 explanations embed evidence text",
    fake.whyFlagged.every((w) => w.explanation.includes("Evidence: ")),
  );
  checkTrue(
    "T1 summary describes strong evidence",
    /^Strong evidence: /.test(fake.summary) && fake.summary.includes("4 independent evidence categories"),
  );
  checkTrue(
    "T1 protective signals empty for fake",
    JSON.stringify(fake.protectiveSignals) === "[]",
  );
  check("T1 top-level keys", Object.keys(fake).sort(), RESULT_KEYS);

  /* ---- Test 2: low-risk candidate → WHY NOT FLAGGED ---- */
  check("T2 whyFlagged empty", harmless.whyFlagged, []);
  const insufficient = harmless.whyNotFlagged.find(
    (w) => w.signal === "INSUFFICIENT_EVIDENCE",
  );
  checkTrue("T2 insufficient entry present", Boolean(insufficient));
  check("T2 protection label", insufficient.protection, "Weak or insufficient evidence");
  checkTrue(
    "T2 explanation says insufficient + lists unavailable",
    /insufficient evidence to flag/.test(insufficient.explanation) &&
      insufficient.explanation.includes("unavailable: LOGO, APP"),
  );
  check("T2 summary", harmless.summary, "Insufficient evidence: no comparative evidence could be collected — risk 0/100 LOW.");
  check("T2 counts", [harmless.evidenceCount, harmless.independentSourceCount], [0, 0]);

  /* ---- Test 3: exact official identity → protective explanation ---- */
  checkTrue(
    "T3 OFFICIAL_ACCOUNT_MATCH surfaced",
    official.protectiveSignals.includes("OFFICIAL_ACCOUNT_MATCH"),
  );
  const identityEntry = official.whyNotFlagged.find(
    (w) => w.signal === "OFFICIAL_ACCOUNT_MATCH",
  );
  check("T3 protection label", identityEntry.protection, "Exact official identity match");
  checkTrue(
    "T3 explains official-asset reduction + cap rule",
    identityEntry.explanation.includes("matches a registered official asset") &&
      identityEntry.explanation.includes("bounded to at most 24/100"),
  );
  checkTrue(
    "T3 summary prevents-inappropriate-escalation wording",
    official.summary.startsWith("Official/protective evidence prevents inappropriate escalation"),
  );
  checkTrue(
    "T3 no NAME/TEXT self-similarity in whyFlagged",
    !official.whyFlagged.some((w) => w.source === "NAME" || w.source === "TEXT"),
  );
  const conflicting = official.whyNotFlagged.find(
    (w) => w.signal === "CONFLICTING_EVIDENCE",
  );
  checkTrue("T3 conflicting assessment present", Boolean(conflicting));
  checkTrue(
    "T3 conflicting explains mixed evidence + both effects",
    conflicting.explanation.includes("the evidence is mixed") &&
      conflicting.explanation.includes("OFFICIAL_ACCOUNT_MATCH") &&
      conflicting.explanation.includes("official domain evidence reduces the total by 25%"),
  );

  /* ---- Test 4: official domain → protective explanation ---- */
  checkTrue(
    "T4 OFFICIAL_DOMAIN_MATCH surfaced",
    official.protectiveSignals.includes("OFFICIAL_DOMAIN_MATCH"),
  );
  const domainEntry = official.whyNotFlagged.find(
    (w) => w.signal === "OFFICIAL_DOMAIN_MATCH",
  );
  check("T4 protection label", domainEntry.protection, "Official domain match");
  checkTrue(
    "T4 explains 25% reduction with factor",
    domainEntry.explanation.includes("reduced the total risk by 25% (×0.75)") &&
      domainEntry.explanation.includes(`score stands at ${official.riskScore}/100`),
  );
  check("T4 category", domainEntry.category, "DOMAIN");

  /* ---- Test 5: official app → protective explanation ---- */
  check("T5 protectiveSignals", officialApp.protectiveSignals, ["OFFICIAL_APP_MATCH"]);
  const appEntry = officialApp.whyNotFlagged.find(
    (w) => w.signal === "OFFICIAL_APP_MATCH",
  );
  check("T5 protection label", appEntry.protection, "Exact official app match");
  check("T5 source", appEntry.source, "APP");
  checkTrue(
    "T5 explains official app match + cap",
    appEntry.explanation.includes("treated as the official app") &&
      appEntry.explanation.includes("bounded to at most 24/100") &&
      appEntry.explanation.includes(`is ${officialApp.riskScore}/100`),
  );
  check(
    "T5 summary",
    officialApp.summary,
    "Official/protective evidence prevents inappropriate escalation: OFFICIAL_APP_MATCH present — risk 0/100 LOW (confidence 0.43).",
  );

  /* ---- Test 6: weak evidence → insufficient wording ---- */
  const weak = explain("SOCIAL", [item({ severity: "LOW", score: 0.5, reason: "weak signal" })]);
  check("T6 weak riskLevel", weak.riskLevel, "LOW");
  checkTrue(
    "T6 limited-support assessment present",
    weak.whyNotFlagged.some((w) => w.signal === "LIMITED_SUPPORT"),
  );
  checkTrue(
    "T6 weak explanation says insufficient",
    weak.whyNotFlagged.some((w) => /insufficient to support a stronger flag/.test(w.explanation)),
  );
  checkTrue(
    "T6 weak summary starts 'Weak evidence'",
    weak.summary.startsWith("Weak evidence: 1 risk signal across a single evidence category"),
  );
  checkTrue(
    "T6 confidence below 0.5 cited",
    weak.whyNotFlagged.some((w) => w.explanation.includes(`(${weak.confidence}/1)`)),
  );

  /* ---- Test 7: multiple reasons sorted correctly ---- */
  checkTrue(
    "T7 impacts non-increasing",
    fake.whyFlagged.every((w, i, arr) => i === 0 || arr[i - 1].impact >= w.impact),
  );
  check("T7 strongest first", fake.whyFlagged[0].signal, "TEXT_IDENTITY_MATCH");
  check(
    "T7 impacts sum to riskScore",
    fake.whyFlagged.reduce((s, w) => s + w.impact, 0),
    fake.riskScore,
  );
  const equal = explain("SOCIAL", [
    item({ severity: "HIGH", score: 1, signal: "EXTERNAL_DOMAIN", source: "SOCIAL", reason: "d" }),
    item({ severity: "HIGH", score: 1, signal: "LOGO_SIMILARITY", source: "LOGO", reason: "l" }),
    item({ severity: "HIGH", score: 1, signal: "TEXT_IDENTITY_MATCH", source: "TEXT", reason: "t" }),
  ]);
  check(
    "T7 equal-impact alphabetical tie-break preserved",
    equal.whyFlagged.map((w) => w.signal),
    ["LOGO_SIMILARITY", "TEXT_IDENTITY_MATCH", "EXTERNAL_DOMAIN"].sort((a, b) => a.localeCompare(b)),
  );

  /* ---- Test 8: no duplicate explanations ---- */
  const flagTexts = fake.whyFlagged.map((w) => w.explanation);
  const notFlagTexts = official.whyNotFlagged.map((w) => w.explanation);
  checkTrue("T8 whyFlagged unique", new Set(flagTexts).size === flagTexts.length);
  checkTrue(
    "T8 whyNotFlagged unique",
    new Set(notFlagTexts).size === notFlagTexts.length,
  );
  checkTrue(
    "T8 combined unique",
    new Set([...flagTexts, ...notFlagTexts]).size === flagTexts.length + notFlagTexts.length,
  );

  /* ---- Test 9: no fabricated evidence ---- */
  checkTrue(
    "T9 every whyFlagged explanation backed by evidence item",
    fake.whyFlagged.every((w) =>
      fakeEvidence.evidence.some(
        (e) => e.signal === w.signal && w.explanation.endsWith(`Evidence: ${e.reason}`),
      ),
    ),
  );
  checkTrue(
    "T9 evidence-based whyNotFlagged entries embed real reason",
    official.whyNotFlagged
      .filter((w) => w.source !== "NONE")
      .every((w) =>
        officialEvidence.evidence.some(
          (e) => e.signal === w.signal && w.explanation.startsWith(e.reason),
        ),
      ),
  );
  checkTrue(
    "T9 assessment entries never claim Evidence",
    official.whyNotFlagged
      .filter((w) => w.source === "NONE")
      .every((w) => !w.explanation.includes("Evidence: ")),
  );
  checkTrue(
    "T9 no fake/scam/malicious verdicts anywhere",
    !/"(fake|scam|malicious)":|(fake|scam|malicious) candidate/i.test(JSON.stringify(fake)) &&
      !/\b(fake|scam|malicious)\b/i.test(fake.summary + official.summary + harmless.summary),
  );

  /* ---- Test 10: deterministic output ---- */
  const fake2 = buildExplanation(buildRiskResult(await evidenceFor(fakeSocialCandidate, "SOCIAL")));
  check("T10 deterministic rebuild", JSON.stringify(fake2), JSON.stringify(fake));
  check("T10 deterministic from same risk", JSON.stringify(buildExplanation(fakeRisk)), JSON.stringify(fake));

  /* ---- Test 11: no divergence from Task 12 ---- */
  check(
    "T11 riskScore/riskLevel/confidence copied from Task 12",
    [fake.riskScore, fake.riskLevel, fake.confidence],
    [fakeRisk.riskScore, fakeRisk.riskLevel, fakeRisk.confidence],
  );
  check(
    "T11 counts copied from Task 12",
    [fake.evidenceCount, fake.independentSourceCount],
    [fakeRisk.evidenceCount, fakeRisk.independentSourceCount],
  );
  check("T11 pinned fake values", [fake.riskScore, fake.riskLevel, fake.confidence], [100, "CRITICAL", 0.95]);
  check(
    "T11 official values match Task 12",
    [official.riskScore, official.riskLevel, official.confidence],
    [officialRisk.riskScore, officialRisk.riskLevel, officialRisk.confidence],
  );

  /* ---- report ---- */
  console.log(`\nTask 13 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 13 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
