/* Explainable Risk Engine (Task 12) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/risk-engine.e2e.cjs */
const BASE = process.env.AEGIS_BASE_URL || "http://127.0.0.1:4000";

let passed = 0;
let failed = 0;
const failures = [];

const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n    expected: ${e}\n    actual:   ${a}`), failed++;
};

const checkTrue = (label, cond) => {
  if (cond) passed++;
  else (failures.push(`${label}: condition false`), failed++);
};

const req = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
};

const CATEGORIES = ["IDENTITY", "CONTENT", "VISUAL", "SOCIAL", "DOMAIN"];

const run = async () => {
  const health = await req("GET", "/health");
  check("health", health.status, 200);

  /* ---- brand + official assets ---- */
  const brandRes = await req("POST", "/api/brands", {
    name: "PaySecure",
    website: "https://paysecure.com",
  });
  check("create brand status", brandRes.status, 201);
  const brandId = brandRes.json.data.id;

  const aSocial = await req("POST", `/api/brands/${brandId}/assets`, {
    type: "SOCIAL",
    value: "@PaySecure",
  });
  const aDomain = await req("POST", `/api/brands/${brandId}/assets`, {
    type: "DOMAIN",
    value: "paysecure.com",
  });
  const aWeb = await req("POST", `/api/brands/${brandId}/assets`, {
    type: "WEBSITE",
    value: "https://paysecure.com",
  });
  const aApp = await req("POST", `/api/brands/${brandId}/assets`, {
    type: "APP",
    value: "com.paysecure.wallet",
  });
  check("official assets created", [aSocial.status, aDomain.status, aWeb.status, aApp.status], [201, 201, 201, 201]);

  /* ---- candidates ---- */
  const mk = async (c) => {
    const r = await req("POST", "/api/candidates", { ...c, brandId });
    if (r.status !== 201) throw new Error(`candidate create failed: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.data.id;
  };

  const fakeSocial = await mk({
    type: "SOCIAL",
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description:
      "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
  });
  const fakeApp = await mk({
    type: "APP",
    value: "com.paysecure.fake.wallet",
    name: "PaySecure",
    description: "Official PaySecure app with support and refund protection.",
  });
  const harmless = await mk({
    type: "SOCIAL",
    value: "@travel_photos",
    name: "Student Travel Photography",
    description: "Photography community for students.",
  });
  const officialSocial = await mk({
    type: "SOCIAL",
    value: "@PaySecure",
    name: "PaySecure",
    description: "Official PaySecure account. Customer support: https://paysecure.com",
  });
  const officialApp = await mk({
    type: "APP",
    value: "com.paysecure.wallet",
    name: "PaySecure Official",
    description: "The official PaySecure wallet.",
  });
  const website = await mk({ type: "WEBSITE", value: "https://example.com", name: "Example" });
  const orphan = await (async () => {
    const r = await req("POST", "/api/candidates", {
      type: "SOCIAL",
      value: "@orphan_account",
      name: "Orphan",
    });
    if (r.status !== 201) throw new Error("orphan create failed");
    return r.json.data.id;
  })();

  const risk = async (id) => req("POST", `/api/candidates/${id}/analyze/risk`);

  /* ---- TEST 1: fake social candidate → CRITICAL ---- */
  const t1 = await risk(fakeSocial);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 candidateId", t1.json.data.candidateId, fakeSocial);
  check("T1 type", t1.json.data.type, "SOCIAL");
  check("T1 riskScore", t1.json.data.riskScore, 100);
  check("T1 riskLevel", t1.json.data.riskLevel, "CRITICAL");
  check("T1 confidence", t1.json.data.confidence, 0.95);
  check("T1 evidenceCount", t1.json.data.evidenceCount, 7);
  check("T1 independentSourceCount", t1.json.data.independentSourceCount, 4);
  check(
    "T1 reason signals",
    t1.json.data.reasons.map((r) => r.signal),
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
  checkTrue(
    "T1 reasons sorted by impact desc",
    t1.json.data.reasons.every((r, i, arr) => i === 0 || arr[i - 1].impact >= r.impact),
  );
  checkTrue(
    "T1 every reason impact > 0 and integer",
    t1.json.data.reasons.every((r) => Number.isInteger(r.impact) && r.impact > 0),
  );
  checkTrue(
    "T1 every reason category valid",
    t1.json.data.reasons.every((r) => CATEGORIES.includes(r.category)),
  );
  const evidenceSignals = new Set(t1.json.data.evidence.map((e) => e.reason));
  checkTrue(
    "T1 every reason text comes from evidence",
    t1.json.data.reasons.every((r) => evidenceSignals.has(r.reason)),
  );
  checkTrue(
    "T1 every reason signal exists in evidence",
    t1.json.data.reasons.every((r) => t1.json.data.evidence.some((e) => e.signal === r.signal)),
  );
  check(
    "T1 unavailable sources",
    t1.json.data.unavailable.map((u) => u.source),
    ["LOGO", "APP"],
  );

  /* ---- TEST 2: fake app candidate → CRITICAL ---- */
  const t2 = await risk(fakeApp);
  check("T2 status", t2.status, 200);
  check("T2 type", t2.json.data.type, "APP");
  check("T2 riskScore", t2.json.data.riskScore, 95);
  check("T2 riskLevel", t2.json.data.riskLevel, "CRITICAL");
  check("T2 confidence", t2.json.data.confidence, 0.85);
  check("T2 evidenceCount", t2.json.data.evidenceCount, 6);

  /* ---- TEST 3: harmless candidate → 0 / LOW ---- */
  const t3 = await risk(harmless);
  check("T3 status", t3.status, 200);
  check("T3 riskScore", t3.json.data.riskScore, 0);
  check("T3 riskLevel", t3.json.data.riskLevel, "LOW");
  check("T3 confidence", t3.json.data.confidence, 0);
  check("T3 reasons", t3.json.data.reasons, []);
  check("T3 evidenceCount", t3.json.data.evidenceCount, 0);

  /* ---- TEST 4: exact official social → LOW (≤24 cap) ---- */
  const t4 = await risk(officialSocial);
  check("T4 status", t4.status, 200);
  checkTrue("T4 riskScore ≤ 24", t4.json.data.riskScore <= 24);
  check("T4 riskLevel", t4.json.data.riskLevel, "LOW");
  checkTrue(
    "T4 benign official signal present",
    t4.json.data.evidence.some((e) => e.signal === "OFFICIAL_ACCOUNT_MATCH"),
  );
  checkTrue(
    "T4 no NAME/TEXT impersonation evidence",
    !t4.json.data.evidence.some((e) => e.source === "NAME" || e.source === "TEXT"),
  );

  /* ---- TEST 5: exact official app → 0 / LOW ---- */
  const t5 = await risk(officialApp);
  check("T5 status", t5.status, 200);
  check("T5 riskScore", t5.json.data.riskScore, 0);
  check("T5 riskLevel", t5.json.data.riskLevel, "LOW");
  check("T5 evidenceCount", t5.json.data.evidenceCount, 1);
  checkTrue(
    "T5 only benign official match",
    t5.json.data.evidence.every((e) => e.signal === "OFFICIAL_APP_MATCH"),
  );
  check("T5 reasons", t5.json.data.reasons, []);

  /* ---- TEST 6: non-SOCIAL/APP candidate ---- */
  const t6 = await risk(website);
  check("T6 status", t6.status, 400);
  check("T6 success", t6.json.success, false);
  check("T6 error", t6.json.error, "ApiError");
  check("T6 code", t6.json.details && t6.json.details.code, "RISK_ANALYSIS_NOT_APPLICABLE");
  checkTrue("T6 message mentions SOCIAL and APP", /only applicable to SOCIAL and APP candidates/.test(t6.json.message));

  /* ---- failure paths ---- */
  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/risk");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await risk(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${fakeSocial}/analyze/risk`);
  check("GET on risk route -> 404", wrongVerb.status, 404);

  /* ---- shape invariants ---- */
  check(
    "T1 top-level fields",
    Object.keys(t1.json.data).sort(),
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
  checkTrue(
    "confidence within 0..1 for all",
    [t1, t2, t3, t4, t5].every(
      (r) => typeof r.json.data.confidence === "number" && r.json.data.confidence >= 0 && r.json.data.confidence <= 1,
    ),
  );
  checkTrue(
    "riskScore within 0..100 for all",
    [t1, t2, t3, t4, t5].every(
      (r) => Number.isInteger(r.json.data.riskScore) && r.json.data.riskScore >= 0 && r.json.data.riskScore <= 100,
    ),
  );
  checkTrue(
    "no fake/scam/malicious verdict keys",
    !/"(fake|scam|malicious|attacker|verdict)":/i.test(JSON.stringify(t1.json.data)),
  );

  /* ---- evidence endpoint regression (Task 11) ---- */
  const ev = await req("POST", `/api/candidates/${fakeSocial}/analyze/evidence`);
  check("Task 11 evidence endpoint still works", ev.status, 200);
  check("Task 11 evidenceCount", ev.json.data.evidenceCount, 7);

  /* ---- determinism ---- */
  const t1again = await risk(fakeSocial);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  console.log(`\nTask 12 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 12 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
