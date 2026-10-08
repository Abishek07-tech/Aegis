/* Social Risk Signals (Task 9) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 npm run test:e2e */
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
  /* ---- health ---- */
  const health = await req("GET", "/health");
  check("health", health.status, 200);

  /* ---- brand ---- */
  const brandRes = await req("POST", "/api/brands", {
    name: "PaySecure",
    website: "https://paysecure.com",
  });
  check("create brand status", brandRes.status, 201);
  const brandId = brandRes.json.data.id;

  /* ---- official assets ---- */
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
  check("official assets created", [aSocial.status, aDomain.status, aWeb.status], [201, 201, 201]);

  /* ---- candidates (Task 1..5 fixtures) ---- */
  const mk = async (c) => {
    const r = await req("POST", "/api/candidates", { ...c, brandId });
    if (r.status !== 201) throw new Error(`candidate create failed: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.data.id;
  };

  const c1 = await mk({
    type: "SOCIAL",
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description:
      "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
  });
  const c2 = await mk({
    type: "SOCIAL",
    value: "@PaySecure",
    name: "PaySecure",
    description: "Official PaySecure account.",
  });
  const c3 = await mk({
    type: "SOCIAL",
    value: "@travel_photos",
    name: "Student Travel Photography",
    description: "Photography community for students.",
  });
  const c4 = await mk({
    type: "SOCIAL",
    value: "@PS_AccountInfo",
    name: "PaySecure Info",
    description: "Visit https://paysecure.com for account information.",
  });
  const c5 = await mk({
    type: "SOCIAL",
    value: "@helpcommunity",
    name: "Help Community",
    description: "Customer support and help community.",
  });
  const c6 = await mk({
    type: "APP",
    value: "com.paysecure.wallet",
    name: "PaySecure Wallet",
    description: "Payments app",
  });
  const cNoBrand = await (async () => {
    const r = await req("POST", "/api/candidates", {
      type: "SOCIAL",
      value: "@orphan_account",
      name: "Orphan",
    });
    if (r.status !== 201) throw new Error("orphan create failed");
    return r.json.data.id;
  })();

  /* ---- TEST 1: obvious impersonation ---- */
  const t1 = await req("POST", `/api/candidates/${c1}/analyze/social-risk`);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 candidateId", t1.json.data.candidateId, c1);
  check("T1 type", t1.json.data.type, "SOCIAL");
  check(
    "T1 signals",
    signalNames(t1.json.data),
    ["NAME_SIMILARITY", "BRAND_TEXT_MATCH", "SUPPORT_LANGUAGE", "EXTERNAL_DOMAIN", "OFFICIAL_IDENTITY_CONFLICT"],
  );
  check("T1 signalCount", t1.json.data.signalCount, 5);
  check("T1 hasHighSeverity", t1.json.data.hasHighSeverity, true);
  checkTrue("T1 name reason present", typeof getSignal(t1.json.data, "NAME_SIMILARITY").reason === "string" && getSignal(t1.json.data, "NAME_SIMILARITY").reason.length > 0);
  check("T1 brand severity", getSignal(t1.json.data, "BRAND_TEXT_MATCH").severity, "HIGH");
  check("T1 support severity", getSignal(t1.json.data, "SUPPORT_LANGUAGE").severity, "MEDIUM");
  check("T1 external severity", getSignal(t1.json.data, "EXTERNAL_DOMAIN").severity, "MEDIUM");
  check("T1 conflict severity", getSignal(t1.json.data, "OFFICIAL_IDENTITY_CONFLICT").severity, "HIGH");
  check("T1 conflict score", getSignal(t1.json.data, "OFFICIAL_IDENTITY_CONFLICT").score, 0.9);
  checkTrue("T1 all scores numeric 0..1", t1.json.data.signals.every((s) => typeof s.score === "number" && s.score >= 0 && s.score <= 1));
  checkTrue("T1 severities valid", t1.json.data.signals.every((s) => ["HIGH", "MEDIUM", "LOW"].includes(s.severity)));

  /* ---- TEST 2: legitimate official account ---- */
  const t2 = await req("POST", `/api/candidates/${c2}/analyze/social-risk`);
  check("T2 status", t2.status, 200);
  check("T2 signals", signalNames(t2.json.data), []);
  check("T2 signalCount", t2.json.data.signalCount, 0);
  check("T2 hasHighSeverity", t2.json.data.hasHighSeverity, false);

  /* ---- TEST 3: harmless unrelated account ---- */
  const t3 = await req("POST", `/api/candidates/${c3}/analyze/social-risk`);
  check("T3 status", t3.status, 200);
  check("T3 few signals", t3.json.data.signalCount, 0);
  check("T3 hasHighSeverity", t3.json.data.hasHighSeverity, false);

  /* ---- TEST 4: legitimate official domain ---- */
  const t4 = await req("POST", `/api/candidates/${c4}/analyze/social-risk`);
  check("T4 status", t4.status, 200);
  checkTrue("T4 no EXTERNAL_DOMAIN", !signalNames(t4.json.data).includes("EXTERNAL_DOMAIN"));
  checkTrue("T4 has OFFICIAL_DOMAIN_MATCH", signalNames(t4.json.data).includes("OFFICIAL_DOMAIN_MATCH"));
  check("T4 official domain severity", getSignal(t4.json.data, "OFFICIAL_DOMAIN_MATCH").severity, "LOW");
  checkTrue("T4 no conflict", !signalNames(t4.json.data).includes("OFFICIAL_IDENTITY_CONFLICT"));

  /* ---- TEST 5: support language alone ---- */
  const t5 = await req("POST", `/api/candidates/${c5}/analyze/social-risk`);
  check("T5 status", t5.status, 200);
  check("T5 signals", signalNames(t5.json.data), ["SUPPORT_LANGUAGE"]);
  check("T5 not high severity", t5.json.data.hasHighSeverity, false);

  /* ---- TEST 6: non-social candidate ---- */
  const t6 = await req("POST", `/api/candidates/${c6}/analyze/social-risk`);
  check("T6 status", t6.status, 400);
  check("T6 success", t6.json.success, false);
  check("T6 error", t6.json.error, "ApiError");
  check("T6 code", t6.json.details && t6.json.details.code, "SOCIAL_ANALYSIS_NOT_APPLICABLE");
  checkTrue("T6 message mentions SOCIAL", /only applicable to SOCIAL candidates/.test(t6.json.message));

  /* ---- other failure paths ---- */
  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/social-risk");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await req("POST", `/api/candidates/${cNoBrand}/analyze/social-risk`);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${c1}/analyze/social-risk`);
  check("GET on social-risk route -> 404", wrongVerb.status, 404);

  /* ---- Task 6/7/8 regression ---- */
  const name = await req("POST", `/api/candidates/${c1}/analyze/name`);
  check("T6 name analysis status", name.status, 200);
  checkTrue("T6 name analysis has score", typeof name.json.data.score === "number");
  checkTrue("T6 name analysis level", ["HIGH", "MEDIUM", "LOW"].includes(name.json.data.level));

  const text = await req("POST", `/api/candidates/${c1}/analyze/text`);
  check("T7 text analysis status", text.status, 200);
  check("T7 text analysis level", text.json.data.level, "HIGH");

  const logo = await req("POST", `/api/candidates/${c1}/analyze/logo`);
  check("T8 logo analysis -> 400 (no candidate logo field)", logo.status, 400);
  checkTrue("T8 logo message", /logo comparison unavailable/.test(logo.json.message));

  /* ---- Task 1-5 regression ---- */
  const badBrand = await req("POST", "/api/brands", {});
  check("brand validation 400", badBrand.status, 400);
  const badCandidate = await req("POST", "/api/candidates", { type: "NOPE", value: "x" });
  check("candidate validation 400", badCandidate.status, 400);
  const listBrands = await req("GET", "/api/brands");
  check("list brands 200", listBrands.status, 200);
  checkTrue("list brands has brand", listBrands.json.count >= 1);
  const listCandidates = await req("GET", `/api/candidates?type=SOCIAL&brandId=${brandId}`);
  check("list candidates 200", listCandidates.status, 200);
  check("list social candidates count (brand-scoped)", listCandidates.json.count, 5);
  const listAssets = await req("GET", `/api/brands/${brandId}/assets`);
  check("list assets 200 + count", [listAssets.status, listAssets.json.count], [200, 3]);
  const unknown = await req("GET", "/api/nope");
  check("unknown route 404", unknown.status, 404);

  /* ---- determinism ---- */
  const t1again = await req("POST", `/api/candidates/${c1}/analyze/social-risk`);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  console.log(`\npassed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL END-TO-END TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
