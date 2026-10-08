# Aegis

**AI-Powered Impersonation Campaign Investigator** — a Digital Risk Protection platform that detects fake/impersonating social accounts, suspicious mobile apps, look-alike assets, and coordinated impersonation campaigns.

## Status

**PHASE 1 — FOUNDATION: COMPLETED** · **PHASE 2 — AI DETECTION: in progress**

| Phase 1 — Foundation | |
|---|---|
| TASK 1 — Backend Project Setup | ✅ |
| TASK 2 — Database Setup | ✅ |
| TASK 3 — Brand Profile | ✅ |
| TASK 4 — Official Asset Registry | ✅ |
| TASK 5 — Candidate Asset System | ✅ |

| Phase 2 — AI Detection | |
|---|---|
| TASK 6 — Name/Handle Similarity | ✅ |
| TASK 7 — Text/Description Similarity | ✅ |
| TASK 8 — Logo Similarity | ✅ |
| TASK 9 — Social Risk Signals | ✅ |
| TASK 10 — App Risk Analysis | ✅ |
| TASK 11 — Multimodal Evidence Engine | ✅ |
| TASK 12 — Explainable Risk Engine | ✅ |
| TASK 13 — Why Flagged / Why NOT Flagged | ✅ |

Next: **TASK 14**

Full tracking: [`docs/TASK_STATUS.md`](docs/TASK_STATUS.md) · Technical memory: [`docs/DEVELOPMENT_MEMORY.md`](docs/DEVELOPMENT_MEMORY.md)

## Tech Stack

- **Backend:** Node.js, TypeScript, Express 4
- **Database:** PostgreSQL with Prisma ORM 7 (driver adapter: `@prisma/adapter-pg` + `pg`)
- **Dev tooling:** `tsx` (watch mode), `tsc` (build), npm scripts

## Repository Structure

```
Aegis/
├── apps/
│   ├── api/                    # Backend (Express + Prisma)
│   │   ├── prisma/schema.prisma + migrations/
│   │   ├── src/
│   │   │   ├── config/         # env + Prisma client + shared constants
│   │   │   ├── controllers/    # request validation + responses
│   │   │   ├── middleware/     # async wrapper + central error handling
│   │   │   ├── routes/         # route definitions & mounting
│   │   │   ├── services/       # business/data layer (incl. analysis services)
│   │   │   ├── app.ts          # Express app factory
│   │   │   └── server.ts       # entry point
│   │   ├── tests/              # pure + end-to-end tests
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env.example
│   └── web/                    # Frontend (planned)
├── data/                       # Scenario datasets (planned)
├── services/                   # Detection / risk / correlation / AI (planned)
└── docs/
```

Architecture flow: **route → controller → service → Prisma**

## Getting Started

Prerequisites: Node.js 20+, npm, PostgreSQL.

```bash
cd apps/api
npm install
cp .env.example .env        # then set DATABASE_URL
npm run db:migrate          # apply the Prisma schema
npm run dev                 # http://localhost:4000
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | `prisma generate` + TypeScript build → `dist/` |
| `npm start` | Run the built production server |
| `npm run typecheck` | Type validation without emitting files |
| `npm test` | Pure analysis tests, no DB (run `npm run build` first) |
| `npm run test:e2e` | End-to-end API tests (needs running server + reachable `DATABASE_URL`, override base URL with `AEGIS_BASE_URL`) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:validate` | Validate `prisma/schema.prisma` |
| `npm run db:migrate` | Create/apply migrations (dev) |

> The Prisma client is generated into `src/generated/prisma/` (gitignored). Run `npm run db:generate` (or `npm run build`) after a fresh clone.

## API

Base URL: `http://localhost:4000`

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service health check |

```json
{ "success": true, "service": "Aegis API", "status": "running" }
```

### Brands

| Method | Path | Description |
|---|---|---|
| POST | `/api/brands` | Create a brand (`name` required; `logoUrl`, `website` optional) |
| GET | `/api/brands` | List all brands |
| GET | `/api/brands/:id` | Get one brand (404 if missing) |
| DELETE | `/api/brands/:id` | Delete brand (official assets cascade) |

### Official Assets

Official assets are the legitimate brand references (social handles, domains, apps) used later for impersonation comparison.

| Method | Path | Description |
|---|---|---|
| POST | `/api/brands/:brandId/assets` | Create an official asset |
| GET | `/api/brands/:brandId/assets` | List the brand's assets |
| GET | `/api/brands/:brandId/assets/:assetId` | Get one asset (ownership enforced) |
| DELETE | `/api/brands/:brandId/assets/:assetId` | Delete an asset (ownership enforced) |

Supported asset types: `SOCIAL`, `WEBSITE`, `APP`, `DOMAIN`

```bash
curl -X POST http://localhost:4000/api/brands/<brandId>/assets \
  -H "Content-Type: application/json" \
  -d '{"type":"SOCIAL","value":"@PaySecure"}'
```

### Candidates

Suspicious assets queued for investigation. `status` always starts as `PENDING`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/candidates` | Create a candidate (`type` + `value` required; `name`, `description`, `brandId` optional) |
| GET | `/api/candidates` | List candidates, optional filters: `?status=`, `?type=`, `?brandId=` |
| GET | `/api/candidates/:id` | Get one candidate (404 if missing) |
| PATCH | `/api/candidates/:id/status` | Update status (`PENDING` \| `REVIEWING` \| `CONFIRMED` \| `DISMISSED`) |
| DELETE | `/api/candidates/:id` | Delete a candidate (404 if missing) |

Candidate types: `SOCIAL`, `WEBSITE`, `APP`, `DOMAIN`

```bash
curl -X POST http://localhost:4000/api/candidates \
  -H "Content-Type: application/json" \
  -d '{"type":"SOCIAL","value":"@PaySecureSupport","name":"PaySecure Support"}'
```

### Detection

| Method | Path | Description |
|---|---|---|
| POST | `/api/candidates/:candidateId/analyze/name` | Name/handle similarity of a candidate vs its brand's official assets |
| POST | `/api/candidates/:candidateId/analyze/text` | Text/description identity similarity vs the official brand identity |
| POST | `/api/candidates/:candidateId/analyze/logo` | Logo/visual similarity of the candidate vs the brand's official logo |
| POST | `/api/candidates/:candidateId/analyze/social-risk` | Social risk signals for a `SOCIAL` candidate (evidence, not a verdict) |
| POST | `/api/candidates/:candidateId/analyze/app-risk` | App risk signals for an `APP` candidate (evidence, not a verdict) |
| POST | `/api/candidates/:candidateId/analyze/evidence` | Multimodal evidence aggregation for `SOCIAL`/`APP` candidates |
| POST | `/api/candidates/:candidateId/analyze/risk` | Explainable risk score + reasons for `SOCIAL`/`APP` candidates |
| POST | `/api/candidates/:candidateId/analyze/explanation` | Why-flagged / why-NOT-flagged explanations for `SOCIAL`/`APP` candidates |

**Name/handle analysis**

```json
{
  "success": true,
  "data": {
    "candidateId": "...",
    "matchedAssetId": "...",
    "score": 0.92,
    "level": "HIGH",
    "isLookalike": true,
    "reason": "Candidate name is highly similar to an official brand asset."
  }
}
```

**Text/description analysis**

```json
{
  "success": true,
  "data": {
    "candidateId": "...",
    "score": 0.91,
    "level": "HIGH",
    "isSuspiciousSimilarity": true,
    "matchedTerms": ["paysecure", "support"],
    "reason": "Candidate text contains strong similarity to the official brand identity."
  }
}
```

**Logo analysis**

```json
{
  "success": true,
  "data": {
    "candidateId": "...",
    "score": 0.96,
    "level": "HIGH",
    "isSimilar": true,
    "reason": "Candidate logo is highly similar to the official brand logo."
  }
}
```

Requires `brand.logoUrl` (official logo) and a candidate logo reference. When either side is missing, or the image cannot be fetched/decoded, the API returns a structured **400 "logo comparison unavailable"** message instead of a fabricated score. Note: the current schema has no candidate logo field, so comparison is unavailable until one is added. Metric: perceptual gradient-hash × pixel-similarity on decoded PNG/JPEG (offline-decodable, no CV frameworks).

Score `0..1` (1 = identical after normalization). Levels: `>= 0.85` HIGH, `>= 0.65` MEDIUM, else LOW. Deterministic Levenshtein + token-overlap similarity — no LLM, results are not stored yet. `isLookalike` / `isSuspiciousSimilarity` mean similar, **not** confirmed malicious.

**Social risk signals**

SOCIAL candidates only. Returns **all meaningful signals** (never one combined threat score) so the later Risk Engine can weigh the evidence:

```json
{
  "success": true,
  "data": {
    "candidateId": "c123",
    "type": "SOCIAL",
    "signals": [
      { "signal": "NAME_SIMILARITY", "severity": "LOW", "score": 0.56, "reason": "Candidate handle shows some similarity to an official social identity." },
      { "signal": "BRAND_TEXT_MATCH", "severity": "HIGH", "score": 1, "reason": "Candidate profile text strongly references the protected brand identity." },
      { "signal": "SUPPORT_LANGUAGE", "severity": "MEDIUM", "score": 0.6, "reason": "Profile uses customer-support language commonly associated with impersonation accounts." },
      { "signal": "EXTERNAL_DOMAIN", "severity": "MEDIUM", "score": 0.7, "reason": "Candidate profile references an external domain that is not registered as an official brand asset: paysecure-help.com." },
      { "signal": "OFFICIAL_IDENTITY_CONFLICT", "severity": "HIGH", "score": 0.9, "reason": "Candidate closely resembles an official social identity but is not the registered official account." }
    ],
    "signalCount": 5,
    "hasHighSeverity": true
  }
}
```

Signals: `NAME_SIMILARITY` (reuses Task 6), `BRAND_TEXT_MATCH` (reuses Task 7), `SUPPORT_LANGUAGE` (12 centralized keywords), `OFFICIAL_DOMAIN_MATCH` / `EXTERNAL_DOMAIN` (URL/domain extraction + official-domain normalization), `OFFICIAL_IDENTITY_CONFLICT` (official-account exclusion applied first).

False-positive protections: the **exact official account** (normalized match) never gets impersonation/conflict signals, official domains are never flagged as external, ordinary brand/support words alone never produce a HIGH signal, and harmless unrelated accounts return `signals: []`. Non-social candidates get **400** `SOCIAL_ANALYSIS_NOT_APPLICABLE` (via `details.code`). Deterministic, explainable, no LLM — signals are evidence, never a "fake" verdict.

**App risk signals**

APP candidates only. Fixed signal order: `APP_NAME_SIMILARITY`, `APP_DESCRIPTION_MATCH`, `PACKAGE_IDENTIFIER_SIMILARITY`, `OFFICIAL_APP_MATCH`, `OFFICIAL_DOMAIN_MATCH`, `EXTERNAL_DOMAIN`, `APP_BRAND_IMPERSONATION`:

```json
{
  "success": true,
  "data": {
    "candidateId": "c456",
    "type": "APP",
    "signals": [
      { "signal": "APP_NAME_SIMILARITY", "severity": "HIGH", "score": 1, "reason": "Candidate app name is highly similar to the protected brand or an official app." },
      { "signal": "APP_DESCRIPTION_MATCH", "severity": "HIGH", "score": 1, "reason": "Candidate app description strongly references the protected brand identity." },
      { "signal": "PACKAGE_IDENTIFIER_SIMILARITY", "severity": "MEDIUM", "score": 0.82, "reason": "Candidate package identifier is moderately similar to an official app identifier." },
      { "signal": "APP_BRAND_IMPERSONATION", "severity": "HIGH", "score": 0.9, "reason": "Multiple strong similarities (app name, description, and/or package identifier) indicate this app closely imitates the protected brand identity." }
    ],
    "signalCount": 4,
    "hasHighSeverity": true,
    "unavailableSignals": [
      { "signal": "DIFFERENT_PUBLISHER", "reason": "Publisher/developer metadata is not present in the current data model — comparison unavailable (DIFFERENT_PUBLISHER)." }
    ]
  }
}
```

False-positive protections: the **exact official app identifier** (normalized match) yields only a benign `OFFICIAL_APP_MATCH` (LOW) and suppresses impersonation signals; generic words (`wallet`, `banking`, `support`, `refund`) never produce a HIGH on their own; official domains in app metadata are never external. `DIFFERENT_PUBLISHER` is always listed under `unavailableSignals` — the schema has no publisher field and was not modified. Non-APP candidates get **400** `APP_ANALYSIS_NOT_APPLICABLE`.

**Multimodal evidence aggregation**

`SOCIAL` and `APP` candidates only. Merges every modality into one ordered evidence list — `NAME` (Task 6), `TEXT` (Task 7), `LOGO` (Task 8), `SOCIAL` (Task 9) or `APP` (Task 10) — plus an honest `unavailable` list for modalities that could not be evaluated:

```json
{
  "success": true,
  "data": {
    "candidateId": "c123",
    "type": "SOCIAL",
    "evidence": [
      { "source": "NAME", "signal": "NAME_SIMILARITY", "severity": "LOW", "score": 0.63, "reason": "Candidate name has low similarity to official brand assets." },
      { "source": "TEXT", "signal": "TEXT_IDENTITY_MATCH", "severity": "HIGH", "score": 1, "reason": "Candidate text contains strong similarity to the official brand identity." },
      { "source": "SOCIAL", "signal": "BRAND_TEXT_MATCH", "severity": "HIGH", "score": 1, "reason": "Candidate profile text strongly references the protected brand identity." }
    ],
    "evidenceCount": 3,
    "highSeverityCount": 2,
    "hasHighSeverity": true,
    "unavailable": [
      { "source": "LOGO", "reason": "Target brand has no official logo (brand.logoUrl) — logo comparison unavailable." },
      { "source": "APP", "reason": "App risk analysis is only applicable to APP candidates — not evaluated for this SOCIAL candidate." }
    ]
  }
}
```

Evidence items appear in fixed source order (`NAME` → `TEXT` → `LOGO` → `SOCIAL`/`APP`); exact content duplicates (same signal, severity, score, reason) are deduplicated first-wins. Nothing is combined into a global score — that is the Risk Engine's job below. Other candidate types get **400** `EVIDENCE_ANALYSIS_NOT_APPLICABLE`.

**Risk analysis (explainable scoring)**

`SOCIAL` and `APP` candidates only. Deterministic scoring over Task 11 evidence — no LLM, no persistence, and **no fake/scam/malicious verdict** (it scores evidence, it does not classify intent):

```json
{
  "success": true,
  "data": {
    "candidateId": "c123",
    "type": "SOCIAL",
    "riskScore": 100,
    "riskLevel": "CRITICAL",
    "confidence": 0.95,
    "evidenceCount": 7,
    "independentSourceCount": 4,
    "reasons": [
      { "category": "CONTENT", "signal": "TEXT_IDENTITY_MATCH", "impact": 34, "reason": "Candidate text contains strong similarity to the official brand identity." },
      { "category": "IDENTITY", "signal": "OFFICIAL_IDENTITY_CONFLICT", "impact": 30, "reason": "…" }
    ],
    "evidence": [ "… Task 11 evidence, unchanged …" ],
    "unavailable": [ "… Task 11 unavailable, unchanged …" ]
  }
}
```

- **Score model:** `contribution = weight(severity) × clamp(score,0,1)` with LOW=10/MEDIUM=20/HIGH=35; overlapping signals in the same category (IDENTITY / CONTENT / VISUAL / SOCIAL / DOMAIN) are damped to 25% after the strongest one; protective official signals (`OFFICIAL_DOMAIN_MATCH`, `OFFICIAL_ACCOUNT_MATCH`, `OFFICIAL_APP_MATCH`) add no risk (official domain dampens the total ×0.75; exact official identity caps the score at 24); final score is bounded to 0–100
- **Levels:** LOW 0–24, MEDIUM 25–49, HIGH 50–74, CRITICAL 75–100
- **`confidence` ∈ [0,1]:** evidence breadth + independent-category count + mean signal strength (a coverage heuristic, not a probability)
- **`reasons`:** one entry per scoring evidence item (protective signals excluded), impact scaled so reasons sum to ≈ `riskScore`, sorted by impact desc → signal asc → source order
- Candidates that exactly match the official identity are protected: name/text self-similarity is suppressed and a benign official-match signal is emitted instead. Other candidate types get **400** `RISK_ANALYSIS_NOT_APPLICABLE`

**Why flagged / why NOT flagged (explanations)**

`SOCIAL` and `APP` candidates only. A deterministic explanation layer over the evidence + risk results — no LLM, no scoring, no new verdicts. `riskScore`/`riskLevel`/`confidence` are copied from the Risk Engine unchanged:

```json
{
  "success": true,
  "data": {
    "candidateId": "c123",
    "type": "SOCIAL",
    "riskScore": 4,
    "riskLevel": "LOW",
    "confidence": 0.87,
    "summary": "Official/protective evidence prevents inappropriate escalation: OFFICIAL_ACCOUNT_MATCH, OFFICIAL_DOMAIN_MATCH present — risk 4/100 LOW (confidence 0.87).",
    "whyFlagged": [
      { "category": "CONTENT", "signal": "TEXT_IDENTITY_MATCH", "source": "TEXT", "impact": 34, "explanation": "Text/brand identity similarity — TEXT evidence at HIGH strength contributed 34 points to the 100/100 CRITICAL risk. Evidence: …" }
    ],
    "whyNotFlagged": [
      { "category": "IDENTITY", "signal": "OFFICIAL_ACCOUNT_MATCH", "source": "SOCIAL", "protection": "Exact official identity match", "explanation": "…Official identity evidence reduced the risk because the candidate matches a registered official asset — the score is bounded to at most 24/100 (LOW ceiling)." },
      { "category": "ASSESSMENT", "signal": "INSUFFICIENT_EVIDENCE", "source": "NONE", "protection": "Weak or insufficient evidence", "explanation": "There is insufficient evidence to flag this candidate: …" }
    ],
    "protectiveSignals": ["OFFICIAL_ACCOUNT_MATCH", "OFFICIAL_DOMAIN_MATCH"],
    "evidenceCount": 3,
    "independentSourceCount": 3
  }
}
```

- **`whyFlagged`:** one entry per Risk Engine reason (strongest first), each backed by its real evidence item — signal label, source, impact, and the evidence's own reason text; nothing is invented, and no asset is called fake/scam/malicious
- **`whyNotFlagged`:** protective evidence actually present (exact official identity/app match with the 24-point cap stated, official domain match with the ×0.75 reduction stated) plus assessment entries: `INSUFFICIENT_EVIDENCE` (no risk evidence at all), `CONFLICTING_EVIDENCE` (protective + risk evidence both present), `LIMITED_SUPPORT` (flagged but confidence < 0.5)
- **`summary`:** one deterministic line from risk level + counts + protection — strong / moderate / weak evidence, insufficient evidence, or protective evidence preventing inappropriate escalation
- Other candidate types get **400** `EXPLANATION_NOT_APPLICABLE`

### Response format

- Success: `{ "success": true, "data": ... }` (list endpoints add `count`)
- Errors: `{ "success": false, "error": "...", "message": "..." }` with proper HTTP status (400 validation, 404 not found, 500 server)

## Roadmap

**Phase 2 — AI Detection:** name/handle similarity ✅ → text/description similarity ✅ → logo similarity ✅ → social risk signals ✅ → app risk analysis ✅ → evidence engine ✅ → explainable risk scoring ✅ → why-flagged / why-NOT-flagged explanations ✅.
**Later:** threat graph → campaign detection → AI Investigator.
