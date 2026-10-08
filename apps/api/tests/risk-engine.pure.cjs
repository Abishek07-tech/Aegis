const path = require("path");
const fs = require("fs");

const riskPath = path.join(__dirname, "..", "dist", "services", "risk-engine.service.js");
const evidencePath = path.join(__dirname, "..", "dist", "services", "evidence.service.js");
if (!fs.existsSync(riskPath) || !fs.existsSync(evidencePath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  buildRiskResult,
  classifyEvidence,
  getRiskLevel,
  isProtectiveSignal,
} = require(riskPath);
const { buildEvidenceResult, collectEvidence } = require(evidencePath);

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

const mk = (type, items, unavailable = []) =>
  buildEvidenceResult("c", type, items, unavailable);

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
const fakeAppCandidate = {
  id: "f5",
  type: "APP",
  value: "com.paysecure.fake.wallet",
  name: "PaySecure",
  description: "Official PaySecure app with support and refund protection.",
};

const run = async () => {
  /* ---- Test 1: empty evidence → LOW / zero ---- */
  const t1 = buildRiskResult(mk("SOCIAL", []));
  check("T1 riskScore", t1.riskScore, 0);
  check("T1 riskLevel", t1.riskLevel, "LOW");
  check("T1 confidence", t1.confidence, 0);
  check("T1 reasons", t1.reasons, []);
  check("T1 evidenceCount", t1.evidenceCount, 0);
  check("T1 independentSourceCount", t1.independentSourceCount, 0);

  /* ---- Test 2: one LOW signal → LOW ---- */
  const t2 = buildRiskResult(mk("SOCIAL", [item({ score: 0.5 })]));
  check("T2 riskScore", t2.riskScore, 5); // 10 × 0.5
  check("T2 riskLevel", t2.riskLevel, "LOW");
  check("T2 confidence", t2.confidence, 0.33);
  check("T2 reasons count", t2.reasons.length, 1);
  check("T2 reason impact", t2.reasons[0].impact, 5);

  /* ---- Test 3: multiple MEDIUM → deterministic increase ---- */
  const med = (signal, source, reason) =>
    item({ severity: "MEDIUM", score: 1, signal, source, reason });
  const m1 = buildRiskResult(mk("SOCIAL", [med("SUPPORT_LANGUAGE", "SOCIAL", "a")]));
  const m2 = buildRiskResult(
    mk("SOCIAL", [
      med("SUPPORT_LANGUAGE", "SOCIAL", "a"),
      med("EXTERNAL_DOMAIN", "SOCIAL", "b"),
    ]),
  );
  const m3 = buildRiskResult(
    mk("SOCIAL", [
      med("SUPPORT_LANGUAGE", "SOCIAL", "a"),
      med("EXTERNAL_DOMAIN", "SOCIAL", "b"),
      med("LOGO_SIMILARITY", "LOGO", "c"),
    ]),
  );
  check("T3 1 MEDIUM score", m1.riskScore, 20);
  check("T3 1 MEDIUM level", m1.riskLevel, "LOW");
  check("T3 2 MEDIUM score", m2.riskScore, 40);
  check("T3 2 MEDIUM level", m2.riskLevel, "MEDIUM");
  check("T3 3 MEDIUM score", m3.riskScore, 60);
  check("T3 3 MEDIUM level", m3.riskLevel, "HIGH");

  /* ---- Test 4: HIGH evidence → appropriate level ---- */
  const t4 = buildRiskResult(
    mk("SOCIAL", [
      item({
        severity: "HIGH",
        score: 1,
        signal: "OFFICIAL_IDENTITY_CONFLICT",
        source: "SOCIAL",
      }),
    ]),
  );
  check("T4 single HIGH score", t4.riskScore, 35); // one signal alone caps at MEDIUM band
  check("T4 single HIGH level", t4.riskLevel, "MEDIUM");

  /* ---- Test 5: multiple independent HIGH → CRITICAL ---- */
  const high = (signal, source, reason) =>
    item({ severity: "HIGH", score: 1, signal, source, reason });
  const twoHigh = buildRiskResult(
    mk("APP", [
      high("APP_NAME_SIMILARITY", "APP", "a"),
      high("TEXT_IDENTITY_MATCH", "TEXT", "b"),
    ]),
  );
  const fourHigh = buildRiskResult(
    mk("APP", [
      high("APP_NAME_SIMILARITY", "APP", "a"),
      high("TEXT_IDENTITY_MATCH", "TEXT", "b"),
      high("LOGO_SIMILARITY", "LOGO", "c"),
      high("SUPPORT_LANGUAGE", "SOCIAL", "d"),
    ]),
  );
  check("T5 2 independent HIGH score", twoHigh.riskScore, 70);
  check("T5 2 independent HIGH level", twoHigh.riskLevel, "HIGH");
  check("T5 4 independent HIGH score", fourHigh.riskScore, 100); // 140 → bounded to 100
  check("T5 4 independent HIGH level", fourHigh.riskLevel, "CRITICAL");

  /* ---- Test 6: score never exceeds 100 ---- */
  const fiveHigh = buildRiskResult(
    mk("APP", [
      high("APP_NAME_SIMILARITY", "APP", "a"),
      high("TEXT_IDENTITY_MATCH", "TEXT", "b"),
      high("LOGO_SIMILARITY", "LOGO", "c"),
      high("SUPPORT_LANGUAGE", "SOCIAL", "d"),
      high("EXTERNAL_DOMAIN", "SOCIAL", "e"),
    ]),
  );
  check("T5/6 5 HIGH bounded", fiveHigh.riskScore, 100);
  checkTrue(
    "T6 all fixture scores within 0..100",
    [t1, t2, m1, m2, m3, t4, twoHigh, fourHigh, fiveHigh].every(
      (r) => r.riskScore >= 0 && r.riskScore <= 100,
    ),
  );

  /* ---- Test 7: score never below 0 ---- */
  const t7 = buildRiskResult(
    mk("SOCIAL", [item({ severity: "HIGH", score: -5 })]),
  );
  check("T7 negative score input → 0", t7.riskScore, 0);
  check("T7 level", t7.riskLevel, "LOW");

  /* ---- Test 8: deterministic ---- */
  const t8a = buildRiskResult(
    mk("SOCIAL", [
      item({ severity: "HIGH", score: 0.9, signal: "OFFICIAL_IDENTITY_CONFLICT", source: "SOCIAL", reason: "x" }),
      med("EXTERNAL_DOMAIN", "SOCIAL", "y"),
      item({ score: 0.63 }),
    ]),
  );
  const t8b = buildRiskResult(
    mk("SOCIAL", [
      item({ severity: "HIGH", score: 0.9, signal: "OFFICIAL_IDENTITY_CONFLICT", source: "SOCIAL", reason: "x" }),
      med("EXTERNAL_DOMAIN", "SOCIAL", "y"),
      item({ score: 0.63 }),
    ]),
  );
  check("T8 deterministic", JSON.stringify(t8a), JSON.stringify(t8b));

  /* ---- Test 9: duplicate/overlapping evidence does not unfairly inflate ---- */
  const t9 = buildRiskResult(
    mk("SOCIAL", [
      high("NAME_SIMILARITY", "NAME", "x"),
      high("NAME_SIMILARITY", "SOCIAL", "y"),
    ]),
  );
  check("T9 overlapping damped score", t9.riskScore, 44); // 35 + 25%×35 = 43.75
  checkTrue("T9 less than naive sum (70)", t9.riskScore < 70);
  check("T9 both reasons kept", t9.reasons.length, 2);
  checkTrue(
    "T9 impacts sum to score",
    t9.reasons.reduce((s, r) => s + r.impact, 0) === t9.riskScore,
  );

  /* ---- Test 10: independent source groups increase confidence ---- */
  const oneGroup = buildRiskResult(
    mk("SOCIAL", [
      high("NAME_SIMILARITY", "NAME", "a"),
      high("APP_NAME_SIMILARITY", "APP", "b"), // same IDENTITY category
    ]),
  );
  const threeGroups = buildRiskResult(
    mk("SOCIAL", [
      high("NAME_SIMILARITY", "NAME", "a"),
      high("LOGO_SIMILARITY", "LOGO", "b"),
      high("EXTERNAL_DOMAIN", "SOCIAL", "c"),
    ]),
  );
  checkTrue(
    "T10 more groups → higher confidence",
    threeGroups.confidence > oneGroup.confidence,
  );
  check("T10 group counts", [oneGroup.independentSourceCount, threeGroups.independentSourceCount], [1, 3]);
  checkTrue("T10 confidence in 0..1", threeGroups.confidence <= 1 && threeGroups.confidence > 0);

  /* ---- Test 11: unavailable evidence does not increase risk ---- */
  const withUnavailable = buildRiskResult(
    mk("SOCIAL", [med("SUPPORT_LANGUAGE", "SOCIAL", "a")], [
      { source: "LOGO", reason: "no logo" },
      { source: "APP", reason: "not applicable" },
    ]),
  );
  const withoutUnavailable = buildRiskResult(
    mk("SOCIAL", [med("SUPPORT_LANGUAGE", "SOCIAL", "a")]),
  );
  check(
    "T11 unavailable does not change score",
    [withUnavailable.riskScore, withUnavailable.confidence],
    [withoutUnavailable.riskScore, withoutUnavailable.confidence],
  );
  const onlyUnavailable = buildRiskResult(
    mk("SOCIAL", [], [{ source: "LOGO", reason: "no logo" }]),
  );
  check("T11 unavailable-only → 0 LOW", [onlyUnavailable.riskScore, onlyUnavailable.riskLevel], [0, "LOW"]);

  /* ---- Test 12: official asset protection (cap rule) ---- */
  const capped = buildRiskResult(
    mk("APP", [
      high("APP_NAME_SIMILARITY", "APP", "a"),
      high("TEXT_IDENTITY_MATCH", "TEXT", "b"),
      item({ severity: "LOW", score: 1, signal: "OFFICIAL_APP_MATCH", source: "APP", reason: "benign" }),
    ]),
  );
  check("T12 official identity cap", capped.riskScore, 24);
  check("T12 capped level", capped.riskLevel, "LOW");
  checkTrue("T12 protective signal adds no reason", !capped.reasons.some((r) => r.signal === "OFFICIAL_APP_MATCH"));
  checkTrue("T12 isProtectiveSignal", isProtectiveSignal("OFFICIAL_APP_MATCH") && isProtectiveSignal("OFFICIAL_ACCOUNT_MATCH") && isProtectiveSignal("OFFICIAL_DOMAIN_MATCH") && !isProtectiveSignal("EXTERNAL_DOMAIN"));

  /* ---- Test 13: external domain + strong identity evidence ---- */
  const t13 = buildRiskResult(
    mk("SOCIAL", [
      high("OFFICIAL_IDENTITY_CONFLICT", "SOCIAL", "a"),
      item({ severity: "MEDIUM", score: 0.7, signal: "EXTERNAL_DOMAIN", source: "SOCIAL", reason: "b" }),
    ]),
  );
  check("T13 combined score", t13.riskScore, 49); // 35 + 14
  check("T13 level", t13.riskLevel, "MEDIUM");
  check("T13 reasons order", t13.reasons.map((r) => [r.signal, r.impact]), [
    ["OFFICIAL_IDENTITY_CONFLICT", 35],
    ["EXTERNAL_DOMAIN", 14],
  ]);
  // protective official domain dampens risk
  const dampened = buildRiskResult(
    mk("SOCIAL", [
      med("SUPPORT_LANGUAGE", "SOCIAL", "a"),
      item({ severity: "LOW", score: 1, signal: "OFFICIAL_DOMAIN_MATCH", source: "SOCIAL", reason: "benign" }),
    ]),
  );
  check("T13 official domain dampens 20 → 15", dampened.riskScore, 15);

  /* ---- Test 14: fake PaySecure-style scenario ---- */
  const fakeEvidence = await evidenceFor(fakeSocialCandidate, "SOCIAL");
  const t14 = buildRiskResult(fakeEvidence);
  check("T14 fake social score", t14.riskScore, 100);
  check("T14 fake social level", t14.riskLevel, "CRITICAL");
  check("T14 confidence", t14.confidence, 0.95);
  check("T14 evidenceCount", t14.evidenceCount, 7);
  check("T14 independentSourceCount", t14.independentSourceCount, 4);
  check(
    "T14 reason signals",
    t14.reasons.map((r) => r.signal),
    [
      "TEXT_IDENTITY_MATCH",
      "OFFICIAL_IDENTITY_CONFLICT",
      "EXTERNAL_DOMAIN",
      "SUPPORT_LANGUAGE",
      "BRAND_TEXT_MATCH",
      "NAME_SIMILARITY",
      "NAME_SIMILARITY",
    ],
  );

  /* ---- Test 15: harmless unrelated candidate ---- */
  const harmlessEvidence = await evidenceFor(harmlessCandidate, "SOCIAL");
  const t15 = buildRiskResult(harmlessEvidence);
  check("T15 score", t15.riskScore, 0);
  check("T15 level", t15.riskLevel, "LOW");
  check("T15 reasons", t15.reasons, []);

  /* ---- Test 16: exact official candidate ---- */
  const officialEvidence = await evidenceFor(officialSocialCandidate, "SOCIAL");
  const t16 = buildRiskResult(officialEvidence);
  checkTrue(
    "T16 official social ≤ 24 (LOW)",
    t16.riskScore <= 24 && t16.riskLevel === "LOW",
  );
  checkTrue(
    "T16 benign official signal present",
    officialEvidence.evidence.some((e) => e.signal === "OFFICIAL_ACCOUNT_MATCH"),
  );
  checkTrue(
    "T16 no name/text impersonation evidence",
    !officialEvidence.evidence.some((e) => e.source === "NAME" || e.source === "TEXT"),
  );
  const officialAppEvidence = await evidenceFor(officialAppCandidate, "APP");
  const t16b = buildRiskResult(officialAppEvidence);
  check("T16 official app score", t16b.riskScore, 0);
  check("T16 official app level", t16b.riskLevel, "LOW");

  /* ---- Test 17: reasons match actual evidence ---- */
  const evidenceSignals = new Set(fakeEvidence.evidence.map((e) => e.reason));
  checkTrue(
    "T17 every reason text comes from evidence",
    t14.reasons.every((r) => evidenceSignals.has(r.reason)),
  );
  checkTrue(
    "T17 every reason has category+signal+impact+reason",
    t14.reasons.every(
      (r) =>
        ["IDENTITY", "CONTENT", "VISUAL", "SOCIAL", "DOMAIN"].includes(r.category) &&
        typeof r.signal === "string" &&
        Number.isInteger(r.impact) &&
        r.impact > 0 &&
        typeof r.reason === "string" &&
        r.reason.length > 0,
    ),
  );
  checkTrue(
    "T17 every reason signal exists in evidence",
    t14.reasons.every((r) => fakeEvidence.evidence.some((e) => e.signal === r.signal)),
  );

  /* ---- Test 18: reasons sorted deterministically ---- */
  checkTrue(
    "T18 impacts non-increasing",
    t14.reasons.every((r, i, arr) => i === 0 || arr[i - 1].impact >= r.impact),
  );
  const equalImpacts = buildRiskResult(
    mk("SOCIAL", [
      high("EXTERNAL_DOMAIN", "SOCIAL", "domain reason"),
      high("LOGO_SIMILARITY", "LOGO", "logo reason"),
      high("TEXT_IDENTITY_MATCH", "TEXT", "text reason"),
    ]),
  );
  // equal 35 impacts → alphabetical signal tie-break
  check(
    "T18 equal-impact tie-break",
    equalImpacts.reasons.map((r) => r.signal),
    ["LOGO_SIMILARITY", "TEXT_IDENTITY_MATCH", "EXTERNAL_DOMAIN"].sort((a, b) => a.localeCompare(b)),
  );
  check("T18 repeat identical", JSON.stringify(buildRiskResult(fakeEvidence)), JSON.stringify(t14));

  /* ---- Test 19: confidence stays in [0,1] ---- */
  const all = [t1, t2, m1, m2, m3, t4, twoHigh, fourHigh, fiveHigh, t7, t9, oneGroup, threeGroups, t14, t15, t16, t16b];
  checkTrue(
    "T19 all confidence within 0..1",
    all.every((r) => typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1),
  );

  /* ---- Test 20: no final fake/scam/malicious verdict ---- */
  const forbidden = /^(fake|scam|malicious|attacker|verdict)$/i;
  checkTrue(
    "T20 no forbidden top-level keys",
    Object.keys(t14).every((k) => !forbidden.test(k)),
  );
  checkTrue(
    "T20 no forbidden reason keys",
    t14.reasons.every((r) => Object.keys(r).every((k) => !forbidden.test(k))),
  );
  checkTrue(
    "T20 no forbidden values in JSON",
    !/"(fake|scam|malicious|attacker)":\s*true/i.test(JSON.stringify(t14)),
  );
  check(
    "T20 top-level fields",
    Object.keys(t14).sort(),
    [
      "candidateId",
      "confidence",
      "evidence",
      "evidenceCount",
      "independentSourceCount",
      "reasons",
      "riskLevel",
      "riskScore",
      "type",
      "unavailable",
    ],
  );

  /* ---- helpers ---- */
  check("classifyEvidence identity", classifyEvidence({ signal: "APP_NAME_SIMILARITY", source: "APP" }), "IDENTITY");
  check("classifyEvidence content", classifyEvidence({ signal: "BRAND_TEXT_MATCH", source: "SOCIAL" }), "CONTENT");
  check("classifyEvidence domain", classifyEvidence({ signal: "EXTERNAL_DOMAIN", source: "SOCIAL" }), "DOMAIN");
  check("classifyEvidence fallback by source", classifyEvidence({ signal: "FUTURE_SIGNAL", source: "LOGO" }), "VISUAL");
  check("getRiskLevel edges", [getRiskLevel(0), getRiskLevel(24), getRiskLevel(25), getRiskLevel(49), getRiskLevel(50), getRiskLevel(74), getRiskLevel(75), getRiskLevel(100)], ["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL", "CRITICAL"]);

  /* ---- report ---- */
  console.log(`\nTask 12 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 12 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
