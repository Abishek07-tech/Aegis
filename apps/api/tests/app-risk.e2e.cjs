/* App Risk Analysis (Task 10) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/app-risk.e2e.cjs */
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

const signalNames = (data) => (data.signals || []).map((s) => s.signal);
const getSignal = (data, name) => (data.signals || []).find((s) => s.signal === name);

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
  check("official assets created", [aDomain.status, aWeb.status, aApp.status], [201, 201, 201]);

  /* ---- candidates ---- */
  const mk = async (c) => {
    const r = await req("POST", "/api/candidates", { ...c, brandId });
    if (r.status !== 201) throw new Error(`candidate create failed: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.data.id;
  };

  // 1. obvious fake PaySecure app
  const fakeApp = await mk({
    type: "APP",
    value: "com.paysecure.fake.wallet",
    name: "PaySecure",
    description: "Official PaySecure app with support and refund protection.",
  });
  // 2. exact official app
  const officialApp = await mk({
    type: "APP",
    value: "com.paysecure.wallet",
    name: "PaySecure Official",
    description: "The official PaySecure wallet.",
  });
  // 3. harmless unrelated app
  const unrelatedApp = await mk({
    type: "APP",
    value: "com.example.travel",
    name: "Travel Journal",
    description: "A journal for travelers.",
  });
  // 4. external domain app
  const extDomainApp = await mk({
    type: "APP",
    value: "com.example.app",
    name: "Test App",
    description: "Visit https://evil.com for more info.",
  });
  // 5. non-APP candidate for failure path
  const socialCandidate = await mk({
    type: "SOCIAL",
    value: "@someuser",
    name: "Social User",
    description: "Social profile",
  });
  // 6. candidate with no brand
  const orphan = await (async () => {
    const r = await req("POST", "/api/candidates", {
      type: "APP",
      value: "com.orphan.app",
      name: "Orphan App",
    });
    if (r.status !== 201) throw new Error("orphan create failed");
    return r.json.data.id;
  })();

  /* ---- TEST 1: obvious fake PaySecure app ---- */
  const t1 = await req("POST", `/api/candidates/${fakeApp}/analyze/app-risk`);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 candidateId", t1.json.data.candidateId, fakeApp);
  check("T1 type", t1.json.data.type, "APP");
  const t1names = signalNames(t1.json.data).sort();
  check(
    "T1 signals",
    t1names,
    ["APP_BRAND_IMPERSONATION", "APP_DESCRIPTION_MATCH", "APP_NAME_SIMILARITY", "PACKAGE_IDENTIFIER_SIMILARITY"].sort(),
  );
  check("T1 hasHighSeverity", t1.json.data.hasHighSeverity, true);
  check("T1 signalCount", t1.json.data.signalCount, 4);
  check("T1 name severity", getSignal(t1.json.data, "APP_NAME_SIMILARITY").severity, "HIGH");
  check("T1 description severity", getSignal(t1.json.data, "APP_DESCRIPTION_MATCH").severity, "HIGH");
  check("T1 impersonation severity", getSignal(t1.json.data, "APP_BRAND_IMPERSONATION").severity, "HIGH");
  check("T1 impersonation score", getSignal(t1.json.data, "APP_BRAND_IMPERSONATION").score, 0.9);
  checkTrue("T1 reasons present", t1.json.data.signals.every((s) => typeof s.reason === "string" && s.reason.length > 0));
  checkTrue("T1 scores 0..1", t1.json.data.signals.every((s) => typeof s.score === "number" && s.score >= 0 && s.score <= 1));
  checkTrue("T1 severities valid", t1.json.data.signals.every((s) => ["HIGH", "MEDIUM", "LOW"].includes(s.severity)));
  checkTrue("T1 DIFFERENT_PUBLISHER unavailable", (t1.json.data.unavailableSignals || []).some((u) => u.signal === "DIFFERENT_PUBLISHER"));

  /* ---- TEST 2: exact official app ---- */
  const t2 = await req("POST", `/api/candidates/${officialApp}/analyze/app-risk`);
  check("T2 status", t2.status, 200);
  check("T2 signals", signalNames(t2.json.data), ["OFFICIAL_APP_MATCH"]);
  check("T2 hasHighSeverity", t2.json.data.hasHighSeverity, false);
  check("T2 signalCount", t2.json.data.signalCount, 1);
  check("T2 official severity", getSignal(t2.json.data, "OFFICIAL_APP_MATCH").severity, "LOW");

  /* ---- TEST 3: harmless unrelated app ---- */
  const t3 = await req("POST", `/api/candidates/${unrelatedApp}/analyze/app-risk`);
  check("T3 status", t3.status, 200);
  check("T3 signals", t3.json.data.signalCount, 0);
  check("T3 hasHighSeverity", t3.json.data.hasHighSeverity, false);

  /* ---- TEST 4: external domain ---- */
  const t4 = await req("POST", `/api/candidates/${extDomainApp}/analyze/app-risk`);
  check("T4 status", t4.status, 200);
  checkTrue("T4 has EXTERNAL_DOMAIN", signalNames(t4.json.data).includes("EXTERNAL_DOMAIN"));
  check("T4 external severity", getSignal(t4.json.data, "EXTERNAL_DOMAIN").severity, "MEDIUM");
  check("T4 external score", getSignal(t4.json.data, "EXTERNAL_DOMAIN").score, 0.7);

  /* ---- TEST 5: non-APP candidate ---- */
  const t5 = await req("POST", `/api/candidates/${socialCandidate}/analyze/app-risk`);
  check("T5 status", t5.status, 400);
  check("T5 success", t5.json.success, false);
  check("T5 error", t5.json.error, "ApiError");
  check("T5 code", t5.json.details && t5.json.details.code, "APP_ANALYSIS_NOT_APPLICABLE");
  checkTrue("T5 message mentions APP", /only applicable to APP candidates/.test(t5.json.message));

  /* ---- failure paths ---- */
  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/app-risk");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await req("POST", `/api/candidates/${orphan}/analyze/app-risk`);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${fakeApp}/analyze/app-risk`);
  check("GET on app-risk route -> 404", wrongVerb.status, 404);

  /* ---- Task 9 regression ---- */
  const social = await req("POST", `/api/candidates/${socialCandidate}/analyze/social-risk`);
  check("Task 9 social-risk still works", social.status, 200);

  /* ---- Task 6/7/8 regression ---- */
  const name = await req("POST", `/api/candidates/${fakeApp}/analyze/name`);
  check("Task 6 name analysis status", name.status, 200);

  const text = await req("POST", `/api/candidates/${fakeApp}/analyze/text`);
  check("Task 7 text analysis status", text.status, 200);

  const logo = await req("POST", `/api/candidates/${fakeApp}/analyze/logo`);
  check("Task 8 logo analysis -> 400 (no candidate logo)", logo.status, 400);

  /* ---- determinism ---- */
  const t1again = await req("POST", `/api/candidates/${fakeApp}/analyze/app-risk`);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  console.log(`\nTask 10 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 10 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
