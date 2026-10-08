/* Campaign Detection (Task 15) — end-to-end API tests.
   Requires a running server + reachable DATABASE_URL.
   Run: npm run build && AEGIS_BASE_URL=http://127.0.0.1:4100 node tests/campaign.e2e.cjs */
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

const TOP_KEYS = ["campaign", "campaignDetected", "candidateId", "explanation"];
const CAMPAIGN_KEYS = [
  "appAssetCount", "assetCount", "campaignId", "campaignType", "candidateIds",
  "confidenceLevel", "confidenceScore", "domainCount", "durationDays",
  "firstSeen", "indicators", "lastSeen", "platformCount",
  "relatedCandidateCount", "relationships", "socialAssetCount", "websiteCount",
];
const INDICATOR_KEYS = ["explanation", "strength", "type"];
const RELATIONSHIP_KEYS = ["candidateId", "links", "relationshipLevel", "relationshipScore"];
const LINK_KEYS = ["explanation", "source", "strength", "type"];
const noCampaignShape = (candidateId) => ({
  candidateId,
  campaignDetected: false,
  campaign: null,
  explanation: "No meaningful multi-asset correlation was found.",
});
const FORBIDDEN = /\b(fake|scam|malicious)\b/i;

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
  const officialWebsite = await mk({ type: "WEBSITE", value: "https://paysecure.com" });
  const website = await mk({ type: "WEBSITE", value: "https://example.com", name: "Example" });
  const orphan = await mk(
    { type: "SOCIAL", value: "@orphan_account", name: "Orphan" },
    false,
  );

  const campaign = async (id) => req("POST", `/api/candidates/${id}/analyze/campaign`);

  /* ---- TEST 1: valid multi-candidate cross-platform campaign ---- */
  const t1 = await campaign(s1);
  check("T1 status", t1.status, 200);
  check("T1 success", t1.json.success, true);
  check("T1 top-level keys", Object.keys(t1.json.data).sort(), TOP_KEYS);
  check("T1 candidateId", t1.json.data.candidateId, s1);
  check("T1 detected", t1.json.data.campaignDetected, true);
  check("T1 campaign keys", Object.keys(t1.json.data.campaign).sort(), CAMPAIGN_KEYS);
  check("T1 campaignType", t1.json.data.campaign.campaignType, "CROSS_PLATFORM_IMPERSONATION");
  check("T1 confidence", [t1.json.data.campaign.confidenceScore, t1.json.data.campaign.confidenceLevel], [100, "VERY_HIGH"]);
  check("T1 members", t1.json.data.campaign.candidateIds, [s1, s2, app1, ew]);
  check("T1 subject first", t1.json.data.campaign.candidateIds[0], s1);
  check("T1 asset/platform counts", [
    t1.json.data.campaign.assetCount,
    t1.json.data.campaign.platformCount,
    t1.json.data.campaign.socialAssetCount,
    t1.json.data.campaign.appAssetCount,
    t1.json.data.campaign.domainCount,
    t1.json.data.campaign.websiteCount,
    t1.json.data.campaign.relatedCandidateCount,
  ], [4, 3, 2, 1, 1, 0, 3]);
  checkTrue(
    "T1 campaign id format",
    /^camp_[0-9a-f]{8}$/.test(t1.json.data.campaign.campaignId),
  );
  check(
    "T1 relationships strongest-first",
    t1.json.data.campaign.relationships.map((r) => [r.candidateId, r.relationshipScore]),
    [[s2, 86], [app1, 86], [ew, 45]],
  );
  checkTrue(
    "T1 relationship keys + levels",
    t1.json.data.campaign.relationships.every(
      (r) =>
        JSON.stringify(Object.keys(r).sort()) === JSON.stringify(RELATIONSHIP_KEYS) &&
        ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].includes(r.relationshipLevel),
    ),
  );
  checkTrue(
    "T1 link keys + types",
    t1.json.data.campaign.relationships.every((r) =>
      r.links.every(
        (l) =>
          JSON.stringify(Object.keys(l).sort()) === JSON.stringify(LINK_KEYS) &&
          ["SHARED_DOMAIN", "SHARED_URL", "SHARED_BRAND_IDENTITY", "SHARED_VISUAL_EVIDENCE", "SHARED_STRONG_SIGNALS"].includes(l.type),
      ),
    ),
  );
  check(
    "T1 indicator types",
    t1.json.data.campaign.indicators.map((i) => i.type),
    [
      "SHARED_SUSPICIOUS_INFRASTRUCTURE",
      "CROSS_PLATFORM_PRESENCE",
      "CONSISTENT_BRAND_IMPERSONATION",
      "MULTI_CANDIDATE_CLUSTER",
    ],
  );
  checkTrue(
    "T1 indicator keys + strengths",
    t1.json.data.campaign.indicators.every(
      (i) =>
        JSON.stringify(Object.keys(i).sort()) === JSON.stringify(INDICATOR_KEYS) &&
        ["STRONG", "MEDIUM", "WEAK"].includes(i.strength),
    ),
  );
  checkTrue(
    "T1 timeline from actual createdAt",
    typeof t1.json.data.campaign.firstSeen === "string" &&
      typeof t1.json.data.campaign.lastSeen === "string" &&
      Number.isInteger(t1.json.data.campaign.durationDays) &&
      t1.json.data.campaign.durationDays >= 0,
  );
  checkTrue(
    "T1 explanation references real indicators",
    t1.json.data.explanation.includes("evil-pay.com") &&
      t1.json.data.explanation.includes("4 candidate assets") &&
      t1.json.data.explanation.includes("2 social, 1 app, 1 domain") &&
      t1.json.data.explanation.includes("campaign confidence 100/100 (VERY_HIGH)"),
  );
  checkTrue(
    "T1 evidence-based language",
    t1.json.data.explanation.includes("The evidence is consistent with a coordinated impersonation campaign"),
  );
  checkTrue(
    "T1 no fake/scam/malicious verdicts",
    !FORBIDDEN.test(t1.json.data.explanation) &&
      t1.json.data.campaign.indicators.every((i) => !FORBIDDEN.test(i.explanation)),
  );
  checkTrue(
    "T1 no risk fields",
    JSON.stringify(t1.json.data).indexOf("riskScore") === -1 &&
      JSON.stringify(t1.json.data).indexOf("riskLevel") === -1,
  );

  /* ---- TEST 2: same campaign from every member (deterministic id) ---- */
  const t2 = await campaign(s2);
  check("T2 status", t2.status, 200);
  check(
    "T2 same campaignId from second member",
    t2.json.data.campaign.campaignId,
    t1.json.data.campaign.campaignId,
  );
  const t2b = await campaign(app1);
  check(
    "T2 same campaignId from app member",
    t2b.json.data.campaign.campaignId,
    t1.json.data.campaign.campaignId,
  );
  check("T2 app member still cross-platform", t2b.json.data.campaign.campaignType, "CROSS_PLATFORM_IMPERSONATION");

  /* ---- TEST 3: no-campaign cases ---- */
  const t3fan = await campaign(fan);
  check("T3 fan (brand-only links) no campaign", t3fan.status, 200);
  check("T3 fan shape", t3fan.json.data, noCampaignShape(fan));

  const t3harmless = await campaign(harmless);
  check("T3 harmless no campaign", t3harmless.json.data, noCampaignShape(harmless));

  /* ---- TEST 4: official asset protection ---- */
  const t4 = await campaign(officialSocial);
  check("T4 official social no campaign", t4.json.data, noCampaignShape(officialSocial));
  const t4b = await campaign(officialApp);
  check("T4 official app no campaign", t4b.json.data, noCampaignShape(officialApp));
  checkTrue(
    "T4 officials + fan + harmless excluded from campaign members",
    ![officialSocial, officialApp, officialWebsite, fan, harmless].some((id) =>
      t1.json.data.campaign.candidateIds.includes(id),
    ),
  );

  /* ---- TEST 5: failure paths + endpoint wiring ---- */
  const t5 = await campaign(website);
  check("T5 non-applicable type -> 400", t5.status, 400);
  check("T5 success", t5.json.success, false);
  check("T5 error", t5.json.error, "ApiError");
  check("T5 code", t5.json.details && t5.json.details.code, "CAMPAIGN_NOT_APPLICABLE");
  checkTrue(
    "T5 message mentions SOCIAL and APP",
    /only applicable to SOCIAL and APP candidates/.test(t5.json.message),
  );

  const missing = await req("POST", "/api/candidates/does-not-exist/analyze/campaign");
  check("missing candidate -> 404", missing.status, 404);
  checkTrue("missing candidate message", /Candidate not found/.test(missing.json.message));

  const noBrand = await campaign(orphan);
  check("no brand -> 400", noBrand.status, 400);
  check("no brand code", noBrand.json.details && noBrand.json.details.code, "NO_TARGET_BRAND");

  const wrongVerb = await req("GET", `/api/candidates/${s1}/analyze/campaign`);
  check("GET on campaign route -> 404", wrongVerb.status, 404);

  /* ---- determinism ---- */
  const t1again = await campaign(s1);
  check("deterministic repeat", JSON.stringify(t1again.json), JSON.stringify(t1.json));

  /* ---- Task 6–14 regressions ---- */
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
  checkTrue(
    "Task 14 correlation cluster matches campaign candidateIds (Task 15 consumes it)",
    JSON.stringify(correlation.json.data.cluster.candidateIds.filter((id) =>
      t1.json.data.campaign.candidateIds.includes(id),
    ).sort()) === JSON.stringify([...t1.json.data.campaign.candidateIds].sort()),
  );

  console.log(`\nTask 15 e2e — passed: ${passed}, failed: ${failed}`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 15 E2E TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
