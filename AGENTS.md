# AGENTS.md

## Purpose

This repository is the local source of truth for an n8n automation whose live
runtime is hosted remotely. It contains workflow definitions, supporting
scripts, deployment notes, and verified project history.

Use this file to preserve project context between work sessions. Update it
whenever a meaningful local or hosted change is completed.

## Working Model

Build and review changes locally first. Treat the remote n8n instance as the
deployment target and source of live execution truth, not as the primary place
to design or debug a workflow.

Preferred lifecycle:

1. Make workflow and documentation changes in this repository.
2. Validate workflow source and helper scripts locally where possible.
3. Review the proposed change as a coherent patch.
4. Deploy or manually apply the approved workflow change to hosted n8n.
5. Run one focused hosted validation execution.
6. Record the deployed version, execution outcome, and any remaining risk here.

This reduces repeated remote inspection and editing, while preserving hosted
validation for integrations that only exist in n8n Cloud.

## Local Responsibilities

Keep these artifacts under version control when applicable:

- Exportable workflow definitions or source generators.
- Code-node JavaScript and expressions represented in maintainable source files.
- Helper scripts for controlled form submission or test requests.
- Expected data-table schemas and field mappings.
- Deployment instructions and execution-validation notes.
- A concise change and milestone history in this file.

Use local checks before deployment, such as syntax checks, schema validation,
and static inspection of node connections and expressions.

## Hosted n8n Responsibilities

The hosted n8n environment remains authoritative for:

- Credentials, OAuth connections, API tokens, and secrets.
- Actual workflow activation and publication.
- Hosted data-table IDs and deployed workflow IDs.
- Real external API behavior and live execution results.
- Production-only constraints such as webhooks, rate limits, and permissions.

Never commit raw credentials, bearer tokens, webhook secrets, or exported
credential data. Keep secrets in local machine configuration or the hosted n8n
credential store only.

## Deployment Rules

- Do not make an unreviewed remote edit when the same change can be represented
  locally first.
- Record the hosted workflow ID, active version ID, and relevant execution ID
  after a deployment when available.
- Prefer a narrowly scoped manual test over broad scheduled or polling tests.
- Do not activate high-frequency polling workflows without an explicit quota
  and cost review.
- Do not overwrite a hosted workflow until the local source reflects the
  intended change.
- If the remote workflow has drifted from the repository, inspect and document
  the difference before applying more changes.

## Project Configuration

Fill these values as the project is established:

- Hosted n8n URL: `TBD`
- Hosted n8n project ID: `FaU28ckb88bAPAfT` (personal project; confirmed via MCP)
- Primary workflow name and ID: `TBD` (workflows deferred until Postgres is live)
- Primary data table name and ID: `N/A` — research system of record is PostgreSQL (`pii_research`), not n8n Data Tables
- Research Postgres: local Docker Compose now; VPS-hosted instance next (host/URL `TBD`)
- Deployment method: MCP for n8n workflows (after DB); git pull + `docker compose` for Postgres on VPS
- Local validation commands:
  - `docker compose up -d postgres`
  - `docker compose --profile migrate run --rm migrate`
  - `docker compose exec postgres psql -U pii_app -d pii_research -c "\dt"`

## Current Status

Project status: Phase 0 database foundation in progress.

PostgreSQL schema and Compose stack exist in this repository. No n8n workflow has been created or deployed yet. Do not start workflow work until the VPS Postgres instance is up, migrated, and reachable from hosted n8n.

## Next Steps

1. Create local `.env` from `.env.example`, start Postgres, apply migrations, and verify tables.
2. Commit and push the Phase 0 database files; pull on the VPS.
3. Start Postgres on the VPS, apply migrations, configure firewall/TLS, and record the host in this file.
4. Create an n8n Postgres credential pointing at the VPS database.
5. Only then begin Phase 1 workflow source (PII-00 orchestrator vertical slice).

## Milestone Log

### 2026-09-02

- Created this repository starter and formalized the repo-first, hosted-n8n deployment workflow.
- Confirmed n8n MCP connectivity to personal project `FaU28ckb88bAPAfT`.
- Chose managed/VPS PostgreSQL over n8n Data Tables for the research system of record.
- Added Phase 0 Docker Compose Postgres, initial schema migration (`001_initial_schema.sql`), migrate runner, and `docs/DATABASE.md`. Workflows intentionally not started yet.
