// PaySecure demo-data seed — repeatable, idempotent, API-schema-faithful.
//
// Creates one fictional PaySecure brand with its official assets and five
// fictional candidate records using the existing service layer (the same
// create* functions the API controllers call), so every field matches the
// Prisma schema and controller validation exactly. No schema fields, routes,
// or detection logic are added or changed. All domains are reserved
// `.example` names — nothing here ever contacts an external platform.
//
// Usage (from apps/api, DATABASE_URL must point at the target database):
//   npm run demo:seed     # create anything missing (safe to rerun)
//   npm run demo:reset    # delete only this demo's records, then reseed
//
// See docs/DEMO_SETUP.md for the full setup/verification guide.

import { prisma } from "../config/database";
import type { AssetType } from "../config/constants";
import { createOfficialAsset } from "../services/asset.service";
import { createBrand } from "../services/brand.service";
import { createCandidate } from "../services/candidate.service";

interface DemoAsset {
  readonly type: AssetType;
  readonly value: string;
}

interface DemoCandidate {
  readonly type: AssetType;
  readonly value: string;
  readonly name: string;
  readonly description: string;
}

const DEMO_BRAND = {
  name: "PaySecure",
  website: "https://paysecure.example",
} as const;

const DEMO_ASSETS: readonly DemoAsset[] = [
  { type: "WEBSITE", value: "https://paysecure.example" },
  { type: "DOMAIN", value: "paysecure.example" },
  { type: "SOCIAL", value: "@PaySecure" },
  { type: "SOCIAL", value: "@PaySecureCareers" },
  { type: "APP", value: "com.paysecure.wallet" },
];

const DEMO_CANDIDATES: readonly DemoCandidate[] = [
  {
    // Look-alike social account: handle containment on the official handle
    // (NAME_SIMILARITY + OFFICIAL_IDENTITY_CONFLICT) plus an external domain.
    type: "SOCIAL",
    value: "@PaySecureHQ",
    name: "PaySecure HQ",
    description:
      "Community page for PaySecure customers. News, offers and account information: https://paysecure-login.example/updates",
  },
  {
    // Fake support account: look-alike handle, customer-support language,
    // and the same external phishing domain as the domain candidate below.
    type: "SOCIAL",
    value: "@PaySecure_Support",
    name: "PaySecure Support",
    description:
      "Official PaySecure customer support. Verify account urgently - contact us with a refund or complaint: https://paysecure-login.example/help",
  },
  {
    // Suspicious impersonating app: package identifier contains the official
    // identifier, name/description mirror the brand -> APP_BRAND_IMPERSONATION.
    type: "APP",
    value: "com.paysecure.wallet.pro",
    name: "PaySecure Wallet Pro",
    description:
      "Send money instantly with PaySecure. Fast customer support and refund protection. Details: https://paysecure-apps.example",
  },
  {
    // Look-alike domain: shares the phishing infrastructure domain referenced
    // by the two social candidates above (SHARED_DOMAIN correlation material).
    // Analysis endpoints are type-gated to SOCIAL/APP and correctly report
    // not-applicable for this record.
    type: "DOMAIN",
    value: "paysecure-login.example",
    name: "PaySecure Login Portal",
    description: "PaySecure account sign-in portal",
  },
  {
    // Legitimate careers account for false-positive protection: its handle
    // exactly matches the registered official social asset above, so evidence
    // records protective OFFICIAL_ACCOUNT_MATCH / OFFICIAL_DOMAIN_MATCH and the
    // risk engine must keep it LOW instead of flagging it.
    type: "SOCIAL",
    value: "@PaySecureCareers",
    name: "PaySecure Careers",
    description:
      "Official PaySecure careers and hiring updates. Open roles at https://paysecure.example/careers",
  },
];

const log = (message: string): void => {
  console.log(`[demo-seed] ${message}`);
};

const findDemoBrands = () =>
  prisma.brand.findMany({
    where: { name: DEMO_BRAND.name, website: DEMO_BRAND.website },
    orderBy: { createdAt: "asc" },
  });

const resetDemoData = async (): Promise<void> => {
  const brands = await findDemoBrands();
  const brandIds = brands.map((brand) => brand.id);
  const demoValues = DEMO_CANDIDATES.map((candidate) => candidate.value);

  // Candidates first (brand deletion would only null their brandId).
  let removedCandidates = 0;
  if (brandIds.length > 0) {
    const byBrand = await prisma.candidateAsset.deleteMany({
      where: { brandId: { in: brandIds } },
    });
    removedCandidates += byBrand.count;
  }
  // Orphans left behind by earlier resets (brandId already null), matched on
  // the demo's distinctive values so unrelated records are never touched.
  const orphans = await prisma.candidateAsset.deleteMany({
    where: { brandId: null, value: { in: demoValues } },
  });
  removedCandidates += orphans.count;

  // Official assets cascade with the brand (schema: onDelete: Cascade).
  const removedBrands = await prisma.brand.deleteMany({
    where: { id: { in: brandIds } },
  });

  log(
    `reset: removed ${removedBrands.count} brand(s), ` +
      `${removedCandidates} candidate(s) (assets cascade with the brand)`,
  );
};

const main = async (): Promise<void> => {
  if (process.argv.includes("--reset")) {
    await resetDemoData();
  }

  let brand = await prisma.brand.findFirst({
    where: { name: DEMO_BRAND.name, website: DEMO_BRAND.website },
  });
  if (brand) {
    log(`brand: exists ${DEMO_BRAND.name} (id=${brand.id})`);
  } else {
    brand = await createBrand({
      name: DEMO_BRAND.name,
      website: DEMO_BRAND.website,
    });
    log(`brand: created ${DEMO_BRAND.name} (id=${brand.id})`);
  }

  let assetsCreated = 0;
  for (const asset of DEMO_ASSETS) {
    const existing = await prisma.officialAsset.findFirst({
      where: { brandId: brand.id, type: asset.type, value: asset.value },
    });
    if (existing) {
      log(`asset: exists ${asset.type} ${asset.value}`);
      continue;
    }
    await createOfficialAsset(brand.id, asset);
    assetsCreated += 1;
    log(`asset: created ${asset.type} ${asset.value}`);
  }

  let candidatesCreated = 0;
  const seeded: string[] = [];
  for (const candidate of DEMO_CANDIDATES) {
    const existing = await prisma.candidateAsset.findFirst({
      where: {
        brandId: brand.id,
        type: candidate.type,
        value: candidate.value,
      },
    });
    if (existing) {
      log(`candidate: exists ${candidate.type} ${candidate.value} (id=${existing.id})`);
      seeded.push(existing.id);
      continue;
    }
    const created = await createCandidate({ ...candidate, brandId: brand.id });
    candidatesCreated += 1;
    seeded.push(created.id);
    log(`candidate: created ${candidate.type} ${candidate.value} (id=${created.id})`);
  }

  log(
    `done: brand=${brand.id} assets ${assetsCreated}/${DEMO_ASSETS.length} created, ` +
      `candidates ${candidatesCreated}/${DEMO_CANDIDATES.length} created`,
  );
  log(
    "next: analyze any SOCIAL/APP candidate via " +
      "POST /api/candidates/<id>/analyze/evidence (or /risk, /correlation, " +
      "/campaign, /investigation, /playbook, /report, /explanation)",
  );
};

main()
  .catch((error: unknown) => {
    console.error("[demo-seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
