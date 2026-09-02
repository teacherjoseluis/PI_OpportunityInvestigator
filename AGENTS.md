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

## Workflow Development Agreements

These rules were agreed with the project owner and must be followed for all
Phase 1+ n8n work.

### Source of truth

- **Local repository** is the design and context source for workflows.
- **Hosted n8n** is the runtime: credentials, execution, publication, and
  live integration behavior.
- Do not repeatedly fetch full workflow JSON from n8n for context when local
  source files already exist.

### Local workflow format

- Workflows are maintained as **n8n Workflow SDK source files** under
  `workflows/`, not as ad-hoc remote-only edits.
- Heavy logic (Code nodes, SQL, schemas) lives in separate maintainable files
  under `workflows/shared/`, `config/`, and `prompts/` where practical.
- Use **separate subworkflows** (PII-00 … PII-14) per the product spec; avoid
  one monolithic canvas.

Proposed layout:

```
workflows/
  pii-00-orchestrator/
  pii-01-identity/
  ...
  shared/          # reusable Code node JS, input/output schemas
config/            # gates, scores, budgets (JSON)
prompts/           # versioned prompt templates
```

### Deployment gate (user-controlled)

- **Do not push or update hosted n8n workflows unless the user explicitly
  asks** (e.g. “deploy”, “push to n8n”, “apply to remote”).
- Local edits, validation, and git commits may proceed without a remote deploy.
- After an approved deploy: run **one focused hosted validation execution**,
  then record workflow ID, version, and execution ID in this file.

### MCP usage (token-efficient)

| Activity | Where |
|---|---|
| Read/edit workflow logic | Local `workflows/` files |
| Static validation | Local |
| Create or update workflow | MCP — once per approved deploy batch |
| Test execution | MCP — one run unless debugging failure |
| Record IDs and outcomes | `AGENTS.md` |

Avoid: exploratory remote workflow fetches, full-canvas redeploys for small
changes when surgical `update_workflow` ops suffice, and remote inspection
when local files answer the question.

### Drift

If hosted n8n was changed outside this repository, compare once, document the
diff, reconcile locally, then deploy only after user approval.

### Credentials (reference by name only)

- **Postgres (PII research DB):** `Postgres account` — points at VPS
  `108.174.153.74:5433` / `pii_research` / `pii_app`.
- Never commit passwords, tokens, or credential exports. Reference credential
  **names** in workflow source; secrets stay in n8n credentials store.

## Project Configuration

Fill these values as the project is established:

- Hosted n8n URL: `TBD`
- Hosted n8n project ID: `FaU28ckb88bAPAfT` (personal project; confirmed via MCP)
- Primary workflow name and ID: `TBD` (Phase 1 not started)
- Primary data table name and ID: `N/A` — research system of record is PostgreSQL (`pii_research`), not n8n Data Tables
- n8n Postgres credential name: `Postgres account`
- Research Postgres: VPS at `108.174.153.74:5433`, database `pii_research`, user `pii_app` (password in VPS `.env` only). Local Docker also uses host port `5433` when `5432` is busy.
- Deployment method: MCP for n8n workflows (user must explicitly request each push); git pull + `docker compose` for Postgres on VPS (`/opt/apps/PI_OpportunityInvestigator`)
- Local validation commands:
  - `docker compose up -d postgres`
  - `docker compose --profile migrate run --rm migrate`
  - `docker compose exec postgres psql -U pii_app -d pii_research -c "\dt"`

## Current Status

Project status: Phase 0 complete — VPS Postgres live and reachable from n8n Cloud.

Host: `108.174.153.74:5433`, database `pii_research`, user `pii_app`. UFW allowlists n8n Cloud egress IPs on 5433. No Phase 1 workflow created yet.

## Next Steps

1. Scaffold Phase 1 local workflow source under `workflows/` (PII-00 vertical slice).
2. Deploy to hosted n8n only when the user requests a push.
3. Add backup automation on the VPS before heavy use.

## Milestone Log

### 2026-09-02

- Created this repository starter and formalized the repo-first, hosted-n8n deployment workflow.
- Confirmed n8n MCP connectivity to personal project `FaU28ckb88bAPAfT`.
- Chose managed/VPS PostgreSQL over n8n Data Tables for the research system of record.
- Added Phase 0 Docker Compose Postgres, initial schema migration (`001_initial_schema.sql`), migrate runner, and `docs/DATABASE.md`. Workflows intentionally not started yet.
- Deployed Postgres to VPS under `/opt/apps/PI_OpportunityInvestigator`; host `108.174.153.74:5433`; UFW allowlisted n8n Cloud IPs on 5433; n8n credential connectivity confirmed.
- Documented workflow development agreements: SDK source in `workflows/`, credential `Postgres account`, user-gated MCP deploys, token-efficient local-first context.
