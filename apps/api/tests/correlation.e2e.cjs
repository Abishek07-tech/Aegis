/* Threat Correlation (Task 14) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/correlation.e2e.cjs */
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

const RESULT_KEYS = ["candidateId", "cluster", "relatedCandidates"];
const LINK_KEYS = ["explanation", "source", "strength", "type"];
const RELATED_KEYS = ["candidateId", "links", "relationshipLevel", "relationshipScore"];

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
  const mk = async (c, withBrand = true) => {
    const body = withBrand ? { ...c, brandId } : c;
    const r = await req("POST", "/api/candidates", body);
    if (r.status !== 201) throw new Error(`candidate create failed: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.data.id;
  };

  const c1 = await mk({
    type: "SOCIAL",
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description: "Official support. Verify at https://evil-pay.com/help",
  });
  const c2 = await mk({
    type: "SOCIAL",
    value: "@PaySecureHelp24",
    name: "PaySecure Help",
    description: "Refunds at https://evil-pay.com/help today",
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
    description: "Official account. https://paysecure.com",
  });
  const officialApp = await mk({
    type: "APP",
    value: "com.paysecure.wallet",
    name: "PaySecure Official",
    description: "The official PaySecure wallet.",
  });
  const externalDomain = await mk({ type: "DOMAIN", value: "evil-pay.com" });
  const officialWebsite = await mk({ type: "WEBSITE", value: "https://paysecure.com" });
  const website = await mk({ type: "WEBSITE", value: "https://example.com", name: "Example" });
  const orphan = await mk(
    { type: "SOCIAL", value: "@orphan_account", name: "Orphan" },
    false,
  );

  const correlate = async (id) => req("POST", `/api/candidates/${id}/analyze/correlation`);

  /* ---- TEST 1: valid candidate with multiple peers ---- */
  const t1 = await correlate(c1);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 candidateId", t1.json.data.candidateId, c1);
  check("T1 top-level keys", Object.keys(t1.json.data).sort(), RESULT_KEYS);
  check("T1 related ids", t1.json.data.relatedCandidates.map((r) => r.candidateId), [c2, externalDomain]);
  check("T1 strongest first", t1.json.data.relatedCandidates[0].candidateId, c2);
  check(
    "T1 strongest pair",
    [t1.json.data.relatedCandidates[0].relationshipScore, t1.json.data.relatedCandidates[0].relationshipLevel],
    [86, "VERY_HIGH"],
  );
  check(
    "T1 domain-only peer",
    [t1.json.data.relatedCandidates[1].relationshipScore, t1.json.data.relatedCandidates[1].relationshipLevel],
    [45, "MEDIUM"],
  );
  const t1pair = t1.json.data.relatedCandidates[0];
  check(
    "T1 pair link types",
    t1pair.links.map((l) => l.type),
    ["SHARED_DOMAIN", "SHARED_BRAND_IDENTITY", "SHARED_URL"],
  );
  checkTrue(
    "T1 entries have related keys",
    t1.json.data.relatedCandidates.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(RELATED_KEYS)),
  );
  checkTrue(
    "T1 links have link keys",
    t1.json.data.relatedCandidates.every((r) =>
      r.links.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(LINK_KEYS)),
    ),
  );
  checkTrue(
    "T1 scores within 0..100 + valid levels",
    t1.json.data.relatedCandidates.every(
      (r) =>
        Number.isInteger(r.relationshipScore) &&
        r.relationshipScore >= 0 &&
        r.relationshipScore <= 100 &&
        ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].includes(r.relationshipLevel),
    ),
  );
  checkTrue(
    "T1 no risk fields on correlation",
    JSON.stringify(t1.json.data).indexOf("riskScore") === -1 &&
      JSON.stringify(t1.json.data).indexOf("riskLevel") === -1,
  );
  check(
    "T1 cluster transitive",
    t1.json.data.cluster,
    { candidateIds: [c1, c2, externalDomain], size: 3 },
  );
  checkTrue(
    "T1 cluster starts with subject",
    t1.json.data.cluster.candidateIds[0] === c1,
  );
  checkTrue(
    "T1 explanations mention shared evidence",
    t1pair.links.some((l) => l.explanation.includes("evil-pay.com")),
  );

  /* ---- TEST 2: multiple candidates / unrelated candidates ---- */
  const t2 = await correlate(harmless);
  check("T2 status", t2.status, 200);
  check("T2 harmless subject unrelated", t2.json.data, {
    candidateId: harmless,
    relatedCandidates: [],
    cluster: { candidateIds: [harmless], size: 1 },
  });

  /* ---- TEST 3: official asset protection ---- */
  const t3 = await correlate(officialSocial);
  check("T3 status", t3.status, 200);
  check("T3 official social protected", [t3.json.data.relatedCandidates.length, t3.json.data.cluster.size], [0, 1]);

  const t3b = await correlate(officialApp);
  check("T3b official app protected", [t3b.json.data.relatedCandidates.length, t3b.json.data.cluster.size], [0, 1]);

  const t3c = await correlate(c1);
  checkTrue(
    "T3c official website peer excluded",
    !t3c.json.data.cluster.candidateIds.includes(officialWebsite),
  );
  checkTrue(
    "T3c official candidates excluded from cluster",
    !t3c.json.data.cluster.candidateIds.includes(officialSocial) &&
      !t3c.json.data.cluster.candidateIds.includes(officialApp),
  );
  const t3d = await correlate(externalDomain);
  check("T3d non-SOCIAL/APP subject -> 400", t3d.status, 400);
  check(
    "T3d code",
    t3d.json.details && t3d.json.details.code,
    "CORRELATION_NOT_APPLICABLE",
  );

  /* ---- TEST 4: empty correlation (subject only brand member eligible) ---- */
  const t4 = await correlate(harmless);
  check("T4 empty related list", t4.json.data.relatedCandidates, []);

  /* ---- failure paths ---- */
  const t5 = await correlate(website);
  check("T5 non-applicable type -> 400", t5.status, 400);
  check("T5 success", t5.json.success, false);
  check("T5 error", t5.json.error, "ApiError");
  check("T5 code", t5.json.details && t5.json.details.code, "CORRELATION_NOT_APPLICABLE");
  checkTrue(
    "T5 message mentions SOCIAL and APP",
    /only applicable to SOCIAL and APP candidates/.test(t5.json.message),
  );

  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/correlation");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await correlate(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${c1}/analyze/correlation`);
  check("GET on correlation route -> 404", wrongVerb.status, 404);

  /* ---- determinism ---- */
  const t1again = await correlate(c1);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  /* ---- Task 6–13 regressions ---- */
  const name = await req("POST", `/api/candidates/${c1}/analyze/name`);
  check("Task 6 name analysis", name.status, 200);
  const text = await req("POST", `/api/candidates/${c1}/analyze/text`);
  check("Task 7 text analysis", text.status, 200);
  const logo = await req("POST", `/api/candidates/${c1}/analyze/logo`);
  check("Task 8 logo analysis", logo.status, 400);
  const social = await req("POST", `/api/candidates/${c1}/analyze/social-risk`);
  check("Task 9 social-risk", social.status, 200);
  const appRisk = await req("POST", `/api/candidates/${officialApp}/analyze/app-risk`);
  check("Task 10 app-risk", appRisk.status, 200);
  const evidence = await req("POST", `/api/candidates/${c1}/analyze/evidence`);
  check("Task 11 evidence", evidence.status, 200);
  const risk = await req("POST", `/api/candidates/${c1}/analyze/risk`);
  check("Task 12 risk", risk.status, 200);
  const explanation = await req("POST", `/api/candidates/${c1}/analyze/explanation`);
  check("Task 13 explanation", explanation.status, 200);

  console.log(`\nTask 14 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 14 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
