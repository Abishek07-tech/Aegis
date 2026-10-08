# Architecture

The API owns authentication and investigation state. Scan jobs are persisted
in PostgreSQL and are designed to be delegated to Celery/Redis. Collectors
will implement narrow interfaces and return provenance plus an explicit source
state. Detection and risk scoring will consume only stored evidence.

The current Phase 1 worker path uses FastAPI background tasks only to validate
the job lifecycle; it does not pretend to collect external data.

The SearXNG adapter is implemented against the documented `/search` JSON
endpoint. It stores query, result provenance, collector version, and explicit
source state. Search results are discovery evidence and are not automatically
classified as threats.

The Compose SearXNG service mounts `searxng/settings.yml`, publishes port
8080 for host-run backend development, enables the JSON format explicitly, and
has a healthcheck that exercises `/search?format=json`. Compose containers use
the service hostname `searxng`; a backend started directly on the host uses
`localhost:8080`.

When a user supplies an official website, links extracted from that
first-party page are persisted as verified official assets with
`html_social_link` provenance and explicit confidence. This is the current
identity-graph boundary; independent search results are not promoted to
official assets automatically.

dnstwist is used only for bounded candidate generation at this stage.
Generated domains are stored as `UNKNOWN` candidates; registration, DNS,
HTTP, and content evidence are required before a risk finding can be created.

Candidate analysis uses dnspython for bounded A, AAAA, CNAME, MX, and NS
queries. DNS records and website collection states are persisted as evidence.
Registration evidence is explicitly recorded as `NOT_CONFIGURED` because no
verified RDAP/WHOIS adapter is currently enabled.
Only candidates with reachable website evidence and non-empty deterministic
signals receive a risk finding; dnstwist-only and DNS-only candidates remain
`UNKNOWN`.

Social discovery uses SearXNG as public-web discovery evidence. LinkedIn does
not use private APIs or authenticated scraping. Instagram has an optional
verified Instaloader public-profile adapter with no login or media downloads;
when the dependency or public access is unavailable, its state is preserved.
Google Play discovery uses SearXNG result URLs and does not claim metadata that
was not returned publicly. Name similarity alone leaves social/app candidates
`UNKNOWN`.

The frontend is an authenticated evidence-first console over these resources.
It separates verified official assets from discovered candidates, displays
collector state independently from candidate counts, and presents raw
evidence beside persisted risk signals, explanations, and recommendations.
Scan progress is derived from scan status and ordered scan events rather than
client-generated percentages.

## AI analysis

AI providers are normalized behind the `AIProvider` contract. The supported
the local Ollama provider is the only active AI provider. It receives
the same bounded evidence bundle independently. Responses are validated
against the shared Pydantic schema and evidence IDs are checked against the
bundle before persistence in `ai_analyses`.

AI does not calculate or replace deterministic risk. Provider failures are
persisted with their explicit state while deterministic discovery and
correlation continue. External evidence is explicitly treated as untrusted
data, never as instructions. Inference is bounded by timeout, evidence size,
output tokens, and a maximum of five evidence-backed candidates per scan.
Validated provider outputs are
validated output is persisted directly; deterministic risk remains authoritative.
and requires human review, while agreement preserves the highest-confidence
assessment. Adjudication never changes the deterministic numeric score.
