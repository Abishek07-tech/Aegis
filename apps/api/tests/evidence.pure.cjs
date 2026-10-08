const path = require("path");
const fs = require("fs");

const svcPath = path.join(__dirname, "..", "dist", "services", "evidence.service.js");
if (!fs.existsSync(svcPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  EVIDENCE_SOURCE_ORDER,
  dedupeEvidence,
  buildEvidenceResult,
  collectEvidence,
} = require(svcPath);

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
const brand = { name: "PaySecure", website: "https://paysecure.com" };
const assets = [
  { id: "a1", brandId: "b1", type: "SOCIAL", value: "@PaySecure", createdAt: new Date() },
  { id: "a2", brandId: "b1", type: "APP", value: "com.paysecure.wallet", createdAt: new Date() },
  { id: "a3", brandId: "b1", type: "DOMAIN", value: "paysecure.com", createdAt: new Date() },
  { id: "a4", brandId: "b1", type: "WEBSITE", value: "https://paysecure.com", createdAt: new Date() },
];

const socialCandidate = {
  id: "c1",
  type: "SOCIAL",
  value: "@PaySecure_Support",
  name: "PaySecure Support",
  description: "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
};
const appCandidate = {
  id: "c2",
  type: "APP",
  value: "com.paysecure.fake.wallet",
  name: "PaySecure",
  description: "Official PaySecure app with support and refund protection.",
};
const harmlessCandidate = {
  id: "c3",
  type: "SOCIAL",
  value: "@travel_photos",
  name: "Student Travel Photography",
  description: "Photography community for students.",
};

const item = (over) => ({
  source: "NAME",
  signal: "NAME_SIMILARITY",
  severity: "LOW",
  score: 0.5,
  reason: "r",
  ...over,
});

const run = async () => {
  /* ---- source order constant ---- */
  check("EVIDENCE_SOURCE_ORDER", EVIDENCE_SOURCE_ORDER, ["NAME", "TEXT", "LOGO", "SOCIAL", "APP"]);

  /* ---- Test 1: social candidate aggregates every applicable source ---- */
  const r1 = await collectEvidence(socialCandidate, brand, assets, "SOCIAL");
  const res1 = buildEvidenceResult("c1", "SOCIAL", r1.items, r1.unavailable);
  check("T1 candidateId", res1.candidateId, "c1");
  check("T1 type", res1.type, "SOCIAL");
  check("T1 evidenceCount", res1.evidenceCount, 7);
  check("T1 highSeverityCount", res1.highSeverityCount, 3);
  check("T1 hasHighSeverity", res1.hasHighSeverity, true);
  check(
    "T1 sources in evidence",
    res1.evidence.map((e) => e.source),
    ["NAME", "TEXT", "SOCIAL", "SOCIAL", "SOCIAL", "SOCIAL", "SOCIAL"],
  );
  check(
    "T1 unavailable sources",
    res1.unavailable.map((u) => u.source),
    ["LOGO", "APP"],
  );
  checkTrue(
    "T1 social signals mirror Task 9 order",
    res1.evidence
      .filter((e) => e.source === "SOCIAL")
      .map((e) => e.signal)
      .join(",") === "NAME_SIMILARITY,BRAND_TEXT_MATCH,SUPPORT_LANGUAGE,EXTERNAL_DOMAIN,OFFICIAL_IDENTITY_CONFLICT",
  );
  checkTrue(
    "T1 every item has reason",
    res1.evidence.every((e) => typeof e.reason === "string" && e.reason.length > 0),
  );
  checkTrue(
    "T1 severities valid",
    res1.evidence.every((e) => ["HIGH", "MEDIUM", "LOW"].includes(e.severity)),
  );
  checkTrue(
    "T1 scores in 0..1",
    res1.evidence.every((e) => typeof e.score === "number" && e.score >= 0 && e.score <= 1),
  );

  /* ---- Test 2: app candidate aggregates APP source ---- */
  const r2 = await collectEvidence(appCandidate, brand, assets, "APP");
  const res2 = buildEvidenceResult("c2", "APP", r2.items, r2.unavailable);
  check("T2 type", res2.type, "APP");
  check("T2 evidenceCount", res2.evidenceCount, 6);
  check("T2 highSeverityCount", res2.highSeverityCount, 4);
  check("T2 hasHighSeverity", res2.hasHighSeverity, true);
  check(
    "T2 sources in evidence",
    res2.evidence.map((e) => e.source),
    ["NAME", "TEXT", "APP", "APP", "APP", "APP"],
  );
  check(
    "T2 unavailable sources",
    res2.unavailable.map((u) => u.source),
    ["LOGO", "SOCIAL"],
  );
  checkTrue(
    "T2 app signals mirror Task 10 order",
    res2.evidence
      .filter((e) => e.source === "APP")
      .map((e) => e.signal)
      .join(",") === "APP_NAME_SIMILARITY,APP_DESCRIPTION_MATCH,PACKAGE_IDENTIFIER_SIMILARITY,APP_BRAND_IMPERSONATION",
  );

  /* ---- Test 3: harmless candidate ---- */
  const r3 = await collectEvidence(harmlessCandidate, brand, assets, "SOCIAL");
  const res3 = buildEvidenceResult("c3", "SOCIAL", r3.items, r3.unavailable);
  check("T3 evidenceCount", res3.evidenceCount, 0);
  check("T3 highSeverityCount", res3.highSeverityCount, 0);
  check("T3 hasHighSeverity", res3.hasHighSeverity, false);
  checkTrue("T3 NAME was computed (not unavailable)", !res3.unavailable.some((u) => u.source === "NAME"));
  checkTrue("T3 TEXT was computed (not unavailable)", !res3.unavailable.some((u) => u.source === "TEXT"));

  /* ---- Test 4: source order invariant (NAME..APP) ---- */
  const idx = (s) => EVIDENCE_SOURCE_ORDER.indexOf(s);
  const ordered = res1.evidence.every((e, i, arr) => i === 0 || idx(arr[i - 1].source) <= idx(e.source));
  checkTrue("T4 evidence follows source order", ordered);
  const unord = res1.unavailable.every((u, i, arr) => i === 0 || idx(arr[i - 1].source) <= idx(u.source));
  checkTrue("T4 unavailable follows source order", unord);

  /* ---- Test 5: exact-duplicate dedupe (content-exact: signal+severity+score+reason) ---- */
  const dupes = [
    item({ score: 0.9, severity: "HIGH" }),
    item({ score: 0.9, severity: "HIGH" }),
    item({ score: 0.5 }),
    item({ source: "SOCIAL", signal: "NAME_SIMILARITY", score: 0.9, severity: "HIGH", reason: "r" }),
    item({ source: "TEXT", signal: "TEXT_IDENTITY_MATCH", score: 0.9, severity: "HIGH", reason: "other" }),
  ];
  const deduped = dedupeEvidence(dupes);
  check("T5 dedupe removes exact content duplicates", deduped.length, 3);
  check("T5 first occurrence wins", deduped[0].source, "NAME");
  check("T5 differing score kept", deduped[1].score, 0.5);
  check("T5 differing signal/reason kept", deduped[2].signal, "TEXT_IDENTITY_MATCH");

  /* ---- Test 6: buildEvidenceResult dedupes + counts ---- */
  const res6 = buildEvidenceResult("c6", "SOCIAL", dupes, []);
  check("T6 evidenceCount after dedupe", res6.evidenceCount, 3);
  check("T6 highSeverityCount", res6.highSeverityCount, 2);
  check("T6 hasHighSeverity", res6.hasHighSeverity, true);

  /* ---- Test 7: empty candidate value + empty text ---- */
  const emptyCandidate = { id: "c7", type: "SOCIAL", value: "", name: null, description: null };
  const r7 = await collectEvidence(emptyCandidate, brand, assets, "SOCIAL");
  const res7 = buildEvidenceResult("c7", "SOCIAL", r7.items, r7.unavailable);
  checkTrue("T7 NAME unavailable", res7.unavailable.some((u) => u.source === "NAME" && /empty after normalization/.test(u.reason)));
  checkTrue("T7 TEXT unavailable", res7.unavailable.some((u) => u.source === "TEXT" && /no usable text/.test(u.reason)));
  check("T7 unavailable sources", res7.unavailable.map((u) => u.source), ["NAME", "TEXT", "LOGO", "APP"]);

  /* ---- Test 8: no official assets ---- */
  const r8 = await collectEvidence(socialCandidate, brand, [], "SOCIAL");
  const res8 = buildEvidenceResult("c8", "SOCIAL", r8.items, r8.unavailable);
  checkTrue("T8 NAME unavailable (no assets)", res8.unavailable.some((u) => u.source === "NAME" && /no official assets/.test(u.reason)));
  checkTrue("T8 LOGO unavailable", res8.unavailable.some((u) => u.source === "LOGO"));

  /* ---- Test 9: brand with official logo but candidate has no logo field ---- */
  const brandWithLogo = { ...brand, logoUrl: "https://paysecure.com/logo.png" };
  const r9 = await collectEvidence(socialCandidate, brandWithLogo, assets, "SOCIAL");
  const res9 = buildEvidenceResult("c9", "SOCIAL", r9.items, r9.unavailable);
  checkTrue(
    "T9 LOGO unavailable (no candidate logo field)",
    res9.unavailable.some((u) => u.source === "LOGO" && /no logo\/image reference/.test(u.reason)),
  );
  checkTrue("T9 no LOGO evidence item", !res9.evidence.some((e) => e.source === "LOGO"));

  /* ---- Test 10: deterministic output ---- */
  const ra = await collectEvidence(socialCandidate, brand, assets, "SOCIAL");
  const rb = await collectEvidence(socialCandidate, brand, assets, "SOCIAL");
  check(
    "T10 deterministic",
    JSON.stringify(buildEvidenceResult("c1", "SOCIAL", ra.items, ra.unavailable)),
    JSON.stringify(buildEvidenceResult("c1", "SOCIAL", rb.items, rb.unavailable)),
  );

  /* ---- report ---- */
  console.log(`\nTask 11 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 11 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
