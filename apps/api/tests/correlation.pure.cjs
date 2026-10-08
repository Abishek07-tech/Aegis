const path = require("path");
const fs = require("fs");

const correlationPath = path.join(__dirname, "..", "dist", "services", "correlation.service.js");
const socialPath = path.join(__dirname, "..", "dist", "services", "social-risk.service.js");
if (!fs.existsSync(correlationPath) || !fs.existsSync(socialPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  buildCorrelationResult,
  correlateFingerprints,
  getRelationshipLevel,
} = require(correlationPath);
const { normalizeUrl, extractUrls } = require(socialPath);

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

/* ---- synthetic fingerprint fixtures ---- */
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

const relatedOf = (result, id) =>
  result.relatedCandidates.find((entry) => entry.candidateId === id);

const RESULT_KEYS = ["candidateId", "cluster", "relatedCandidates"];

const run = async () => {
  /* ---- Test 1: same suspicious domain → correlated ---- */
  const t1 = correlateFingerprints(
    fp("s", { externalDomains: ["evil-pay.com"] }),
    [fp("x", { externalDomains: ["evil-pay.com"] }), fp("y", { externalDomains: ["other.io"] })],
    "PaySecure",
  );
  check("T1 related ids", t1.relatedCandidates.map((r) => r.candidateId), ["x"]);
  check("T1 score", t1.relatedCandidates[0].relationshipScore, 45);
  check("T1 level", t1.relatedCandidates[0].relationshipLevel, "MEDIUM");
  check("T1 link type", t1.relatedCandidates[0].links[0].type, "SHARED_DOMAIN");
  check("T1 link strength", t1.relatedCandidates[0].links[0].strength, "STRONG");
  check("T1 link source", t1.relatedCandidates[0].links[0].source, "TEXT");
  checkTrue(
    "T1 explanation names the domain",
    t1.relatedCandidates[0].links[0].explanation.includes("evil-pay.com") &&
      t1.relatedCandidates[0].links[0].explanation.includes("external domain"),
  );
  check("T1 cluster", t1.cluster, { candidateIds: ["s", "x"], size: 2 });

  /* ---- Test 2: same normalized URL → correlated (+ infra damping) ---- */
  const t2 = correlateFingerprints(
    fp("s", {
      externalDomains: ["evil-pay.com"],
      urls: ["https://evil-pay.com/help"],
    }),
    [fp("x", {
      externalDomains: ["evil-pay.com"],
      urls: ["https://evil-pay.com/help"],
    })],
    "PaySecure",
  );
  const t2links = t2.relatedCandidates[0].links;
  check("T2 score damped (not 90)", t2.relatedCandidates[0].relationshipScore, 56);
  check("T2 level", t2.relatedCandidates[0].relationshipLevel, "HIGH");
  check("T2 link order", t2links.map((l) => l.type), ["SHARED_DOMAIN", "SHARED_URL"]);
  check("T2 url strength damped", t2links[1].strength, "WEAK");
  checkTrue(
    "T2 url explanation notes infrastructure",
    t2links[1].explanation.includes("same underlying infrastructure"),
  );

  // URL-only correlation (no shared domain text)
  const t2b = correlateFingerprints(
    fp("s", { urls: ["https://evil-pay.com/help"] }),
    [fp("x", { urls: ["https://evil-pay.com/help"] })],
    "PaySecure",
  );
  check("T2b url only score", t2b.relatedCandidates[0].relationshipScore, 45);
  check("T2b url strength full", t2b.relatedCandidates[0].links[0].strength, "STRONG");

  // URL normalization reuse
  check(
    "T2c normalizeUrl",
    [
      normalizeUrl("https://Evil-Pay.com/help#section"),
      normalizeUrl("https://evil-pay.com/help/"),
      normalizeUrl("www.evil-pay.com/help"),
      normalizeUrl("https://evil-pay.com/help."),
    ],
    [
      "https://evil-pay.com/help",
      "https://evil-pay.com/help",
      "https://evil-pay.com/help",
      "https://evil-pay.com/help",
    ],
  );
  check(
    "T2c extractUrls dedupes",
    extractUrls("see https://evil-pay.com/help and www.evil-pay.com/help"),
    ["https://evil-pay.com/help"],
  );

  /* ---- Test 3: shared meaningful evidence → correlated ---- */
  const evA = [
    high("NAME_SIMILARITY", "NAME"),
    high("TEXT_IDENTITY_MATCH", "TEXT"),
    high("SUPPORT_LANGUAGE", "SOCIAL"),
  ];
  const evB = [high("TEXT_IDENTITY_MATCH", "TEXT"), high("SUPPORT_LANGUAGE", "SOCIAL")];
  const t3 = correlateFingerprints(fp("s", { evidence: evA }), [fp("x", { evidence: evB })], "PaySecure");
  const t3c = relatedOf(t3, "x");
  check("T3 score", t3c.relationshipScore, 50);
  check("T3 level", t3c.relationshipLevel, "HIGH");
  check("T3 link types", t3c.links.map((l) => l.type), ["SHARED_BRAND_IDENTITY", "SHARED_STRONG_SIGNALS"]);
  checkTrue(
    "T3 brand link names the brand",
    t3c.links[0].explanation.includes("(PaySecure)"),
  );
  checkTrue(
    "T3 strong-signals carries only not-yet-covered signals",
    t3c.links[1].explanation.includes("SUPPORT_LANGUAGE") &&
      !t3c.links[1].explanation.includes("TEXT_IDENTITY_MATCH"),
  );

  // visual evidence
  const evL = [high("LOGO_SIMILARITY", "LOGO"), high("NAME_SIMILARITY", "NAME")];
  const t3v = correlateFingerprints(fp("s", { evidence: evL }), [fp("x", { evidence: evL })], "PaySecure");
  check(
    "T3v visual link",
    relatedOf(t3v, "x").links.map((l) => l.type),
    ["SHARED_BRAND_IDENTITY", "SHARED_VISUAL_EVIDENCE"],
  );
  checkTrue(
    "T3v no double count of shared HIGH signals",
    !relatedOf(t3v, "x").links.some((l) => l.type === "SHARED_STRONG_SIGNALS"),
  );

  /* ---- Test 4: unrelated candidates → no relationship ---- */
  const t4 = correlateFingerprints(
    fp("s", { evidence: [high("SUPPORT_LANGUAGE")] }),
    [fp("x", { externalDomains: ["elsewhere.io"] }), fp("y")],
    "PaySecure",
  );
  check("T4 related", t4.relatedCandidates, []);
  check("T4 cluster", t4.cluster, { candidateIds: ["s"], size: 1 });

  // weak/low evidence only → no link
  const weak = [{ source: "NAME", signal: "NAME_SIMILARITY", severity: "LOW", score: 0.5, reason: "weak" }];
  const t4w = correlateFingerprints(fp("s", { evidence: weak }), [fp("x", { evidence: [...weak] })], "PaySecure");
  check("T4w weak evidence only", t4w.relatedCandidates, []);

  /* ---- Test 5: official assets not correlated as threats ---- */
  const t5s = correlateFingerprints(
    fp("s", { isExactOfficial: true, externalDomains: ["evil.com"] }),
    [fp("x", { externalDomains: ["evil.com"] })],
    "PaySecure",
  );
  check("T5 official subject protected", t5s, {
    relatedCandidates: [],
    cluster: { candidateIds: ["s"], size: 1 },
  });
  const t5p = correlateFingerprints(
    fp("s", { externalDomains: ["evil.com"] }),
    [fp("official", { isExactOfficial: true, externalDomains: ["evil.com"] }), fp("x", { externalDomains: ["evil.com"] })],
    "PaySecure",
  );
  check("T5 official peer excluded", t5p.relatedCandidates.map((r) => r.candidateId), ["x"]);

  // sharing only the brand registry never links without strong evidence
  const t5b = correlateFingerprints(fp("s"), [fp("x"), fp("y")], "PaySecure");
  check("T5 same brand alone → no link", t5b.relatedCandidates, []);

  // official-domain-only peers (value on official domain) are excluded upstream —
  // verified here through buildCorrelationResult below (Test 5b).

  /* ---- Test 6: duplicate underlying evidence → no inflation ---- */
  // domain + url (same infrastructure) + strong signals on one pair: damped total
  const sharedOnly = [high("SUPPORT_LANGUAGE")];
  const t6 = correlateFingerprints(
    fp("s", {
      externalDomains: ["evil-pay.com"],
      urls: ["https://evil-pay.com/help"],
      evidence: sharedOnly,
    }),
    [fp("x", {
      externalDomains: ["evil-pay.com"],
      urls: ["https://evil-pay.com/help"],
      evidence: sharedOnly,
    })],
    "PaySecure",
  );
  const t6c = relatedOf(t6, "x");
  check("T6 damped total", t6c.relationshipScore, 76); // 45 + 11 + 20 — not 45+45+20=110
  checkTrue("T6 below naive sum (110)", t6c.relationshipScore < 110);
  check(
    "T6 link types",
    t6c.links.map((l) => l.type),
    ["SHARED_DOMAIN", "SHARED_STRONG_SIGNALS", "SHARED_URL"],
  );
  const t6b = correlateFingerprints(
    fp("s", { externalDomains: ["a.io"], evidence: [high("SUPPORT_LANGUAGE")] }),
    [fp("x", { externalDomains: ["a.io"], evidence: [high("SUPPORT_LANGUAGE")] })],
    "PaySecure",
  );
  check("T6b modest combined total", relatedOf(t6b, "x").relationshipScore, 65); // 45 + 20
  // hard cap: everything shared at once still stays within 0–100
  const t6cap = correlateFingerprints(
    fp("s", {
      externalDomains: ["evil-pay.com"],
      urls: ["https://evil-pay.com/help"],
      evidence: evA,
    }),
    [fp("x", {
      externalDomains: ["evil-pay.com"],
      urls: ["https://evil-pay.com/help"],
      evidence: evB,
    })],
    "PaySecure",
  );
  check("T6c capped at 100", relatedOf(t6cap, "x").relationshipScore, 100);
  check("T6c capped level", relatedOf(t6cap, "x").relationshipLevel, "VERY_HIGH");

  /* ---- Test 7: deterministic scoring ---- */
  const t7a = correlateFingerprints(fp("s", { externalDomains: ["e.com"], evidence: evA }), [fp("x", { externalDomains: ["e.com"], evidence: evB })], "PaySecure");
  const t7b = correlateFingerprints(fp("s", { externalDomains: ["e.com"], evidence: evA }), [fp("x", { externalDomains: ["e.com"], evidence: evB })], "PaySecure");
  check("T7 deterministic", JSON.stringify(t7a), JSON.stringify(t7b));

  /* ---- Test 8: relationship ordering ---- */
  const t8 = correlateFingerprints(
    fp("s", { externalDomains: ["shared.io", "second.io"] }),
    [
      fp("weak", { externalDomains: ["shared.io"] }),
      fp("strong", {
        externalDomains: ["shared.io", "second.io"],
        urls: ["https://shared.io/x"],
        evidence: evA,
      }),
    ],
    "PaySecure",
  );
  check("T8 order strong first", t8.relatedCandidates.map((r) => r.candidateId), ["strong", "weak"]);
  checkTrue(
    "T8 scores descending",
    t8.relatedCandidates.every((r, i, arr) => i === 0 || arr[i - 1].relationshipScore >= r.relationshipScore),
  );

  /* ---- Test 9: empty candidate set ---- */
  const t9 = correlateFingerprints(fp("s", { externalDomains: ["e.com"] }), [], "PaySecure");
  check("T9 empty universe", t9, {
    relatedCandidates: [],
    cluster: { candidateIds: ["s"], size: 1 },
  });

  /* ---- Test 10: missing/unsupported correlation data ---- */
  const t10 = correlateFingerprints(fp("s"), [fp("x"), fp("y")], "PaySecure");
  check("T10 no data → no links", t10.relatedCandidates, []);
  const SUPPORTED = [
    "SHARED_DOMAIN",
    "SHARED_URL",
    "SHARED_BRAND_IDENTITY",
    "SHARED_VISUAL_EVIDENCE",
    "SHARED_STRONG_SIGNALS",
  ];
  checkTrue(
    "T10 only supported link types (no SHARED_CONTACT/SHARED_PUBLISHER)",
    Object.values(t10_types(t6)).every((type) => SUPPORTED.includes(type)),
  );
  function t10_types(result) {
    const out = {};
    for (const r of result.relatedCandidates) for (const l of r.links) out[l.type] = l.type;
    return out;
  }
  checkTrue(
    "T10 unsupported types never appear",
    Object.keys(t10_types(t6)).every((type) => SUPPORTED.includes(type)) &&
      JSON.stringify(t6).indexOf("SHARED_CONTACT") === -1 &&
      JSON.stringify(t6).indexOf("SHARED_PUBLISHER") === -1,
  );
  check(
    "T10 level boundaries",
    [
      getRelationshipLevel(0), getRelationshipLevel(24), getRelationshipLevel(25),
      getRelationshipLevel(49), getRelationshipLevel(50), getRelationshipLevel(74),
      getRelationshipLevel(75), getRelationshipLevel(100),
    ],
    ["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "VERY_HIGH", "VERY_HIGH"],
  );

  /* ---- Test 11: no fabricated links ---- */
  checkTrue(
    "T11 every link has type/source/strength/explanation",
    t6.relatedCandidates.every((r) =>
      r.links.every(
        (l) =>
          SUPPORTED.includes(l.type) &&
          ["NAME", "TEXT", "LOGO", "SOCIAL", "APP"].includes(l.source) &&
          ["STRONG", "MEDIUM", "WEAK"].includes(l.strength) &&
          typeof l.explanation === "string" &&
          l.explanation.length > 20,
      ),
    ),
  );
  checkTrue(
    "T11 domain links name an actual shared domain",
    t6.relatedCandidates.every((r) =>
      r.links
        .filter((l) => l.type === "SHARED_DOMAIN")
        .every((l) => l.explanation.includes("shared.io") || l.explanation.includes("evil-pay.com")),
    ),
  );
  checkTrue(
    "T11 no risk-score field on correlation output",
    JSON.stringify(t6).indexOf("riskScore") === -1 &&
      JSON.stringify(t6).indexOf("riskLevel") === -1,
  );

  /* ---- Test 12: real fixtures (buildCorrelationResult) ---- */
  const brand = { id: "b1", name: "PaySecure", website: "https://paysecure.com", logoUrl: null };
  const assets = [
    { id: "a1", brandId: "b1", type: "SOCIAL", value: "@PaySecure", createdAt: new Date() },
    { id: "a2", brandId: "b1", type: "APP", value: "com.paysecure.wallet", createdAt: new Date() },
    { id: "a3", brandId: "b1", type: "DOMAIN", value: "paysecure.com", createdAt: new Date() },
    { id: "a4", brandId: "b1", type: "WEBSITE", value: "https://paysecure.com", createdAt: new Date() },
  ];
  const cand = (id, type, over) => ({
    id, type, brandId: "b1", status: "PENDING",
    createdAt: new Date(), updatedAt: new Date(),
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
  const c3 = cand("c3", "SOCIAL", {
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
  const evilDomain = cand("ew", "DOMAIN", { value: "evil-pay.com" });
  const all = [c1, c2, c3, official, officialWeb, evilDomain];

  const t12 = await buildCorrelationResult(c1, brand, assets, all);
  check("T12 top-level keys", Object.keys(t12).sort(), RESULT_KEYS);
  check("T12 related ids", t12.relatedCandidates.map((r) => r.candidateId), ["c2", "ew"]);
  check("T12 strongest first", t12.relatedCandidates[0].candidateId, "c2");
  check("T12 pair score", t12.relatedCandidates[0].relationshipScore, 86); // 45 + 30 + 11
  check("T12 pair level", t12.relatedCandidates[0].relationshipLevel, "VERY_HIGH");
  check("T12 domain-only peer", [t12.relatedCandidates[1].relationshipScore, t12.relatedCandidates[1].relationshipLevel], [45, "MEDIUM"]);
  check(
    "T12 cluster transitive",
    t12.cluster,
    { candidateIds: ["c1", "c2", "ew"], size: 3 },
  );
  checkTrue(
    "T12 official peer not correlated",
    !t12.relatedCandidates.some((r) => r.candidateId === "off") &&
      !t12.cluster.candidateIds.includes("off"),
  );
  checkTrue(
    "T12 official-domain website not correlated",
    !t12.relatedCandidates.some((r) => r.candidateId === "web") &&
      !t12.cluster.candidateIds.includes("web"),
  );

  const t12b = await buildCorrelationResult(c3, brand, assets, all);
  check("T12b harmless subject", t12b, {
    candidateId: "c3",
    relatedCandidates: [],
    cluster: { candidateIds: ["c3"], size: 1 },
  });

  const t12c = await buildCorrelationResult(official, brand, assets, all);
  check("T12c official subject", [t12c.relatedCandidates.length, t12c.cluster.size], [0, 1]);

  const t12d = await buildCorrelationResult(c1, brand, assets, [c1]);
  check("T12d subject only", [t12d.relatedCandidates.length, t12d.cluster.size], [0, 1]);

  const t12e = await buildCorrelationResult(c1, brand, assets, [...all].reverse());
  check("T12e input-order independent", JSON.stringify(t12e), JSON.stringify(t12));

  /* ---- report ---- */
  console.log(`\nTask 14 pure tests — passed: ${passed}, failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  console.log("ALL TASK 14 PURE TESTS PASSED");
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
