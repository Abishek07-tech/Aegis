/* Why Flagged / Why NOT Flagged explanations (Task 13) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/explanation.e2e.cjs */
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

  const explain = async (id) => req("POST", `/api/candidates/${id}/analyze/explanation`);

  /* ---- TEST 1: fake social → strong WHY FLAGGED ---- */
  const t1 = await explain(fakeSocial);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 candidateId", t1.json.data.candidateId, fakeSocial);
  check("T1 type", t1.json.data.type, "SOCIAL");
  check("T1 top-level keys", Object.keys(t1.json.data).sort(), RESULT_KEYS);
  check("T1 riskScore", t1.json.data.riskScore, 100);
  check("T1 riskLevel", t1.json.data.riskLevel, "CRITICAL");
  check("T1 confidence", t1.json.data.confidence, 0.95);
  check("T1 whyFlagged count", t1.json.data.whyFlagged.length, 7);
  check("T1 whyNotFlagged", t1.json.data.whyNotFlagged, []);
  check("T1 protectiveSignals", t1.json.data.protectiveSignals, []);
  checkTrue(
    "T1 summary strong evidence",
    /^Strong evidence: /.test(t1.json.data.summary) &&
      t1.json.data.summary.includes("100/100 CRITICAL"),
  );
  checkTrue(
    "T1 whyFlagged sorted strongest first",
    t1.json.data.whyFlagged.every((w, i, arr) => i === 0 || arr[i - 1].impact >= w.impact),
  );
  check(
    "T1 impacts sum to riskScore",
    t1.json.data.whyFlagged.reduce((s, w) => s + w.impact, 0),
    t1.json.data.riskScore,
  );
  checkTrue(
    "T1 entries have category/signal/source/impact/explanation",
    t1.json.data.whyFlagged.every(
      (w) =>
        typeof w.category === "string" &&
        typeof w.signal === "string" &&
        typeof w.source === "string" &&
        Number.isInteger(w.impact) &&
        typeof w.explanation === "string",
    ),
  );
  checkTrue(
    "T1 explanations embed real evidence",
    t1.json.data.whyFlagged.every((w) => w.explanation.includes("Evidence: ")),
  );

  /* ---- TEST 2: no divergence from Task 12 risk endpoint ---- */
  const t2 = await req("POST", `/api/candidates/${fakeSocial}/analyze/risk`);
  check("T2 risk endpoint status", t2.status, 200);
  check(
    "T2 riskScore matches risk endpoint",
    t1.json.data.riskScore,
    t2.json.data.riskScore,
  );
  check(
    "T2 riskLevel matches risk endpoint",
    t1.json.data.riskLevel,
    t2.json.data.riskLevel,
  );
  check(
    "T2 confidence matches risk endpoint",
    t1.json.data.confidence,
    t2.json.data.confidence,
  );
  check(
    "T2 counts match risk endpoint",
    [t1.json.data.evidenceCount, t1.json.data.independentSourceCount],
    [t2.json.data.evidenceCount, t2.json.data.independentSourceCount],
  );

  /* ---- TEST 3: harmless → WHY NOT FLAGGED (insufficient) ---- */
  const t3 = await explain(harmless);
  check("T3 status", t3.status, 200);
  check("T3 riskScore", t3.json.data.riskScore, 0);
  check("T3 whyFlagged", t3.json.data.whyFlagged, []);
  const insufficient = (t3.json.data.whyNotFlagged || []).find(
    (w) => w.signal === "INSUFFICIENT_EVIDENCE",
  );
  checkTrue("T3 insufficient entry present", Boolean(insufficient));
  checkTrue(
    "T3 explanation says insufficient",
    insufficient && /insufficient evidence to flag/.test(insufficient.explanation),
  );
  checkTrue(
    "T3 summary insufficient",
    t3.json.data.summary.startsWith("Insufficient evidence"),
  );

  /* ---- TEST 4: exact official social → protective ---- */
  const t4 = await explain(officialSocial);
  check("T4 status", t4.status, 200);
  checkTrue(
    "T4 protective signals",
    t4.json.data.protectiveSignals.includes("OFFICIAL_ACCOUNT_MATCH") &&
      t4.json.data.protectiveSignals.includes("OFFICIAL_DOMAIN_MATCH"),
  );
  checkTrue(
    "T4 summary prevents escalation",
    t4.json.data.summary.startsWith("Official/protective evidence prevents inappropriate escalation"),
  );
  const identity = t4.json.data.whyNotFlagged.find((w) => w.signal === "OFFICIAL_ACCOUNT_MATCH");
  check("T4 identity protection", identity && identity.protection, "Exact official identity match");
  checkTrue(
    "T4 identity explains cap",
    identity && identity.explanation.includes("bounded to at most 24/100"),
  );
  const domain = t4.json.data.whyNotFlagged.find((w) => w.signal === "OFFICIAL_DOMAIN_MATCH");
  check("T4 domain protection", domain && domain.protection, "Official domain match");
  checkTrue(
    "T4 domain explains reduction",
    domain && domain.explanation.includes("reduced the total risk by 25% (×0.75)"),
  );
  checkTrue(
    "T4 conflicting assessment present",
    t4.json.data.whyNotFlagged.some((w) => w.signal === "CONFLICTING_EVIDENCE"),
  );

  /* ---- TEST 5: exact official app → protective ---- */
  const t5 = await explain(officialApp);
  check("T5 status", t5.status, 200);
  check("T5 riskScore", t5.json.data.riskScore, 0);
  check("T5 protectiveSignals", t5.json.data.protectiveSignals, ["OFFICIAL_APP_MATCH"]);
  const appEntry = t5.json.data.whyNotFlagged.find((w) => w.signal === "OFFICIAL_APP_MATCH");
  check("T5 app protection", appEntry && appEntry.protection, "Exact official app match");
  checkTrue(
    "T5 app explanation",
    appEntry && appEntry.explanation.includes("treated as the official app"),
  );
  check("T5 whyFlagged empty", t5.json.data.whyFlagged, []);

  /* ---- TEST 6: fake app → strong WHY FLAGGED ---- */
  const t6 = await explain(fakeApp);
  check("T6 status", t6.status, 200);
  check("T6 riskScore", t6.json.data.riskScore, 95);
  check("T6 riskLevel", t6.json.data.riskLevel, "CRITICAL");
  checkTrue("T6 whyFlagged non-empty", t6.json.data.whyFlagged.length > 0);
  checkTrue(
    "T6 summary strong",
    t6.json.data.summary.startsWith("Strong evidence:"),
  );

  /* ---- failure paths ---- */
  const t7 = await explain(website);
  check("T7 non-applicable type -> 400", t7.status, 400);
  check("T7 success", t7.json.success, false);
  check("T7 error", t7.json.error, "ApiError");
  check(
    "T7 code",
    t7.json.details && t7.json.details.code,
    "EXPLANATION_NOT_APPLICABLE",
  );
  checkTrue(
    "T7 message mentions SOCIAL and APP",
    /only applicable to SOCIAL and APP candidates/.test(t7.json.message),
  );

  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/explanation");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await explain(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${fakeSocial}/analyze/explanation`);
  check("GET on explanation route -> 404", wrongVerb.status, 404);

  /* ---- invariants ---- */
  const all = [t1, t3, t4, t5, t6];
  checkTrue(
    "riskScore within 0..100 for all",
    all.every((r) => Number.isInteger(r.json.data.riskScore) && r.json.data.riskScore >= 0 && r.json.data.riskScore <= 100),
  );
  checkTrue(
    "confidence within 0..1 for all",
    all.every((r) => typeof r.json.data.confidence === "number" && r.json.data.confidence >= 0 && r.json.data.confidence <= 1),
  );
  checkTrue(
    "no fake/scam/malicious verdicts",
    !/\b(fake|scam|malicious)\b/i.test(all.map((r) => r.json.data.summary).join(" ")),
  );
  checkTrue(
    "no duplicate explanations in any response",
    all.every((r) => {
      const texts = [
        ...r.json.data.whyFlagged.map((w) => w.explanation),
        ...r.json.data.whyNotFlagged.map((w) => w.explanation),
      ];
      return new Set(texts).size === texts.length;
    }),
  );

  /* ---- Task 6–12 regressions ---- */
  const name = await req("POST", `/api/candidates/${fakeSocial}/analyze/name`);
  check("Task 6 name analysis", name.status, 200);
  const text = await req("POST", `/api/candidates/${fakeSocial}/analyze/text`);
  check("Task 7 text analysis", text.status, 200);
  const logo = await req("POST", `/api/candidates/${fakeSocial}/analyze/logo`);
  check("Task 8 logo analysis", logo.status, 400);
  const social = await req("POST", `/api/candidates/${fakeSocial}/analyze/social-risk`);
  check("Task 9 social-risk", social.status, 200);
  const appRisk = await req("POST", `/api/candidates/${fakeApp}/analyze/app-risk`);
  check("Task 10 app-risk", appRisk.status, 200);
  const evidence = await req("POST", `/api/candidates/${fakeSocial}/analyze/evidence`);
  check("Task 11 evidence", evidence.status, 200);
  const risk = await req("POST", `/api/candidates/${fakeSocial}/analyze/risk`);
  check("Task 12 risk", risk.status, 200);

  /* ---- determinism ---- */
  const t1again = await explain(fakeSocial);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  console.log(`\nTask 13 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 13 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
