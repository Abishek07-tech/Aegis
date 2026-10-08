# API

Current endpoints: `POST /auth/register`, `POST /auth/login`, `GET
/auth/me`, investigation CRUD, `POST /investigations/{id}/scan`, and `GET
/investigations/{id}/scan/status`. Authenticated endpoints require
`Authorization: Bearer <token>`.

`GET /investigations/{id}/sources` returns discovery provenance and the
collector state. A source with `NOT_CONFIGURED`, `UNAVAILABLE`, `BLOCKED`,
`RATE_LIMITED`, or `FAILED` is not equivalent to zero findings.

Generated dnstwist domains are returned by the candidates endpoint with
`status=UNKNOWN` until separate live analysis supplies evidence.

`GET /investigations/{id}/relationships` returns first-party identity
relationships. Assets are marked verified only when supplied by the official
website or directly linked from it; search ranking alone cannot create a
verified asset.

`GET /investigations/{id}/domain-analysis` returns domain candidates with
DNS/website evidence counts, deterministic risk fields, and explicit
`UNKNOWN` status when collection is insufficient.

Social and app candidates are included in `GET /investigations/{id}/candidates`
with `asset_type` values `social` or `app`. `GET /investigations/{id}/sources`
exposes the source state for Instagram, LinkedIn, and Google Play discovery.

The React investigation console also uses `GET
/investigations/{id}/scan/events` for ordered events from the latest scan.
This endpoint applies the normal investigation ownership check. Finding
explanations, recommendations, and signal contributions are rendered from
backend responses; the frontend does not recalculate risk. Source states
remain visible when a collector fails or is unavailable.

`GET /ai/providers` reports the configured state of the internal Ollama model
without returning credentials. `GET
/investigations/{id}/ai-analyses` returns persisted normalized assessments,
including provider/model, status, evidence IDs, confidence, recommendation,
and evidence snapshot hash. AI records are informational; deterministic
findings and numeric risk remain authoritative. When at least one provider
returns a validated local-model result, it is persisted directly.
Provider disagreement is represented as `REVIEW`; unavailable providers are
never treated as evidence of no threat.
