/* Multimodal Evidence Engine (Task 11) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/evidence.e2e.cjs */
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

const SOURCE_ORDER = ["NAME", "TEXT", "LOGO", "SOCIAL", "APP"];
const sourcesOf = (data) => (data.evidence || []).map((e) => e.source);
const unavailableOf = (data) => (data.unavailable || []).map((u) => u.source);

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

  const socialC = await mk({
    type: "SOCIAL",
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description:
      "Official PaySecure customer support. Verify your account at https://paysecure-help.com",
  });
  const appC = await mk({
    type: "APP",
    value: "com.paysecure.fake.wallet",
    name: "PaySecure",
    description: "Official PaySecure app with support and refund protection.",
  });
  const harmlessC = await mk({
    type: "SOCIAL",
    value: "@travel_photos",
    name: "Student Travel Photography",
    description: "Photography community for students.",
  });
  const websiteC = await mk({
    type: "WEBSITE",
    value: "https://example.com",
    name: "Example",
  });
  const orphan = await (async () => {
    const r = await req("POST", "/api/candidates", {
      type: "SOCIAL",
      value: "@orphan_account",
      name: "Orphan",
    });
    if (r.status !== 201) throw new Error("orphan create failed");
    return r.json.data.id;
  })();

  /* ---- TEST 1: social candidate aggregates evidence ---- */
  const t1 = await req("POST", `/api/candidates/${socialC}/analyze/evidence`);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 candidateId", t1.json.data.candidateId, socialC);
  check("T1 type", t1.json.data.type, "SOCIAL");
  check("T1 evidenceCount", t1.json.data.evidenceCount, 7);
  check("T1 highSeverityCount", t1.json.data.highSeverityCount, 3);
  check("T1 hasHighSeverity", t1.json.data.hasHighSeverity, true);
  check("T1 sources", sourcesOf(t1.json.data), ["NAME", "TEXT", "SOCIAL", "SOCIAL", "SOCIAL", "SOCIAL", "SOCIAL"]);
  check("T1 unavailable", unavailableOf(t1.json.data), ["LOGO", "APP"]);
  checkTrue(
    "T1 every item has source/signal/severity/score/reason",
    t1.json.data.evidence.every(
      (e) =>
        SOURCE_ORDER.includes(e.source) &&
        typeof e.signal === "string" &&
        ["HIGH", "MEDIUM", "LOW"].includes(e.severity) &&
        typeof e.score === "number" &&
        e.score >= 0 &&
        e.score <= 1 &&
        typeof e.reason === "string" &&
        e.reason.length > 0,
    ),
  );
  checkTrue(
    "T1 unavailable items have source/reason",
    t1.json.data.unavailable.every(
      (u) => SOURCE_ORDER.includes(u.source) && typeof u.reason === "string" && u.reason.length > 0,
    ),
  );
  checkTrue(
    "T1 evidence in source order",
    sourcesOf(t1.json.data).every(
      (s, i, arr) => i === 0 || SOURCE_ORDER.indexOf(arr[i - 1]) <= SOURCE_ORDER.indexOf(s),
    ),
  );
  checkTrue(
    "T1 highSeverityCount matches evidence",
    t1.json.data.highSeverityCount === t1.json.data.evidence.filter((e) => e.severity === "HIGH").length,
  );
  checkTrue(
    "T1 LOGO unavailable reason mentions logo",
    /logo/i.test(t1.json.data.unavailable.find((u) => u.source === "LOGO").reason),
  );
  checkTrue(
    "T1 APP unavailable reason mentions APP candidates",
    /only applicable to APP candidates/.test(t1.json.data.unavailable.find((u) => u.source === "APP").reason),
  );

  /* ---- TEST 2: app candidate aggregates evidence ---- */
  const t2 = await req("POST", `/api/candidates/${appC}/analyze/evidence`);
  check("T2 status", t2.status, 200);
  check("T2 type", t2.json.data.type, "APP");
  check("T2 evidenceCount", t2.json.data.evidenceCount, 6);
  check("T2 highSeverityCount", t2.json.data.highSeverityCount, 4);
  check("T2 hasHighSeverity", t2.json.data.hasHighSeverity, true);
  check("T2 sources", sourcesOf(t2.json.data), ["NAME", "TEXT", "APP", "APP", "APP", "APP"]);
  check("T2 unavailable", unavailableOf(t2.json.data), ["LOGO", "SOCIAL"]);
  checkTrue(
    "T2 SOCIAL unavailable reason mentions SOCIAL candidates",
    /only applicable to SOCIAL candidates/.test(t2.json.data.unavailable.find((u) => u.source === "SOCIAL").reason),
  );

  /* ---- TEST 3: harmless candidate ---- */
  const t3 = await req("POST", `/api/candidates/${harmlessC}/analyze/evidence`);
  check("T3 status", t3.status, 200);
  check("T3 evidenceCount", t3.json.data.evidenceCount, 0);
  check("T3 highSeverityCount", t3.json.data.highSeverityCount, 0);
  check("T3 hasHighSeverity", t3.json.data.hasHighSeverity, false);
  check("T3 unavailable", unavailableOf(t3.json.data), ["LOGO", "APP"]);

  /* ---- TEST 4: non-SOCIAL/APP candidate ---- */
  const t4 = await req("POST", `/api/candidates/${websiteC}/analyze/evidence`);
  check("T4 status", t4.status, 400);
  check("T4 success", t4.json.success, false);
  check("T4 error", t4.json.error, "ApiError");
  check("T4 code", t4.json.details && t4.json.details.code, "EVIDENCE_ANALYSIS_NOT_APPLICABLE");
  checkTrue("T4 message mentions SOCIAL and APP", /only applicable to SOCIAL and APP candidates/.test(t4.json.message));

  /* ---- failure paths ---- */
  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/evidence");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await req("POST", `/api/candidates/${orphan}/analyze/evidence`);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${socialC}/analyze/evidence`);
  check("GET on evidence route -> 404", wrongVerb.status, 404);

  /* ---- Task 6..10 regressions ---- */
  const name = await req("POST", `/api/candidates/${socialC}/analyze/name`);
  check("Task 6 name analysis status", name.status, 200);

  const text = await req("POST", `/api/candidates/${socialC}/analyze/text`);
  check("Task 7 text analysis status", text.status, 200);

  const logo = await req("POST", `/api/candidates/${socialC}/analyze/logo`);
  check("Task 8 logo analysis status", logo.status, 400);

  const social = await req("POST", `/api/candidates/${socialC}/analyze/social-risk`);
  check("Task 9 social-risk status", social.status, 200);

  const appRisk = await req("POST", `/api/candidates/${appC}/analyze/app-risk`);
  check("Task 10 app-risk status", appRisk.status, 200);

  /* ---- determinism ---- */
  const t1again = await req("POST", `/api/candidates/${socialC}/analyze/evidence`);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  console.log(`\nTask 11 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 11 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
