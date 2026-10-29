# Pharma Investment Opportunity Investigator

Local source of truth for the n8n research automation. Hosted n8n remains the execution runtime; PostgreSQL on your VPS is the research system of record.

## Current focus

Phase 1 workflows are hosted; evidence enrichment is sliced in [docs/ENRICHMENT.md](docs/ENRICHMENT.md). Weekly candidate **lead list** (no auto-investigation) is specified in [docs/DISCOVERY.md](docs/DISCOVERY.md). Postgres setup remains in [docs/DATABASE.md](docs/DATABASE.md).

## Quick start (local Postgres)

```bash
cp .env.example .env
# edit POSTGRES_PASSWORD
docker compose up -d postgres
docker compose --profile migrate run --rm migrate
```

## Local tests (before git commit or n8n deploy)

```bash
npm test
npm run bundle:pii-00
npm run bundle:pii-01
```

Unit tests cover shared Code node logic under `workflows/shared/code/`. Full webhook execution still requires a hosted n8n test run after deploy — see [docs/SMOKE_TESTS.md](docs/SMOKE_TESTS.md) and `scripts/smoke/Invoke-PiiWebhook.ps1`.

## Repository layout

- `AGENTS.md` — working model and milestone log
- `PHARMA_INVESTMENT_OPPORTUNITY_INVESTIGATOR.md` — product specification
- `docker-compose.yml` — Postgres + migrate runner
- `db/migrations/` — SQL schema versions
- `docs/DATABASE.md` — local and VPS database instructions
- `docs/ENRICHMENT.md` — evidence enrichment slices (XBRL, blobs, FDA/IR/patents)
- `docs/DISCOVERY.md` — D0 weekly discovery lead list (SEC names → email; no auto PII-00)
- `docs/SMOKE_TESTS.md` — hosted webhook smoke helpers
- `workflows/` — n8n Workflow SDK sources (PII-00+)
