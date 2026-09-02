# Pharma Investment Opportunity Investigator

Local source of truth for the n8n research automation. Hosted n8n remains the execution runtime; PostgreSQL on your VPS is the research system of record.

## Current focus

Phase 0 database foundation only. Workflows are deferred until Postgres is deployed and reachable from n8n.

See [docs/DATABASE.md](docs/DATABASE.md).

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
```

Unit tests cover shared Code node logic under `workflows/shared/code/`. Full webhook execution still requires a hosted n8n test run after deploy.

## Repository layout

- `AGENTS.md` — working model and milestone log
- `PHARMA_INVESTMENT_OPPORTUNITY_INVESTIGATOR.md` — product specification
- `docker-compose.yml` — Postgres + migrate runner
- `db/migrations/` — SQL schema versions
- `docs/DATABASE.md` — local and VPS database instructions
- `workflows/` — n8n Workflow SDK sources (PII-00+)
