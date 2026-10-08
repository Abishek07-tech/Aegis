/* AI Investigation (Task 16) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/investigation.e2e.cjs */
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

const TOP_KEYS = ["candidateId", "investigation"];
const INVESTIGATION_KEYS = [
  "assessment", "attackPath", "campaignAssessment", "confidence", "confidenceLevel",
  "headline", "keyFindings", "recommendedActions", "secondaryIntents", "source",
  "strongestEvidence", "threatIntent", "uncertainties",
];
const KEY_FINDING_KEYS = ["evidence", "finding", "importance"];
const STRONGEST_KEYS = ["explanation", "signal", "source", "strength"];
const CAMPAIGN_ASSESS_KEYS = ["campaignType", "confidence", "detected", "explanation", "memberCount"];
const ATTACK_KEYS = ["evidence", "step"];
const UNCERTAINTY_KEYS = ["issue", "reason"];
const ACTION_KEYS = ["action", "priority", "reason"];
const INTENTS = [
  "UNKNOWN", "BRAND_IMPERSONATION", "ACCOUNT_IMPERSONATION", "APP_IMPERSONATION",
  "PHISHING_LURE", "SUPPORT_SCAM_PATTERN", "CREDENTIAL_TARGETING",
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
  const orphan = await mk(
    { type: "SOCIAL", value: "@orphan_account", name: "Orphan" },
    false,
  );

  const analyze = async (id) => req("POST", `/api/candidates/${id}/analyze/investigation`);
  const campaign = async (id) => req("POST", `/api/candidates/${id}/analyze/campaign`);

  const proseOf = (inv) => [
    inv.headline,
    inv.assessment,
    ...inv.keyFindings.flatMap((f) => [f.finding, f.evidence]),
    ...inv.strongestEvidence.map((s) => s.explanation),
    inv.campaignAssessment.explanation,
    ...inv.attackPath.map((s) => s.evidence),
    ...inv.uncertainties.flatMap((u) => [u.issue, u.reason]),
    ...inv.recommendedActions.flatMap((a) => [a.action, a.reason]),
  ].filter((t) => typeof t === "string" && t.length > 0);

  /* ---- TEST 1: valid investigation, exact key sets ---- */
  const t1 = await analyze(s1);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 top-level keys", Object.keys(t1.json.data).sort(), TOP_KEYS);
  check("T1 candidateId", t1.json.data.candidateId, s1);
  const inv1 = t1.json.data.investigation;
  check("T1 investigation keys", Object.keys(inv1).sort(), INVESTIGATION_KEYS);
  check("T1 source is deterministic without a provider key", inv1.source, "DETERMINISTIC");
  check("T1 threat intent", inv1.threatIntent, "SUPPORT_SCAM_PATTERN");
  check("T1 threat intent within enum", INTENTS.includes(inv1.threatIntent), true);
  checkTrue("T1 secondary intents are supported intents", inv1.secondaryIntents.every((i) => INTENTS.includes(i)));
  check("T1 confidence shape", [typeof inv1.confidence, Number.isInteger(inv1.confidence), inv1.confidence >= 0, inv1.confidence <= 100], ["number", true, true, true]);
  check("T1 confidence level consistent", [inv1.confidence, inv1.confidenceLevel], [95, "HIGH"]);
  checkTrue("T1 headline cites brand + campaign", inv1.headline.includes("PaySecure") && inv1.headline.includes("campaign confidence 100/100"));
  checkTrue("T1 assessment cautious + traces engines", /observed indicators suggest|available evidence/i.test(inv1.assessment) && inv1.assessment.includes("100/100 CRITICAL"));
  checkTrue("T1 key findings non-empty with keys", inv1.keyFindings.length >= 3 && inv1.keyFindings.every((f) => JSON.stringify(Object.keys(f).sort()) === JSON.stringify(KEY_FINDING_KEYS)));
  checkTrue("T1 strongest evidence keys", inv1.strongestEvidence.length > 0 && inv1.strongestEvidence.every((s) => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(STRONGEST_KEYS)));
  checkTrue("T1 attack path keys", inv1.attackPath.length > 0 && inv1.attackPath.every((s) => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(ATTACK_KEYS)));
  checkTrue("T1 uncertainties keys", inv1.uncertainties.length > 0 && inv1.uncertainties.every((u) => JSON.stringify(Object.keys(u).sort()) === JSON.stringify(UNCERTAINTY_KEYS)));
  checkTrue("T1 actions keys", inv1.recommendedActions.length > 0 && inv1.recommendedActions.every((a) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(ACTION_KEYS)));
  check("T1 campaign assessment keys", Object.keys(inv1.campaignAssessment).sort(), CAMPAIGN_ASSESS_KEYS);
  checkTrue("T1 no risk/confidence override fields", !JSON.stringify(inv1).includes('"riskScore"') && !JSON.stringify(inv1).includes('"riskLevel"'));

  /* ---- TEST 2: campaign-backed consistency with Task 15 ---- */
  const c1 = await campaign(s1);
  check("T2 campaign status", c1.status, 200);
  check(
    "T2 campaignAssessment mirrors Task 15 campaign endpoint",
    inv1.campaignAssessment,
    {
      detected: true,
      campaignType: c1.json.data.campaign.campaignType,
      confidence: c1.json.data.campaign.confidenceScore,
      memberCount: c1.json.data.campaign.assetCount,
      explanation: c1.json.data.explanation,
    },
  );
  check("T2 members counted", inv1.campaignAssessment.memberCount, c1.json.data.campaign.candidateIds.length);

  /* ---- TEST 3: investigation for a campaign member app ---- */
  const t3 = await analyze(app1);
  check("T3 status", t3.status, 200);
  const inv3 = t3.json.data.investigation;
  check("T3 threat intent is APP_IMPERSONATION", inv3.threatIntent, "APP_IMPERSONATION");
  check("T3 campaign detected", inv3.campaignAssessment.detected, true);
  checkTrue("T3 confidence high with strong evidence", inv3.confidence >= 70 && inv3.confidenceLevel === "HIGH");
  checkTrue("T3 no forbidden verdicts", proseOf(inv3).every((p) => !FORBIDDEN.test(p)));

  /* ---- TEST 4: no-campaign candidate ---- */
  const t4 = await analyze(harmless);
  check("T4 status", t4.status, 200);
  const inv4 = t4.json.data.investigation;
  check("T4 no campaign", [inv4.campaignAssessment.detected, inv4.campaignAssessment.campaignType, inv4.campaignAssessment.confidence], [false, null, null]);
  check("T4 campaign explanation", inv4.campaignAssessment.explanation, "No meaningful multi-asset correlation was found.");
  check("T4 unknown intent on no evidence", inv4.threatIntent, "UNKNOWN");
  check("T4 no attack path without evidence", inv4.attackPath, []);
  check("T4 low confidence", [inv4.confidence, inv4.confidenceLevel], [0, "LOW"]);

  /* ---- TEST 5: official asset protection ---- */
  const t5 = await analyze(officialSocial);
  check("T5 status", t5.status, 200);
  const inv5 = t5.json.data.investigation;
  check("T5 official attack path empty", inv5.attackPath, []);
  checkTrue("T5 official uncertainty cites protection", inv5.uncertainties.some((u) => u.issue === "Official asset protection present"));
  checkTrue("T5 official actions are low priority", inv5.recommendedActions.every((a) => a.priority === "LOW"));
  check("T5 official confidence is bounded", [inv5.confidence >= 0, inv5.confidence <= 69], [true, true]);
  const t5b = await analyze(officialApp);
  check("T5 official app status", t5b.status, 200);
  check("T5 official app no campaign", t5b.json.data.investigation.campaignAssessment.detected, false);

  /* ---- TEST 6: fan candidate — partial evidence ---- */
  const t6 = await analyze(fan);
  check("T6 status", t6.status, 200);
  const inv6 = t6.json.data.investigation;
  check("T6 fan brand impersonation intent", inv6.threatIntent, "BRAND_IMPERSONATION");
  check("T6 fan no campaign", inv6.campaignAssessment.detected, false);
  checkTrue("T6 fan path limited to identity + social", inv6.attackPath.every((s) => ["Impersonated brand identity", "User-facing social account"].includes(s.step)));

  /* ---- TEST 7: prose hygiene across all outputs ---- */
  const allInv = [inv1, inv3, inv4, inv5, inv6];
  checkTrue(
    "T7 no fake/scam/malicious/definitely/certainly in prose",
    allInv.every((inv) => proseOf(inv).every((p) => !FORBIDDEN.test(p))),
  );
  checkTrue(
    "T7 no enforcement actions recommended",
    allInv.every((inv) => inv.recommendedActions.every((a) => !FORBIDDEN_ACTION.test(a.action) && !FORBIDDEN_ACTION.test(a.reason))),
  );
  checkTrue(
    "T7 prose domains are real fixture domains",
    allInv.every((inv) =>
      proseOf(inv).every((text) =>
        (text.toLowerCase().match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [])
          .filter((token) => token.split(".").every((part) => part.length >= 2))
          .every((token) => ["evil-pay.com", "paysecure.com", "com.paysecure.help", "com.paysecure.wallet"].includes(token)),
      ),
    ),
  );

  /* ---- TEST 8: failure paths + endpoint wiring ---- */
  const missing = await analyze("does-not-exist");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const t8 = await analyze(website);
  check("non-applicable type -> 400", t8.status, 400);
  check("non-applicable success", t8.json.success, false);
  check("non-applicable code", t8.json.details && t8.json.details.code, "INVESTIGATION_NOT_APPLICABLE");
  checkTrue("non-applicable message mentions applicability", /SOCIAL|APP/.test(t8.json.message));

  const noBrand = await analyze(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${s1}/analyze/investigation`);
  check("GET on investigation route -> 404", wrongVerb.status, 404);

  /* ---- determinism ---- */
  const t1again = await analyze(s1);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  /* ---- Task 6–15 regressions ---- */
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
  const camp = await campaign(s1);
  check("Task 15 campaign", camp.status, 200);
  checkTrue(
    "Task 15 correlation cluster still matches campaign candidates",
    JSON.stringify(correlation.json.data.cluster.candidateIds.filter((id) =>
      camp.json.data.campaign.candidateIds.includes(id),
    ).sort()) === JSON.stringify([...camp.json.data.campaign.candidateIds].sort()),
  );

  console.log(`\nTask 16 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 16 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
