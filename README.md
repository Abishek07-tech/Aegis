# Digital Risk Protection Platform

An evidence-first, self-hosted prototype for investigating a brand's public
digital identity and potential impersonation risk.

## Current implementation

Phase 1 provides:

- FastAPI backend with Argon2id password hashing and JWT authentication
- user-isolated investigation CRUD and background scan status
- optional user-supplied official websites, email domains, social URLs, apps, logo assets, and identity context supplement automatic discovery
- PostgreSQL-ready SQLAlchemy models and an Alembic migration baseline
- React/Vite/TypeScript security-console shell
- Docker Compose services for frontend, backend, worker, PostgreSQL, Redis,
  SearXNG, and Nginx
- explicit source states (`NOT_CONFIGURED`, `UNAVAILABLE`, `FAILED`) instead
  of fabricated findings
- verified SearXNG JSON discovery adapter with bounded results and persisted
  provenance

## Local services

The Compose deployment publishes SearXNG on `http://localhost:8080` and
enables its JSON search format through `searxng/settings.yml`. The backend
uses `http://searxng:8080` when running inside Compose (from the root `.env`)
and `http://localhost:8080` when running directly on the host (from
`backend/.env`). The backend client calls `/search?q=<query>&format=json`.

Live collectors are intentionally isolated behind adapters. No production
finding is generated without collected evidence.

## Local AI

The only active AI provider is the internal Ollama service using
`LiquidAI/lfm2.5-350m`. Ollama is reachable only on the Compose network; it
has no public port and requires no API key. The initialization service
idempotently pulls the model if it is not already installed. AI interprets
bounded evidence only; deterministic provenance, signals, findings, and
numeric risk remain authoritative.

For low-memory VMs, Ollama is configured with one parallel request, one loaded
model, and a 10-minute keep-alive so the five selected AI candidates are
processed sequentially without repeated model loads. Each request is limited
to eight ranked evidence items, 6,000 context characters, a 2,048-token
context, and 256 output tokens. The Ollama container has a 640 MB limit:
inference was measured at 535–536 MB before this headroom was added, while
the complete stack remained below the host's measured available memory.

## Local setup

```bash
cp .env.example .env
docker compose up -d --build
```

The production-shaped Compose stack publishes only Nginx. For rootless local
Podman validation, the host mapping is `8080:80`, so the frontend is available
at `http://localhost:8080` and the API is under `/api` (for example,
`GET /api/health`). Nginx continues to listen on port 80 inside its
container. PostgreSQL, Redis, SearXNG, the backend, and the worker
remain on the internal Compose network.

Before starting, replace every placeholder in `.env`, especially
`POSTGRES_PASSWORD`, `JWT_SECRET`, and `CORS_ORIGINS`. No external AI API keys
are required.

For the local hackathon demo, `.env.example` enables an idempotent demo
account bootstrap:

```text
Email: demo@brand.local
Password: BrandDemo@2026!
```

These credentials are for local demonstration only and are not production-safe.
Set `ENABLE_DEMO_ACCOUNT=false` for production. The backend creates this user
only when enabled and absent, hashes the password with the existing Argon2id
implementation, and never overwrites an existing account or password.

The `pgdata` and `redisdata` named volumes must not be removed during normal
upgrades or restarts.

For Podman, use the equivalent `podman-compose` commands. The same service
hostnames are used: `postgres`, `redis`, and `searxng`.

For a host-based backend:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload
```

## Oracle Cloud deployment

Use an Oracle Cloud VM with a firewall/security list permitting only SSH and
the intended HTTP/HTTPS ports. For Oracle production, map the host to Nginx's
internal port 80 using host port 80 or 443 as appropriate, with TLS
termination and certificate management configured explicitly. Keep ports
5432, 6379, 8080, 8000, and 11434 closed to the public internet. The
`8080:80` mapping in this repository is for rootless local Podman validation,
not the public Oracle listener.

```bash
cp .env.example .env
# edit .env with production values and your public HTTPS origin
podman-compose up -d --build
podman-compose ps
curl http://127.0.0.1:8080/api/health
```

Backend startup runs `alembic upgrade head` before Uvicorn starts. This is
safe for the existing migrations and ensures the persistent PostgreSQL volume
is upgraded before the API becomes healthy.

## Verification

```bash
pytest -q
python -m compileall backend/app
```

## Security notes

- Set a long random `JWT_SECRET` outside development.
- Passwords are never stored in plaintext.
- Every investigation query is scoped to the authenticated user.
- The collector boundary must enforce DNS-aware SSRF protection, timeouts,
  response limits, and redirect validation before fetching external URLs.
- Search, social, app, and AI integrations must report unavailable states;
  they must not turn collection failures into “no threats”.

See `docs/architecture.md` and `docs/security.md` for the current design and
known limitations.
