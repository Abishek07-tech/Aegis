const path = require("path");
const fs = require("fs");

const servicePath = path.join(__dirname, "..", "dist", "services", "ai-investigator.service.js");
const campaignPath = path.join(__dirname, "..", "dist", "services", "campaign.service.js");
if (!fs.existsSync(servicePath) || !fs.existsSync(campaignPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  ATTACK_PATH_STEPS,
  buildAIValidationContext,
  buildProviderRequest,
  computeInvestigation,
  createOpenAICompatibleProvider,
  deterministicInvestigation,
  deriveInvestigationConfidence,
  deriveThreatIntent,
  domainTokens,
  getInvestigationConfidenceLevel,
  parseAIProviderResponse,
  readAIProviderConfig,
  resolveProvider,
  runInvestigation,
} = require(servicePath);
const { collectEvidence, buildEvidenceResult } = require(path.join(__dirname, "..", "dist", "services", "evidence.service.js"));
const { buildRiskResult } = require(path.join(__dirname, "..", "dist", "services", "risk-engine.service.js"));
const { buildExplanation } = require(path.join(__dirname, "..", "dist", "services", "explanation.service.js"));
const { buildCorrelationResult } = require(path.join(__dirname, "..", "dist", "services", "correlation.service.js"));
const { computeCampaignAnalysis } = require(campaignPath);

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

/* ---------------- fixtures (same shape as Tasks 14/15) ---------------- */
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

const mkInput = async (subject, candidates = all) => {
  const type = subject.type.toUpperCase();
  const { items, unavailable } = await collectEvidence(subject, brand, assets, type);
  const evidence = buildEvidenceResult(subject.id, type, items, unavailable);
  const risk = buildRiskResult(evidence);
  const explanation = buildExplanation(risk);
  const correlation = await buildCorrelationResult(subject, brand, assets, candidates);
  const campaign = await computeCampaignAnalysis(subject, brand, assets, candidates);
  return { candidate: subject, brand, officialAssets: assets, evidence, risk, explanation, correlation, campaign };
};

// minimal hand-built input for threat-intent rule unit tests
const minimalInput = (evidenceItems, over = {}) => ({
  candidate: { id: "m1", type: "SOCIAL", value: "@v", name: null, description: null, brandId: "b1", status: "PENDING", createdAt: null, updatedAt: null },
  brand,
  officialAssets: [],
  evidence: { candidateId: "m1", type: "SOCIAL", evidence: evidenceItems, evidenceCount: evidenceItems.length, highSeverityCount: 0, hasHighSeverity: false, unavailable: [] },
  risk: { candidateId: "m1", type: "SOCIAL", riskScore: 0, riskLevel: "LOW", confidence: 0, evidenceCount: evidenceItems.length, independentSourceCount: 1, reasons: [], evidence: evidenceItems, unavailable: [] },
  explanation: { candidateId: "m1", type: "SOCIAL", riskScore: 0, riskLevel: "LOW", confidence: 0, summary: "", whyFlagged: [], whyNotFlagged: [], protectiveSignals: [], evidenceCount: evidenceItems.length, independentSourceCount: 1 },
  correlation: { candidateId: "m1", relatedCandidates: [], cluster: { candidateIds: ["m1"], size: 1 } },
  campaign: { candidateId: "m1", campaignDetected: false, campaign: null, explanation: "No meaningful multi-asset correlation was found." },
  ...over,
});
const ev = (signal, severity = "HIGH", source = "SOCIAL") => ({
  source, signal, severity, score: severity === "HIGH" ? 1 : 0.7, reason: `reason for ${signal}`,
});

/* ---------------- key sets ---------------- */
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
const NO_CAMPAIGN_TEXT = "No meaningful multi-asset correlation was found.";
const FORBIDDEN = /\b(fake|scam|malicious|definitely|certainly)\b/i;
const FORBIDDEN_ACTION = /\b(ban|block|takedown|take down|suspend|remove the account|contact the platform|accuse)\b/i;
const ALL_STEPS = Object.values(ATTACK_PATH_STEPS);
const FIXTURE_DOMAINS = new Set([
  "evil-pay.com", "paysecure.com", "com.paysecure.help", "com.paysecure.wallet",
]);

const proseOf = (inv) => [
  inv.headline,
  inv.assessment,
  ...inv.keyFindings.flatMap((f) => [f.finding, f.evidence]),
  ...inv.strongestEvidence.map((s) => s.explanation),
  inv.campaignAssessment.explanation,
  ...inv.attackPath.map((s) => s.evidence),
  ...inv.uncertainties.flatMap((u) => [u.issue, u.reason]),
  ...inv.recommendedActions.flatMap((a) => [a.action, a.reason]),
].filter((text) => typeof text === "string" && text.length > 0);

const run = async () => {
  /* ---- input assembly (Tasks 11–15 consumed, not recomputed) ---- */
  const inputC1 = await mkInput(c1);
  const inv1 = deterministicInvestigation(inputC1);
  const inputApp = await mkInput(app1);
  const inv2 = deterministicInvestigation(inputApp);
  const inputFan = await mkInput(fan);
  const inv3 = deterministicInvestigation(inputFan);
  const inputHarmless = await mkInput(harmless);
  const inv4 = deterministicInvestigation(inputHarmless);
  const inputOfficial = await mkInput(official);
  const inv5 = deterministicInvestigation(inputOfficial);

  /* ================= T1: strong social impersonation + campaign ================= */
  check("T1 result keys", Object.keys({ candidateId: "c1", investigation: inv1 }).sort(), TOP_KEYS);
  check("T1 investigation keys", Object.keys(inv1).sort(), INVESTIGATION_KEYS);
  check("T1 source is deterministic fallback", inv1.source, "DETERMINISTIC");
  check("T1 threat intent", inv1.threatIntent, "SUPPORT_SCAM_PATTERN");
  check("T1 secondary intents", inv1.secondaryIntents, ["PHISHING_LURE", "BRAND_IMPERSONATION", "ACCOUNT_IMPERSONATION"]);
  check("T1 investigation confidence", [inv1.confidence, inv1.confidenceLevel], [95, "HIGH"]);
  checkTrue(
    "T1 headline uses cautious campaign language",
    inv1.headline.includes("evidence is consistent with a coordinated cross platform impersonation campaign") &&
      inv1.headline.includes("4 assets") &&
      inv1.headline.includes("campaign confidence 100/100") &&
      inv1.headline.includes("PaySecure"),
  );
  checkTrue(
    "T1 assessment traces risk + campaign + correlation",
    inv1.assessment.includes("The observed indicators suggest") &&
      inv1.assessment.includes("scores this candidate 100/100 CRITICAL") &&
      inv1.assessment.includes("4 related candidates") &&
      inv1.assessment.includes("strongest relationship 86/100 VERY_HIGH") &&
      inv1.assessment.includes("campaign confidence 100/100 (VERY_HIGH)") &&
      inv1.assessment.includes("SUPPORT_SCAM_PATTERN") &&
      inv1.assessment.includes("Investigation confidence 95/100 (HIGH)"),
  );
  check("T1 campaign assessment keys", Object.keys(inv1.campaignAssessment).sort(), CAMPAIGN_ASSESS_KEYS);
  check(
    "T1 campaign assessment mirrors Task 15",
    inv1.campaignAssessment,
    {
      detected: true,
      campaignType: inputC1.campaign.campaign.campaignType,
      confidence: inputC1.campaign.campaign.confidenceScore,
      memberCount: inputC1.campaign.campaign.assetCount,
      explanation: inputC1.campaign.explanation,
    },
  );
  check("T1 campaign members counted", inv1.campaignAssessment.memberCount, inputC1.campaign.campaign.candidateIds.length);
  check(
    "T1 attack path order",
    inv1.attackPath.map((s) => s.step),
    [ATTACK_PATH_STEPS.IDENTITY, ATTACK_PATH_STEPS.SOCIAL, ATTACK_PATH_STEPS.SUPPORT_LURE, ATTACK_PATH_STEPS.EXTERNAL_DOMAIN, ATTACK_PATH_STEPS.CAMPAIGN],
  );
  checkTrue(
    "T1 attack path steps carry real evidence",
    inv1.attackPath.every((s) => ATTACK_KEYS.every((k) => s[k] !== undefined) && s.evidence.length > 10),
  );
  check("T1 strongest evidence", inv1.strongestEvidence[0], {
    source: inputC1.evidence.evidence[0].source === "TEXT" ? inputC1.evidence.evidence.find((i) => i.signal === "TEXT_IDENTITY_MATCH").source : "TEXT",
    signal: "TEXT_IDENTITY_MATCH",
    strength: "HIGH",
    explanation: inputC1.evidence.evidence.find((i) => i.signal === "TEXT_IDENTITY_MATCH").reason,
  });
  check("T1 strongest evidence keys", Object.keys(inv1.strongestEvidence[0]).sort(), STRONGEST_KEYS);
  check("T1 strongest evidence capped", inv1.strongestEvidence.length <= 5, true);
  check("T1 uncertainties", inv1.uncertainties.map((u) => u.issue), ["Logo evidence unavailable"]);
  check("T1 uncertainty keys", Object.keys(inv1.uncertainties[0]).sort(), UNCERTAINTY_KEYS);
  check("T1 action keys", Object.keys(inv1.recommendedActions[0]).sort(), ACTION_KEYS);
  check(
    "T1 actions priority order",
    inv1.recommendedActions.map((a) => a.priority),
    ["HIGH", "HIGH", "HIGH", "HIGH", "MEDIUM", "MEDIUM"],
  );
  checkTrue(
    "T1 shared-domain review action cites the real domain",
    inv1.recommendedActions[0].action === "Review the shared external domain and URL infrastructure referenced by the campaign" &&
      inv1.recommendedActions[0].reason.includes("evil-pay.com"),
  );
  checkTrue(
    "T1 app verification action present",
    inv1.recommendedActions.some(
      (a) => a.action === "Verify the publisher or developer identity of the related application",
    ),
  );

  /* ================= T2: app impersonation ================= */
  check("T2 threat intent", inv2.threatIntent, "APP_IMPERSONATION");
  check("T2 secondary intents", inv2.secondaryIntents, ["PHISHING_LURE", "BRAND_IMPERSONATION"]);
  check("T2 confidence", [inv2.confidence, inv2.confidenceLevel], [96, "HIGH"]);
  checkTrue("T2 headline cautious", inv2.headline.includes("evidence is consistent with a coordinated"));
  check(
    "T2 attack path",
    inv2.attackPath.map((s) => s.step),
    [ATTACK_PATH_STEPS.IDENTITY, ATTACK_PATH_STEPS.APP_LISTING, ATTACK_PATH_STEPS.EXTERNAL_DOMAIN, ATTACK_PATH_STEPS.CAMPAIGN],
  );
  check("T2 campaign assessment", [inv2.campaignAssessment.detected, inv2.campaignAssessment.campaignType, inv2.campaignAssessment.confidence, inv2.campaignAssessment.memberCount], [true, "CROSS_PLATFORM_IMPERSONATION", 100, 4]);
  checkTrue("T2 key findings cite campaign + reasons", inv2.keyFindings.length >= 4 && inv2.keyFindings[0].importance === "HIGH");

  /* ================= T3: cross-platform campaign consistency ================= */
  check(
    "T3 campaignAssessment equals Task 15 output",
    [inv1.campaignAssessment.detected, inv1.campaignAssessment.campaignType, inv1.campaignAssessment.confidence, inv1.campaignAssessment.memberCount, inv1.campaignAssessment.explanation],
    [inputC1.campaign.campaignDetected, inputC1.campaign.campaign.campaignType, inputC1.campaign.campaign.confidenceScore, inputC1.campaign.campaign.assetCount, inputC1.campaign.explanation],
  );
  checkTrue(
    "T3 campaign finding first when detected",
    inv1.keyFindings[0].finding.startsWith("Coordinated campaign:") &&
      inv1.keyFindings[0].importance === "HIGH",
  );
  checkTrue(
    "T3 correlation consumed: related count in findings",
    inv1.keyFindings.some((f) => f.finding.includes("4 related candidates")),
  );

  /* ================= T4: shared suspicious infrastructure ================= */
  checkTrue(
    "T4 domain appears in findings + actions + assessment inputs",
    JSON.stringify(inv1.keyFindings).includes("evil-pay.com") &&
      JSON.stringify(inv1.recommendedActions).includes("evil-pay.com"),
  );
  checkTrue(
    "T4 verify-ownership action cites external domain reason",
    inv1.recommendedActions.some(
      (a) =>
        a.action === "Verify ownership of the referenced external infrastructure" &&
        a.reason.includes("external domain") &&
        a.reason.includes("evil-pay.com"),
    ),
  );

  /* ================= T5: weak evidence ================= */
  check("T5 intent unknown", [inv4.threatIntent, inv4.secondaryIntents], ["UNKNOWN", []]);
  check("T5 confidence", [inv4.confidence, inv4.confidenceLevel], [0, "LOW"]);
  check("T5 empty narrative sections", [inv4.keyFindings, inv4.strongestEvidence, inv4.attackPath], [[], [], []]);
  check("T5 campaign assessment", inv4.campaignAssessment, {
    detected: false, campaignType: null, confidence: null, memberCount: 0, explanation: NO_CAMPAIGN_TEXT,
  });
  checkTrue("T5 headline insufficient language", inv4.headline.includes("available evidence is insufficient"));
  checkTrue("T5 assessment insufficient language", inv4.assessment.includes("The available evidence does not support a specific threat intent"));
  check("T5 uncertainties", inv4.uncertainties.map((u) => u.issue), [
    "Logo evidence unavailable",
    "No shared infrastructure evidence",
    "No correlated candidates",
    "Limited evidence coverage",
    "Investigation confidence is LOW",
  ]);
  check("T5 single low-priority action", inv4.recommendedActions.map((a) => [a.priority, a.action]), [["LOW", "Continue monitoring this candidate"]]);
  checkTrue("T5 no risk fields in output", JSON.stringify(inv4).indexOf('"riskScore"') === -1 && JSON.stringify(inv4).indexOf('"riskLevel"') === -1);

  /* ================= T6: official asset protection ================= */
  check("T6 intent unknown", inv5.threatIntent, "UNKNOWN");
  check("T6 protective headline", inv5.headline.includes("protective official-asset evidence") && inv5.headline.includes("OFFICIAL_ACCOUNT_MATCH"), true);
  check("T6 no attack path against official", inv5.attackPath, []);
  check("T6 protective key finding", [inv5.keyFindings.length, inv5.keyFindings[0].importance], [1, "HIGH"]);
  checkTrue("T6 protective finding names signals", inv5.keyFindings[0].finding.includes("OFFICIAL_ACCOUNT_MATCH") && inv5.keyFindings[0].finding.includes("OFFICIAL_DOMAIN_MATCH"));
  checkTrue("T6 protective evidence text from Task 13", inv5.keyFindings[0].evidence.includes("official social identity"));
  check("T6 first uncertainty is protection", inv5.uncertainties[0].issue, "Official asset protection present");
  checkTrue("T6 assessment states bounded", inv5.assessment.includes("official-asset protection keeps the assessment bounded"));
  check("T6 only LOW actions", inv5.recommendedActions.every((a) => a.priority === "LOW"), true);
  check("T6 confidence ladder", [inv5.confidence, inv5.confidenceLevel], [52, "MEDIUM"]);

  /* ================= T7: no campaign ================= */
  check("T7 fan has no campaign assessment", [inv3.campaignAssessment.detected, inv3.campaignAssessment.campaignType, inv3.campaignAssessment.confidence, inv3.campaignAssessment.memberCount], [false, null, null, 0]);
  check("T7 fan no-campaign explanation", inv3.campaignAssessment.explanation, NO_CAMPAIGN_TEXT);
  check("T7 fan intent stays evidence-based", inv3.threatIntent, "BRAND_IMPERSONATION");
  check("T7 fan campaign finding absent", inv3.keyFindings.some((f) => f.finding.startsWith("Coordinated campaign:")), false);

  /* ================= T8/T9: missing logo + missing infrastructure ================= */
  checkTrue("T8 logo uncertainty everywhere logo unavailable", [inv1, inv2, inv3, inv4, inv5].every((inv) => inv.uncertainties.some((u) => u.issue === "Logo evidence unavailable")));
  checkTrue("T8 logo reason from Task 11", inv4.uncertainties.find((u) => u.issue === "Logo evidence unavailable").reason.includes("logo"));
  checkTrue("T9 no-infrastructure uncertainty", inv4.uncertainties.some((u) => u.issue === "No shared infrastructure evidence" && u.reason.includes("No external domain or URL")));
  checkTrue("T9 infrastructure present → no such uncertainty", !inv1.uncertainties.some((u) => u.issue === "No shared infrastructure evidence"));

  /* ================= T10: multiple strong findings ================= */
  checkTrue("T10 several findings on campaign input", inv1.keyFindings.length >= 4 && inv1.keyFindings.length <= 6);
  checkTrue("T10 mixed importances", inv1.keyFindings.some((f) => f.importance === "HIGH") && inv1.keyFindings.some((f) => f.importance === "MEDIUM"));
  checkTrue(
    "T10 every finding backed by evidence text",
    inv1.keyFindings.every((f) => KEY_FINDING_KEYS.every((k) => f[k] !== undefined) && f.evidence.length > 10),
  );
  checkTrue(
    "T10 finding signals trace to real evidence",
    inv1.keyFindings.every((f) =>
      f.finding.startsWith("Coordinated campaign:") ||
      f.finding.startsWith("Protective official evidence") ||
      /\d+ related candidates/.test(f.finding) ||
      inputC1.evidence.evidence.some((item) => f.finding.startsWith(`${item.signal} at `)),
    ),
  );

  /* ================= T11: uncertainty structure ================= */
  checkTrue(
    "T11 uncertainty keys + non-trivial reasons",
    [inv1, inv3, inv4, inv5].every((inv) =>
      inv.uncertainties.every((u) => UNCERTAINTY_KEYS.every((k) => u[k] !== undefined) && u.reason.length > 10),
    ),
  );
  checkTrue("T11 campaign-confidence uncertainty below HIGH", (() => {
    const synthetic = minimalInput([ev("NAME_SIMILARITY", "MEDIUM", "NAME")], {
      campaign: {
        candidateId: "m1",
        campaignDetected: true,
        campaign: {
          campaignId: "camp_deadbeef", campaignType: "SOCIAL_IMPERSONATION", confidenceScore: 45,
          confidenceLevel: "MEDIUM", candidateIds: ["m1", "m2"], assetCount: 2, platformCount: 1,
          socialAssetCount: 2, appAssetCount: 0, domainCount: 0, websiteCount: 0, relatedCandidateCount: 1,
          firstSeen: null, lastSeen: null, durationDays: null, relationships: [], indicators: [],
        },
        explanation: "2 candidate assets are linked by the same external domain x.example.",
      },
    });
    const inv = deterministicInvestigation(synthetic);
    return inv.uncertainties.some((u) => u.issue === "Campaign confidence below HIGH" && u.reason.includes("45/100"));
  })());

  /* ================= T12: recommended actions from evidence ================= */
  checkTrue(
    "T12 no enforcement actions anywhere",
    [inv1, inv2, inv3, inv4, inv5].every((inv) =>
      inv.recommendedActions.every((a) => !FORBIDDEN_ACTION.test(a.action) && !FORBIDDEN_ACTION.test(a.reason)),
    ),
  );
  checkTrue(
    "T12 actions only HIGH/MEDIUM/LOW with reasons",
    [inv1, inv2, inv3, inv4, inv5].every((inv) =>
      inv.recommendedActions.every(
        (a) => ["HIGH", "MEDIUM", "LOW"].includes(a.priority) && a.reason.length > 10,
      ),
    ),
  );
  checkTrue(
    "T12 preserve-evidence action on high-severity input",
    inv1.recommendedActions.some((a) => a.action === "Preserve screenshots and source evidence for this candidate"),
  );
  checkTrue(
    "T12 monitor action only without campaign",
    inv3.recommendedActions.some((a) => a.action === "Monitor related assets for coordinated behavior") &&
      !inv1.recommendedActions.some((a) => a.action === "Monitor related assets for coordinated behavior"),
  );

  /* ================= T13: no fabricated claims ================= */
  const allInvocations = [inv1, inv2, inv3, inv4, inv5];
  checkTrue(
    "T13 every prose domain exists in fixtures",
    allInvocations.every((inv) =>
      proseOf(inv).every((text) => domainTokens(text).every((token) => FIXTURE_DOMAINS.has(token))),
    ),
  );
  checkTrue(
    "T13 strongest evidence signals come from input evidence",
    [inv1, inv2, inv3, inv5].every((inv, index) => {
      const inputs = [inputC1, inputApp, inputFan, inputOfficial];
      return inv.strongestEvidence.every((entry) =>
        inputs[index].evidence.evidence.some((item) => item.signal === entry.signal && item.source === entry.source),
      );
    }),
  );
  checkTrue(
    "T13 attack steps use the fixed vocabulary",
    allInvocations.every((inv) => inv.attackPath.every((s) => ALL_STEPS.includes(s.step))),
  );
  checkTrue(
    "T13 campaign explanation is Task 15's own text",
    inv1.campaignAssessment.explanation === inputC1.campaign.explanation,
  );

  /* ================= T14: no absolute verdicts ================= */
  checkTrue(
    "T14 no fake/scam/malicious/definitely/certainly in any prose",
    allInvocations.every((inv) => proseOf(inv).every((text) => !FORBIDDEN.test(text))),
  );
  checkTrue(
    "T14 cautious phrases present in assessments",
    allInvocations.every((inv) => /Evidence is consistent with|observed indicators suggest|available evidence/i.test(inv.assessment)),
  );
  checkTrue(
    "T14 no risk/confidence override fields",
    allInvocations.every((inv) => {
      const keys = new Set(Object.keys(inv));
      return !keys.has("riskScore") && !keys.has("riskLevel") && !keys.has("riskConfidence");
    }),
  );

  /* ================= T15: deterministic fallback ================= */
  check("T15 no key → no config", readAIProviderConfig({}), null);
  check("T15 empty key → no config", readAIProviderConfig({ AEGIS_AI_API_KEY: "   " }), null);
  check("T15 resolve without key", resolveProvider({}), null);
  const cfg = readAIProviderConfig({ AEGIS_AI_API_KEY: "sk-test-123", AEGIS_AI_TIMEOUT_MS: "abc" });
  check("T15 config defaults", [cfg.apiKey, cfg.baseUrl, cfg.model, cfg.timeoutMs], ["sk-test-123", "https://api.openai.com/v1", "gpt-4o-mini", 8000]);
  check("T15 forced-null provider → fallback", (await runInvestigation(inputC1, null)).source, "DETERMINISTIC");
  const base1 = deterministicInvestigation(inputC1);
  check("T15 fallback equals pure investigator", JSON.stringify(await runInvestigation(inputC1, null)), JSON.stringify(base1));

  /* ================= T16: same input → same output ================= */
  check("T16 repeated deterministic investigation", JSON.stringify(deterministicInvestigation(inputC1)), JSON.stringify(deterministicInvestigation(await mkInput(c1))));
  const computedA = await computeInvestigation(c1, brand, assets, all);
  const computedB = await computeInvestigation(c1, brand, assets, [...all].reverse());
  check("T16 computeInvestigation deterministic", JSON.stringify(computedA), JSON.stringify(computedB));
  check("T16 computeInvestigation source", computedA.investigation.source, "DETERMINISTIC");
  checkTrue("T16 confidence integer in bounds", Number.isInteger(computedA.investigation.confidence) && computedA.investigation.confidence >= 0 && computedA.investigation.confidence <= 100);
  check(
    "T16 confidence ladder",
    [getInvestigationConfidenceLevel(0), getInvestigationConfidenceLevel(39), getInvestigationConfidenceLevel(40), getInvestigationConfidenceLevel(69), getInvestigationConfidenceLevel(70), getInvestigationConfidenceLevel(100)],
    ["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH"],
  );
  check("T16 confidence never equals 0..1 risk confidence semantics", [inputC1.risk.confidence <= 1, inv1.confidence >= 50], [true, true]);
  check("T16 campaign confidence pass-through only", inv1.campaignAssessment.confidence, inputC1.campaign.campaign.confidenceScore);

  /* ================= T17: threat intent selection ================= */
  const t = (items) => deriveThreatIntent(minimalInput(items));
  check("T17 support+domain → SUPPORT_SCAM_PATTERN", t([ev("SUPPORT_LANGUAGE", "MEDIUM"), ev("EXTERNAL_DOMAIN", "MEDIUM"), ev("NAME_SIMILARITY", "HIGH", "NAME")]).primary, "SUPPORT_SCAM_PATTERN");
  check("T17 domain+identity → PHISHING_LURE", t([ev("EXTERNAL_DOMAIN", "MEDIUM"), ev("NAME_SIMILARITY", "HIGH", "NAME")]).primary, "PHISHING_LURE");
  check("T17 support-only + handle → ACCOUNT_IMPERSONATION", t([ev("SUPPORT_LANGUAGE", "MEDIUM"), ev("NAME_SIMILARITY", "HIGH", "NAME")]).primary, "ACCOUNT_IMPERSONATION");
  check("T17 brand material → BRAND_IMPERSONATION", t([ev("TEXT_IDENTITY_MATCH", "HIGH", "TEXT")]).primary, "BRAND_IMPERSONATION");
  check("T17 app identity → APP_IMPERSONATION", deriveThreatIntent(minimalInput([ev("PACKAGE_IDENTIFIER_SIMILARITY", "MEDIUM", "APP")], { evidence: { candidateId: "m1", type: "APP", evidence: [ev("PACKAGE_IDENTIFIER_SIMILARITY", "MEDIUM", "APP")], evidenceCount: 1, highSeverityCount: 0, hasHighSeverity: false, unavailable: [] }, risk: { candidateId: "m1", type: "APP", riskScore: 0, riskLevel: "LOW", confidence: 0, evidenceCount: 1, independentSourceCount: 1, reasons: [], evidence: [ev("PACKAGE_IDENTIFIER_SIMILARITY", "MEDIUM", "APP")], unavailable: [] }, explanation: { candidateId: "m1", type: "APP", riskScore: 0, riskLevel: "LOW", confidence: 0, summary: "", whyFlagged: [], whyNotFlagged: [], protectiveSignals: [], evidenceCount: 1, independentSourceCount: 1 } })).primary, "APP_IMPERSONATION");
  check("T17 weak name only → UNKNOWN", t([ev("NAME_SIMILARITY", "LOW", "NAME")]).primary, "UNKNOWN");
  check("T17 no evidence → UNKNOWN", t([]).primary, "UNKNOWN");
  check("T17 identity without channel not ACCOUNT", t([ev("NAME_SIMILARITY", "HIGH", "NAME"), ev("OFFICIAL_IDENTITY_CONFLICT", "HIGH")]).primary, "UNKNOWN");
  checkTrue("T17 supported list is priority ordered", (() => {
    const s = t([ev("SUPPORT_LANGUAGE", "MEDIUM"), ev("EXTERNAL_DOMAIN", "MEDIUM"), ev("NAME_SIMILARITY", "HIGH", "NAME"), ev("TEXT_IDENTITY_MATCH", "HIGH", "TEXT")]).supported;
    return JSON.stringify(s) === JSON.stringify(["SUPPORT_SCAM_PATTERN", "PHISHING_LURE", "BRAND_IMPERSONATION", "ACCOUNT_IMPERSONATION"]);
  })());
  checkTrue(
    "T17 CREDENTIAL_TARGETING never emitted",
    [...allInvocations].every((inv) => inv.threatIntent !== "CREDENTIAL_TARGETING") &&
      t([ev("NAME_SIMILARITY", "HIGH", "NAME"), ev("EXTERNAL_DOMAIN", "MEDIUM"), ev("SUPPORT_LANGUAGE", "MEDIUM")]).primary !== "CREDENTIAL_TARGETING",
  );
  checkTrue(
    "T17 official → UNKNOWN",
    inv5.threatIntent === "UNKNOWN" && deriveThreatIntent(inputOfficial).supported.length === 0,
  );

  /* ================= T18: attack path only supported evidence ================= */
  checkTrue(
    "T18 no support lure without SUPPORT_LANGUAGE evidence",
    allInvocations.every((inv) => {
      const hasSupport = inv.attackPath.some((s) => s.step === ATTACK_PATH_STEPS.SUPPORT_LURE);
      const hasSupportEvidence = (inv.threatIntent !== undefined) && proseOf(inv).some((p) => p.includes("SUPPORT_LANGUAGE")) ;
      return !hasSupport || hasSupportEvidence;
    }),
  );
  checkTrue(
    "T18 no external-domain step without EXTERNAL_DOMAIN evidence",
    allInvocations.every((inv) => {
      if (!inv.attackPath.some((s) => s.step === ATTACK_PATH_STEPS.EXTERNAL_DOMAIN)) return true;
      return JSON.stringify(inv.strongestEvidence).includes("EXTERNAL_DOMAIN") || JSON.stringify(inv.keyFindings).includes("EXTERNAL_DOMAIN");
    }),
  );
  checkTrue(
    "T18 weak/official inputs produce no path",
    inv4.attackPath.length === 0 && inv5.attackPath.length === 0,
  );
  checkTrue(
    "T18 fan path has no lure/domain/campaign steps",
    inv3.attackPath.every((s) => [ATTACK_PATH_STEPS.IDENTITY, ATTACK_PATH_STEPS.SOCIAL].includes(s.step)),
  );
  checkTrue(
    "T18 path order follows canonical order",
    allInvocations.every((inv) => {
      const idx = inv.attackPath.map((s) => ALL_STEPS.indexOf(s.step));
      return idx.every((value, i) => i === 0 || idx[i - 1] < value);
    }),
  );

  /* ================= T19: invalid/empty AI output falls back safely ================= */
  const ctx = buildAIValidationContext(inputC1, base1);
  check("T19 parse null", parseAIProviderResponse(null, ctx), null);
  check("T19 parse empty", parseAIProviderResponse("", ctx), null);
  check("T19 parse garbage", parseAIProviderResponse("not json {", ctx), null);
  check("T19 parse non-object", parseAIProviderResponse("[1,2]", ctx), null);
  check("T19 parse wrong type field", parseAIProviderResponse(JSON.stringify({ headline: 5 }), ctx), null);
  check("T19 parse unknown key", parseAIProviderResponse(JSON.stringify({ confidence: 100 }), ctx), null);
  check("T19 parse empty object", parseAIProviderResponse("{}", ctx), null);
  check("T19 parse invented domain", parseAIProviderResponse(JSON.stringify({ headline: "See https://invented-scam.example for details" }), ctx), null);
  check("T19 parse verdict language", parseAIProviderResponse(JSON.stringify({ assessment: "This is definitely a scam." }), ctx), null);
  for (const [label, payload] of [
    ["null content", null],
    ["empty string", ""],
    ["garbage", "not json {"],
    ["wrong types", JSON.stringify({ headline: 5 })],
    ["unknown keys", JSON.stringify({ confidence: 99, riskScore: 5 })],
  ]) {
    const mock = { name: "mock", complete: async () => payload };
    const out = await runInvestigation(inputC1, mock);
    check(`T19 fallback on ${label}`, [out.source, JSON.stringify(out)], ["DETERMINISTIC", JSON.stringify(base1)]);
  }
  const throwing = { name: "throw", complete: async () => { throw new Error("provider down"); } };
  check("T19 throwing provider → fallback", JSON.stringify(await runInvestigation(inputC1, throwing)), JSON.stringify(base1));

  // transport-level failures (mocked fetch — no live calls)
  const req = { system: "s", user: "u" };
  const providerConfig = { apiKey: "sk-live-secret", baseUrl: "https://api.example.com/v1/", model: "m1", timeoutMs: 1000 };
  const calls = [];
  const okFetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ headline: "Evidence is consistent with activity." }) } }] }) };
  };
  const okProvider = createOpenAICompatibleProvider(providerConfig, okFetch);
  const content = await okProvider.complete(req);
  check("T19 transport returns content", JSON.parse(content).headline, "Evidence is consistent with activity.");
  check("T19 endpoint URL", calls[0].url, "https://api.example.com/v1/chat/completions");
  check("T19 auth header", calls[0].options.headers.Authorization, "Bearer sk-live-secret");
  checkTrue("T19 key never in body", !calls[0].options.body.includes("sk-live-secret"));
  const badStatus = createOpenAICompatibleProvider(providerConfig, async () => ({ ok: false, status: 500, json: async () => ({}) }));
  check("T19 non-2xx → null", await badStatus.complete(req), null);
  const throwingFetch = createOpenAICompatibleProvider(providerConfig, async () => { throw new Error("ECONNREFUSED"); });
  check("T19 network error → null", await throwingFetch.complete(req), null);
  const badPayload = createOpenAICompatibleProvider(providerConfig, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 42 } }] }) }));
  check("T19 non-string content → null", await badPayload.complete(req), null);
  const timeoutFetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const timeoutProvider = createOpenAICompatibleProvider({ ...providerConfig, timeoutMs: 15 }, timeoutFetch);
  check("T19 timeout → null", await timeoutProvider.complete(req), null);

  /* ================= T20: AI output cannot override structured facts ================= */
  for (const [label, payload] of [
    ["unsupported intent", JSON.stringify({ threatIntent: "CREDENTIAL_TARGETING" })],
    ["injected confidence", JSON.stringify({ headline: "Evidence is consistent with activity.", confidence: 1 })],
    ["injected campaign", JSON.stringify({ campaignAssessment: { detected: false } })],
    ["injected risk fields", JSON.stringify({ assessment: "Risk is 0/100 LOW.", riskScore: 0, riskLevel: "LOW" })],
    ["invented attack step", JSON.stringify({ attackPath: [{ step: "Credential theft", evidence: "assumed" }] })],
    ["forged finding importance", JSON.stringify({ keyFindings: [{ finding: "x", evidence: "y", importance: "CRITICAL" }] })],
  ]) {
    const mock = { name: "mock", complete: async () => payload };
    const out = await runInvestigation(inputC1, mock);
    check(`T20 rejected: ${label}`, [out.source, JSON.stringify(out)], ["DETERMINISTIC", JSON.stringify(base1)]);
  }
  const accepted = {
    name: "mock",
    complete: async () =>
      JSON.stringify({
        headline: "Evidence is consistent with coordinated impersonation activity against PaySecure.",
        assessment: "The observed indicators suggest coordination across the supplied evidence.",
        threatIntent: "PHISHING_LURE",
        keyFindings: [{ finding: "Shared infrastructure observed", evidence: "Both candidates reference evil-pay.com.", importance: "HIGH" }],
        recommendedActions: [{ priority: "MEDIUM", action: "Review the shared infrastructure", reason: "evil-pay.com is shared across candidates." }],
      }),
  };
  const out20 = await runInvestigation(inputC1, accepted);
  check("T20 accepted model interpretation flagged", out20.source, "AI");
  check("T20 model headline adopted", out20.headline, "Evidence is consistent with coordinated impersonation activity against PaySecure.");
  check("T20 model intent within supported set", out20.threatIntent, "PHISHING_LURE");
  check("T20 structured confidence untouched", [out20.confidence, out20.confidenceLevel], [base1.confidence, base1.confidenceLevel]);
  check("T20 campaign assessment untouched", out20.campaignAssessment, base1.campaignAssessment);
  check("T20 strongest evidence untouched", out20.strongestEvidence, base1.strongestEvidence);
  check("T20 base key findings retained", out20.keyFindings[0], base1.keyFindings[0]);
  check("T20 model finding appended", out20.keyFindings.some((f) => f.finding === "Shared infrastructure observed"), true);
  checkTrue("T20 model prose still verdict-scanned", !FORBIDDEN.test(out20.headline) && !FORBIDDEN.test(out20.assessment));
  const officialCtx = buildAIValidationContext(inputOfficial, deterministicInvestigation(inputOfficial));
  check(
    "T20 official input allows no attack steps",
    parseAIProviderResponse(JSON.stringify({ attackPath: [{ step: ATTACK_PATH_STEPS.CAMPAIGN, evidence: "x" }] }), officialCtx),
    null,
  );

  /* ---- provider prompt hygiene ---- */
  const request = buildProviderRequest(inputC1, ctx);
  checkTrue("T21 system prompt states the rules", request.system.includes("Never invent evidence") && request.system.includes("Return valid structured JSON"));
  const userJson = JSON.parse(request.user);
  checkTrue("T21 prompt carries allowed intents + steps", JSON.stringify(userJson.allowedIntents).includes("SUPPORT_SCAM_PATTERN") && userJson.allowedAttackSteps.length === 5);
  checkTrue("T21 prompt contains only structured evidence keys", ["candidate", "brand", "evidence", "risk", "correlation", "campaign"].every((k) => k in userJson));
  checkTrue("T21 prompt contains no provider secrets", !request.user.includes("sk-") && !request.system.includes("sk-"));

  /* ---- report ---- */
  console.log(`\nTask 16 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 16 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
