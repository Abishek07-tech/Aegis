const path = require("path");
const fs = require("fs");

const svcPath = path.join(__dirname, "..", "dist", "services", "app-risk.service.js");
if (!fs.existsSync(svcPath)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
const {
  getOfficialAppValues,
  isOfficialAppIdentity,
  findBestAppIdentityMatch,
  buildAppDescriptionText,
  buildAppSignals,
  buildAppRiskResult,
} = require(svcPath);

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

const approx = (label, actual, expected) => {
  if (actual === expected) passed++;
  else {
    failed++;
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
};

/* ---- fixtures ---- */
const brand = { name: "PaySecure", website: "https://paysecure.com" };
const assets = [
  { id: "a1", brandId: "b1", type: "SOCIAL", value: "@PaySecure", createdAt: new Date() },
  { id: "a2", brandId: "b1", type: "APP", value: "com.paysecure.wallet", createdAt: new Date() },
  { id: "a3", brandId: "b1", type: "DOMAIN", value: "paysecure.com", createdAt: new Date() },
  { id: "a4", brandId: "b1", type: "WEBSITE", value: "https://paysecure.com", createdAt: new Date() },
];

/* ---- helpers ---- */
check("getOfficialAppValues", getOfficialAppValues(assets), ["com.paysecure.wallet"]);
check("getOfficialAppValues empty", getOfficialAppValues([]), []);
check("isOfficialAppIdentity exact", isOfficialAppIdentity("com.paysecure.wallet", ["com.paysecure.wallet"]), true);
check("isOfficialAppIdentity case-insensitive", isOfficialAppIdentity("COM.PAYSECURE.WALLET", ["com.paysecure.wallet"]), true);
check("isOfficialAppIdentity not exact", isOfficialAppIdentity("com.paysecure.wallet.fake", ["com.paysecure.wallet"]), false);
check("isOfficialAppIdentity no assets", isOfficialAppIdentity("com.paysecure.wallet", []), false);
check("buildAppDescriptionText", buildAppDescriptionText({ name: "App Name", description: "App desc" }), "App Name App desc");
check("buildAppDescriptionText empty", buildAppDescriptionText({ name: null, description: null }), "");

/* ---- Test 1: obvious fake PaySecure app ---- */
const t1 = buildAppSignals({
  candidate: {
    value: "com.paysecure.fake.wallet",
    name: "PaySecure",
    description: "Official PaySecure app with support and refund protection.",
  },
  brand,
  assets,
});
const names1 = t1.signals.map((s) => s.signal).sort();
check("T1 signal names", names1, ["APP_BRAND_IMPERSONATION", "APP_DESCRIPTION_MATCH", "APP_NAME_SIMILARITY", "PACKAGE_IDENTIFIER_SIMILARITY"].sort());
check("T1 name severity HIGH", t1.signals.find((s) => s.signal === "APP_NAME_SIMILARITY").severity, "HIGH");
check("T1 description severity HIGH", t1.signals.find((s) => s.signal === "APP_DESCRIPTION_MATCH").severity, "HIGH");
check("T1 package severity MEDIUM+", ["MEDIUM", "HIGH"].includes(t1.signals.find((s) => s.signal === "PACKAGE_IDENTIFIER_SIMILARITY").severity), true);
check("T1 impersonation severity HIGH", t1.signals.find((s) => s.signal === "APP_BRAND_IMPERSONATION").severity, "HIGH");
check("T1 impersonation score", t1.signals.find((s) => s.signal === "APP_BRAND_IMPERSONATION").score, 0.9);
check("T1 hasHighSeverity", buildAppRiskResult("c1", t1).hasHighSeverity, true);
check("T1 signalCount", buildAppRiskResult("c1", t1).signalCount, 4);

/* ---- Test 2: exact official PaySecure app ---- */
const t2 = buildAppSignals({
  candidate: {
    value: "com.paysecure.wallet",
    name: "PaySecure Official",
    description: "The official PaySecure wallet.",
  },
  brand,
  assets,
});
const names2 = t2.signals.map((s) => s.signal);
check("T2 only OFFICIAL_APP_MATCH", names2, ["OFFICIAL_APP_MATCH"]);
check("T2 no impersonation flag", names2.includes("APP_BRAND_IMPERSONATION"), false);
check("T2 hasHighSeverity false", buildAppRiskResult("c2", t2).hasHighSeverity, false);

/* ---- Test 3: harmless unrelated app ---- */
const t3 = buildAppSignals({
  candidate: {
    value: "com.example.travel",
    name: "Travel Journal",
    description: "A journal for travelers.",
  },
  brand,
  assets,
});
check("T3 no signals", t3.signals.length, 0);
check("T3 hasHighSeverity false", buildAppRiskResult("c3", t3).hasHighSeverity, false);

/* ---- Test 4: high app-name similarity ---- */
const t4 = buildAppSignals({
  candidate: {
    value: "com.other.app",
    name: "PaySecure",
    description: "Some unrelated app",
  },
  brand,
  assets,
});
const nameSignal4 = t4.signals.find((s) => s.signal === "APP_NAME_SIMILARITY");
check("T4 name severity HIGH", nameSignal4.severity, "HIGH");
approx("T4 name score", nameSignal4.score, 1);
check("T4 has name signal", t4.signals.map((s) => s.signal).includes("APP_NAME_SIMILARITY"), true);

/* ---- Test 5: description similarity ---- */
const t5 = buildAppSignals({
  candidate: {
    value: "com.other.app",
    name: "Test App",
    description: "PaySecure payment gateway with full support",
  },
  brand,
  assets,
});
const descSignal5 = t5.signals.find((s) => s.signal === "APP_DESCRIPTION_MATCH");
check("T5 description severity HIGH", descSignal5.severity, "HIGH");
check("T5 hasHighSeverity", buildAppRiskResult("c5", t5).hasHighSeverity, true);

/* ---- Test 6: generic words not producing HIGH ---- */
const t6 = buildAppSignals({
  candidate: {
    value: "com.example.wallet",
    name: "My Wallet App",
    description: "Secure banking support and refund protection",
  },
  brand,
  assets,
});
const nameSignal6 = t6.signals.find((s) => s.signal === "APP_NAME_SIMILARITY");
check("T6 name not HIGH", nameSignal6 === undefined || nameSignal6.severity !== "HIGH", true);
const descSignal6 = t6.signals.find((s) => s.signal === "APP_DESCRIPTION_MATCH");
check("T6 description not HIGH", descSignal6 === undefined || descSignal6.severity !== "HIGH", true);
check("T6 hasHighSeverity false", buildAppRiskResult("c6", t6).hasHighSeverity, false);

/* ---- Test 7: official domain protection ---- */
const t7 = buildAppSignals({
  candidate: {
    value: "com.example.app",
    name: "Test App",
    description: "Visit https://paysecure.com for more info.",
  },
  brand,
  assets,
});
check("T7 no external domain", t7.signals.map((s) => s.signal).includes("EXTERNAL_DOMAIN"), false);
check("T7 official domain match present", t7.signals.map((s) => s.signal).includes("OFFICIAL_DOMAIN_MATCH"), true);

/* ---- Test 8: external domain ---- */
const t8 = buildAppSignals({
  candidate: {
    value: "com.example.app",
    name: "Test App",
    description: "Visit https://evil.com for more info.",
  },
  brand,
  assets,
});
const extDomain8 = t8.signals.find((s) => s.signal === "EXTERNAL_DOMAIN");
check("T8 external domain MEDIUM", extDomain8.severity, "MEDIUM");
check("T8 external domain score", extDomain8.score, 0.7);

/* ---- Test 9: missing metadata ---- */
const t9 = buildAppSignals({
  candidate: { value: "com.example.app", name: null, description: null },
  brand,
  assets,
});
check("T9 no signals", t9.signals.length, 0);
check("T9 hasHighSeverity false", buildAppRiskResult("c9", t9).hasHighSeverity, false);

/* ---- Test 10: deterministic output ---- */
const t10a = buildAppSignals({
  candidate: {
    value: "com.paysecure.fake",
    name: "PaySecure Fake",
    description: "Fake PaySecure app",
  },
  brand,
  assets,
});
const t10b = buildAppSignals({
  candidate: {
    value: "com.paysecure.fake",
    name: "PaySecure Fake",
    description: "Fake PaySecure app",
  },
  brand,
  assets,
});
check("T10 deterministic", JSON.stringify(t10a), JSON.stringify(t10b));

/* ---- Test 11: non-APP candidate ---- */
const t11 = buildAppSignals({
  candidate: { value: "@someuser", name: "Social User", description: "Social profile" },
  brand,
  assets: [],
});
check("T11 no signals", t11.signals.length, 0);
check("T11 hasHighSeverity false", buildAppRiskResult("c11", t11).hasHighSeverity, false);

/* ---- unavailable signal for DIFFERENT_PUBLISHER ---- */
check("T12 publisher unavailable always", t9.unavailableSignals.map((s) => s.signal).includes("DIFFERENT_PUBLISHER"), true);

/* ---- report ---- */
console.log(`\nTask 10 pure tests — passed: ${passed}, failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
console.log("ALL TASK 10 PURE TESTS PASSED");
