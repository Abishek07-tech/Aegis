# PaySecure Demo Data Setup

Repeatable, idempotent seed for a fictional **PaySecure** demo workspace using the
existing backend only. The seed calls the same service functions the API
controllers call (`createBrand`, `createOfficialAsset`, `createCandidate`), so
every record matches the Prisma schema and controller validation exactly — no
schema fields, endpoints, detection logic, or frontend components are added or
changed. All values are fictional and use reserved `.example` domains; nothing
contacts an external platform. No credentials are hardcoded and `.env` is never
written by the tooling.

## What it creates

**Brand** — one record:

| Field | Value |
|---|---|
| name | `PaySecure` |
| website | `https://paysecure.example` |
| logoUrl | *(unset — logo analysis reports "unavailable", no image fetches)* |

**Official assets** (5, types restricted to the API's `SOCIAL, WEBSITE, APP, DOMAIN`):

| Type | Value |
|---|---|
| WEBSITE | `https://paysecure.example` |
| DOMAIN | `paysecure.example` |
| SOCIAL | `@PaySecure` |
| SOCIAL | `@PaySecureCareers` |
| APP | `com.paysecure.wallet` |

**Candidates** (5, all linked to the brand, status `PENDING`):

| # | Type | Value | Name | Designed to exercise |
|---|---|---|---|---|
| 1 | SOCIAL | `@PaySecureHQ` | PaySecure HQ | Look-alike account: `NAME_SIMILARITY` + `OFFICIAL_IDENTITY_CONFLICT` (handle containment on `@PaySecure`), brand text, external domain |
| 2 | SOCIAL | `@PaySecure_Support` | PaySecure Support | Fake support account: look-alike handle + `SUPPORT_LANGUAGE` (HIGH) + external domain |
| 3 | APP | `com.paysecure.wallet.pro` | PaySecure Wallet Pro | Impersonating app: package identifier contains the official id, name/description mirror the brand → `APP_BRAND_IMPERSONATION` |
| 4 | DOMAIN | `paysecure-login.example` | PaySecure Login Portal | Look-alike domain sharing the phishing infrastructure referenced by candidates 1–2 (`SHARED_DOMAIN` correlation). Analysis endpoints are type-gated to SOCIAL/APP and correctly return `400 NOT_APPLICABLE` for this record |
| 5 | SOCIAL | `@PaySecureCareers` | PaySecure Careers | **False-positive protection**: handle exactly matches the registered `@PaySecureCareers` official asset → protective `OFFICIAL_ACCOUNT_MATCH` + `OFFICIAL_DOMAIN_MATCH`, risk stays `LOW` |

Candidates 1, 2 and 4 deliberately share `paysecure-login.example`, so
correlation/campaign analysis produces a small realistic cluster; the careers
account (5) is excluded from threat clusters by the exact-official protection.

## Setup

Prerequisites: Node.js 20+, npm, PostgreSQL. From the repository root:

```bash
cd apps/api

# 1. Point the seed at the target database.
#    Recommended: a dedicated demo database so the dashboard shows only PaySecure.
#    Set DATABASE_URL in your shell (or in apps/api/.env — never commit it).
export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/aegis_demo?schema=public"

# 2. Apply the schema (once per database)
npx prisma migrate deploy        # or: npm run db:migrate on a fresh dev database

# 3. Seed (safe to rerun)
npm run demo:seed

# 4. Run the API
npm run dev                      # http://localhost:4000
```

To use the browser UI against the seeded API (frontend is at the repo root):

```bash
# API must allow the Vite dev origin (default port 5173)
CORS_ORIGIN="http://localhost:5173" npm run dev        # in apps/api

cd ../..                                          # repository root
VITE_USE_MOCK_DATA=false VITE_API_BASE_URL=http://localhost:4000 npm run dev
```

Open a threat row → drawer → **Run Aegis Analysis** to execute the 8-step
workflow (evidence, risk, explanation, correlation, campaign, investigation,
playbook, report) against the seeded candidates.

## Re-running

`npm run demo:seed` is idempotent. Natural keys prevent duplicates:

- brand: `name = PaySecure` **and** `website = https://paysecure.example`
- asset: `(brandId, type, value)`
- candidate: `(brandId, type, value)`

Existing records are reported as `exists` and are **never overwritten** (edit
them freely; rerunning only fills gaps). The brand key includes the website, so
an unrelated `PaySecure` brand created by other tooling/tests is never adopted
or modified.

## Resetting

**Demo records only** (removes the demo brand, its candidates, its assets via
relation cascade, plus orphaned demo candidates whose `brandId` was already
nulled — then reseeds in the same run):

```bash
cd apps/api
DATABASE_URL="..." npm run demo:reset
```

**Entire database** (destroys *all* brands/candidates — including anything the
e2e tests or other tooling created — then reapplies migrations; reseed after):

```bash
cd apps/api
DATABASE_URL="..." npx prisma migrate reset --force
DATABASE_URL="..." npm run demo:seed
```

`DATABASE_URL` may instead live in `apps/api/.env` for any of these commands;
the scripts never modify that file.

## Verifying

```bash
cd apps/api
export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/aegis_demo?schema=public"
npm run dev &                                   # API on :4000

# Records
curl -s localhost:4000/api/brands | jq '.data[] | select(.website=="https://paysecure.example")'
curl -s localhost:4000/api/candidates | jq '.data[] | {type,value,name,status}'

# The 8 analysis endpoints — run for every SOCIAL/APP candidate id (<id> from above)
for step in evidence risk explanation correlation campaign investigation playbook report; do
  curl -s -X POST "localhost:4000/api/candidates/<id>/analyze/$step" | jq '{success, code:.data.riskLevel}'
done

# DOMAIN candidate: expect 400 with a real backend code (type-gated by design)
curl -s -X POST "localhost:4000/api/candidates/<domain-id>/analyze/evidence" | jq .
# → {"success":false,...,"details":{"code":"EVIDENCE_ANALYSIS_NOT_APPLICABLE"}}
```

Expected analysis outcomes on a freshly seeded database:

- `@PaySecureHQ` / `@PaySecure_Support` → HIGH/CRITICAL risk, look-alike +
  external-domain evidence; support account has `SUPPORT_LANGUAGE` HIGH
- `com.paysecure.wallet.pro` → `APP_BRAND_IMPERSONATION` present
- `@PaySecureCareers` → risk ≤ 24 (`LOW`), protective signals only
- correlation on `@PaySecureHQ` → related to `@PaySecure_Support` and
  `paysecure-login.example`; campaign detected over that shared domain
- `paysecure-login.example` → analysis endpoints return `400` `*_NOT_APPLICABLE`

Full automated checks used during development (record shapes, all 8 endpoints
per candidate, protective/type-gate assertions) were run against this setup;
the repository's own suites remain the source of truth for regressions:

```bash
cd apps/api
npm run typecheck && npm run build
npm test              # pure analysis tests (no DB)
AEGIS_BASE_URL=http://localhost:4000 npm run test:e2e   # with a running server
```
