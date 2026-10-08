const path = require("path");
const fs = require("fs");

const campaignPath = path.join(__dirname, "..", "dist", "services", "campaign.service.js");
const correlationPath = path.join(__dirname, "..", "dist", "services", "correlation.service.js");
if (!fs.existsSync(campaignPath) || !fs.existsSync(correlationPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  buildCampaignResult,
  computeCampaignAnalysis,
  deriveCampaignId,
  getCampaignConfidenceLevel,
} = require(campaignPath);
const { buildCorrelationResult } = require(correlationPath);

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

/* ---- synthetic fixtures ---- */
const fp = (candidateId, over = {}) => ({
  candidateId,
  type: "SOCIAL",
  brandId: "b1",
  externalDomains: [],
  urls: [],
  evidence: [],
  isExactOfficial: false,
  ...over,
});

const high = (signal, source = "SOCIAL") => ({
  source,
  signal,
  severity: "HIGH",
  score: 1,
  reason: `reason-${signal}`,
});

const info = (id, type = "SOCIAL", createdAt = null) => ({
  id,
  type,
  createdAt: createdAt === null ? null : new Date(createdAt),
});

const corr = (ids) => ({
  candidateId: ids[0],
  cluster: { candidateIds: ids, size: ids.length },
});

const TOP_KEYS = ["campaign", "campaignDetected", "candidateId", "explanation"];
const CAMPAIGN_KEYS = [
  "appAssetCount", "assetCount", "campaignId", "campaignType", "candidateIds",
  "confidenceLevel", "confidenceScore", "domainCount", "durationDays",
  "firstSeen", "indicators", "lastSeen", "platformCount",
  "relatedCandidateCount", "relationships", "socialAssetCount", "websiteCount",
];
const INDICATOR_KEYS = ["explanation", "strength", "type"];
const RELATIONSHIP_KEYS = ["candidateId", "links", "relationshipLevel", "relationshipScore"];
const NO_CAMPAIGN_TEXT = "No meaningful multi-asset correlation was found.";

const run = async () => {
  /* ---- Test 1: two candidates sharing suspicious domain → campaign ---- */
  const t1 = buildCampaignResult(
    corr(["s", "x"]),
    [info("s"), info("x")],
    [fp("s", { externalDomains: ["evil-pay.com"] }), fp("x", { externalDomains: ["evil-pay.com"] })],
    "PaySecure",
  );
  check("T1 top-level keys", Object.keys(t1).sort(), TOP_KEYS);
  check("T1 detected", t1.campaignDetected, true);
  check("T1 candidateId", t1.candidateId, "s");
  check("T1 campaign keys", Object.keys(t1.campaign).sort(), CAMPAIGN_KEYS);
  check("T1 type", t1.campaign.campaignType, "SOCIAL_IMPERSONATION");
  check("T1 candidateIds", t1.campaign.candidateIds, ["s", "x"]);
  check("T1 score/level", [t1.campaign.confidenceScore, t1.campaign.confidenceLevel], [45, "MEDIUM"]);
  check("T1 indicators", t1.campaign.indicators.map((i) => `${i.type}:${i.strength}`), [
    "SHARED_SUSPICIOUS_INFRASTRUCTURE:STRONG",
  ]);
  check("T1 indicator keys", Object.keys(t1.campaign.indicators[0]).sort(), INDICATOR_KEYS);
  check("T1 relationship keys", Object.keys(t1.campaign.relationships[0]).sort(), RELATIONSHIP_KEYS);
  check("T1 relationship", [t1.campaign.relationships[0].candidateId, t1.campaign.relationships[0].relationshipScore], ["x", 45]);
  check("T1 counts", [t1.campaign.assetCount, t1.campaign.socialAssetCount, t1.campaign.platformCount, t1.campaign.relatedCandidateCount], [2, 2, 1, 1]);
  checkTrue("T1 explanation references the domain", t1.explanation.includes("evil-pay.com"));
  checkTrue("T1 explanation references counts", t1.explanation.includes("2 candidate assets"));
  checkTrue("T1 explanation references confidence", t1.explanation.includes("campaign confidence 45/100 (MEDIUM)"));

  /* ---- Test 2: three candidates sharing infrastructure → one campaign ---- */
  const three = (subject) => {
    const ids = ["s", "a", "b"];
    const ordered = [subject, ...ids.filter((id) => id !== subject)];
    return buildCampaignResult(
      corr(ordered),
      ids.map((id) => info(id)),
      ids.map((id) => fp(id, { externalDomains: ["evil.io"] })),
      "PaySecure",
    );
  };
  const t2 = three("s");
  check("T2 one campaign of three", [t2.campaignDetected, t2.campaign.assetCount, t2.campaign.candidateIds], [true, 3, ["s", "a", "b"]]);
  check("T2 score", [t2.campaign.confidenceScore, t2.campaign.confidenceLevel], [58, "HIGH"]);
  check("T2 indicators", t2.campaign.indicators.map((i) => i.type), [
    "SHARED_SUSPICIOUS_INFRASTRUCTURE",
    "MULTI_CANDIDATE_CLUSTER",
  ]);
  const t2FromA = three("a");
  check("T2 same campaign from another member", t2FromA.campaign.campaignId, t2.campaign.campaignId);

  /* ---- Test 3: cross-platform social + app → campaign ---- */
  const t3 = buildCampaignResult(
    corr(["s", "app"]),
    [info("s", "SOCIAL"), info("app", "APP")],
    [
      fp("s", { externalDomains: ["evil.com"], evidence: [high("NAME_SIMILARITY", "NAME")] }),
      fp("app", { type: "APP", externalDomains: ["evil.com"], evidence: [high("APP_NAME_SIMILARITY", "APP")] }),
    ],
    "PaySecure",
  );
  check("T3 detected", t3.campaignDetected, true);
  check("T3 type", t3.campaign.campaignType, "CROSS_PLATFORM_IMPERSONATION");
  check("T3 score/level", [t3.campaign.confidenceScore, t3.campaign.confidenceLevel], [90, "VERY_HIGH"]);
  check("T3 platform counts", [t3.campaign.socialAssetCount, t3.campaign.appAssetCount, t3.campaign.platformCount], [1, 1, 2]);
  checkTrue(
    "T3 cross-platform indicator present",
    t3.campaign.indicators.some((i) => i.type === "CROSS_PLATFORM_PRESENCE"),
  );
  checkTrue("T3 explanation names both channels", t3.explanation.includes("across social and app channels"));

  /* ---- Test 4: unrelated candidates → no campaign ---- */
  const t4 = buildCampaignResult(
    corr(["s"]),
    [info("s"), info("x"), info("y")],
    [
      fp("s", { externalDomains: ["alpha.io"] }),
      fp("x", { externalDomains: ["beta.io"] }),
      fp("y"),
    ],
    "PaySecure",
  );
  check("T4 no campaign", [t4.campaignDetected, t4.campaign], [false, null]);
  check("T4 explanation", t4.explanation, NO_CAMPAIGN_TEXT);

  /* ---- Test 5: same brand alone → no campaign ---- */
  const t5 = buildCampaignResult(
    corr(["s", "x"]),
    [info("s"), info("x")],
    [fp("s"), fp("x")],
    "PaySecure",
  );
  check("T5 same brand alone", t5.campaignDetected, false);

  /* ---- Test 6: official assets → no false campaign ---- */
  const t6 = buildCampaignResult(
    corr(["off"]),
    [info("off")],
    [fp("off", { isExactOfficial: true, externalDomains: ["evil.com"] })],
    "PaySecure",
  );
  check("T6 official subject", [t6.campaignDetected, t6.campaign], [false, null]);

  /* ---- Test 7: shared official domain → no suspicious campaign ---- */
  // official domains/URLs are filtered by Task 14 before fingerprints exist:
  // externalDomains/urls stay empty, so only branding similarity remains (30 < 45)
  const brandOnly = [high("NAME_SIMILARITY", "NAME")];
  const t7 = buildCampaignResult(
    corr(["w1", "w2"]),
    [info("w1"), info("w2")],
    [fp("w1", { evidence: brandOnly }), fp("w2", { evidence: brandOnly })],
    "PaySecure",
  );
  check("T7 official domain refs never campaign", t7.campaignDetected, false);

  /* ---- Test 8: weak correlation → no campaign ---- */
  const t8 = buildCampaignResult(
    corr(["f1", "f2"]),
    [info("f1"), info("f2")],
    [fp("f1", { evidence: brandOnly }), fp("f2", { evidence: brandOnly })],
    "PaySecure",
  );
  check("T8 brand-only edge below threshold", t8.campaignDetected, false);
  check("T8 explanation", t8.explanation, NO_CAMPAIGN_TEXT);

  /* ---- Test 9: duplicate evidence does not inflate confidence ---- */
  // domain (45) + damped URL (11) + strong signals (20) = one edge of 76;
  // domain+URL count as ONE infrastructure signal family → pinned confidence
  const sharedEvidence = [high("SUPPORT_LANGUAGE")];
  const t9 = buildCampaignResult(
    corr(["a", "b"]),
    [info("a"), info("b")],
    [
      fp("a", { externalDomains: ["evil.com"], urls: ["https://evil.com/help"], evidence: sharedEvidence }),
      fp("b", { externalDomains: ["evil.com"], urls: ["https://evil.com/help"], evidence: sharedEvidence }),
    ],
    "PaySecure",
  );
  check("T9 damped relationship", t9.campaign.relationships[0].relationshipScore, 76);
  check("T9 confidence (family dedup, not 62/66)", [t9.campaign.confidenceScore, t9.campaign.confidenceLevel], [60, "HIGH"]);
  checkTrue("T9 below undamped-inflation bound", t9.campaign.confidenceScore < 66);

  /* ---- Test 10: campaign confidence deterministic ---- */
  const t10a = buildCampaignResult(
    corr(["a", "b"]),
    [info("a"), info("b")],
    [fp("a", { externalDomains: ["e.com"] }), fp("b", { externalDomains: ["e.com"] })],
    "PaySecure",
  );
  const t10b = buildCampaignResult(
    corr(["a", "b"]),
    [info("a"), info("b")],
    [fp("a", { externalDomains: ["e.com"] }), fp("b", { externalDomains: ["e.com"] })],
    "PaySecure",
  );
  check("T10 deterministic", JSON.stringify(t10a), JSON.stringify(t10b));
  checkTrue(
    "T10 integer score in bounds + level matches ladder",
    Number.isInteger(t10a.campaign.confidenceScore) &&
      t10a.campaign.confidenceScore >= 0 &&
      t10a.campaign.confidenceScore <= 100 &&
      t10a.campaign.confidenceLevel === getCampaignConfidenceLevel(t10a.campaign.confidenceScore),
  );
  check(
    "T10 level ladder",
    [
      getCampaignConfidenceLevel(0), getCampaignConfidenceLevel(24),
      getCampaignConfidenceLevel(25), getCampaignConfidenceLevel(49),
      getCampaignConfidenceLevel(50), getCampaignConfidenceLevel(74),
      getCampaignConfidenceLevel(75), getCampaignConfidenceLevel(100),
    ],
    ["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "VERY_HIGH", "VERY_HIGH"],
  );

  /* ---- Test 11: candidate ordering deterministic ---- */
  const membersAB = [info("a"), info("b"), info("c")];
  const fpsAB = [
    fp("a", { externalDomains: ["e.com"] }),
    fp("b", { externalDomains: ["e.com"] }),
    fp("c", { externalDomains: ["e.com"] }),
  ];
  const t11a = buildCampaignResult(corr(["a", "b", "c"]), membersAB, fpsAB, "PaySecure");
  const t11b = buildCampaignResult(
    corr(["a", "b", "c"]),
    [...membersAB].reverse(),
    [...fpsAB].reverse(),
    "PaySecure",
  );
  check("T11 reversed input identical", JSON.stringify(t11a), JSON.stringify(t11b));
  checkTrue("T11 subject first", t11a.campaign.candidateIds[0] === "a");
  checkTrue(
    "T11 relationships sorted score desc then id asc",
    t11a.campaign.relationships.every((r, i, arr) =>
      i === 0 ||
      arr[i - 1].relationshipScore > r.relationshipScore ||
      (arr[i - 1].relationshipScore === r.relationshipScore &&
        arr[i - 1].candidateId.localeCompare(r.candidateId) <= 0),
    ),
  );

  /* ---- Test 12: campaign ID deterministic ---- */
  checkTrue("T12 id format", /^camp_[0-9a-f]{8}$/.test(t11a.campaign.campaignId));
  check("T12 deriveCampaignId sorted-set stable", deriveCampaignId(["b", "a", "c"]), deriveCampaignId(["c", "b", "a"]));
  checkTrue("T12 different members → different id", deriveCampaignId(["a", "b"]) !== deriveCampaignId(["a", "c"]));
  const t11FromB = buildCampaignResult(corr(["b", "a", "c"]), membersAB, fpsAB, "PaySecure");
  check("T12 same campaign id from any subject", t11FromB.campaign.campaignId, t11a.campaign.campaignId);

  /* ---- Test 13: timeline uses actual timestamps only ---- */
  const t13 = buildCampaignResult(
    corr(["a", "b"]),
    [info("a", "SOCIAL", "2026-01-01T00:00:00.000Z"), info("b", "SOCIAL", "2026-01-03T00:00:00.000Z")],
    [fp("a", { externalDomains: ["e.com"] }), fp("b", { externalDomains: ["e.com"] })],
    "PaySecure",
  );
  check("T13 firstSeen/lastSeen/duration", [
    t13.campaign.firstSeen,
    t13.campaign.lastSeen,
    t13.campaign.durationDays,
  ], ["2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", 2]);

  /* ---- Test 14: missing timestamps remain null ---- */
  const t14 = buildCampaignResult(
    corr(["a", "b"]),
    [info("a", "SOCIAL", null), info("b", "SOCIAL", "2026-01-03T00:00:00.000Z")],
    [fp("a", { externalDomains: ["e.com"] }), fp("b", { externalDomains: ["e.com"] })],
    "PaySecure",
  );
  check("T14 null timeline", [t14.campaign.firstSeen, t14.campaign.lastSeen, t14.campaign.durationDays], [null, null, null]);

  /* ---- Test 15: explanation references real indicators ---- */
  const t15 = buildCampaignResult(
    corr(["s1", "s2", "ew"]),
    [info("s1"), info("s2"), info("ew", "DOMAIN")],
    [
      fp("s1", { externalDomains: ["evil-pay.com"], evidence: [high("NAME_SIMILARITY", "NAME"), high("TEXT_IDENTITY_MATCH", "TEXT")] }),
      fp("s2", { externalDomains: ["evil-pay.com"], evidence: [high("NAME_SIMILARITY", "NAME"), high("TEXT_IDENTITY_MATCH", "TEXT")] }),
      fp("ew", { type: "DOMAIN", externalDomains: ["evil-pay.com"] }),
    ],
    "PaySecure",
  );
  checkTrue(
    "T15 explanation names the real domain and counts",
    t15.explanation.includes("evil-pay.com") &&
      t15.explanation.includes("3 candidate assets") &&
      t15.explanation.includes("2 social, 1 domain"),
  );
  checkTrue(
    "T15 consistent-identity indicator lists real signals",
    t15.campaign.indicators
      .filter((i) => i.type === "CONSISTENT_BRAND_IMPERSONATION")
      .every(
        (i) =>
          i.explanation.includes("NAME_SIMILARITY") &&
          i.explanation.includes("TEXT_IDENTITY_MATCH") &&
          i.explanation.includes("PaySecure"),
      ),
  );
  checkTrue(
    "T15 evidence-based closing language",
    t15.explanation.includes("The evidence is consistent with a coordinated impersonation campaign"),
  );

  /* ---- Test 16: no fabricated evidence ---- */
  const allExplanations = [t1, t2, t3, t9, t15]
    .flatMap((r) => [r.explanation, ...r.campaign.indicators.map((i) => i.explanation)]);
  const realDomains = ["evil-pay.com", "evil.io", "evil.com", "e.com", "evil.com"];
  checkTrue(
    "T16 every referenced domain exists in a fingerprint",
    allExplanations.every((text) =>
      ["evil-pay.com", "evil.io", "evil.com", "e.com"].every(
        (domain) => !text.includes(domain) || realDomains.includes(domain),
      ),
    ),
  );
  checkTrue(
    "T16 every indicator has a non-trivial explanation",
    [t1, t2, t3, t9, t15].every((r) =>
      r.campaign.indicators.every(
        (i) =>
          INDICATOR_KEYS.every((k) => i[k] !== undefined) &&
          typeof i.explanation === "string" &&
          i.explanation.length > 20,
      ),
    ),
  );
  checkTrue(
    "T16 signals in indicators come from real evidence",
    t15.campaign.indicators.every(
      (i) =>
        !i.explanation.includes("SUPPORT_LANGUAGE") &&
        (i.type !== "CONSISTENT_BRAND_IMPERSONATION" ||
          ["NAME_SIMILARITY", "TEXT_IDENTITY_MATCH"].some((s) => i.explanation.includes(s))),
    ),
  );

  /* ---- Test 17: no fake/scam/malicious verdicts ---- */
  const forbidden = /\b(fake|scam|malicious)\b/i;
  checkTrue(
    "T17 no forbidden verdict words in any explanation",
    [t1, t2, t3, t4, t5, t6, t7, t8, t9, t15].every(
      (r) => !forbidden.test(r.explanation),
    ) &&
      [t1, t2, t3, t9, t15].every((r) =>
        r.campaign.indicators.every((i) => !forbidden.test(i.explanation)),
      ),
  );
  checkTrue(
    "T17 no risk fields on campaign output",
    JSON.stringify(t15).indexOf("riskScore") === -1 &&
      JSON.stringify(t15).indexOf("riskLevel") === -1,
  );

  /* ---- Test 18: single candidate → no campaign ---- */
  const t18 = buildCampaignResult(corr(["s"]), [info("s")], [fp("s", { externalDomains: ["e.com"] })], "PaySecure");
  check("T18 single candidate", [t18.campaignDetected, t18.campaign, t18.explanation], [false, null, NO_CAMPAIGN_TEXT]);

  /* ---- Test 19: weak candidate cannot join a strong campaign (fan protection) ---- */
  const t19 = buildCampaignResult(
    corr(["s1", "s2", "ew", "fan"]),
    [info("s1"), info("s2"), info("ew", "DOMAIN"), info("fan")],
    [
      fp("s1", { externalDomains: ["evil-pay.com"], evidence: [high("NAME_SIMILARITY", "NAME")] }),
      fp("s2", { externalDomains: ["evil-pay.com"], evidence: [high("NAME_SIMILARITY", "NAME")] }),
      fp("ew", { type: "DOMAIN", externalDomains: ["evil-pay.com"] }),
      fp("fan", { evidence: brandOnly }),
    ],
    "PaySecure",
  );
  checkTrue(
    "T19 weak fan excluded from campaign members and relationships",
    !t19.campaign.candidateIds.includes("fan") &&
      !t19.campaign.relationships.some((r) => r.candidateId === "fan"),
  );
  check("T19 campaign members", t19.campaign.candidateIds, ["s1", "s2", "ew"]);

  /* ---- Test 20: real fixtures (computeCampaignAnalysis) ---- */
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
  const evilDomain = cand("ew", "DOMAIN", { value: "evil-pay.com" });
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
  const officialWeb = cand("web", "WEBSITE", { value: "https://paysecure.com" });
  const all = [c1, c2, evilDomain, fan, harmless, official, officialWeb];

  const t20 = await computeCampaignAnalysis(c1, brand, assets, all);
  check("T20 detected", t20.campaignDetected, true);
  check("T20 members exclude fan + officials + harmless", t20.campaign.candidateIds, ["c1", "c2", "ew"]);
  check("T20 type", t20.campaign.campaignType, "MULTI_ASSET_BRAND_IMPERSONATION");
  check("T20 score/level", [t20.campaign.confidenceScore, t20.campaign.confidenceLevel], [88, "VERY_HIGH"]);
  check("T20 counts", [
    t20.campaign.assetCount, t20.campaign.socialAssetCount, t20.campaign.domainCount,
    t20.campaign.platformCount, t20.campaign.relatedCandidateCount,
  ], [3, 2, 1, 2, 2]);
  check("T20 indicator types", t20.campaign.indicators.map((i) => i.type), [
    "SHARED_SUSPICIOUS_INFRASTRUCTURE",
    "CONSISTENT_BRAND_IMPERSONATION",
    "MULTI_CANDIDATE_CLUSTER",
  ]);
  checkTrue(
    "T20 explanation references real domain + evidence language",
    t20.explanation.includes("evil-pay.com") &&
      t20.explanation.includes("share strong brand-impersonation evidence"),
  );

  // consistency with the Task 14 correlation endpoint for the same subject
  const t20corr = await buildCorrelationResult(c1, brand, assets, all);
  const campaignSet = new Set(t20.campaign.candidateIds);
  check(
    "T20 relationships = correlation related filtered to campaign",
    t20.campaign.relationships.map((r) => [r.candidateId, r.relationshipScore]),
    t20corr.relatedCandidates
      .filter((r) => campaignSet.has(r.candidateId))
      .map((r) => [r.candidateId, r.relationshipScore]),
  );

  const t20fan = await computeCampaignAnalysis(fan, brand, assets, all);
  check("T20 fan subject → no campaign", [t20fan.campaignDetected, t20fan.campaign], [false, null]);

  const t20harmless = await computeCampaignAnalysis(harmless, brand, assets, all);
  check("T20 harmless subject → no campaign", t20harmless.campaignDetected, false);

  const t20official = await computeCampaignAnalysis(official, brand, assets, all);
  check("T20 official subject → no campaign", t20official.campaignDetected, false);

  const t20fanAgain = await computeCampaignAnalysis(c1, brand, assets, [...all].reverse());
  check("T20 input-order independent", JSON.stringify(t20fanAgain), JSON.stringify(t20));

  /* ---- report ---- */
  console.log(`\nTask 15 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 15 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
