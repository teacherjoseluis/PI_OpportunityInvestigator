# Pharma Investment Opportunity Investigator

Local source of truth for the n8n research automation. Hosted n8n remains the execution runtime; PostgreSQL on your VPS is the research system of record.

## Current focus

Phase 1 workflows are hosted; evidence enrichment is sliced in [docs/ENRICHMENT.md](docs/ENRICHMENT.md). Weekly candidate **lead list** (no auto-investigation) is specified in [docs/DISCOVERY.md](docs/DISCOVERY.md). The supervisor DAG and technical-analysis specialist are in [docs/MULTI_AGENT_ORCHESTRATION.md](docs/MULTI_AGENT_ORCHESTRATION.md). The accepted chart email is specified in [docs/EMAIL_CHART_MEMO.md](docs/EMAIL_CHART_MEMO.md) and follow-up routing in [docs/FOLLOW_UP_QUESTIONS.md](docs/FOLLOW_UP_QUESTIONS.md). Neither spec is implemented. Postgres setup remains in [docs/DATABASE.md](docs/DATABASE.md).

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
- `docs/MULTI_AGENT_ORCHESTRATION.md` — supervisor DAG, specialist agents, technical analysis
- `docs/EMAIL_CHART_MEMO.md` — chart research-memo email (visual: `assets/pii-investor-email-charts.png`)
- `docs/FOLLOW_UP_QUESTIONS.md` — supervisor routing for follow-up questions on an existing case
- `docs/SMOKE_TESTS.md` — hosted webhook smoke helpers
- `config/agents.v1.json` — agent catalog and task-graph dependencies
- `config/analysis-technical.v1.json` — TA indicator params and timing rubric
- `config/collection-market.v1.json` — OHLCV collector (TwelveData plan coverage unverified)
- `workflows/` — n8n Workflow SDK sources (PII-00+)
