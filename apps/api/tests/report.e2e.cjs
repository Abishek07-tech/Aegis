/* AI Investigation Report (Task 18) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/report.e2e.cjs */
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

const TOP_KEYS = [
  "candidateId", "generatedAt", "executiveSummary", "targetBrand",
  "candidateAsset", "riskAssessment", "investigation", "campaign", "keyEvidence",
  "predictedNextActions", "attackPath", "uncertainties", "recommendedActions",
  "analystConclusion", "source",
];
const TARGET_BRAND_KEYS = ["id", "logoRegistered", "name", "website"];
const CANDIDATE_ASSET_KEYS = ["description", "id", "name", "status", "type", "value"];
const RISK_KEYS = ["confidence", "evidenceCount", "independentSourceCount", "reasons", "riskLevel", "riskScore"];
const KEY_EVIDENCE_KEYS = ["evidence", "evidenceCount", "highSeverityCount", "unavailable"];
const UNCERTAINTY_KEYS = ["issue", "reason"];
const FORBIDDEN = /\b(fake|scam|malicious|definitely|certainly)\b/i;
const FORBIDDEN_ACTION = /\b(ban|block|takedown|take down|suspend|remove the account|contact the platform|accuse)\b/i;
const FIXTURE_DOMAINS = ["evil-pay.com", "paysecure.com", "com.paysecure.help", "com.paysecure.wallet"];
const domainTokens = (text) =>
  (text.toLowerCase().match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/g) ?? [])
    .filter((token) => token.split(".").every((part) => part.length >= 2));

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

  const analyze = async (id) => req("POST", `/api/candidates/${id}/analyze/report`);
  const play = async (id) => req("POST", `/api/candidates/${id}/analyze/playbook`);
  const inv = async (id) => req("POST", `/api/candidates/${id}/analyze/investigation`);
  const campaign = async (id) => req("POST", `/api/candidates/${id}/analyze/campaign`);
  const riskOf = async (id) => req("POST", `/api/candidates/${id}/analyze/risk`);
  const evidenceOf = async (id) => req("POST", `/api/candidates/${id}/analyze/evidence`);

  /* ---- TEST 1: valid report, exact key set + order ---- */
  const t1 = await analyze(s1);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 top-level keys in order", Object.keys(t1.json.data), TOP_KEYS);
  check("T1 candidateId", t1.json.data.candidateId, s1);
  check("T1 source deterministic without a provider key", t1.json.data.source, "DETERMINISTIC");
  checkTrue("T1 generatedAt is a valid ISO timestamp", !Number.isNaN(Date.parse(t1.json.data.generatedAt)));
  const rep1 = t1.json.data;
  check("T1 targetBrand keys", Object.keys(rep1.targetBrand).sort(), TARGET_BRAND_KEYS);
  check("T1 candidateAsset keys", Object.keys(rep1.candidateAsset).sort(), CANDIDATE_ASSET_KEYS);
  check("T1 riskAssessment keys", Object.keys(rep1.riskAssessment).sort(), RISK_KEYS);
  check("T1 keyEvidence keys", Object.keys(rep1.keyEvidence).sort(), KEY_EVIDENCE_KEYS);

  /* ---- TEST 2: executive summary is four deterministic sentences ---- */
  const sentences = rep1.executiveSummary.split(". ");
  check("T2 four sentences", sentences.length, 4);
  checkTrue("T2 sentence 1 traces risk + breadth", sentences[0].includes("100/100 CRITICAL with 7 evidence items across 4 independent sources"));
  checkTrue("T2 sentence 2 traces campaign", sentences[1].includes("4 other candidates") && sentences[1].includes("CROSS_PLATFORM_IMPERSONATION campaign at 100/100"));
  checkTrue("T2 sentence 3 traces investigation confidence", sentences[2] === "Investigation confidence is 95/100 (HIGH) with primary intent SUPPORT_SCAM_PATTERN");
  checkTrue("T2 sentence 4 traces playbook outlook", sentences[3].includes("6 predicted next actions") && sentences[3].includes("90/100"));
  checkTrue("T2 summary within prose cap", rep1.executiveSummary.length <= 1600);

  /* ---- TEST 3: structured fields mirror their endpoints ---- */
  const riskRes = await riskOf(s1);
  check("T3 risk endpoint status", riskRes.status, 200);
  check(
    "T3 riskAssessment mirrors Task 12 endpoint",
    [rep1.riskAssessment.riskScore, rep1.riskAssessment.riskLevel, rep1.riskAssessment.confidence, rep1.riskAssessment.evidenceCount, rep1.riskAssessment.independentSourceCount],
    [riskRes.json.data.riskScore, riskRes.json.data.riskLevel, riskRes.json.data.confidence, riskRes.json.data.evidenceCount, riskRes.json.data.independentSourceCount],
  );
  const evidenceRes = await evidenceOf(s1);
  check("T3 evidence endpoint status", evidenceRes.status, 200);
  check(
    "T3 keyEvidence mirrors Task 11 endpoint",
    [rep1.keyEvidence.evidenceCount, rep1.keyEvidence.highSeverityCount],
    [evidenceRes.json.data.evidenceCount, evidenceRes.json.data.highSeverityCount],
  );
  check("T3 evidence items mirror endpoint", rep1.keyEvidence.evidence, evidenceRes.json.data.evidence);

  /* ---- TEST 4: investigation field mirrors Task 16 ---- */
  const invRes = await inv(s1);
  check("T4 investigation endpoint status", invRes.status, 200);
  check("T4 investigation mirrors Task 16 endpoint", rep1.investigation, invRes.json.data.investigation);
  check("T4 attack path mirrors investigation", rep1.attackPath, invRes.json.data.investigation.attackPath);
  check("T4 recommended actions mirror investigation", rep1.recommendedActions, invRes.json.data.investigation.recommendedActions);

  /* ---- TEST 5: campaign field mirrors Task 15 ---- */
  const campRes = await campaign(s1);
  check("T5 campaign endpoint status", campRes.status, 200);
  check("T5 campaign mirrors Task 15 endpoint", rep1.campaign, campRes.json.data);

  /* ---- TEST 6: predictions mirror Task 17 ---- */
  const pbRes = await play(s1);
  check("T6 playbook endpoint status", pbRes.status, 200);
  check("T6 predictedNextActions mirror Task 17 endpoint", rep1.predictedNextActions, pbRes.json.data.predictions);
  const pbApp = await play(app1);
  const repApp = await analyze(app1);
  check("T6 app predictions mirror playbook endpoint", repApp.json.data.predictedNextActions, pbApp.json.data.predictions);
  check("T6 app overall pinned", [repApp.json.data.predictedNextActions.map((p) => p.confidence), repApp.json.data.source], [[90, 90, 81, 81, 78], "DETERMINISTIC"]);

  /* ---- TEST 7: merged uncertainties ---- */
  check(
    "T7 c1 merged uncertainty issues",
    rep1.uncertainties.map((u) => u.issue),
    ["Logo evidence unavailable", "Predictions are probabilistic"],
  );
  checkTrue(
    "T7 uncertainty keys",
    rep1.uncertainties.every((u) => JSON.stringify(Object.keys(u).sort()) === JSON.stringify(UNCERTAINTY_KEYS)),
  );
  checkTrue("T7 capped at 12", rep1.uncertainties.length <= 12);

  /* ---- TEST 8: fan + weak + official narratives ---- */
  const fanReport = await analyze(fan);
  check("T8 fan status", fanReport.status, 200);
  const fanSentences = fanReport.json.data.executiveSummary.split(". ");
  check("T8 fan four sentences", fanSentences.length, 4);
  checkTrue("T8 fan related-only sentence", fanSentences[1].includes("3 other candidates") && fanSentences[1].includes("no coordinated campaign"));

  const weakReport = await analyze(harmless);
  check("T8 weak status", weakReport.status, 200);
  const weakSentences = weakReport.json.data.executiveSummary.split(". ");
  check("T8 weak four sentences", weakSentences.length, 4);
  checkTrue(
    "T8 weak conclusion bounded to monitoring",
    weakReport.json.data.analystConclusion.startsWith("The available evidence is insufficient"),
  );
  check("T8 weak uncertainties start with Task 13", weakReport.json.data.uncertainties[0].issue, "INSUFFICIENT_EVIDENCE");

  const offReport = await analyze(officialSocial);
  check("T8 official status", offReport.status, 200);
  const off = offReport.json.data;
  checkTrue(
    "T8 official conclusion is protection-bounded",
    off.analystConclusion.startsWith("Official-asset protection (OFFICIAL_ACCOUNT_MATCH, OFFICIAL_DOMAIN_MATCH)") &&
      off.analystConclusion.endsWith("continued monitoring rather than escalation."),
  );
  check("T8 official predictions suppressed", off.predictedNextActions, []);
  checkTrue(
    "T8 official summary ends with the no-prediction sentence",
    off.executiveSummary.endsWith("No playbook next actions are predicted for this candidate."),
  );
  check("T8 official uncertainties start with why-not-flagged", off.uncertainties[0].issue, "OFFICIAL_ACCOUNT_MATCH");

  const offAppReport = await analyze(officialApp);
  check("T8 official app status", offAppReport.status, 200);
  check("T8 official app predictions suppressed", offAppReport.json.data.predictedNextActions, []);

  /* ---- TEST 9: prose hygiene ---- */
  const allReports = [rep1, repApp.json.data, fanReport.json.data, weakReport.json.data, off];
  const proseOf = (r) => [r.executiveSummary, r.analystConclusion, ...r.uncertainties.flatMap((u) => [u.issue, u.reason])];
  checkTrue(
    "T9 no absolute verdicts in report prose",
    allReports.every((r) => proseOf(r).every((text) => !FORBIDDEN.test(text))),
  );
  checkTrue(
    "T9 no enforcement recommendations in the narrative",
    allReports.every((r) => !FORBIDDEN_ACTION.test(r.executiveSummary) && !FORBIDDEN_ACTION.test(r.analystConclusion)),
  );
  checkTrue(
    "T9 report prose domains are fixture domains",
    allReports.every((r) =>
      [r.executiveSummary, r.analystConclusion].every((text) =>
        domainTokens(text).every((token) => FIXTURE_DOMAINS.includes(token)),
      ),
    ),
  );

  /* ---- TEST 10: failure paths + endpoint wiring ---- */
  const missing = await analyze("does-not-exist");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const t10 = await analyze(website);
  check("non-applicable type -> 400", t10.status, 400);
  check("non-applicable success", t10.json.success, false);
  check("non-applicable code", t10.json.details && t10.json.details.code, "REPORT_NOT_APPLICABLE");
  checkTrue("non-applicable message mentions applicability", /SOCIAL|APP/.test(t10.json.message));

  const noBrand = await analyze(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${s1}/analyze/report`);
  check("GET on report route -> 404", wrongVerb.status, 404);

  /* ---- determinism modulo generatedAt ---- */
  const again = await analyze(s1);
  const strip = ({ generatedAt, ...rest }) => rest;
  check(
    "deterministic repeat modulo generatedAt",
    JSON.stringify(strip(again.json.data)),
    JSON.stringify(strip(rep1)),
  );

  /* ---- Task 6–17 regressions ---- */
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
  const evidence = await evidenceOf(s1);
  check("Task 11 evidence", evidence.status, 200);
  const risk = await riskOf(s1);
  check("Task 12 risk", risk.status, 200);
  const explanation = await req("POST", `/api/candidates/${s1}/analyze/explanation`);
  check("Task 13 explanation", explanation.status, 200);
  const correlation = await req("POST", `/api/candidates/${s1}/analyze/correlation`);
  check("Task 14 correlation", correlation.status, 200);
  const camp = await campaign(s1);
  check("Task 15 campaign", camp.status, 200);
  const invRes2 = await inv(s1);
  check("Task 16 investigation", invRes2.status, 200);
  const pbRes2 = await play(s1);
  check("Task 17 playbook", pbRes2.status, 200);
  checkTrue(
    "Task 17 playbook still pins six predictions",
    pbRes2.json.data.predictions.length === 6 && pbRes2.json.data.overallConfidence === 90,
  );

  console.log(`\nTask 18 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 18 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
