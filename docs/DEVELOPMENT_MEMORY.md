# Aegis — Development Memory

Persistent technical memory for the Aegis project. Only record decisions that were actually made.

---

## TASK 1 — Backend Project Setup (COMPLETED)

### Backend technology
- **Node.js** + **TypeScript** + **Express 4**
- Runtime on this machine: Node v24.18.0, npm 11.16.0
- Dev runner: `tsx` (runs TypeScript directly, watches files)
- Production: `tsc` build to `dist/`, run with `node dist/server.js`

### Backend location
- `apps/api/`
- The git repository root is the inner `Aegis/` folder (branch: `feat/backend-core`)
- No root-level `package.json` was created — the API is a standalone package for now

### Project structure
```
apps/api/
├── src/
│   ├── config/
│   │   └── env.ts              # loads .env, exports typed `env` object
│   ├── routes/
│   │   ├── index.ts            # mounts all routers
│   │   └── health.routes.ts    # GET /health
│   ├── controllers/
│   │   └── health.controller.ts
│   ├── services/               # empty (reserved for Task 2+)
│   ├── models/                 # empty (reserved for Task 2+)
│   ├── middleware/
│   │   ├── async.middleware.ts # asyncHandler wrapper for future async routes
│   │   └── error.middleware.ts # ApiError, notFoundHandler, errorHandler
│   ├── app.ts                  # createApp() builds the Express app
│   └── server.ts               # entry point, starts listening
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore                  # ignores node_modules/, dist/, .env
```

### Important configuration decisions
- **Module system:** CommonJS (`module: "commonjs"`) — simplest reliable setup with `tsx` + `tsc`, no ESM import-extension friction
- **TypeScript:** `strict: true` plus `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
- **App/server split:** `app.ts` exports `createApp()` (testable, no side effects), `server.ts` is the only file that calls `listen()`
- **CORS:** enabled, origins read from `CORS_ORIGIN` env var (comma-separated)
- **JSON body parsing:** `express.json()` + `express.urlencoded({ extended: true })`
- **Error handling:** centralized — `notFoundHandler` for unknown routes, `errorHandler` as final Express error middleware. Errors thrown as `ApiError` return `{ success: false, error, message, details? }`; unknown errors return 500 with the message hidden in production. Future routes use `asyncHandler(...)` to forward async errors automatically.
- **Response convention:** JSON with a top-level `success` boolean (matches health endpoint and error responses)
- **Environment:** `dotenv` loaded in `src/config/env.ts`

### npm scripts (in `apps/api/package.json`)
| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `tsx watch src/server.ts` | development with hot reload |
| `npm run build` | `tsc -p tsconfig.json` | production build to `dist/` |
| `npm start` | `node dist/server.js` | run built production app (requires `npm run build` first) |
| `npm run typecheck` | `tsc --noEmit` | type validation without emitting files |

### How to start the backend
```bash
cd apps/api
npm install
cp .env.example .env   # optional, defaults work without it
npm run dev            # development → http://localhost:4000
```

Production:
```bash
cd apps/api
npm run build
npm start
```

### Health endpoint
`GET /health` →
```json
{ "success": true, "service": "Aegis API", "status": "running" }
```
Verified working with curl in both dev (`tsx watch`) and production (`node dist/server.js`) modes.

Unknown routes return:
```json
{ "success": false, "error": "NotFound", "message": "Route GET /nope does not exist" }
```

### Dependencies installed
- runtime: `express`, `cors`, `dotenv`
- dev: `typescript`, `tsx`, `@types/express`, `@types/cors`, `@types/node`
- No other dependencies added

### Environment variables (`.env.example`)
| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | API port |
| `NODE_ENV` | `development` | controls error detail leakage |
| `CORS_ORIGIN` | `http://localhost:3000` | comma-separated allowed origins |

No database or third-party API variables were added in Task 1 — `DATABASE_URL` was added in Task 2 (see below).

### Assumptions / notes
- Default port **4000** chosen to avoid clashes with common 3000/5173 (frontend) and 5000 ports
- Frontend (`apps/web/`) and `services/*` folders exist but are empty and untouched
- `docs/architecture.md` and `README.md` existed but were empty — left as-is
- npm on this machine blocks postinstall scripts by default (`allow-scripts`); `tsx` still works because esbuild's binary comes from an optional dependency package
- No git commit was made (not requested)

---

## TASK 2 — Database Setup (COMPLETED)

### Technology
- **PostgreSQL** + **Prisma ORM 7.10.0**
- Versions pinned deliberately: npm's `latest` tag for `prisma` currently points at `8.0.0-rc.21` (a release candidate), so the CLI was pinned to `7.10.0` to match `@prisma/client@7.10.0` (stable)
- Prisma 7 uses a **driver adapter** for PostgreSQL: `@prisma/adapter-pg` + `pg` (there is no built-in engine connection anymore)

### Packages installed
- runtime: `@prisma/client@7.10.0`, `@prisma/adapter-pg@7.10.0`, `pg`
- dev: `prisma@7.10.0`, `@types/pg`

### Files created / changed in Task 2
```
apps/api/prisma/schema.prisma      # Brand + OfficialAsset models
apps/api/prisma7.config.ts         # Prisma 7 config — reads DATABASE_URL (created by `prisma init`)
apps/api/src/config/database.ts    # PrismaClient singleton (pg adapter)
apps/api/src/config/env.ts         # + DATABASE_URL export
apps/api/.env                      # local placeholder (gitignored)
apps/api/.env.example              # + DATABASE_URL placeholder
apps/api/package.json              # + db scripts, build now runs `prisma generate` first
apps/api/.gitignore                # + /src/generated/prisma (appended by `prisma init`)
apps/api/src/generated/prisma/     # generated client — gitignored, do not edit
```
Removed after `prisma init` (agent-tool clutter, not project code): `.claude/`, `.windsurf/`, `.agents/`, `skills-lock.json`.

### Schema (prisma/schema.prisma)
```prisma
model Brand {
  id        String   @id @default(cuid())
  name      String
  logoUrl   String?
  website   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  assets OfficialAsset[]
}

model OfficialAsset {
  id        String   @id @default(cuid())
  brandId   String
  type      String
  value     String
  createdAt DateTime @default(now())
  brand Brand @relation(fields: [brandId], references: [id], onDelete: Cascade)
  @@index([brandId])
  @@index([type])
}
```

### Schema decisions
- **IDs:** `String` + `cuid()` (Prisma's default style — no exposed sequential IDs)
- **`logoUrl` / `website`:** nullable — a brand may not have one yet
- **`OfficialAsset.type`:** plain `String`, not an enum — asset categories are decided in Task 4, an enum would force a migration to add values
- **`OfficialAsset` has no `updatedAt`** — matches the Task 2 field list exactly
- **Relation:** `Brand.assets` ↔ `OfficialAsset.brand`, `onDelete: Cascade` (deleting a brand removes its official assets)
- **Indexes:** on `brandId` (joins) and `type` (future asset lookups)

### Connection configuration
- `DATABASE_URL` lives in `.env` (gitignored) and is read by `prisma7.config.ts` for the CLI
- At runtime the app reads `env.DATABASE_URL` (via `src/config/env.ts`) and passes it to `new PrismaPg({ connectionString })`
- `.env.example` contains a placeholder only: `postgresql://USER:PASSWORD@localhost:5432/aegis?schema=public`
- Prisma 7 puts the datasource URL in `prisma7.config.ts`, **not** in `schema.prisma` (the `datasource db` block only declares the provider)

### Client usage (for future tasks)
```ts
import { prisma } from "../config/database";

const brands = await prisma.brand.findMany();
```
`src/config/database.ts` exports a singleton `PrismaClient` (reused across hot reloads in dev) and throws a clear error if `DATABASE_URL` is missing. The client connects lazily — importing it does **not** open a connection.

### npm scripts added
| Script | Command |
|---|---|
| `npm run db:generate` | `prisma generate` |
| `npm run db:validate` | `prisma validate` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run build` | `prisma generate && tsc -p tsconfig.json` (changed) |

### How to set up the database (when credentials exist)
```bash
cd apps/api
cp .env.example .env      # then edit DATABASE_URL
npm run db:generate       # regenerate client (also runs inside `npm run build`)
npm run db:migrate        # create + apply the first migration
```

### Validation results
- `prisma validate` → **schema is valid** ✅
- `prisma generate` → **Prisma Client 7.10.0 generated** to `src/generated/prisma` ✅
- `prisma generate` also works with no `.env` present ✅
- `npm run typecheck` and `npm run build` → pass ✅
- Client construction smoke test → `prisma.brand` and `prisma.officialAsset` delegates exist ✅
- Task 1 regression: `GET /health` still returns the expected JSON ✅

### Important notes / assumptions
- **A local PostgreSQL server IS running on 127.0.0.1:5432**, but no credentials are available (peer auth fails for OS user `abishek`, TCP requires a password). No database was created and **no migration has been applied** — `prisma migrate dev` / `db push` must be run once `DATABASE_URL` is real
- `src/generated/prisma/` is gitignored — run `npm run db:generate` (or `npm run build`) after a fresh clone, otherwise `tsc` cannot resolve the client import
- No Brand/Asset APIs, no detection, no risk logic — Task 3+ territory

---

## TASK 3 — Cleanup + Brand Profile (COMPLETED)

### Cleanup performed
Inspected the whole repo (duplicates, temp files, tool clutter, empty folders):
- **Already clean** — no duplicate files, no temp/backup files, no Prisma/OpenCode agent clutter (the `prisma init` skills folders `.claude/`, `.windsurf/`, `.agents/`, `skills-lock.json` were already removed in Task 2)
- **Removed:** `apps/api/src/models/` + `.gitkeep` — empty placeholder with no purpose; Prisma models live in `prisma/schema.prisma` and typed models come from the generated client
- **Removed:** `apps/api/src/services/.gitkeep` — replaced by the real `brand.service.ts`
- **Kept (empty but intentional):** `apps/web/`, `services/*`, `data/*` — pre-existing repo scaffold for future tasks; `README.md`, `docs/architecture.md` — empty but listed in the target structure
- **Kept:** `apps/api/dist/`, `apps/api/src/generated/` — build artifacts, both gitignored

### Final project structure (actual)
```
Aegis/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── database.ts        # PrismaClient singleton
│   │   │   │   └── env.ts             # env vars incl. DATABASE_URL
│   │   │   ├── controllers/
│   │   │   │   ├── brand.controller.ts
│   │   │   │   └── health.controller.ts
│   │   │   ├── middleware/
│   │   │   │   ├── async.middleware.ts
│   │   │   │   └── error.middleware.ts
│   │   │   ├── routes/
│   │   │   │   ├── brand.routes.ts
│   │   │   │   ├── health.routes.ts
│   │   │   │   └── index.ts
│   │   │   ├── services/
│   │   │   │   └── brand.service.ts
│   │   │   ├── generated/prisma/      # gitignored, prisma generate output
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   ├── .env                       # gitignored
│   │   ├── .env.example
│   │   ├── .gitignore
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   ├── prisma7.config.ts
│   │   ├── tsconfig.json
│   │   └── dist/                      # gitignored, build output
│   └── web/                           # empty, future frontend
├── data/                              # empty, future scenario data
│   ├── apps/ brands/ scenarios/ social/
├── services/                          # empty, future microservices
│   ├── ai-investigator/ correlation/ detection/ risk-engine/
├── docs/
│   ├── DEVELOPMENT_MEMORY.md
│   ├── TASK_STATUS.md
│   └── architecture.md                # still empty
└── README.md                          # still empty
```

### Brand Profile API
Flow: **route → controller → service → Prisma**

| Method | Path | Handler | Behaviour |
|---|---|---|---|
| POST | `/api/brands` | `createBrandHandler` | validates body, creates brand → **201** `{success, data}` |
| GET | `/api/brands` | `listBrandsHandler` | all brands, newest first → **200** `{success, count, data}` |
| GET | `/api/brands/:id` | `getBrandHandler` | one brand → **200** `{success, data}`, missing → **404** |
| DELETE | `/api/brands/:id` | `deleteBrandHandler` | deletes brand (OfficialAssets cascade) → **200** `{success, data:{id, deleted:true}}`, missing → **404** |

Files:
- `src/routes/brand.routes.ts` — router, mounted at `/api/brands` in `src/routes/index.ts`
- `src/controllers/brand.controller.ts` — validation + response shaping
- `src/services/brand.service.ts` — Prisma queries (`createBrand`, `listBrands`, `getBrandById`, `deleteBrandById`)

### Validation rules (POST /api/brands)
- `name` required, must be a string, cannot be empty/whitespace → **400** `"name is required and cannot be empty"` (value is trimmed before save)
- `logoUrl`, `website` optional → missing/null/empty-string stored as `null`; if present must be a string → **400** `"logoUrl must be a string"` / `"website must be a string"`
- Malformed JSON body → **400** (see error-handling change below)
- No URL-format validation (kept simple; can be added in a later task if needed)

### Architecture decisions
- **Response envelope:** success → `{ success: true, data }` (list adds `count`); errors → `{ success: false, error, message, details? }` — matches Task 1 health/error format
- **Validation lives in the controller** (request-shaping concern), queries live in the service — no schema-validation library added
- **`asyncHandler`** wraps every controller so thrown `ApiError`s and Prisma errors reach the central error middleware
- **Delete checks existence first** (`findUnique` → 404 → `delete`) so a missing ID returns 404 rather than a Prisma P2025 error; cascade of `OfficialAsset` rows is handled by the DB relation (`onDelete: Cascade` from Task 2)
- **Error middleware extended:** errors carrying a 4xx `status`/`statusCode` (e.g. body-parser `SyntaxError` on malformed JSON) now return 4xx with `{success:false, error:"BadRequest", ...}` instead of 500

### Validation results (Task 3)
- `npm run typecheck` → **pass** ✅
- `npm run build` (prisma generate + tsc) → **pass** ✅
- Runtime tests against `node dist/server.js`:
  - `GET /health` → **200** correct JSON ✅
  - `POST /api/brands` missing name → **400** ✅
  - `POST /api/brands` name `"   "` → **400** ✅
  - `POST /api/brands` malformed JSON → **400** BadRequest ✅
  - `POST /api/brands` non-string `logoUrl` → **400** ✅
  - `GET /api/nope` → **404** ✅
  - `GET /api/brands` → **500** `P1000 AuthenticationFailed` (placeholder credentials) — route wiring works, DB call reached the local server ✅
- **NOT tested against a real database:** create/read/update/delete success paths, 404-on-missing-ID (DB-backed), and `OfficialAsset` cascade delete — no valid PostgreSQL credentials available (no `.pgpass`, no env vars, TCP auth rejected, sudo needs a password)

### Notes for Task 4
- `OfficialAsset` model + cascade relation already exist from Task 2 — the Official Asset API should follow the same route → controller → service → Prisma pattern
- Mount new routers in `src/routes/index.ts` under `/api/...`
- Once real `DATABASE_URL` exists: run `npm run db:migrate`, then re-test all Brand endpoints end-to-end (including cascade delete)

---

## TASK 4 — Official Asset Registry (COMPLETED)

### Cleanup inspection
- No duplicate, temp, backup, or tool-generated files found anywhere in the repo (src has zero duplicate basenames) — nothing removed
- No schema/design changes: reused the Task 2 `OfficialAsset` model as-is

### Files created / changed
```
NEW     src/services/asset.service.ts       # asset queries + OFFICIAL_ASSET_TYPES
NEW     src/controllers/asset.controller.ts # ownership checks + validation
NEW     src/routes/asset.routes.ts          # Router({ mergeParams: true })
CHANGED src/routes/index.ts                 # mounts /api/brands/:brandId/assets
NEW     README.md                           # full project README (was empty)
CHANGED docs/TASK_STATUS.md, docs/DEVELOPMENT_MEMORY.md
```

### Final structure (actual, backend)
```
apps/api/
├── prisma/schema.prisma
├── prisma7.config.ts, package.json, tsconfig.json, .env.example, .gitignore
├── src/
│   ├── config/       database.ts, env.ts
│   ├── controllers/  brand.controller.ts, asset.controller.ts, health.controller.ts
│   ├── middleware/   async.middleware.ts, error.middleware.ts
│   ├── routes/       index.ts, brand.routes.ts, asset.routes.ts, health.routes.ts
│   ├── services/     brand.service.ts, asset.service.ts
│   ├── generated/    prisma/ (gitignored)
│   ├── app.ts, server.ts
├── dist/ (gitignored)
```
Root: `apps/web/`, `data/{apps,brands,scenarios,social}/`, `services/{ai-investigator,correlation,detection,risk-engine}/`, `docs/{DEVELOPMENT_MEMORY,TASK_STATUS,architecture}.md`, `README.md`.

### Official Asset Registry API
| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/brands/:brandId/assets` | create asset → **201** `{success, data}` |
| GET | `/api/brands/:brandId/assets` | list brand's assets (newest first) → **200** `{success, count, data}` |
| GET | `/api/brands/:brandId/assets/:assetId` | one asset → **200** `{success, data}` |
| DELETE | `/api/brands/:brandId/assets/:assetId` | delete → **200** `{success, data:{id, deleted:true}}` |

All endpoints: brand missing → **404**; GET/DELETE asset missing **or belonging to another brand** → **404** (identical response — no existence leak).

### Supported asset types
`SOCIAL`, `WEBSITE`, `APP`, `DOMAIN` — defined once as `OFFICIAL_ASSET_TYPES` in `src/services/asset.service.ts` (exported const array + type guard). `OfficialAsset.type` stays a plain DB `String` (no schema change).

### Validation rules (POST)
- `type` required, non-empty string → else **400** `"type is required"`; trimmed + uppercased, then must be in the list → else **400** `"type must be one of: SOCIAL, WEBSITE, APP, DOMAIN"` (case-insensitive input accepted, stored uppercase)
- `value` must be a string → **400** `"value must be a string"`; trimmed, empty → **400** `"value is required and cannot be empty"`

### Ownership rules
- Every handler runs `requireBrand(brandId)` (reuses `getBrandById` from `brand.service.ts` — no duplicated brand logic) → 404 if the brand does not exist
- Asset queries use `findFirst({ where: { id, brandId } })` so an asset ID from another brand behaves exactly like a non-existent one → 404
- `deleteOfficialAsset` re-checks ownership before `delete`

### Architecture decisions
- **Mount point:** `router.use("/api/brands/:brandId/assets", assetRouter)` in `routes/index.ts`, with `Router({ mergeParams: true })` in `asset.routes.ts` so `brandId` is available in `req.params` — keeps `brand.routes.ts` untouched and avoids route conflicts (assets mounted before brands; brand routes only match single path segments)
- **Body validation runs BEFORE the brand lookup** on POST — bad input returns 400 without a DB round-trip; missing brand still returns 404 after validation passes
- No unique constraint on `(brandId, type, value)` — duplicates were not forbidden by the spec, adding one would require a schema migration
- No new dependencies added

### Validation results (Task 4)
- `npm run typecheck` → **pass** ✅
- `npm run build` → **pass** ✅
- Runtime (against `node dist/server.js`):
  - `GET /health` → **200** ✅
  - `POST .../assets` missing type → **400** ✅ / invalid type → **400** ✅ / empty value → **400** ✅ / non-string value → **400** ✅
  - Valid asset body → reaches `brand.findUnique` (route + ownership wiring proven) ✅
  - GET list / GET single / DELETE → reach the brand-existence check ✅
  - Brand regression (`POST /api/brands` missing name → 400) ✅; unknown route → 404 ✅
- **Not tested against a real database:** 404-on-missing-brand, create/list/get/delete success paths, cross-brand 404 isolation, and brand-cascade delete — no valid PostgreSQL credentials (unchanged from Task 3)

### Notes for Task 5 (Candidate Asset System)
- Pattern to copy: `routes → controller → service → Prisma`, mount new routers in `routes/index.ts`
- Candidate assets will likely mirror official assets but must reference scan/candidate context instead of owning `brandId` — design in Task 5
- Once `DATABASE_URL` is real: `npm run db:migrate`, then end-to-end test Brand + OfficialAsset flows (including cascade delete and cross-brand 404s)

---

## TASK 5 — Candidate Asset System (COMPLETED) — ends PHASE 1

### Cleanup inspection
- No duplicate, temporary, or tool-generated files found — nothing removed
- Task 1–4 code untouched except one deliberate DRY change (see "shared constants" below)

### Files created / changed
```
CHANGED prisma/schema.prisma             # + CandidateAsset model, + Brand.candidates back-relation
NEW     src/config/constants.ts          # ASSET_TYPES + CANDIDATE_STATUSES + type guards (shared)
CHANGED src/services/asset.service.ts    # now aliases its type list from constants (exported API identical)
NEW     src/services/candidate.service.ts
NEW     src/controllers/candidate.controller.ts
NEW     src/routes/candidate.routes.ts
CHANGED src/routes/index.ts              # mounts /api/candidates
CHANGED docs/TASK_STATUS.md, docs/DEVELOPMENT_MEMORY.md, README.md
```

### Prisma schema changes
```prisma
model CandidateAsset {
  id          String   @id @default(cuid())
  type        String
  value       String
  name        String?
  description String?
  brandId     String?          // optional — candidate may be found before knowing the target brand
  status      String   @default("PENDING")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  brand Brand? @relation(fields: [brandId], references: [id], onDelete: SetNull)
  @@index([status])
  @@index([brandId])
}
```
- `Brand.candidates CandidateAsset[]` back-relation added
- `prisma validate` → valid ✅, `prisma generate` → client regenerated with `candidateAsset` ✅, **no migration applied** (no PostgreSQL credentials)

### Candidate statuses
`PENDING` → `REVIEWING` → `CONFIRMED` / `DISMISSED` (workflow not enforced — any listed status may be set at any time; enforced values only). Stored as `String` with DB default `PENDING`.

### Supported candidate types
`SOCIAL`, `WEBSITE`, `APP`, `DOMAIN` — same vocabulary as official assets.

**Shared-constants decision:** the type/status lists and guards now live once in `src/config/constants.ts`. `asset.service.ts` re-exports them under its existing names (`OFFICIAL_ASSET_TYPES`, `isOfficialAssetType`, …), so `asset.controller.ts` and all Task 4 behaviour are unchanged — only the internal source of the list moved. Both future phases reuse the same file.

### Candidate Asset API
| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/candidates` | create → **201** `{success, data}`; `status` forced to `PENDING` (any `status` in the body is ignored) |
| GET | `/api/candidates` | list newest-first → **200** `{success, count, data}`; filters `?status=`, `?type=`, `?brandId=` |
| GET | `/api/candidates/:id` | → **200** `{success, data}`, missing → **404** |
| PATCH | `/api/candidates/:id/status` | update status → **200** `{success, data}`, missing → **404** |
| DELETE | `/api/candidates/:id` | → **200** `{success, data:{id, deleted:true}}`, missing → **404** |

Mounted in `routes/index.ts` as `router.use("/api/candidates", candidateRouter)` (no mergeParams needed — candidates are top-level, not nested under brands).

### Validation rules
- POST: `type` required → 400 `"type is required"`; trimmed + uppercased, must be in `ASSET_TYPES` → 400 otherwise
- POST: `value` must be a string → 400; trimmed, empty → 400
- POST: `name`, `description`, `brandId` optional — non-string → 400, trimmed, empty string → stored as `null`
- POST with `brandId`: brand verified **after** body validation → missing brand → **404**
- GET filters: invalid `status` → 400 (`status must be one of: PENDING, REVIEWING, CONFIRMED, DISMISSED`), invalid `type` → 400, repeated/non-string filter value → 400; filter values are case-insensitive (normalized to uppercase); a `brandId` filter with no such brand simply returns an empty list (not 404)
- PATCH: `status` required → 400; uppercased then must be in `CANDIDATE_STATUSES` → 400; candidate missing → 404 (existence checked **after** status validation)
- No URL/format validation on `value` (kept simple, consistent with Tasks 3–4)

### Architecture decisions
- Same flow as before: **route → controller → service → Prisma**; no new dependencies
- Candidates are **not nested under brands** (a candidate may exist before its brand is known) — hence the top-level `/api/candidates` route and optional `brandId`
- **`onDelete: SetNull` for `CandidateAsset.brand`** — deleting a Brand keeps candidate evidence (only its `brandId` is cleared), while `OfficialAsset` still cascades. Official = owned by brand; candidate = independent evidence
- Status/type validated in the controller (request concern); queries in `candidate.service.ts`
- `updateCandidateStatus` uses a pre-read (404) then `update`, matching the existence-check pattern used by brand/asset endpoints
- Indexes added on `status` and `brandId` because the list endpoint filters on them

### Validation results (Task 5)
- `npm run typecheck` → **pass** ✅
- `npm run build` (prisma generate + tsc) → **pass** ✅
- `prisma validate` → **valid** ✅ · `prisma generate` → **client regenerated (includes CandidateAsset)** ✅
- Runtime against `node dist/server.js`:
  - `GET /health` → **200** ✅
  - POST: missing type / bad type / missing value / empty value / non-string name → all **400** ✅
  - POST valid (no brandId) → reaches `candidateAsset.create` ✅ · POST with brandId → reaches `brand.findUnique` ✅
  - LIST: bad `status` filter → **400** ✅, bad `type` filter → **400** ✅, valid filters → reaches `candidateAsset.findMany` ✅
  - GET one → reaches `candidateAsset.findUnique` ✅
  - PATCH: bad status → **400** ✅, missing status → **400** ✅, valid status → reaches candidate lookup ✅
  - DELETE → reaches candidate lookup ✅
  - Regressions: brand `POST` missing name → **400** ✅, official asset bad type → **400** ✅, unknown route → **404** ✅
- **Not tested against a real database** (no PostgreSQL credentials): every success path (create/list/get/update/delete returning data), 404-on-missing-candidate/brand, filter results, `status` default, and `SetNull` behaviour on brand delete

### PHASE 1 — status
All Task 1–5 deliverables complete: Express+TS backend, Prisma/PostgreSQL setup, Brand Profile, Official Asset Registry, Candidate Asset System.

### Notes for Phase 2 (Task 6 — Name/Handle Similarity)
- Reuse `src/config/constants.ts` (`ASSET_TYPES`, guards) for any new type vocabulary
- Similarity logic belongs in `src/services/` (e.g. a detection service) invoked by controllers — do not put scoring inside controllers
- Remember: no DB migration has ever been applied; first real-DB session must run `npm run db:migrate` and then re-test Tasks 3–5 end-to-end

---

## TASK 6 — Name / Handle Similarity (COMPLETED) — opens PHASE 2

### Cleanup inspection
- No duplicate, temporary, or tool-generated files found — nothing removed
- Tasks 1–5 code untouched except additive changes (new service, new handler, new route, new constants)

### Files created / changed
```
NEW     src/services/similarity.service.ts     # pure functions: normalize, Levenshtein, score, level
NEW     src/services/name-analysis.service.ts  # detection flow: candidate → brand → assets → best match
CHANGED src/config/constants.ts               # + SIMILARITY_THRESHOLDS, + SimilarityLevel
CHANGED src/controllers/candidate.controller.ts# + analyzeCandidateNameHandler + failure messages
CHANGED src/routes/candidate.routes.ts        # + POST /:candidateId/analyze/name
CHANGED docs/*, README.md
```

### Text normalization rules (`normalizeText`)
Applied in order: lowercase → strip `@`, whitespace (`\s`), `_`, `-`, `.` (also trims, since whitespace is removed). No other characters are touched.

| Input | Normalized |
|---|---|
| `@PaySecure` | `paysecure` |
| `Pay-Secure` | `paysecure` |
| `Pay_Secure` | `paysecure` |
| `pay secure` | `paysecure` |
| `pay.secure` | `paysecure` |
| `PAYSECURE` | `paysecure` |

### Similarity algorithm
- **Levenshtein edit distance** (classic DP, O(m·n), no dependencies) → `similarityScore(a, b)`
- `score = 1 - distance / max(len(normalized a), len(normalized b))`, clamped to `[0, 1]`, rounded to **2 decimals**
- Both strings identical after normalization → `1`; both empty → `1` (callers pre-filter empties, so this never reaches a comparison)
- **Score range:** `0` (completely different) … `1` (identical)
- Functions: `normalizeText`, `levenshteinDistance`, `similarityScore`, `getSimilarityLevel` — all pure/reusable (no DB, no LLM)

### Thresholds (`SIMILARITY_THRESHOLDS` in `constants.ts`)
| Score | Level | `isLookalike` |
|---|---|---|
| `>= 0.85` | `HIGH` | `true` |
| `>= 0.65` | `MEDIUM` | `false` |
| `< 0.65` | `LOW` | `false` |

Level is computed from the rounded score. `isLookalike` is `true` only for `HIGH` — similarity is a signal, **not** confirmation of malice (field is deliberately not `isFake`).

### API endpoint
`POST /api/candidates/:candidateId/analyze/name` (no body) → **200**
```json
{ "success": true, "data": { "candidateId", "matchedAssetId", "score", "level", "isLookalike", "reason" } }
```

Failure cases (mapped in the controller from a typed outcome union):
| Case | Status | Message |
|---|---|---|
| Candidate missing | **404** | `Candidate not found: <id>` |
| Candidate has no `brandId` (or its brand row is gone) | **400** | `Candidate has no target brand (brandId is missing) — cannot compare against official assets.` |
| Brand has zero official assets | **400** | `Target brand has no official assets to compare against.` |
| Candidate value empty after normalization | **400** | `Candidate value is empty after normalization — nothing to compare.` |
| All official asset values empty/non-comparable after normalization | **400** | `No comparable official assets with non-empty values.` |

### Detection flow (`name-analysis.service.ts`)
1. load candidate → `CANDIDATE_NOT_FOUND`
2. require `brandId` + load brand → `NO_TARGET_BRAND`
3. load brand's official assets (reuses `listOfficialAssets`) → `NO_OFFICIAL_ASSETS` if empty
4. normalize candidate value, reject if empty → `EMPTY_CANDIDATE_VALUE`
5. keep only assets with `type` in `ASSET_TYPES` (SOCIAL, WEBSITE, DOMAIN, APP) **and** a non-empty normalized value → `NO_COMPARABLE_ASSETS` if none (never blindly compares unrelated data — only `OfficialAsset.value` strings, never logos/descriptions)
6. score candidate vs every comparable asset, keep the **highest** score (ties → first asset, deterministic)
7. derive level + `isLookalike` + reason text; **nothing is written to the database**

### Architecture decisions
- **Two-service split:** `similarity.service.ts` = pure text math (unit-testable with zero I/O); `name-analysis.service.ts` = DB orchestration returning a discriminated `NameAnalysisOutcome` union (`{ok:true,data} | {ok:false,code}`). The **controller maps codes to HTTP** — services stay free of `ApiError`/HTTP concerns
- Route added to the existing `candidateRouter` (`/:candidateId/analyze/name`) — no new route/controller files
- Only additive changes to Task 5 files (imports + one handler + one route line)
- No LLM, no ML/scoring libraries, **zero new dependencies**
- Comparisons limited to the 4 asset types via the shared `ASSET_TYPES`/`isAssetType` from `constants.ts`

### Test results (Task 6)
Pure logic (no DB, run against `dist/`): **all required cases pass** ✅
| Pair | Score | Level |
|---|---|---|
| `PaySecure` vs `PaySecure` | `1` | HIGH (lookalike) |
| `PaySecureSupport` vs `PaySecure` | `0.56` | LOW |
| `Pay-Secure` vs `PaySecure` | `1` | HIGH |
| `Pay_Secure` vs `PaySecure` | `1` | HIGH |
| `CompletelyDifferent` vs `PaySecure` | `0.21` | LOW |
- Normalization cases all correct; threshold boundaries (`0.85`→HIGH, `0.84`→MEDIUM, `0.65`→MEDIUM, `0.64`→LOW) ✅; `levenshtein("kitten","sitting") = 3` ✅; empty-string inputs handled without throwing ✅
- Runtime: `GET /health` → **200** ✅; `POST .../analyze/name` reaches `candidateAsset.findUnique` (correct handler) ✅; `GET` on that path → 404 (POST-only) ✅; regressions on candidate/brand/asset validation and unknown-route 404 all still pass ✅
- `npm run typecheck` → **pass** ✅ · `npm run build` → **pass** ✅
- **DB-dependent, untested** (no credentials): the full analysis flow returning real data, all 404/400 outcomes above, and matched-asset selection across multiple assets

### Limitations (recorded honestly)
- **Length-penalty behaviour:** appending a suffix scores LOW under Levenshtein/max-length normalization (`PaySecureSupport` vs `PaySecure` = `0.56` → LOW) — long handles are under-scored; may need token/substring analysis in a later task
- No phonetic (Soundex/Metaphone), no token-set/Jaccard, no fuzzy-charset (homoglyph/typosquat like `paysecuге` with Cyrillic) detection yet
- Score rounded to 2 decimals; ties resolve to the first asset in `createdAt DESC` order
- Results are computed on demand and **not persisted**; repeated calls re-compute
- 400 (not 409/200) is used for "nothing to analyze" cases — chosen for a clear, explicit client message

### Notes for Task 7 (Text/Description Similarity)
- Reuse `similarity.service.ts` for any token/length math; add new pure functions rather than modifying `similarityScore`
- Candidates already store optional `name`/`description` — likely inputs for Task 7
- Remember: no migration has ever been applied; first real-DB session must run `npm run db:migrate`

---

## TASK 7 — Text / Description Similarity (COMPLETED)

### Cleanup inspection
- No duplicate, temp, or unnecessary files found — nothing removed
- Tasks 1–6 untouched except additive changes (one new pure helper in `similarity.service.ts`, new service, one handler, one route)

### Files created / changed
```
NEW     src/services/text-analysis.service.ts     # builders + pure compare + DB analysis flow
CHANGED src/services/similarity.service.ts       # + tokenizeText (pure, reusable — no Levenshtein duplication)
CHANGED src/controllers/candidate.controller.ts  # + analyzeCandidateTextHandler + failure messages
CHANGED src/routes/candidate.routes.ts          # + POST /:candidateId/analyze/text
CHANGED docs/*, README.md
```

### Text normalization / tokenization (`tokenizeText`)
1. lowercase
2. split on whitespace (collapses repeated spaces/tabs)
3. within each token remove every non-letter/non-digit character (`Pay-Secure!` → `paysecure`, `paysecure.com` → `paysecurecom`, `@PaySecure` → `paysecure`)
4. drop tokens that become empty (punctuation-only)

`normalizeText`/`similarityScore` from Task 6 are reused unchanged for fuzzy comparison — **the Levenshtein implementation was not duplicated**.

### Algorithm (deterministic, explainable)
Candidate text = non-empty of `name`, `description`, `value`, joined with spaces (`buildCandidateText`; nulls/whitespace-only/punctuation-only parts skipped).
Brand identity text = non-empty of `brand.name` + all official asset values (`buildBrandIdentityText`).

`compareTextToIdentity(candidateText, identityText)`:
1. tokenize both sides
2. for each candidate token: exact token match against the identity set → `1`; otherwise best **Levenshtein similarity** vs each identity token (reuses `similarityScore`)
3. `score = max(bestTokenScore, similarityScore(fullCandidateText, fullIdentityText))` — the existing full-string score is combined in as a secondary signal
4. `matchedTerms` = unique candidate tokens scoring `>= 0.65`, sorted by score desc then alphabetically
5. score rounded to **2 decimals**, clamped `[0, 1]`

### Score / thresholds (centralized in `constants.ts`)
`SIMILARITY_THRESHOLDS` — unchanged, shared with Task 6: `>= 0.85` **HIGH**, `>= 0.65` **MEDIUM**, `< 0.65` **LOW**.
`isSuspiciousSimilarity = level === "HIGH"`. Terminology: *text/identity/suspicious similarity*, *likely look-alike* — the candidate is **never** called "fake" from this result alone; similarity is a signal, not proof of malice.

### API endpoint
`POST /api/candidates/:candidateId/analyze/text` (no body) → **200**
```json
{ "success": true, "data": { "candidateId", "score", "level", "isSuspiciousSimilarity", "matchedTerms", "reason" } }
```

| Failure case | Status | Message |
|---|---|---|
| Candidate missing | **404** | `Candidate not found: <id>` |
| Candidate has no `brandId` | **400** | `Candidate has no target brand (brandId is missing) — cannot compare against official brand identity.` |
| Brand row gone despite `brandId` | **404** | `Target brand referenced by the candidate does not exist.` |
| No usable candidate text (name+description+value all empty/null) | **400** | `Candidate has no usable text — name, description, and value are all empty.` |
| Brand identity empty (name + asset values all empty) | **400** | `Target brand has no usable identity information (name and official asset values are all empty).` |

### Architecture decisions
- **Two-layer split again:** pure functions (`buildCandidateText`, `buildBrandIdentityText`, `compareTextToIdentity`) exported for reuse by Tasks 8–10 and for offline testing; `analyzeCandidateText(candidateId)` does DB orchestration returning a typed `TextAnalysisOutcome` union; the **controller maps codes to HTTP** (services stay HTTP-free)
- Route/handler added to the existing candidate router/controller — no new files beyond the service
- Thresholds stay centralized in `constants.ts`; reasons keyed by `SimilarityLevel`
- Empty/null values are skipped when building texts (never crash); `compareTextToIdentity` returns `{score:0, matchedTerms:[]}` for empty input instead of throwing
- No LLM, no NLP/ML libraries — **zero new dependencies**

### Test results (Task 7)
**Pure logic, no DB — 20/20 pass** (fictional PaySecure brand: `PaySecure`, `@PaySecure`, `paysecure.com`):
| Case | Score | Level |
|---|---|---|
| `PaySecure official customer support` | `1` | HIGH ✅ |
| `Need help with your PaySecure account? Contact PaySecure Support.` | `1` | HIGH ✅ |
| `Secure payment wallet and customer support platform` | `0.67` (matched: `secure`) | MEDIUM ✅ |
| `Travel photography community for students` | `0.25` | LOW ✅ |
- empty description / only `name` / `name+description+value` builders ✅ · all-empty → `""` (400 path) ✅ · punctuation `Pay-Secure!!!` → HIGH ✅ · UPPERCASE → HIGH ✅ · repeated whitespace → HIGH ✅ · unrelated → LOW ✅ · exact brand name → `1` HIGH ✅ · `matchedTerms` deduped+sorted `["paysecure","secure"]` ✅ · null description safe ✅ · empty-input compare safe ✅ · identity builder skips empty asset values ✅
- One bug found and fixed during testing: identity text could contain double spaces from untrimmed asset values (`joinUsable` now trims each part)
- `npm run typecheck` → **pass** ✅ · `npm run build` → **pass** ✅
- Runtime: `GET /health` → **200** ✅; `POST .../analyze/text` reaches `candidateAsset.findUnique` (correct handler) ✅; GET on that path → 404 ✅; `analyze/name` still wired ✅; brand/asset/candidate validation regressions + unknown-route 404 all pass ✅
- **DB-dependent, NOT tested** (no credentials): the endpoint returning real analysis data, all 404/400 outcomes above, and multi-asset identity assembly from real rows

### Limitations
- Identity vocabulary is small (brand name + asset values) — a candidate only mentioning brand marketing words (`wallet`, `support`) without anything close to the brand name scores MEDIUM at best; no stopword list, no TF-IDF, no stemming/synonyms
- `matchedTerms` uses the MEDIUM threshold (0.65) — near-miss terms are omitted by design
- Full-text Levenshtein component is normalized string length, so long candidate texts rarely beat the token component (it mostly acts as a tie-breaker)
- Scores not persisted; results re-computed per call; ties in matching are order-independent for the score but `matchedTerms` sorting is score-then-alphabetical
- No homoglyph/typosquat or multilingual handling

### Notes for Task 8 (Logo Similarity)
- Consume `compareTextToIdentity` / levels from `constants.ts`; do not fork thresholds
- Logo comparison will need image inputs — decide storage approach (no file handling exists yet)
- Remember: still no DB migration has been applied (`npm run db:migrate` first real-DB session)

---

## TASK 8 — Logo / Visual Similarity (COMPLETED)

### Cleanup inspection
- No duplicate, temp, or unnecessary files found — nothing removed
- Tasks 1–7 untouched except additive changes (new service, one handler, two route lines, two new deps)

### Files created / changed
```
NEW     src/services/logo-analysis.service.ts     # decode + perceptual compare + reference resolution + DB analysis flow
CHANGED src/controllers/candidate.controller.ts   # + analyzeCandidateLogoHandler + failure messages
CHANGED src/routes/candidate.routes.ts           # + POST /:candidateId/analyze/logo
CHANGED package.json                              # + pngjs, jpeg-js (deps); + @types/pngjs, @types/jpeg-js (dev)
CHANGED docs/*, README.md
```

### Schema decision: NO migration
- `Brand.logoUrl` already exists (official side); **`CandidateAsset` has no logo/image field**
- `getCandidateLogoReference(...)` therefore returns `undefined` **by design**: `candidate.value` holds a handle/URL/app-id and `name`/`description` are text — treating any of them as a logo would fabricate an image reference
- Honest outcome instead of a fake score: the endpoint returns a structured 400 "logo comparison unavailable" until a dedicated candidate logo field exists (add `logoUrl` to `CandidateAsset` in a later task when the field will actually be populated)

### Dependencies (justified — only image decoding was needed)
- `pngjs` + `jpeg-js` (pure JS, no native compilation) — `sharp`/OpenCV/ML libs rejected (native builds, heavy CV surface)
- Used only inside `decodeImage`; no CV frameworks, no GPU, no LLM

### Algorithm (deterministic, explainable, offline)
1. **Decode:** PNG via `pngjs` → fallback JPEG via `jpeg-js`; empty / oversized (>5 MB) / SVG / corrupt → `null`
2. **Grayscale:** luma `0.299R + 0.587G + 0.114B`, bilinear resample to a `9×8` grid
3. **Gradient hash:** horizontal dHash (64 bits) + vertical hash (63 bits) = 127-bit vector → Hamming similarity
4. **Pixel term:** `8×8` block-averaged grayscale grids → `1 − mean|Δ|/255`
5. **score = round(hashSim × pixelSim, 2)` — both signals must agree
- **Why the product:** plain dHash alone scored `0.88` (HIGH) for visually different sparse shapes in fixture tests; empirically measured alternatives (table in session log): product keeps identical/resized ≥ `0.85` while pushing all different pairs `< 0.65`
- Reference loading: global `fetch` for `http(s)://` **and** `data:` URLs — 5 s timeout, 5 MB cap, non-OK/unreachable/throw → `null` (fails closed, never a fabricated score)

### Score / thresholds / terminology
- Reuses `getSimilarityLevel` + `SIMILARITY_THRESHOLDS` from `constants.ts` — **not duplicated**
- `isSimilar = level === "HIGH"`; reasons keyed by `SimilarityLevel`
- Terminology: *logo similarity*, *visual similarity*, *similar logo* — never "fake logo"; similarity is a signal, not proof of malice

### API endpoint
`POST /api/candidates/:candidateId/analyze/logo` (no body) → **200**
```json
{ "success": true, "data": { "candidateId", "score", "level", "isSimilar", "reason" } }
```

| Failure case | Status | Message |
|---|---|---|
| Candidate missing | **404** | `Candidate not found: <id>` |
| Brand row gone despite `brandId` | **404** | `Target brand referenced by the candidate does not exist.` |
| Candidate has no `brandId` | **400** | `Candidate has no target brand (brandId is missing) — logo comparison unavailable.` |
| Brand has no `logoUrl` | **400** | `Target brand has no official logo (brand.logoUrl) — logo comparison unavailable.` |
| Candidate has no logo reference (current schema, always) | **400** | `Candidate has no logo/image reference in the current data model — logo comparison unavailable. A dedicated candidate logo field is required for real logo comparison.` |
| Image unfetchable / undecodable / unsupported | **400** | `Logo image reference could not be fetched or decoded — logo comparison unavailable.` |

### Detection flow (`logo-analysis.service.ts`)
1. load candidate → `CANDIDATE_NOT_FOUND`
2. require `brandId` → `NO_TARGET_BRAND`; load brand → `BRAND_NOT_FOUND`
3. official reference from `brand.logoUrl` (trimmed, non-empty) → `NO_OFFICIAL_LOGO` (**checked before the candidate side so brand-side unavailability is reachable**)
4. candidate logo reference → always missing today → `NO_CANDIDATE_LOGO`
5. fetch both images in parallel → unfetchable → `LOGO_UNAVAILABLE`
6. decode + compare → undecodable → `LOGO_UNAVAILABLE`; else build result; **nothing written to the database**

### Architecture decisions
- Third consecutive two-layer split: pure exports (`decodeImage`, `computeDHash`, `computeVerticalHash`, `hammingSimilarity`, `pixelSimilarity`, `compareImageBuffers`, `loadImageReference`, `getOfficialLogoReference`, `getCandidateLogoReference`, `buildLogoAnalysisResult`) for offline testing; `analyzeCandidateLogo` returns a typed `LogoAnalysisOutcome` union; **controller maps codes → HTTP**
- Route/handler added to the existing candidate router/controller — no new files beyond the service

### Test results (Task 8)
**Pure logic, no DB, offline fixtures (local PNG/JPEG bytes, `data:` URLs) — 32/32 pass:**
| Case | Score | Level |
|---|---|---|
| identical PNG | `1` | HIGH ✅ |
| same logo resized 64→200 px | `0.96` | HIGH ✅ |
| circle vs stripes (different) | `0.36` | LOW ✅ |
| circle vs corner-square (different) | `0.48` | LOW ✅ |
| same shape JPEG vs PNG (cross-format) | `0.87` | HIGH ✅ |
- invalid text-bytes / empty / SVG / >5 MB → decode `null`, compare `null`, no throw ✅ · hamming edges (identical `1`, opposite `0`, length-mismatch `0`) ✅ · `dHash` length 64, cross-size bit sim `0.97` ✅ · reference honesty (`candidate → undefined`, `logoUrl` trim/empty/null) ✅ · `data:` URL round-trip → HIGH ✅ · unreachable URL → `null` ✅ · result shapes (HIGH/MEDIUM/LOW + `isSimilar` semantics) ✅ · threshold boundaries `0.85`→HIGH, `0.84`→MEDIUM, `0.65`→MEDIUM, `0.64`→LOW ✅
- `npm run typecheck` → **pass** ✅ · `npm run build` → **pass** ✅
- Runtime: `GET /health` → **200** ✅; `POST .../analyze/logo` reaches `candidateAsset.findUnique` (correct handler) ✅; `GET` on that path → 404 (POST-only) ✅; regressions: `analyze/name`, `analyze/text`, brands/candidates/assets GETs, `POST /api/brands` validation-400 all unchanged ✅
- **DB-dependent, NOT tested** (no credentials): the endpoint returning real analysis data, every 404/400 outcome above, and comparison of real `brand.logoUrl` images

### Limitations (recorded honestly)
- **Candidate logo field does not exist** → the endpoint currently always ends in `NO_CANDIDATE_LOGO` (or an earlier brand-side code); real comparison needs `CandidateAsset.logoUrl` added and populated later
- Metric uses luma only — chroma-only color differences with equal luminance can collide; brightness shifts lower the pixel term (a darkened copy of the same logo measured `0.81` → MEDIUM)
- Flat/uniform images can collide (gradient bits all zero) — inherent to perceptual hashing
- SVG and transparent-background compositing unsupported (raw RGBA decoded; transparent pixels are not flattened onto a background)
- Image size cap 5 MB, fetch timeout 5 s — larger/slower sources fail closed as `LOGO_UNAVAILABLE`
- Scores not persisted; results re-computed per call

### Notes for Task 9 (Social Risk Signals)
- Reuse the outcome-union → controller-maps-HTTP pattern; keep services free of `ApiError`
- Social risk will likely need external signals — keep anything non-local clearly typed as unavailable rather than guessed
- Remember: still no DB migration has been applied (`npm run db:migrate` first real-DB session)

---

## TASK 9 — Social Risk Signals (COMPLETED)

### Cleanup inspection
- Scanned the whole repo (duplicate basenames in `src`, `*~`/`*.bak`/`*.tmp`/`*.orig`/`*.old`/`.DS_Store`/`*.log` files, stray tool clutter): **nothing found — 0 files removed**
- Tasks 1–8 untouched except purely additive changes (one new constants block, one import + one handler + one route line, one new service)

### Files created / changed
```
NEW     src/services/social-risk.service.ts    # signal builders (pure) + DB analysis flow
CHANGED src/config/constants.ts                # + SOCIAL_SIGNAL_THRESHOLDS (Task 9 block)
CHANGED src/controllers/candidate.controller.ts# + analyzeCandidateSocialRiskHandler + failure messages
CHANGED src/routes/candidate.routes.ts         # + POST /:candidateId/analyze/social-risk
NEW     tests/social-risk.pure.cjs             # 93 pure assertions (no DB)
NEW     tests/social-risk.e2e.cjs              # 59 end-to-end assertions (server + DB)
CHANGED package.json                           # + "test", "test:e2e" scripts
NEW     prisma/migrations/20261008161411_init/ # FIRST migration ever — see "database" below
CHANGED docs/*, README.md
```

### Scope guard (what Task 9 deliberately did NOT build)
No global Risk Engine, no campaign detection, no AI Investigator, no prediction, no Task 10 (App Risk), **no LLM anywhere** — every signal is deterministic and explainable.

### Signals implemented (`signal` → severity → score → when)
Signal order in the result is fixed: `NAME_SIMILARITY`, `BRAND_TEXT_MATCH`, `SUPPORT_LANGUAGE`, `OFFICIAL_DOMAIN_MATCH`, `EXTERNAL_DOMAIN`, `OFFICIAL_IDENTITY_CONFLICT`.

| Signal | Severity | Score | Rule |
|---|---|---|---|
| `NAME_SIMILARITY` | `getSimilarityLevel(score)` | best Task 6 score vs official `SOCIAL` assets | emitted when score ≥ `0.5` **or** handle containment detected |
| `BRAND_TEXT_MATCH` | level from Task 7 thresholds | `compareTextToIdentity` score (candidate name+description+value vs brand identity) | emitted only when level is MEDIUM or HIGH (≥ 0.65) |
| `SUPPORT_LANGUAGE` | HIGH ≥ 0.85, MEDIUM ≥ 0.6, else LOW | `0.5 + 0.1 × (matchedKeywords − 1)`, capped `0.9` | ≥ 1 keyword from the centralized list matches |
| `OFFICIAL_DOMAIN_MATCH` | LOW | 1 (exact match strength) | discovered domain equals / is a subdomain of an official domain |
| `EXTERNAL_DOMAIN` | MEDIUM (from `0.7`) | `0.7` | discovered domain is NOT official |
| `OFFICIAL_IDENTITY_CONFLICT` | HIGH (from `0.9`) | `0.9` | not the official account AND (Task 6 level HIGH **or** handle containment) |

- **Reused, never duplicated:** `similarityScore` / `getSimilarityLevel` / `normalizeText` (Task 6), `buildCandidateText` / `buildBrandIdentityText` / `compareTextToIdentity` (Task 7), shared `SIMILARITY_THRESHOLDS` (≥ 0.85 HIGH, ≥ 0.65 MEDIUM). Levenshtein, normalization, and thresholds were **not** re-implemented.
- **Containment** (the one new comparison): normalized strings are compared for substring containment only when BOTH normalized handles are ≥ 4 chars; score = `shorter/longer` (rounded 2 dp). This catches `@PaySecure_Support ⊃ @PaySecure`, which plain Levenshtein scores only `0.56` (the Task 6 length-penalty limitation).
- **All meaningful signals are returned** — never collapsed into one threat score; no overall/final risk score is produced (that is the later Risk Engine's job).
- Severity vocabulary: `HIGH` / `MEDIUM` / `LOW` (reuses `SimilarityLevel`).

### Support-language keyword list (centralized, 12 entries)
`customer support`, `customer care`, `account verification`, `verify account`, `security team`, `contact us`, `refund`, `complaint`, `claim`, `urgent`, `support`, `help`
- Matched with word-boundary, case-insensitive regexes (so `helpdesk`/`disclaimer` do **not** match `help`/`claim`)
- A single-word keyword already covered by a matched phrase is not double-counted (`customer support` suppresses `support`)
- Support language is **only a signal** — it never classifies an account as fake

### Domain handling (no DNS, no external services)
- `extractDomains(text)` finds `http(s)://…`, `www.…` and bare domain-like tokens in candidate value/name/description
- `normalizeDomain(...)` lowercases, strips scheme / path / query / fragment / userinfo / port / leading `www.` / edge punctuation → `https://paysecure.com`, `http://paysecure.com/login`, `www.paysecure.com` all normalize to `paysecure.com`
- Official set = `brand.website` + official `WEBSITE`/`DOMAIN` asset values; comparison is exact **or** subdomain (`login.paysecure.com` matches official `paysecure.com`) → false-positive protection for legitimate official domains

### False-positive protections (the important part)
1. **Official account exclusion:** if `normalizeText(candidate.value)` exactly equals any official `SOCIAL` value, the candidate is treated as the registered official account — `NAME_SIMILARITY`, `BRAND_TEXT_MATCH`, and `OFFICIAL_IDENTITY_CONFLICT` are all suppressed (checked **before** producing any impersonation/conflict signal)
2. Official domains never produce `EXTERNAL_DOMAIN`
3. `BRAND_TEXT_MATCH` only fires at MEDIUM+ — ordinary brand-related words alone stay silent
4. `SUPPORT_LANGUAGE` alone is MEDIUM/LOW evidence at most and never a verdict
5. Harmless unrelated accounts (no brand text, no containment, no keywords, no URLs) produce **zero signals**
6. `NAME_SIMILARITY` / `OFFICIAL_IDENTITY_CONFLICT` require official `SOCIAL` assets to exist — nothing is compared against unrelated asset types
7. Task 9 produces **evidence only**; terminology avoids "fake"/"malicious" entirely

### Result format (`POST .../analyze/social-risk` → 200)
```json
{
  "success": true,
  "data": {
    "candidateId": "...",
    "type": "SOCIAL",
    "signals": [
      { "signal": "NAME_SIMILARITY", "severity": "LOW", "score": 0.56, "reason": "Candidate handle shows some similarity to an official social identity." }
    ],
    "signalCount": 1,
    "hasHighSeverity": false
  }
}
```
`hasHighSeverity = signals.some(s => s.severity === "HIGH")`. Nothing is written to the database; results are recomputed per call.

### API + failure mapping (service returns codes; controller maps to HTTP)
| Code | HTTP | Message / details |
|---|---|---|
| `CANDIDATE_NOT_FOUND` | **404** | `Candidate not found: <id>` |
| `SOCIAL_ANALYSIS_NOT_APPLICABLE` | **400** | `Social risk analysis is only applicable to SOCIAL candidates.` + `details.code` |
| `NO_TARGET_BRAND` | **400** | `Candidate has no target brand (brandId is missing) — cannot compare social signals against official assets.` + `details.code` |
| `BRAND_NOT_FOUND` | **404** | `Target brand referenced by the candidate does not exist.` |

- The type check runs **before** the brand check → a non-social candidate always gets `SOCIAL_ANALYSIS_NOT_APPLICABLE` (APP/WEBSITE/DOMAIN candidates are never analyzed)
- `SOCIAL_ANALYSIS_NOT_APPLICABLE` and `NO_TARGET_BRAND` include `details: { "code": "..." }` so clients can branch on the machine-readable code
- A brand is required because identity similarity and official-domain exclusion both need the brand's registered assets; a brand with no official assets still succeeds with whatever signals are computable (possibly an empty list)

### Architecture decisions
- Fourth consecutive two-layer split: **pure exports** (`normalizeDomain`, `extractDomains`, `isDomainLike`, `collectOfficialDomains`, `matchesOfficialDomain`, `detectSupportLanguage`, `getSupportLanguageSeverity`, `isOfficialSocialIdentity`, `containmentScore`, `findBestOfficialSocialMatch`, `buildSocialSignals`, `buildSocialRiskResult`) for DB-free tests; `analyzeCandidateSocialRisk(candidateId)` returns a typed `SocialRiskOutcome` union; the **controller maps codes → HTTP** (services stay free of `ApiError`)
- New thresholds live once in `constants.ts` under `SOCIAL_SIGNAL_THRESHOLDS`; Task 6/7 thresholds were not copied
- Route/handler added to the existing candidate router/controller — no new route/controller files
- Zero new dependencies; no LLM, no ML, no external network calls

### Test results (Task 9)
**Pure tests — 93/93 pass** (`npm test`, no DB, runs against `dist/`): domain normalization (scheme/path/query/port/www/trailing-dot/punctuation), domain extraction (URLs, emails, hyphenated hosts, dedupe, order), official-domain comparison (exact/subdomain/external), support-keyword detection (`helpdesk`/`disclaimer` negatives, phrase-suppression, score 0.5/0.6/0.9, severity LOW/MEDIUM/HIGH edges), official identity matching (exact + normalized variants + negatives), containment (suffix/prefix/unrelated/too-short/equal), best-match selection (score/level/containment/no-values → null), and **spec Tests 1–5 + FP guards + determinism** through `buildSocialSignals`/`buildSocialRiskResult`.

**End-to-end tests — 59/59 pass** (`npm run test:e2e`, real server + real PostgreSQL): spec Test 1 (5 expected signals, severities, scores, `signalCount=5`, `hasHighSeverity=true`), Test 2 (official account → zero signals), Test 3 (harmless account → zero signals), Test 4 (official domain → `OFFICIAL_DOMAIN_MATCH`, no `EXTERNAL_DOMAIN`), Test 5 (support language only → not high severity), Test 6 (`APP` → **400** `SOCIAL_ANALYSIS_NOT_APPLICABLE` via `details.code`), missing candidate → 404, missing brand → 400 `NO_TARGET_BRAND`, GET on the POST-only route → 404, **deterministic repeat run**, plus regressions: Task 6 name analysis (200), Task 7 text analysis (200, HIGH), Task 8 logo analysis (400 unavailable, unchanged), brand/candidate validation 400s, list endpoints with correct counts, unknown route 404, `GET /health` 200.

- `npm run typecheck` → **pass** ✅
- `npm run build` (`prisma generate` + `tsc`) → **pass** ✅

### Database testing (recorded honestly)
- The committed `.env` still holds Prisma's **placeholder** `DATABASE_URL` — the pre-existing local PostgreSQL on :5432 still has no usable credentials, so the project's real database remains unconfigured
- To avoid claiming untested results, tests ran against a **throwaway ephemeral PostgreSQL 18 cluster** created in `/tmp/opencode/pgdata` (trust auth, port 55432, db `aegis`) — no system service or config was modified
- Against that cluster the **first migration in project history** was created and applied: `prisma/migrations/20261008161411_init/` (+ `migration_lock.toml`) — `prisma migrate dev --name init`; schema has never been easier to reproduce: `npm run db:migrate` with a real `DATABASE_URL`
- The ephemeral cluster and the test server (port 4100) were **stopped after testing**; re-running `npm run test:e2e` needs a reachable `DATABASE_URL` + server (`AEGIS_BASE_URL=...`)
- NOT tested: none of the Task 9 code paths remain untested — but the tests did **not** run against the project's production/real database (it does not exist yet)

### Limitations (recorded honestly)
- No campaign/network analysis, no temporal/frequency signals, no follower/post/engagement data — only what Aegis already stores (`value`, `name`, `description`, brand + official assets)
- `NAME_SIMILARITY` severity is plain Task 6 Levenshtein level, so an obvious `officialhandle+suffix` can show LOW similarity even though the separate `OFFICIAL_IDENTITY_CONFLICT` carries HIGH — intentional reuse over a forked metric
- Support keywords are English-only, phrase-exact, and small by design; no stemming/synonyms/regex variants
- Domain extraction is ASCII-only and does no DNS/WHOIS/metadata lookups; homograph/punycode and IP-literal hosts are not handled
- `OFFICIAL_DOMAIN_MATCH` score `1` means *match strength* (severity LOW marks it benign); `EXTERNAL_DOMAIN` score `0.7` and `OFFICIAL_IDENTITY_CONFLICT` score `0.9` are fixed deterministic constants (per spec examples), not measured ratios
- Candidates without `brandId` get a 400 instead of partial brand-less signals (identity comparison needs official assets)
- Scores/signals are not persisted; repeated calls re-compute

---

## TASK 10 — APP RISK ANALYSIS (COMPLETED)

### What was built
`POST /api/candidates/:candidateId/analyze/app-risk` — deterministic, explainable risk **signals** for `APP` candidates. Evidence only: no combined score, no verdict, no LLM.

```
NEW     src/services/app-risk.service.ts          # pure signal builders + analyzeCandidateAppRisk
CHANGED src/config/constants.ts                   # + APP_SIGNAL_THRESHOLDS
CHANGED src/controllers/candidate.controller.ts   # + analyzeCandidateAppRiskHandler + APP_RISK_FAILURE_MESSAGES
CHANGED src/routes/candidate.routes.ts            # + POST /:candidateId/analyze/app-risk
NEW     tests/app-risk.pure.cjs                   # 39 pure assertions
NEW     tests/app-risk.e2e.cjs                    # 45 end-to-end assertions
CHANGED package.json                              # test scripts chained
CHANGED docs/*, README.md
```

### Signals implemented (fixed order: `signal` → severity → score → when)
| Signal | Severity | Score | Rule |
|---|---|---|---|
| `APP_NAME_SIMILARITY` | `getSimilarityLevel(score)` | best Task 6 score of app name vs official name/app values | emitted when score ≥ `0.5` or containment |
| `APP_DESCRIPTION_MATCH` | level from Task 7 thresholds | `compareTextToIdentity` (name+description vs brand identity) | emitted only at MEDIUM+ (≥ `0.65`) |
| `PACKAGE_IDENTIFIER_SIMILARITY` | `getSimilarityLevel(score)` | best score of `candidate.value` vs official `APP` asset values | emitted when score ≥ `0.5` or containment |
| `OFFICIAL_APP_MATCH` | LOW | `1` | `normalizeText(value)` exactly equals an official `APP` value (normalized); **suppresses** name/description/package/impersonation |
| `OFFICIAL_DOMAIN_MATCH` | LOW | `1` | discovered domain (name+description only) equals/subdomain of official domain |
| `EXTERNAL_DOMAIN` | MEDIUM | `0.7` | discovered domain NOT official |
| `APP_BRAND_IMPERSONATION` | HIGH | `0.9` | ≥ 2 strong indicators: name HIGH/containment, description ≥ `0.85`, package HIGH/containment |

- **Reused, never duplicated:** `similarityScore`/`getSimilarityLevel`/`normalizeText` (Task 6), `buildBrandIdentityText`/`compareTextToIdentity` (Task 7), `containmentScore`/`extractDomains`/`collectOfficialDomains`/`matchesOfficialDomain` (Task 9), `SIMILARITY_THRESHOLDS`, `SOCIAL_SIGNAL_THRESHOLDS.NAME_SIMILARITY_MIN` (= 0.5)
- **`APP_SIGNAL_THRESHOLDS`** in `constants.ts` aliases Task 9's shared constants (`NAME_SIMILARITY_MIN`, `EXTERNAL_DOMAIN_SCORE`, `OFFICIAL_DOMAIN_SCORE`, `OFFICIAL_APP_SCORE`) + the one new value `IMPERSONATION_SCORE: 0.9` — thresholds live in one place
- Domain scan uses **name + description only** — `candidate.value` for an APP is a package identifier (`com.paysecure.fake.wallet`), and feeding it to `extractDomains` fabricated an `EXTERNAL_DOMAIN` false positive (caught by pure test, fixed)
- `DIFFERENT_PUBLISHER` is **always** in `unavailableSignals` with an honest reason — the schema has no publisher field and was **not** modified
- `unavailable`/`unavailableSignals` vocabulary: signals that cannot be computed with current data are disclosed, never silently dropped

### False-positive protections
1. Exact official app identity (normalized) → only benign `OFFICIAL_APP_MATCH` (LOW); impersonation/name/description/package suppressed
2. Generic words (`wallet`, `pay`, `banking`, `support`, `official`, `refund`) never reach HIGH on their own — tested
3. Official domains in app metadata never become `EXTERNAL_DOMAIN`
4. Missing name/description → zero signals (not fabricated)
5. Non-APP candidates → structured 400, never partial app signals

### API + failure mapping
| Code | HTTP | Message / details |
|---|---|---|
| `CANDIDATE_NOT_FOUND` | **404** | `Candidate not found: <id>` |
| `APP_ANALYSIS_NOT_APPLICABLE` | **400** | `App risk analysis is only applicable to APP candidates.` + `details.code` |
| `NO_TARGET_BRAND` | **400** | `Candidate has no target brand …` + `details.code` |
| `BRAND_NOT_FOUND` | **404** | `Target brand referenced by the candidate does not exist.` |

Type check runs **before** the brand check (same as Task 9).

### Test results (Task 10)
- **Pure 39/39**: helper units (official-app values, identity match, description text) + spec Tests 1–11 + publisher-unavailable guard
- **E2E 45/45**: fake app (4 signals, HIGH impersonation 0.9), official app (only `OFFICIAL_APP_MATCH`), harmless app (0), external domain (MEDIUM 0.7), non-APP → 400, missing → 404, no-brand → 400, GET → 404, determinism, Task 6–9 regressions
- `npm run typecheck` / `npm run build` → **pass**

---

## TASK 11 — MULTIMODAL EVIDENCE ENGINE (COMPLETED)

### What was built
`POST /api/candidates/:candidateId/analyze/evidence` — merges every modality into one ordered evidence list for `SOCIAL` and `APP` candidates, with an honest `unavailable` list. Aggregation only: **no global score** (that is Task 12's job).

```
NEW     src/services/evidence.service.ts         # dedupeEvidence + buildEvidenceResult + collectEvidence + analyzeCandidateEvidence
CHANGED src/services/name-analysis.service.ts    # + pure computeNameAnalysis(candidateValue, assets)   [behavior-preserving extraction]
CHANGED src/services/text-analysis.service.ts    # + pure computeTextAnalysis(candidate, brand, assets)  [behavior-preserving extraction]
CHANGED src/services/logo-analysis.service.ts    # + pure async computeCandidateLogoAnalysis(brand, candidate, id) [behavior-preserving extraction]
CHANGED src/controllers/candidate.controller.ts  # + analyzeCandidateEvidenceHandler + EVIDENCE_FAILURE_MESSAGES
CHANGED src/routes/candidate.routes.ts           # + POST /:candidateId/analyze/evidence
NEW     tests/evidence.pure.cjs                  # 41 pure assertions
NEW     tests/evidence.e2e.cjs                   # 47 end-to-end assertions
CHANGED package.json, docs/*, README.md
```

### Result shape
```json
{
  "candidateId": "...", "type": "SOCIAL" | "APP",
  "evidence": [ { "source": "NAME", "signal": "NAME_SIMILARITY", "severity": "LOW", "score": 0.63, "reason": "…" } ],
  "evidenceCount": 7, "highSeverityCount": 3, "hasHighSeverity": true,
  "unavailable": [ { "source": "LOGO", "reason": "Target brand has no official logo …" } ]
}
```

### Design decisions
- **Fixed source order:** `NAME` → `TEXT` → `LOGO` → `SOCIAL`/`APP`; evidence items and `unavailable` entries both follow it (pure-tested)
- **Source → signal mapping:** `NAME`/`TEXT`/`LOGO` sources get their own single signal (`NAME_SIMILARITY`, `TEXT_IDENTITY_MATCH`, `LOGO_SIMILARITY`) computed by the extracted Task 6/7/8 pure functions; `SOCIAL`/`APP` sources pass through Task 9/10 signals unchanged (task order preserved)
- **Emission thresholds** mirror Task 9: NAME item emitted at score ≥ `0.5`; TEXT item only at MEDIUM+ (≥ `0.65`); a computed-but-below-threshold modality is silent (no item, not `unavailable`); LOGO emits whenever computable (any level)
- **`unavailable`** = modalities that could not be evaluated, with honest reasons: no official assets, empty candidate value/text, brand identity empty, no candidate logo field (always, current schema), and the cross-type entry (`APP` source for a SOCIAL candidate / `SOCIAL` source for an APP candidate — "only applicable to …")
- **Exact-duplicate dedupe only** (`dedupeEvidence`): key = signal + severity + score + reason (content-exact, source excluded); first occurrence wins. No fuzzy/partial merging ever
- **`highSeverityCount`** = count of HIGH items; `hasHighSeverity = highSeverityCount > 0` — counts are computed post-dedupe
- **Pure compute extraction** (behavior-preserving): Task 6/7/8 service internals were lifted into `compute*` functions so `collectEvidence` loads candidate/brand/assets **once** from the DB and reuses them across all five modalities (no repeated queries); `analyzeCandidate*` wrappers now delegate and keep identical HTTP behavior — Tasks 6/8 e2e regression-tested green after the refactor
- **Type check before brand check** → non-SOCIAL/APP candidates always get `EVIDENCE_ANALYSIS_NOT_APPLICABLE` (400 + `details.code`); type normalized (`trim().toUpperCase()`)

### API + failure mapping
| Code | HTTP | Message / details |
|---|---|---|
| `CANDIDATE_NOT_FOUND` | **404** | `Candidate not found: <id>` |
| `EVIDENCE_ANALYSIS_NOT_APPLICABLE` | **400** | `Evidence analysis is only applicable to SOCIAL and APP candidates.` + `details.code` |
| `NO_TARGET_BRAND` | **400** | `Candidate has no target brand …` + `details.code` |
| `BRAND_NOT_FOUND` | **404** | `Target brand referenced by the candidate does not exist.` |

### Test results (Task 11)
- **Pure 41/41**: source-order constant, social fixture (7 items / 3 HIGH / unavailable `[LOGO, APP]` / Task 9 signal order), app fixture (6 items / 4 HIGH / unavailable `[LOGO, SOCIAL]` / Task 10 signal order), harmless fixture (0 items, NAME/TEXT computed), order invariant, dedupe (exact removed, differing score/signal kept, first wins), counts post-dedupe, empty candidate (NAME+TEXT unavailable), no assets (NAME unavailable), brand with logo (LOGO unavailable, no fetch), determinism
- **E2E 47/47**: all of the above through HTTP with exact pinned counts, WEBSITE candidate → 400 `EVIDENCE_ANALYSIS_NOT_APPLICABLE`, missing → 404, orphan → 400 `NO_TARGET_BRAND`, GET → 404, deterministic repeat, Task 6–10 endpoint regressions
- `npm run typecheck` / `npm run build` → **pass**
- Combined suites: **173 pure + 151 e2e = 324 assertions, all green** (`npm test` chains social-risk + app-risk + evidence; `npm run test:e2e` likewise)

### Database testing (Tasks 10–11)
- Same ephemeral PostgreSQL 18 recipe as Task 9: cluster in `/tmp/opencode/pgdata` (trust auth, port 55432, db `aegis`, migration `20261008161411_init` already applied); server on port 4100 with `DATABASE_URL=postgresql://aegis@127.0.0.1:55432/aegis?schema=public PORT=4100`
- The project's real `.env` `DATABASE_URL` placeholder was **not** modified; tests stopped the cluster/server afterwards
- NOT tested: no production/real database exists yet (unchanged from Task 9)

### Limitations (recorded honestly)
- No publisher/developer metadata anywhere in the schema → `DIFFERENT_PUBLISHER` is permanently unavailable until the schema gains the field (explicitly not added here)
- No candidate logo field → LOGO modality always lands in `unavailable` (Task 8 limitation inherited)
- Evidence is recomputed per call, never persisted; no cross-candidate correlation, no temporal signals
- Cross-source duplicates are only removed when content is byte-identical (same signal/severity/score/reason); differing reasons/scores from Task 6 vs Task 9 name checks are intentionally kept as separate observations
- Scores are deterministic fixed constants where the underlying data cannot yield a measured ratio (`EXTERNAL_DOMAIN` 0.7, impersonation 0.9, official match 1)

### Notes for Task 12 (Explainable Risk Engine)
- Task 9/10 signals and Task 11 evidence are shaped to be consumed — combine them there, never inside Tasks 9–11
- Reuse the outcome-union → controller-maps-HTTP pattern; failure-code → HTTP tables above are the template
- E2E recipe: ephemeral cluster `pg_ctl … start -p 55432`, `DATABASE_URL=postgresql://aegis@127.0.0.1:55432/aegis?schema=public PORT=4100 node dist/server.js`, `AEGIS_BASE_URL=http://127.0.0.1:4100 npm run test:e2e`
