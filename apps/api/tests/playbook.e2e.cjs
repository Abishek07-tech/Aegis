/* Adversary Playbook Prediction (Task 17) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/playbook.e2e.cjs */
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

const TOP_KEYS = ["candidateId", "limitations", "overallConfidence", "predictions"];
const PREDICTION_KEYS = ["action", "confidence", "rationale", "supportingSignals"];
const LIMITATION_KEYS = ["issue", "reason"];
const KNOWN_ACTIONS = [
  "CREATE_LOOKALIKE_SOCIAL_ACCOUNT", "CREATE_IMPERSONATION_PAGE", "DISTRIBUTE_PHISHING_URL",
  "PUBLISH_IMPERSONATING_APP", "EXPAND_CAMPAIGN_TO_NEW_PLATFORM", "CREATE_FAKE_SUPPORT_ACCOUNT",
  "TARGET_VICTIMS_WITH_SUPPORT_LURE", "DEPLOY_PHISHING_DOMAIN", "UNKNOWN_NEXT_STEP",
];
const FORBIDDEN = /\b(fake|scam|malicious|definitely|certainly)\b/i;
const FORBIDDEN_ACTION = /\b(ban|block|takedown|take down|suspend|remove the account|contact the platform|accuse)\b/i;

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

  const aSocial = await req("POST", `/api/brands/${brandId}/assets`, { type: "SOCIAL", value: "@PaySecure" });
  const aDomain = await req("POST", `/api/brands/${brandId}/assets`, { type: "DOMAIN", value: "paysecure.com" });
  const aWeb = await req("POST", `/api/brands/${brandId}/assets`, { type: "WEBSITE", value: "https://paysecure.com" });
  const aApp = await req("POST", `/api/brands/${brandId}/assets`, { type: "APP", value: "com.paysecure.wallet" });
  check("official assets created", [aSocial.status, aDomain.status, aWeb.status, aApp.status], [201, 201, 201, 201]);

  /* ---- candidates ---- */
  const mk = async (c, withBrand = true) => {
    const body = withBrand ? { ...c, brandId } : c;
    const r = await req("POST", "/api/candidates", body);
    if (r.status !== 201) throw new Error(`candidate create failed: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.data.id;
  };

  const s1 = await mk({
    type: "SOCIAL",
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description: "Official support. Verify at https://evil-pay.com/help",
  });
  const s2 = await mk({
    type: "SOCIAL",
    value: "@PaySecureHelp24",
    name: "PaySecure Help",
    description: "Refunds at https://evil-pay.com/help today",
  });
  const ew = await mk({ type: "DOMAIN", value: "evil-pay.com" });
  const app1 = await mk({
    type: "APP",
    value: "com.paysecure.help",
    name: "PaySecure Wallet Pro",
    description: "Wallet Pro. Support at https://evil-pay.com/help",
  });
  const fan = await mk({
    type: "SOCIAL",
    value: "@PaySecureFan1",
    name: "PaySecure Fan",
    description: "Fan community for students.",
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
  const website = await mk({ type: "WEBSITE", value: "https://example.com", name: "Example" });
  const orphan = await mk({ type: "SOCIAL", value: "@orphan_account", name: "Orphan" }, false);

  const analyze = async (id) => req("POST", `/api/candidates/${id}/analyze/playbook`);
  const report = async (id) => req("POST", `/api/candidates/${id}/analyze/report`);

  /* ---- TEST 1: valid playbook, exact key sets ---- */
  const t1 = await analyze(s1);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 top-level keys", Object.keys(t1.json.data).sort(), TOP_KEYS);
  check("T1 candidateId", t1.json.data.candidateId, s1);
  const pb1 = t1.json.data;
  checkTrue(
    "T1 prediction keys",
    pb1.predictions.length > 0 &&
      pb1.predictions.every((p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(PREDICTION_KEYS)),
  );
  checkTrue(
    "T1 limitation keys",
    pb1.limitations.length > 0 &&
      pb1.limitations.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(LIMITATION_KEYS)),
  );
  checkTrue(
    "T1 actions from fixed vocabulary",
    pb1.predictions.every((p) => KNOWN_ACTIONS.includes(p.action)),
  );
  checkTrue(
    "T1 predictions within cap + bounded confidence",
    pb1.predictions.length <= 6 &&
      pb1.predictions.every((p) => Number.isInteger(p.confidence) && p.confidence >= 0 && p.confidence <= 90) &&
      Number.isInteger(pb1.overallConfidence) &&
      pb1.overallConfidence >= 0 &&
      pb1.overallConfidence <= 90,
  );

  /* ---- TEST 2: c1 pins ---- */
  check(
    "T2 c1 action order",
    pb1.predictions.map((p) => p.action),
    [
      "CREATE_LOOKALIKE_SOCIAL_ACCOUNT",
      "CREATE_IMPERSONATION_PAGE",
      "DISTRIBUTE_PHISHING_URL",
      "EXPAND_CAMPAIGN_TO_NEW_PLATFORM",
      "CREATE_FAKE_SUPPORT_ACCOUNT",
      "TARGET_VICTIMS_WITH_SUPPORT_LURE",
    ],
  );
  check("T2 c1 confidences", pb1.predictions.map((p) => p.confidence), [90, 90, 90, 90, 90, 90]);
  check("T2 c1 overall", pb1.overallConfidence, 90);
  checkTrue(
    "T2 no phishing-domain deployment for the support-lure candidate",
    !pb1.predictions.some((p) => p.action === "DEPLOY_PHISHING_DOMAIN"),
  );

  /* ---- TEST 3: rationale + signal hygiene ---- */
  checkTrue(
    "T3 every rationale cites its action and stays within the cap",
    pb1.predictions.every((p) => p.rationale.includes(p.action) && p.rationale.length <= 500),
  );
  checkTrue(
    "T3 campaign + correlation clauses present",
    pb1.predictions[0].rationale.includes("CROSS_PLATFORM_IMPERSONATION campaign at 100/100") &&
      pb1.predictions[0].rationale.includes("4 correlated candidates"),
  );
  checkTrue(
    "T3 signals capped at 4",
    pb1.predictions.every((p) => p.supportingSignals.length <= 4),
  );
  checkTrue(
    "T3 disclaimer limitation first",
    pb1.limitations[0].issue === "Predictions are probabilistic",
  );

  /* ---- TEST 4: app member pins ---- */
  const t4 = await analyze(app1);
  check("T4 status", t4.status, 200);
  const pb4 = t4.json.data;
  check(
    "T4 app1 action order",
    pb4.predictions.map((p) => p.action),
    [
      "PUBLISH_IMPERSONATING_APP",
      "EXPAND_CAMPAIGN_TO_NEW_PLATFORM",
      "CREATE_IMPERSONATION_PAGE",
      "DISTRIBUTE_PHISHING_URL",
      "DEPLOY_PHISHING_DOMAIN",
    ],
  );
  check("T4 app1 confidences", pb4.predictions.map((p) => p.confidence), [90, 90, 81, 81, 78]);
  check("T4 app1 overall", pb4.overallConfidence, 84);

  /* ---- TEST 5: fan — partial evidence, no campaign ---- */
  const t5 = await analyze(fan);
  check("T5 status", t5.status, 200);
  const pb5 = t5.json.data;
  check("T5 fan single prediction", pb5.predictions.map((p) => [p.action, p.confidence]), [["CREATE_LOOKALIKE_SOCIAL_ACCOUNT", 90]]);
  checkTrue("T5 fan rationale has no campaign clause", !pb5.predictions[0].rationale.includes("campaign at"));

  /* ---- TEST 6: weak evidence → unknown placeholder ---- */
  const t6 = await analyze(harmless);
  check("T6 status", t6.status, 200);
  const pb6 = t6.json.data;
  check("T6 harmless unknown action", pb6.predictions.map((p) => p.action), ["UNKNOWN_NEXT_STEP"]);
  check("T6 harmless confidences", [pb6.predictions[0].confidence, pb6.overallConfidence], [0, 0]);
  checkTrue(
    "T6 insufficient-evidence limitation present",
    pb6.limitations.some((l) => l.issue === "Insufficient evidence for a specific prediction"),
  );

  /* ---- TEST 7: official-asset protection suppresses predictions ---- */
  const t7 = await analyze(officialSocial);
  check("T7 status", t7.status, 200);
  const pb7 = t7.json.data;
  check("T7 official predictions", pb7.predictions, []);
  check("T7 official overall", pb7.overallConfidence, 0);
  checkTrue(
    "T7 official-protection limitation present",
    pb7.limitations.some((l) => l.issue === "Official asset protection present" && l.reason.includes("OFFICIAL_ACCOUNT_MATCH")),
  );
  const t7b = await analyze(officialApp);
  check("T7 official app status", t7b.status, 200);
  check("T7 official app predictions", t7b.json.data.predictions, []);

  /* ---- TEST 8: cross-endpoint parity with the report ---- */
  const r1 = await report(s1);
  check("T8 report status", r1.status, 200);
  check(
    "T8 report predictedNextActions equals playbook endpoint output",
    r1.json.data.predictedNextActions,
    pb1.predictions,
  );
  const r2 = await report(app1);
  check(
    "T8 app report predictions equal playbook",
    r2.json.data.predictedNextActions,
    pb4.predictions,
  );

  /* ---- TEST 9: failure paths + endpoint wiring ---- */
  const missing = await analyze("does-not-exist");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const t9 = await analyze(website);
  check("non-applicable type -> 400", t9.status, 400);
  check("non-applicable success", t9.json.success, false);
  check("non-applicable code", t9.json.details && t9.json.details.code, "PLAYBOOK_NOT_APPLICABLE");
  checkTrue("non-applicable message mentions applicability", /SOCIAL|APP/.test(t9.json.message));

  const noBrand = await analyze(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${s1}/analyze/playbook`);
  check("GET on playbook route -> 404", wrongVerb.status, 404);

  /* ---- determinism ---- */
  const t1again = await analyze(s1);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  /* ---- Task 6–16 regressions ---- */
  const name = await req("POST", `/api/candidates/${s1}/analyze/name`);
  check("Task 6 name analysis", name.status, 200);
  const text = await req("POST", `/api/candidates/${s1}/analyze/text`);
  check("Task 7 text analysis", text.status, 200);
  const logo = await req("POST", `/api/candidates/${s1}/analyze/logo`);
  check("Task 8 logo analysis", logo.status, 400);
  const social = await req("POST", `/api/candidates/${s1}/analyze/social-risk`);
  check("Task 9 social-risk", social.status, 200);
  const appRisk = await req("POST", `/api/candidates/${officialApp}/analyze/app-risk`);
  check("Task 10 app-risk", appRisk.status, 200);
  const evidence = await req("POST", `/api/candidates/${s1}/analyze/evidence`);
  check("Task 11 evidence", evidence.status, 200);
  const risk = await req("POST", `/api/candidates/${s1}/analyze/risk`);
  check("Task 12 risk", risk.status, 200);
  const explanation = await req("POST", `/api/candidates/${s1}/analyze/explanation`);
  check("Task 13 explanation", explanation.status, 200);
  const correlation = await req("POST", `/api/candidates/${s1}/analyze/correlation`);
  check("Task 14 correlation", correlation.status, 200);
  const camp = await req("POST", `/api/candidates/${s1}/analyze/campaign`);
  check("Task 15 campaign", camp.status, 200);
  const inv = await req("POST", `/api/candidates/${s1}/analyze/investigation`);
  check("Task 16 investigation", inv.status, 200);
  checkTrue(
    "Task 16 investigation still detects the campaign",
    inv.json.data.investigation.campaignAssessment.detected === true,
  );

  /* ---- prose hygiene across all outputs ---- */
  const allPb = [pb1, pb4, pb5, pb6, pb7];
  checkTrue(
    "no absolute verdicts in rationales or limitations",
    allPb.every((pb) =>
      pb.predictions.every((p) => !FORBIDDEN.test(p.rationale)) &&
      pb.limitations.every((l) => !FORBIDDEN.test(l.issue) && !FORBIDDEN.test(l.reason)),
    ),
  );
  checkTrue(
    "no enforcement recommendations",
    allPb.every((pb) =>
      pb.predictions.every((p) => !FORBIDDEN_ACTION.test(p.rationale)) &&
      pb.limitations.every((l) => !FORBIDDEN_ACTION.test(l.reason)),
    ),
  );

  console.log(`\nTask 17 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 17 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
