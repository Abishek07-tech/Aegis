const path = require("path");
const fs = require("fs");

const reportPath = path.join(__dirname, "..", "dist", "services", "investigation-report.service.js");
const investigatorPath = path.join(__dirname, "..", "dist", "services", "ai-investigator.service.js");
const playbookPath = path.join(__dirname, "..", "dist", "services", "playbook.service.js");
if (!fs.existsSync(reportPath) || !fs.existsSync(investigatorPath) || !fs.existsSync(playbookPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  buildDeterministicReport,
  buildReportProviderRequest,
  computeReport,
  parseAIReportResponse,
  runReport,
} = require(reportPath);
const {
  assembleInvestigationInput,
  buildAIValidationContext,
  deterministicInvestigation,
} = require(investigatorPath);
const { derivePlaybook } = require(playbookPath);

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

/* ---------------- fixtures (same shape as Tasks 14–16) ---------------- */
const brand = { id: "b1", name: "PaySecure", website: "https://paysecure.com", logoUrl: null };
const assets = [
  { id: "a1", brandId: "b1", type: "SOCIAL", value: "@PaySecure", createdAt: new Date() },
  { id: "a2", brandId: "b1", type: "APP", value: "com.paysecure.wallet", createdAt: new Date() },
  { id: "a3", brandId: "b1", type: "DOMAIN", value: "paysecure.com", createdAt: new Date() },
  { id: "a4", brandId: "b1", type: "WEBSITE", value: "https://paysecure.com", createdAt: new Date() },
];
const cand = (id, type, over) => ({
  id, type, brandId: "b1", status: "PENDING",
  createdAt: new Date("2026-02-01T00:00:00.000Z"), updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  value: "", name: null, description: null, ...over,
});
const c1 = cand("c1", "SOCIAL", {
  value: "@PaySecure_Support",
  name: "PaySecure Support",
  description: "Official support. Verify at https://evil-pay.com/help",
});
const c2 = cand("c2", "SOCIAL", {
  value: "@PaySecureHelp24",
  name: "PaySecure Help",
  description: "Refunds at https://evil-pay.com/help today",
});
const ew = cand("ew", "DOMAIN", { value: "evil-pay.com" });
const app1 = cand("app1", "APP", {
  value: "com.paysecure.help",
  name: "PaySecure Wallet Pro",
  description: "Wallet Pro. Support at https://evil-pay.com/help",
});
const fan = cand("f1", "SOCIAL", {
  value: "@PaySecureFan1",
  name: "PaySecure Fan",
  description: "Fan community for students.",
});
const harmless = cand("c3", "SOCIAL", {
  value: "@travel_photos",
  name: "Student Travel Photography",
  description: "Photos.",
});
const official = cand("off", "SOCIAL", {
  value: "@PaySecure",
  name: "PaySecure",
  description: "Official account. https://paysecure.com",
});
const all = [c1, c2, ew, app1, fan, harmless, official];

const mkInput = (subject, candidates = all) =>
  assembleInvestigationInput(subject, brand, assets, candidates);

/* ---------------- key sets + hygiene patterns ---------------- */
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

const stripGenerated = ({ generatedAt, ...rest }) => rest;

const run = async () => {
  const inputC1 = await mkInput(c1);
  const inputApp = await mkInput(app1);
  const inputFan = await mkInput(fan);
  const inputHarmless = await mkInput(harmless);
  const inputOfficial = await mkInput(official);

  const inv1 = deterministicInvestigation(inputC1);
  const pb1 = derivePlaybook(inputC1);
  const rep1 = buildDeterministicReport(inputC1, inv1, pb1, "2026-01-01T00:00:00.000Z");

  /* ================= T1: report shape ================= */
  check("T1 top-level keys", Object.keys(rep1).sort(), [...TOP_KEYS].sort());
  check("T1 key insertion order", Object.keys(rep1), TOP_KEYS);
  check("T1 candidateId", rep1.candidateId, "c1");
  check("T1 generatedAt", rep1.generatedAt, "2026-01-01T00:00:00.000Z");
  check("T1 source", rep1.source, "DETERMINISTIC");

  /* ================= T2: executive summary (four deterministic sentences) ================= */
  const c1Sentences = rep1.executiveSummary.split(". ");
  check("T2 c1 summary is four sentences", c1Sentences.length, 4);
  checkTrue(
    "T2 sentence 1 traces risk + evidence breadth",
    c1Sentences[0].startsWith("PaySecure candidate PaySecure Support is assessed 100/100 CRITICAL with 7 evidence items across 4 independent sources"),
  );
  checkTrue(
    "T2 sentence 2 traces correlation + campaign",
    c1Sentences[1] === "It correlates with 4 other candidates and a detected CROSS_PLATFORM_IMPERSONATION campaign at 100/100",
  );
  checkTrue(
    "T2 sentence 3 traces investigation confidence + intent",
    c1Sentences[2] === "Investigation confidence is 95/100 (HIGH) with primary intent SUPPORT_SCAM_PATTERN",
  );
  checkTrue(
    "T2 sentence 4 traces playbook outlook",
    c1Sentences[3] === "6 predicted next actions recorded with overall playbook confidence 90/100.",
  );
  checkTrue(
    "T2 summary within prose cap",
    rep1.executiveSummary.length <= 1600,
  );

  /* ================= T3: risk assessment mirrors Task 12 ================= */
  check("T3 risk keys", Object.keys(rep1.riskAssessment).sort(), RISK_KEYS);
  check(
    "T3 risk values mirror input.risk",
    [rep1.riskAssessment.riskScore, rep1.riskAssessment.riskLevel, rep1.riskAssessment.confidence, rep1.riskAssessment.evidenceCount, rep1.riskAssessment.independentSourceCount],
    [inputC1.risk.riskScore, inputC1.risk.riskLevel, inputC1.risk.confidence, inputC1.risk.evidenceCount, inputC1.risk.independentSourceCount],
  );
  check("T3 reasons passed through", rep1.riskAssessment.reasons, inputC1.risk.reasons);

  /* ================= T4: key evidence mirrors Task 11 ================= */
  check("T4 key evidence keys", Object.keys(rep1.keyEvidence).sort(), KEY_EVIDENCE_KEYS);
  check(
    "T4 evidence values mirror input.evidence",
    [rep1.keyEvidence.evidenceCount, rep1.keyEvidence.highSeverityCount],
    [inputC1.evidence.evidenceCount, inputC1.evidence.highSeverityCount],
  );
  check("T4 evidence items passed through", rep1.keyEvidence.evidence, inputC1.evidence.evidence);
  check("T4 unavailable passed through", rep1.keyEvidence.unavailable, inputC1.evidence.unavailable);

  /* ================= T5: investigation field is Task 16's output ================= */
  check("T5 investigation equals deterministic investigation", rep1.investigation, inv1);
  check("T5 investigation source independent of report source", rep1.investigation.source, "DETERMINISTIC");

  /* ================= T6: campaign field is Task 15's output ================= */
  check("T6 campaign equals input.campaign", rep1.campaign, inputC1.campaign);
  checkTrue("T6 campaign detected for c1", rep1.campaign.campaignDetected === true);

  /* ================= T7: predictions equal Task 17 playbook output ================= */
  check("T7 predictedNextActions equals playbook predictions", rep1.predictedNextActions, pb1.predictions);
  check(
    "T7 c1 prediction pins",
    rep1.predictedNextActions.map((p) => [p.action, p.confidence]),
    [
      ["CREATE_LOOKALIKE_SOCIAL_ACCOUNT", 90],
      ["CREATE_IMPERSONATION_PAGE", 90],
      ["DISTRIBUTE_PHISHING_URL", 90],
      ["EXPAND_CAMPAIGN_TO_NEW_PLATFORM", 90],
      ["CREATE_FAKE_SUPPORT_ACCOUNT", 90],
      ["TARGET_VICTIMS_WITH_SUPPORT_LURE", 90],
    ],
  );

  /* ================= T8: attack path + recommended actions from Task 16 ================= */
  check("T8 attack path mirrors investigation", rep1.attackPath, inv1.attackPath);
  check("T8 recommended actions mirror investigation", rep1.recommendedActions, inv1.recommendedActions);
  checkTrue("T8 attack path non-empty for c1", rep1.attackPath.length === 5);

  /* ================= T9: merged uncertainties ================= */
  check(
    "T9 c1 merged uncertainty issues",
    rep1.uncertainties.map((u) => u.issue),
    ["Logo evidence unavailable", "Predictions are probabilistic"],
  );
  checkTrue(
    "T9 uncertainty keys",
    rep1.uncertainties.every((u) => JSON.stringify(Object.keys(u).sort()) === JSON.stringify(UNCERTAINTY_KEYS)),
  );
  checkTrue(
    "T9 why-not-flagged entries first when present",
    (() => {
      const officialReport = buildDeterministicReport(
        inputOfficial,
        deterministicInvestigation(inputOfficial),
        derivePlaybook(inputOfficial),
        "2026-01-01T00:00:00.000Z",
      );
      return officialReport.uncertainties[0].issue === "OFFICIAL_ACCOUNT_MATCH" &&
        officialReport.uncertainties[1].issue === "OFFICIAL_DOMAIN_MATCH";
    })(),
  );
  checkTrue(
    "T9 merged uncertainties deduplicated by issue",
    (() => {
      const report = buildDeterministicReport(
        inputHarmless,
        deterministicInvestigation(inputHarmless),
        derivePlaybook(inputHarmless),
        "2026-01-01T00:00:00.000Z",
      );
      const issues = report.uncertainties.map((u) => u.issue);
      return new Set(issues).size === issues.length;
    })(),
  );
  checkTrue(
    "T9 merged uncertainties capped at 12",
    [rep1].every((r) => r.uncertainties.length <= 12),
  );

  /* ================= T10: brand + asset projections ================= */
  check("T10 targetBrand keys", Object.keys(rep1.targetBrand).sort(), TARGET_BRAND_KEYS);
  check("T10 targetBrand values", rep1.targetBrand, { id: "b1", name: "PaySecure", website: "https://paysecure.com", logoRegistered: false });
  check("T10 candidateAsset keys", Object.keys(rep1.candidateAsset).sort(), CANDIDATE_ASSET_KEYS);
  check(
    "T10 candidateAsset values",
    rep1.candidateAsset,
    { id: "c1", type: "SOCIAL", value: "@PaySecure_Support", name: "PaySecure Support", description: "Official support. Verify at https://evil-pay.com/help", status: "PENDING" },
  );

  /* ================= T11: app report ================= */
  const inputAppReport = await computeReport(app1, brand, assets, all, null);
  check("T11 app report source", inputAppReport.source, "DETERMINISTIC");
  check("T11 app predictions pin", inputAppReport.predictedNextActions.map((p) => [p.action, p.confidence]), [
    ["PUBLISH_IMPERSONATING_APP", 90],
    ["EXPAND_CAMPAIGN_TO_NEW_PLATFORM", 90],
    ["CREATE_IMPERSONATION_PAGE", 81],
    ["DISTRIBUTE_PHISHING_URL", 81],
    ["DEPLOY_PHISHING_DOMAIN", 78],
  ]);
  const appSentences = inputAppReport.executiveSummary.split(". ");
  check("T11 app summary four sentences", appSentences.length, 4);
  checkTrue(
    "T11 app summary pins overall playbook confidence 84",
    inputAppReport.executiveSummary.includes("overall playbook confidence 84/100"),
  );

  /* ================= T12: fan report (related, no campaign) ================= */
  const fanReport = await computeReport(fan, brand, assets, all, null);
  const fanSentences = fanReport.executiveSummary.split(". ");
  check("T12 fan summary four sentences", fanSentences.length, 4);
  checkTrue(
    "T12 fan sentence 2 mentions related-only context",
    fanSentences[1] === "It correlates with 3 other candidates but no coordinated campaign was detected",
  );
  checkTrue(
    "T12 fan conclusion supports further investigation",
    fanReport.analystConclusion.startsWith("The available evidence supports further investigation"),
  );
  check(
    "T12 fan prediction parity with playbook",
    fanReport.predictedNextActions,
    derivePlaybook(inputFan).predictions,
  );

  /* ================= T13: official protection bounds the narrative ================= */
  const officialReport = await computeReport(official, brand, assets, all, null);
  check("T13 official predictions", officialReport.predictedNextActions, []);
  checkTrue(
    "T13 official conclusion is monitoring-bounded",
    officialReport.analystConclusion.startsWith("Official-asset protection (OFFICIAL_ACCOUNT_MATCH, OFFICIAL_DOMAIN_MATCH)") &&
      officialReport.analystConclusion.endsWith("continued monitoring rather than escalation."),
  );
  checkTrue(
    "T13 official summary carries protective clause + no-prediction sentence",
    officialReport.executiveSummary.includes("protective signals present: OFFICIAL_ACCOUNT_MATCH, OFFICIAL_DOMAIN_MATCH") &&
      officialReport.executiveSummary.endsWith("No playbook next actions are predicted for this candidate."),
  );
  checkTrue(
    "T13 official uncertainties begin with why-not-flagged signals",
    officialReport.uncertainties[0].issue === "OFFICIAL_ACCOUNT_MATCH",
  );

  /* ================= T14: weak evidence report ================= */
  const weakReport = await computeReport(harmless, brand, assets, all, null);
  const weakSentences = weakReport.executiveSummary.split(". ");
  check("T14 weak summary four sentences", weakSentences.length, 4);
  checkTrue(
    "T14 weak sentence 1 records zero evidence",
    weakSentences[0].includes("0/100 LOW with 0 evidence items across 0 independent sources"),
  );
  checkTrue(
    "T14 weak sentence 2 records no correlation",
    weakSentences[1] === "No correlated candidates or coordinated campaign were found for this asset",
  );
  checkTrue(
    "T14 weak conclusion is insufficient-evidence bounded",
    weakReport.analystConclusion.startsWith("The available evidence is insufficient to support a specific threat assessment"),
  );
  check(
    "T14 weak uncertainties start with Task 13 why-not-flagged",
    weakReport.uncertainties[0].issue,
    "INSUFFICIENT_EVIDENCE",
  );

  /* ================= T15: deterministic repeat ================= */
  const again = await computeReport(c1, brand, assets, all, null);
  const first = await computeReport(c1, brand, assets, all, null);
  check(
    "T15 report repeatable modulo generatedAt",
    JSON.stringify(stripGenerated(first)),
    JSON.stringify(stripGenerated(again)),
  );
  const reversed = await computeReport(c1, brand, assets, [...all].reverse(), null);
  check(
    "T15 input-order independent modulo generatedAt",
    JSON.stringify(stripGenerated(reversed)),
    JSON.stringify(stripGenerated(first)),
  );
  checkTrue("T15 generatedAt is a valid ISO timestamp", !Number.isNaN(Date.parse(first.generatedAt)));

  /* ================= T16: accepted model prose merges over the base ================= */
  const base16 = await computeReport(c1, brand, assets, all, null);
  const goodPayload = JSON.stringify({
    executiveSummary:
      "PaySecure candidate PaySecure Support is assessed 100/100 CRITICAL with 7 evidence items across 4 independent sources. The observed indicators suggest coordinated activity across 4 related candidates and a detected CROSS_PLATFORM_IMPERSONATION campaign at 100/100. Investigation confidence is 95/100 (HIGH) with primary intent SUPPORT_SCAM_PATTERN. 6 predicted next actions were recorded with overall playbook confidence 90/100.",
    analystConclusion:
      "The available evidence supports further investigation of this candidate: the observed indicators suggest coordinated impersonation activity against PaySecure across the supplied evidence.",
  });
  const mockGood = { name: "mock-good", complete: async () => goodPayload };
  const aiReport = await runReport(await mkInput(c1), mockGood);
  check("T16 AI source flagged", aiReport.source, "AI");
  check("T16 model executive summary adopted", aiReport.executiveSummary, JSON.parse(goodPayload).executiveSummary);
  check("T16 model analyst conclusion adopted", aiReport.analystConclusion, JSON.parse(goodPayload).analystConclusion);
  check("T16 structured risk untouched", aiReport.riskAssessment, base16.riskAssessment);
  check("T16 investigation untouched", aiReport.investigation, base16.investigation);
  check("T16 campaign untouched", aiReport.campaign, base16.campaign);
  check("T16 predictions untouched", aiReport.predictedNextActions, base16.predictedNextActions);
  check("T16 uncertainties untouched", aiReport.uncertainties, base16.uncertainties);
  check("T16 attack path untouched", aiReport.attackPath, base16.attackPath);
  check("T16 recommended actions untouched", aiReport.recommendedActions, base16.recommendedActions);
  check("T16 key evidence untouched", aiReport.keyEvidence, base16.keyEvidence);

  /* ================= T17: rejected model output falls back to base ================= */
  const rejections = [
    ["null", null],
    ["empty", ""],
    ["garbage", "not json {"],
    ["non-object", "[1,2]"],
    ["empty object", "{}"],
    ["wrong type", JSON.stringify({ executiveSummary: 5 })],
    ["unknown key", JSON.stringify({ assessmentExtra: "Evidence is consistent with activity." })],
    ["injected risk", JSON.stringify({ executiveSummary: "Evidence is consistent with activity.", riskScore: 0 })],
    ["verdict language", JSON.stringify({ analystConclusion: "This is definitely a scam." })],
    ["enforcement language", JSON.stringify({ analystConclusion: "Block the account immediately." })],
    ["invented domain", JSON.stringify({ executiveSummary: "See https://invented-scam.example for details." })],
    ["over-length", JSON.stringify({ executiveSummary: "x".repeat(1601) })],
  ];
  for (const [label, payload] of rejections) {
    const mock = { name: "mock-reject", complete: async () => payload };
    const out = await runReport(await mkInput(c1), mock);
    check(`T17 fallback on ${label}`, [out.source, JSON.stringify(stripGenerated(out))], ["DETERMINISTIC", JSON.stringify(stripGenerated(base16))]);
  }
  const throwing = { name: "throw", complete: async () => { throw new Error("provider down"); } };
  const thrown = await runReport(await mkInput(c1), throwing);
  check("T17 throwing provider → base", [thrown.source, JSON.stringify(stripGenerated(thrown))], ["DETERMINISTIC", JSON.stringify(stripGenerated(base16))]);
  const nulled = await runReport(await mkInput(c1), null);
  check("T17 null provider → base", [nulled.source, JSON.stringify(stripGenerated(nulled))], ["DETERMINISTIC", JSON.stringify(stripGenerated(base16))]);
  // A payload the investigation parser accepts but the report parser rejects:
  // investigation prose may become AI while the report narrative stays base.
  const invOnly = {
    name: "inv-only",
    complete: async () => JSON.stringify({ headline: "Evidence is consistent with activity." }),
  };
  const invOnlyReport = await runReport(await mkInput(c1), invOnly);
  check(
    "T17 report prose stays deterministic when only investigation prose passes",
    [invOnlyReport.source, invOnlyReport.investigation.source, invOnlyReport.executiveSummary, invOnlyReport.analystConclusion],
    ["DETERMINISTIC", "AI", base16.executiveSummary, base16.analystConclusion],
  );

  /* ================= T18: parser unit checks + prompt hygiene ================= */
  const ctx = buildAIValidationContext(inputC1, inv1);
  check("T18 parse null", parseAIReportResponse(null, ctx), null);
  check("T18 parse empty", parseAIReportResponse("", ctx), null);
  check("T18 parse garbage", parseAIReportResponse("not json {", ctx), null);
  check("T18 parse non-object", parseAIReportResponse("[1]", ctx), null);
  check("T18 parse empty object", parseAIReportResponse("{}", ctx), null);
  check("T18 parse unknown key", parseAIReportResponse(JSON.stringify({ assessment: "x" }), ctx), null);
  check(
    "T18 parse partial accept",
    parseAIReportResponse(JSON.stringify({ analystConclusion: "The available evidence supports continued monitoring." }), ctx),
    { analystConclusion: "The available evidence supports continued monitoring." },
  );
  const request = buildReportProviderRequest(await mkInput(c1), base16, ctx);
  checkTrue(
    "T18 system prompt states the rules",
    request.system.includes("Never invent evidence") && request.system.includes("Return valid structured JSON"),
  );
  const userJson = JSON.parse(request.user);
  check("T18 prompt keys", userJson.keys, ["executiveSummary", "analystConclusion"]);
  checkTrue("T18 prompt carries allowed domains", Array.isArray(userJson.allowedDomains) && userJson.allowedDomains.includes("evil-pay.com"));
  checkTrue("T18 prompt contains no provider secrets", !request.user.includes("sk-") && !request.system.includes("sk-"));

  /* ================= T19: prose hygiene across all reports ================= */
  const allReports = [rep1, inputAppReport, fanReport, officialReport, weakReport, first];
  const proseOf = (r) => [r.executiveSummary, r.analystConclusion,
    ...r.uncertainties.flatMap((u) => [u.issue, u.reason])];
  checkTrue(
    "T19 no absolute verdicts in report prose",
    allReports.every((r) => proseOf(r).every((text) => !FORBIDDEN.test(text))),
  );
  checkTrue(
    "T19 no enforcement recommendations in report prose",
    allReports.every((r) => [r.executiveSummary, r.analystConclusion].every((text) => !FORBIDDEN_ACTION.test(text))),
  );
  checkTrue(
    "T19 report prose domains are fixture domains",
    allReports.every((r) =>
      [r.executiveSummary, r.analystConclusion].every((text) =>
        domainTokens(text).every((token) => FIXTURE_DOMAINS.includes(token)),
      ),
    ),
  );
  checkTrue(
    "T19 conclusion within prose cap",
    allReports.every((r) => r.analystConclusion.length <= 1200),
  );

  console.log(`\nTask 18 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 18 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
