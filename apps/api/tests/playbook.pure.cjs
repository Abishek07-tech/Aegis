const path = require("path");
const fs = require("fs");

const servicePath = path.join(__dirname, "..", "dist", "services", "playbook.service.js");
const investigatorPath = path.join(__dirname, "..", "dist", "services", "ai-investigator.service.js");
if (!fs.existsSync(servicePath) || !fs.existsSync(investigatorPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const { derivePlaybook, computePlaybook } = require(servicePath);
const { assembleInvestigationInput, deterministicInvestigation } = require(investigatorPath);

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
const DISCLAIMER = "Predictions are probabilistic";

const run = async () => {
  const inputC1 = await mkInput(c1);
  const inputApp = await mkInput(app1);
  const inputFan = await mkInput(fan);
  const inputHarmless = await mkInput(harmless);
  const inputOfficial = await mkInput(official);

  const pb1 = derivePlaybook(inputC1);
  const pb2 = derivePlaybook(inputApp);
  const pb3 = derivePlaybook(inputFan);
  const pb4 = derivePlaybook(inputHarmless);
  const pb5 = derivePlaybook(inputOfficial);

  /* ================= T1: result shape ================= */
  check("T1 top-level keys", Object.keys(pb1).sort(), TOP_KEYS);
  check("T1 candidateId", pb1.candidateId, "c1");
  checkTrue(
    "T1 prediction keys",
    pb1.predictions.every((p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(PREDICTION_KEYS)),
  );
  checkTrue(
    "T1 limitation keys",
    pb1.limitations.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(LIMITATION_KEYS)),
  );
  checkTrue(
    "T1 actions from the fixed vocabulary",
    [pb1, pb2, pb3, pb4, pb5].every((pb) =>
      pb.predictions.every((p) => KNOWN_ACTIONS.includes(p.action)),
    ),
  );

  /* ================= T2: strong social impersonation (c1) ================= */
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
  check(
    "T2 c1 confidences",
    pb1.predictions.map((p) => p.confidence),
    [90, 90, 90, 90, 90, 90],
  );
  check("T2 c1 overall confidence", pb1.overallConfidence, 90);
  check("T2 c1 prediction count within cap", pb1.predictions.length <= 6, true);
  checkTrue(
    "T2 c1 support-lure candidate never predicted to deploy a phishing domain",
    !pb1.predictions.some((p) => p.action === "DEPLOY_PHISHING_DOMAIN"),
  );

  /* ================= T3: rationale construction ================= */
  check(
    "T3 c1 lookalike rationale pinned",
    pb1.predictions[0].rationale,
    "Likely next step: CREATE_LOOKALIKE_SOCIAL_ACCOUNT — predicted from observed evidence (NAME_SIMILARITY, OFFICIAL_IDENTITY_CONFLICT, TEXT_IDENTITY_MATCH); observed intent SUPPORT_SCAM_PATTERN; CROSS_PLATFORM_IMPERSONATION campaign at 100/100; 4 correlated candidates.",
  );
  checkTrue(
    "T3 every rationale cites the action",
    [pb1, pb2, pb3, pb4].every((pb) =>
      pb.predictions.every((p) => p.rationale.includes(p.action)),
    ),
  );
  checkTrue(
    "T3 rationale clipped to RATIONALE_MAX",
    [pb1, pb2, pb3, pb4, pb5].every((pb) =>
      pb.predictions.every((p) => p.rationale.length <= 500),
    ),
  );
  checkTrue(
    "T3 unknown rationale is the fixed placeholder",
    pb4.predictions[0].rationale ===
      "UNKNOWN_NEXT_STEP — the available evidence does not support a specific predicted next action; this assessment is predicted from observed evidence only.",
  );

  /* ================= T4: supporting signals ================= */
  check(
    "T4 c1 lookalike signals",
    pb1.predictions[0].supportingSignals,
    ["NAME_SIMILARITY", "OFFICIAL_IDENTITY_CONFLICT", "TEXT_IDENTITY_MATCH"],
  );
  check(
    "T4 c1 page signals",
    pb1.predictions[1].supportingSignals,
    ["TEXT_IDENTITY_MATCH", "BRAND_TEXT_MATCH", "EXTERNAL_DOMAIN"],
  );
  check(
    "T4 c1 expand signals are campaign indicators",
    pb1.predictions.find((p) => p.action === "EXPAND_CAMPAIGN_TO_NEW_PLATFORM").supportingSignals,
    ["SHARED_SUSPICIOUS_INFRASTRUCTURE", "CROSS_PLATFORM_PRESENCE", "CONSISTENT_BRAND_IMPERSONATION", "MULTI_CANDIDATE_CLUSTER"],
  );
  check(
    "T4 c1 support signals",
    pb1.predictions.find((p) => p.action === "CREATE_FAKE_SUPPORT_ACCOUNT").supportingSignals,
    ["SUPPORT_LANGUAGE", "NAME_SIMILARITY", "OFFICIAL_IDENTITY_CONFLICT"],
  );
  check(
    "T4 signals capped at 4",
    [pb1, pb2, pb3, pb4, pb5].every((pb) =>
      pb.predictions.every((p) => p.supportingSignals.length <= 4),
    ),
    true,
  );
  check(
    "T4 unknown has no signals",
    pb4.predictions[0].supportingSignals,
    [],
  );

  /* ================= T5: c1 limitations ================= */
  check(
    "T5 c1 limitations",
    pb1.limitations.map((l) => l.issue),
    [DISCLAIMER, "Logo evidence unavailable"],
  );
  checkTrue(
    "T5 logo reason comes from Task 11",
    pb1.limitations.find((l) => l.issue === "Logo evidence unavailable").reason.includes("logo"),
  );
  check(
    "T5 disclaimer reason",
    pb1.limitations[0].reason,
    "Playbook predictions are heuristic assessments derived from observed structured results and are not guaranteed outcomes.",
  );

  /* ================= T6: app impersonation (app1) ================= */
  check(
    "T6 app1 action order",
    pb2.predictions.map((p) => p.action),
    [
      "PUBLISH_IMPERSONATING_APP",
      "EXPAND_CAMPAIGN_TO_NEW_PLATFORM",
      "CREATE_IMPERSONATION_PAGE",
      "DISTRIBUTE_PHISHING_URL",
      "DEPLOY_PHISHING_DOMAIN",
    ],
  );
  check(
    "T6 app1 confidences",
    pb2.predictions.map((p) => p.confidence),
    [90, 90, 81, 81, 78],
  );
  check("T6 app1 overall confidence", pb2.overallConfidence, 84);
  check(
    "T6 app1 publish signals",
    pb2.predictions[0].supportingSignals,
    ["APP_NAME_SIMILARITY", "PACKAGE_IDENTIFIER_SIMILARITY", "APP_DESCRIPTION_MATCH"],
  );
  checkTrue(
    "T6 app1 social-only actions absent",
    !pb2.predictions.some((p) =>
      ["CREATE_LOOKALIKE_SOCIAL_ACCOUNT", "CREATE_FAKE_SUPPORT_ACCOUNT", "TARGET_VICTIMS_WITH_SUPPORT_LURE"].includes(p.action),
    ),
  );

  /* ================= T7: fan — partial evidence, no campaign ================= */
  check(
    "T7 fan single lookalike prediction",
    pb3.predictions.map((p) => [p.action, p.confidence]),
    [["CREATE_LOOKALIKE_SOCIAL_ACCOUNT", 90]],
  );
  check("T7 fan overall confidence", pb3.overallConfidence, 90);
  checkTrue(
    "T7 fan rationale has no campaign clause",
    !pb3.predictions[0].rationale.includes("campaign at"),
  );
  checkTrue(
    "T7 fan rationale still cites correlated candidates",
    pb3.predictions[0].rationale.includes("3 correlated candidates"),
  );
  check(
    "T7 fan limitations",
    pb3.limitations.map((l) => l.issue),
    [DISCLAIMER, "Logo evidence unavailable", "No shared infrastructure evidence", "No coordinated campaign detected"],
  );
  checkTrue(
    "T7 no-campaign limitation carries Task 15 text",
    pb3.limitations.find((l) => l.issue === "No coordinated campaign detected").reason ===
      "No meaningful multi-asset correlation was found.",
  );

  /* ================= T8: weak evidence → unknown placeholder ================= */
  check("T8 harmless action", pb4.predictions.map((p) => p.action), ["UNKNOWN_NEXT_STEP"]);
  check("T8 harmless confidence", [pb4.predictions[0].confidence, pb4.overallConfidence], [0, 0]);
  check(
    "T8 harmless limitation order + cap",
    pb4.limitations.map((l) => l.issue),
    [
      DISCLAIMER,
      "Insufficient evidence for a specific prediction",
      "Logo evidence unavailable",
      "No shared infrastructure evidence",
      "No coordinated campaign detected",
      "No correlated candidates",
    ],
  );
  check("T8 limitations capped at 6", pb4.limitations.length <= 6, true);

  /* ================= T9: official-asset protection suppresses predictions ================= */
  check("T9 official predictions", pb5.predictions, []);
  check("T9 official overall confidence", pb5.overallConfidence, 0);
  check(
    "T9 official limitations",
    pb5.limitations.map((l) => l.issue),
    [DISCLAIMER, "Official asset protection present", "Logo evidence unavailable", "No shared infrastructure evidence", "No coordinated campaign detected", "No correlated candidates"],
  );
  checkTrue(
    "T9 official protection lists the Task 13 signals",
    pb5.limitations.find((l) => l.issue === "Official asset protection present").reason.includes("OFFICIAL_ACCOUNT_MATCH"),
  );

  /* ================= T10: bounded deterministic confidence ================= */
  checkTrue(
    "T10 confidences are integers within [0, 90]",
    [pb1, pb2, pb3, pb4, pb5].every((pb) =>
      pb.predictions.every(
        (p) => Number.isInteger(p.confidence) && p.confidence >= 0 && p.confidence <= 90,
      ),
    ),
  );
  checkTrue(
    "T10 predictions sorted by confidence desc",
    [pb1, pb2, pb3, pb4, pb5].every((pb) =>
      pb.predictions.every((p, i) => i === 0 || pb.predictions[i - 1].confidence >= p.confidence),
    ),
  );
  checkTrue(
    "T10 overall confidence integer in [0, 90]",
    [pb1, pb2, pb3, pb4, pb5].every(
      (pb) => Number.isInteger(pb.overallConfidence) && pb.overallConfidence >= 0 && pb.overallConfidence <= 90,
    ),
  );
  check(
    "T10 overall confidence is the rounded mean",
    [pb1.overallConfidence, pb2.overallConfidence, pb3.overallConfidence, pb4.overallConfidence, pb5.overallConfidence],
    [90, 84, 90, 0, 0],
  );

  /* ================= T11: tie-breaks (corroborated first, then vocabulary) ================= */
  checkTrue(
    "T11 c1 corroborated actions precede non-corroborated at equal confidence",
    pb1.predictions.findIndex((p) => p.action === "CREATE_FAKE_SUPPORT_ACCOUNT") >
      pb1.predictions.findIndex((p) => p.action === "EXPAND_CAMPAIGN_TO_NEW_PLATFORM"),
  );
  checkTrue(
    "T11 equal-confidence actions follow vocabulary order",
    (() => {
      const order = pb1.predictions
        .filter((p) => p.confidence === 90)
        .map((p) => p.action);
      const rank = (a) => KNOWN_ACTIONS.indexOf(a);
      return order.every((a, i) => i === 0 || rank(order[i - 1]) < rank(a));
    })(),
  );

  /* ================= T12: gates reference real observations ================= */
  checkTrue(
    "T12 app1 deploys a phishing domain (no support lure, external domain + identity)",
    pb2.predictions.some((p) => p.action === "DEPLOY_PHISHING_DOMAIN"),
  );
  checkTrue(
    "T12 fan has no external-domain actions",
    pb3.predictions.every((p) =>
      !["DEPLOY_PHISHING_DOMAIN", "DISTRIBUTE_PHISHING_URL", "CREATE_IMPERSONATION_PAGE"].includes(p.action),
    ),
  );
  checkTrue(
    "T12 supporting signals all observed in inputs",
    [pb1, pb2, pb3].every((pb, index) => {
      const input = [inputC1, inputApp, inputFan][index];
      const observed = new Set([
        ...input.evidence.evidence.map((item) => item.signal),
        ...(input.campaign.campaign?.indicators.map((i) => i.type) ?? []),
      ]);
      return pb.predictions.every((p) => p.supportingSignals.every((s) => observed.has(s)));
    }),
  );

  /* ================= T13: input-order independence ================= */
  const reversed = await computePlaybook(c1, brand, assets, [...all].reverse());
  const normal = await computePlaybook(c1, brand, assets, all);
  check("T13 computePlaybook deterministic", JSON.stringify(normal), JSON.stringify(reversed));
  check("T13 derivePlaybook repeatable", JSON.stringify(derivePlaybook(inputC1)), JSON.stringify(pb1));

  /* ================= T14: pure function — no time/randomness ================= */
  checkTrue(
    "T14 no timestamp-like fields in the result",
    !JSON.stringify(pb1).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  );
  check(
    "T14 report-parity input (deterministic investigation untouched)",
    deterministicInvestigation(inputC1).threatIntent,
    "SUPPORT_SCAM_PATTERN",
  );

  /* ================= T15: prose hygiene ================= */
  const allPb = [pb1, pb2, pb3, pb4, pb5];
  checkTrue(
    "T15 no absolute verdicts in rationales or limitations",
    allPb.every((pb) =>
      pb.predictions.every((p) => !FORBIDDEN.test(p.rationale)) &&
      pb.limitations.every((l) => !FORBIDDEN.test(l.issue) && !FORBIDDEN.test(l.reason)),
    ),
  );
  checkTrue(
    "T15 no enforcement recommendations",
    allPb.every((pb) =>
      pb.predictions.every((p) => !FORBIDDEN_ACTION.test(p.rationale)) &&
      pb.limitations.every((l) => !FORBIDDEN_ACTION.test(l.reason)),
    ),
  );

  /* ================= T16: weak/official edge cases ================= */
  checkTrue(
    "T16 every fixture carries the disclaimer first",
    allPb.every((pb) => pb.limitations.length > 0 && pb.limitations[0].issue === DISCLAIMER),
  );
  checkTrue(
    "T16 unknown only when nothing else fires",
    allPb.every((pb) =>
      !pb.predictions.some((p) => p.action === "UNKNOWN_NEXT_STEP") ||
      pb.predictions.length === 1,
    ),
  );
  checkTrue(
    "T16 official never predicts any action",
    pb5.predictions.length === 0 && pb5.overallConfidence === 0,
  );

  /* ================= T17: endpoint entry point wiring ================= */
  check(
    "T17 computePlaybook mirrors derivePlaybook",
    JSON.stringify(await computePlaybook(app1, brand, assets, all)),
    JSON.stringify(derivePlaybook(await mkInput(app1))),
  );
  check(
    "T17 result candidateId matches subject",
    [pb1.candidateId, pb2.candidateId, pb3.candidateId, pb4.candidateId, pb5.candidateId],
    ["c1", "app1", "f1", "c3", "off"],
  );

  console.log(`\nTask 17 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 17 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
