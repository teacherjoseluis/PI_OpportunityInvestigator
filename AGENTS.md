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
- Use **separate subworkflows** (PII-00 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ PII-14) per the product spec; avoid
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
  asks** (e.g. ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œdeployÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â, ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œpush to n8nÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â, ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œapply to remoteÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â).
- Local edits, validation, and git commits may proceed without a remote deploy.
- After an approved deploy: run **one focused hosted validation execution**,
  then record workflow ID, version, and execution ID in this file.

### MCP usage (token-efficient)

| Activity | Where |
|---|---|
| Read/edit workflow logic | Local `workflows/` files |
| Static validation | Local |
| Create or update workflow | MCP ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â once per approved deploy batch |
| Test execution | MCP ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â one run unless debugging failure |
| Record IDs and outcomes | `AGENTS.md` |

Avoid: exploratory remote workflow fetches, full-canvas redeploys for small
changes when surgical `update_workflow` ops suffice, and remote inspection
when local files answer the question.

### Drift

If hosted n8n was changed outside this repository, compare once, document the
diff, reconcile locally, then deploy only after user approval.

### Credentials (reference by name only)

- **Postgres (PII research DB):** `Postgres account` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â points at VPS
  `108.174.153.74:5433` / `pii_research` / `pii_app`.
- Never commit passwords, tokens, or credential exports. Reference credential
  **names** in workflow source; secrets stay in n8n credentials store.

## Project Configuration

Fill these values as the project is established:

- Hosted n8n URL: `https://teacherjoseluis.app.n8n.cloud`
- Hosted n8n project ID: `FaU28ckb88bAPAfT` (personal project; confirmed via MCP)
- Primary workflow name and ID: `PII-00 Case Orchestrator` / `4jvmYtTHKufojJRK` (published; version `e1828955-d1db-48e9-b359-b61fc76a98cd`)
- PII-01 workflow name and ID: `PII-01 Identity Resolver` / `Xf6DjDUMyfOyNX3G` (published; version `de222a9c-c473-4dae-86f8-2017ff9319a7`)
- PII-02 workflow name and ID: `PII-02 Eligibility Gate` / `hqgFoP7ny6jnycxx` (published; version `567e37d5-1cd7-41cd-9399-9ae3055f69e0`)
- PII-03 workflow name and ID: `PII-03 Evidence Collector` / `IqoALspzvN3PL5Cq` (published; version `dd3f6f92-dcfd-436e-a0de-be298656f5ed`)
- PII-04 workflow name and ID: `PII-04 Financial and Business Analyst` / `RvIlyuDV0MEsXezL` (published; version `93d2a4b7-4192-4348-b27e-45d5ae81da26`)
- PII-05 workflow name and ID: `PII-05 Growth Analyst` / `sdamxDo9SUdo4QxC` (published; version `5eda536b-d371-4b57-a95f-c61b450e91df`)
- PII-06 workflow name and ID: `PII-06 Pipeline and Clinical Analyst` / `b8CxYW8T8FrGl62x` (published; version `7b992085-7363-4320-897b-cd0b87aeec14`)
- PII-07 workflow name and ID: `PII-07 Regulatory and Catalyst Analyst` / `4AqBDr5hjZeMLy99` (published; version `024718e7-9cd9-4fe8-ba7b-0598b405f3c4`)
- PII-08 workflow name and ID: `PII-08 Valuation and Market Analyst` / `1PuOVYf0O3GThRwq` (published; version `d64f67dc-4a25-4527-8175-e258c554b12c`)
- PII-09 workflow name and ID: `PII-09 Risk and Red-Team Reviewer` / `mioSWLKBMLAaBGzs` (published; version `68b3a70b-5e3d-4942-9df1-46746edda50a`)
- PII-10 workflow name and ID: `PII-10 Scoring and Quality Gate` / `lIjKOZS7qDizvynm` (published; version `74ad0610-407a-46fe-8e13-cc238cec2dc3`)
- PII-11 workflow name and ID: `PII-11 Report Generator` / `CLiHq1zJ1Euwhrxb` (published; version `65614b81-f873-4f1c-ad89-05e6df8dcb35`)
- PII-12 workflow name and ID: `PII-12 Monitoring and Reassessment` / `go396vtpeHKcvtub` (inactive; version `2633c95f-34cf-4051-a384-a0ec7b78762e`)
- PII-13 workflow name and ID: `PII-13 Operations and Alerts` / `ldPDfkqkkuDBfLe5` (inactive; version `be2d45ee-bd56-4e1a-b588-bdf46d2143f1`)
- PII-14 workflow name and ID: `PII-14 Email Digest and Report Delivery` / `kf6pC1t7J1XavbiE` (published; version `9a7c0bf0-1a1f-4234-99af-d0ec88a6b846`; on PII-00 path)
- PII Slack Intake workflow name and ID: `PII Slack Intake` / `Co5hmZSuqqk97rhg` (published; version `1d358400-1f6c-4a08-afca-ed776cbceb9e`)
- PII-15 workflow name and ID: `PII-15 Slack Completion Notify` / `3Q4goJz1gGKJRLMI` (published; version `fdf2949f-d947-4b8b-ad4f-c59377a38d53`)
- Active version ID: e1828955-d1db-48e9-b359-b61fc76a98cd (PII-00; wired through PII-11 → PII-14 → PII-15; early-exit notify on eligibility/evidence stop)
- Webhook test URL: `https://teacherjoseluis.app.n8n.cloud/webhook-test/pii/investigate`
- Webhook production URL: `https://teacherjoseluis.app.n8n.cloud/webhook/pii/investigate` (published)
- Slack slash webhook production URL: `https://teacherjoseluis.app.n8n.cloud/webhook/pii/slack` (published)
- Primary data table name and ID: `N/A` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â research system of record is PostgreSQL (`pii_research`), not n8n Data Tables
- n8n Postgres credential name: `Postgres account`
- n8n Twelve Data credential name: `TwelveData API key` (`httpQueryAuth`) — `/quote` on Basic; `/profile` needs Grow+; `/statistics` needs Pro+
- n8n Finnhub credential name: `Finnhub API key` (`httpQueryAuth`) — PII-02 profile2 fallback; PII-03 E5 `/company-news` headlines
- n8n USPTO credential name: `USPTO ODP API Key` (`httpHeaderAuth`) — PII-03 E6 Patent File Wrapper search (`X-API-KEY`)
- n8n openFDA credential name: `openFDA API key` (`httpQueryAuth`, query param `api_key`) — PII-03 E4/E8 Drugs@FDA
- n8n CourtListener credential name: `CourtListener API Token` (`httpHeaderAuth`, `Authorization: Token …`) — PII-03 E8 search v4
- n8n SMTP credential name: `SMTP account` (from/to `teacherjoseluis@gmail.com`; shared with Investment Concierge)
- n8n Slack credential name: `Slack PII bot` (`slackApi`) — used by PII-15 completion DM; requires `im:write` (plus existing scopes); Slack intake Phase 1 still uses slash `response_url`
- Research Postgres: VPS at `108.174.153.74:5433`, database `pii_research`, user `pii_app` (password in VPS `.env` only). Local Docker also uses host port `5433` when `5432` is busy.
- Deployment method: MCP for n8n workflows (user must explicitly request each push); git pull + `docker compose` for Postgres on VPS (`/opt/apps/PI_OpportunityInvestigator`)
- Local validation commands:
  - `docker compose up -d postgres`
  - `docker compose --profile migrate run --rm migrate`
  - `docker compose exec postgres psql -U pii_app -d pii_research -c "\dt"`
  - `npm test` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â unit tests for shared Code node logic
  - `npm run bundle:pii-00` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate `workflow.ts` after template/code edits
  - `npm run bundle:pii-01` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-01 `workflow.ts`
  - `npm run bundle:pii-02` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-02 `workflow.ts`
  - `npm run bundle:pii-03` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-03 `workflow.ts`
  - `npm run bundle:pii-04` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-04 `workflow.ts`
  - `npm run bundle:pii-05` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-05 `workflow.ts`
  - `npm run bundle:pii-06` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-06 `workflow.ts`
  - `npm run bundle:pii-07` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â regenerate PII-07 `workflow.ts`
  - `npm run bundle:pii-08` — regenerate PII-08 `workflow.ts`
  - `npm run bundle:pii-09` — regenerate PII-09 `workflow.ts`
  - `npm run bundle:pii-10` — regenerate PII-10 `workflow.ts`
  - `npm run bundle:pii-11` — regenerate PII-11 `workflow.ts`
  - `npm run bundle:pii-12` — regenerate PII-12 `workflow.ts`
  - `npm run bundle:pii-13` — regenerate PII-13 `workflow.ts`
 - `npm run bundle:pii-14` — regenerate PII-14 `workflow.ts`
 - `npm run bundle:pii-slack` — regenerate Slack intake `workflow.ts`
 - `npm run bundle:pii-15` — regenerate PII-15 Slack notify `workflow.ts`
 - `.\scripts\smoke\Invoke-PiiWebhook.ps1` — hosted webhook smoke test (see `docs/SMOKE_TESTS.md`)

## Current Status

Project status: Phase 1 through PII-15 hosted. **E1 + E4 + E5 + E6 + E7 signed off**. **E8 local** (CourtListener + wider XBRL + CT.gov enrollment; migration `024`). **Slack early-exit notify deployed**. Remaining: apply `024` + deploy E8; optional TwelveData upgrade; webhook rotation.

### PII-03 enrichment backlog (see ENRICHMENT.md)

1. ~~SEC XBRL cash/debt (E1)~~ — **done** (E8 widens income/OCF/shares/runway)
2. ~~Full SEC filing HTML / object storage (E2–E3)~~ — **declined**
3. ~~FDA / openFDA collector (E4)~~ — **done** (E8 attaches `openFDA API key`)
4. ~~Company IR / press (E5)~~ — **done** (Finnhub company-news compact headlines)
5. ~~USPTO / patents collector (E6)~~ — **done** (ODP Patent File Wrapper compact; credential `USPTO ODP API Key`)
6. ~~Broader `evidence_chunks` + analyst sweep (E7)~~ — **done**
7. CourtListener litigation inventory (E8) — **local**; Orange Book ZIP exclusivity still deferred

Hosted workflows in personal project `FaU28ckb88bAPAfT`.

## Next Steps

1. Apply VPS migration `024`, then say **deploy** for PII-03 / PII-04 / PII-06 / PII-09 / PII-10.
2. Smoke a fresh ticker through collect → report → email; confirm burn/margins/shares/enrollment/litigation claims and a numeric Business score.
3. Optionally upgrade TwelveData; rotate webhook secret; smoke early-exit DM on a mega-cap.
4. Day-to-day: Slack `/pii` / webhook for fresh tickers (avoid REGN duplicate_recent_case).

## Milestone Log

### 2026-09-16 (Slice E8 local)

- Implemented **E8 CourtListener + wider XBRL + CT.gov enrollment** (no filing HTML blobs; Orange Book ZIP deferred).
- PII-03: credential `openFDA API key` on Fetch OpenFDA; collector `courtlistener` → `courtlistener_docket`; companyfacts now extracts revenue/margins/OCF/shares/runway; CT.gov stores enrollment.
- PII-04: facts for `margins`, `burn_runway`, `share_count` when XBRL metrics exist.
- PII-06: `enrollment_inventory`; PII-09: `litigation_docket_inventory`; PII-10: score `business_financial` claims (fixes blank Business email score).
- Migration `024_collection_courtlistener_xbrl_e8_v1.sql`. Unit tests + `bundle:pii-03/04/06/09/10`. **Not deployed** until explicitly requested.

### 2026-09-16 (Slack early-exit notify deploy)

- Applied migration `023` via temp n8n Postgres (exec `2396`; archived); `notify_on_early_exit: true` on active config.
- Published PII-15 `3Q4goJz1gGKJRLMI` → `fdf2949f-d947-4b8b-ad4f-c59377a38d53` (mode COMPLETION|EARLY_EXIT; stage dedupe).
- Published PII-00 `4jvmYtTHKufojJRK` → `e1828955-d1db-48e9-b359-b61fc76a98cd` (completion `mode=COMPLETION`; IF false → Notify Slack Eligibility/Evidence Early Exit).

### 2026-09-16 (Slack early-exit notify local)

- Local: PII-15 accepts `mode` COMPLETION|EARLY_EXIT + stage/reason/outcome/next_state/detail; EARLY_EXIT DMs without requiring a report; dedupe `slack:EARLY_EXIT:<case_id>:<stage>`.
- Config `notify_on_early_exit: true`; migration `023_slack_early_exit_notify_v1.sql`.
- PII-00 wires early-exit Execute PII-15 from eligibility not COLLECTING and evidence not ANALYZING; completion path passes `mode=COMPLETION`.
- Unit tests + `bundle:pii-15` / `bundle:pii-00`. Deployed same day (see Slack early-exit notify deploy).

### 2026-09-16 (E7 sign-off)

- Owner verified E7 smoke (chunks + net_cash_debt / liquidity claims). Slice E7 signed off for product use.

### 2026-09-16 (Slice E7 deploy + smoke)

- Applied migration `022` soft-close copy via temp Postgres wrapper (archived) when needed; config check confirmed E7 insufficient texts.
- Published PII-03 `IqoALspzvN3PL5Cq` → `dd3f6f92-dcfd-436e-a0de-be298656f5ed` (Prepare/Has/Upsert Evidence Chunks after SEC/CT/FDA/news/USPTO).
- Published PII-04 `RvIlyuDV0MEsXezL` → `93d2a4b7-4192-4348-b27e-45d5ae81da26` (dilution soft-close when offering forms present).
- Published PII-08 `1PuOVYf0O3GThRwq` → `d64f67dc-4a25-4527-8175-e258c554b12c` (Load Financial Metrics + `net_cash_debt`).
- Published PII-09 `mioSWLKBMLAaBGzs` → `68b3a70b-5e3d-4942-9df1-46746edda50a` (Load Financial Metrics + `liquidity_balance_sheet_inventory`).
- REGN case `a87fa88d-2508-4150-b01f-da7f03a6d8c0` via temp wrappers (archived): PII-03 wrapper exec `2386` / sub `2387` COLLECTED (`fda` chunks=7, `finnhub_company_news` chunks=25, `uspto_patent` chunks=25); analysts wrapper exec `2388` → PII-08 `2389` ANALYZED (`net_cash_debt` fact, not in insufficient; metrics_count=602); PII-09 `2390` ANALYZED (`liquidity_balance_sheet_inventory`; `financial_financing_depth` not in insufficient); PII-04 `2391` ANALYZED (`dilution` still insufficient — REGN had no offering forms to soft-close).

### 2026-09-16 (Slice E7 local)

- Implemented **E7 chunk backfill + analyst sweep** (no new collectors/blobs): migration `022_chunk_backfill_analyst_sweep_v1.sql`.
- PII-03: after SEC/CT/FDA/news/USPTO document upserts, write `evidence_chunks` from existing `chunk_text` (XBRL path unchanged).
- PII-08: `net_cash_debt` fact from `financial_metrics` when XBRL present; skip insufficient.
- PII-09: `liquidity_balance_sheet_inventory` + skip `financial_financing_depth` when XBRL metrics present.
- PII-04: soft-close `dilution` insufficient when offering forms already signaled.
- Unit tests + `bundle:pii-03/04/08/09`. **Not deployed** until explicitly requested.

### 2026-09-16 (E6 sign-off)

- Owner verified E6 smoke checks (USPTO patent evidence + risk patent inventory claim). Slice E6 signed off for product use.

### 2026-09-16 (Slice E6 deploy + smoke)

- VPS migration `021` already applied (owner). Published PII-03 `IqoALspzvN3PL5Cq` → `4e4d2fa2-8e7b-465b-b7cb-984f19b9d059` (news → USPTO path → Evaluate; credential `USPTO ODP API Key` / `GQZs1uccM2RkmRz1`).
- Published PII-09 `mioSWLKBMLAaBGzs` → `5db6fefe-25bd-490b-bd93-e51968175985` (`patent_portfolio_inventory` + skip `patent_exclusivity` insufficient).
- REGN case `a87fa88d-2508-4150-b01f-da7f03a6d8c0` via manual wrapper (archived): PII-03 exec `2379` COLLECTED (`patents_stored_count=25`, `news_stored_count=25`, `fda_stored_count=7`, `uspto_patents` ok); PII-09 exec `2380` ANALYZED (`patents_count=25`, `claim_count=13`, `patent_portfolio_inventory` present; `patent_exclusivity` not in insufficient list).

### 2026-09-16 (Slice E6 local)

- Implemented **E6 USPTO ODP Patent File Wrapper compact facts** (no PDF/HTML): `uspto_patents` enabled (`patent_file_wrapper_compact`); migration `021_collection_uspto_patents_v1.sql`.
- PII-03: Prepare → Fetch `/api/v1/patent/applications/search` (credential `USPTO ODP API Key`) → normalize → upsert `uspto_patent`; coverage `patents_*`.
- PII-09: `patent_portfolio_inventory` + skips `patent_exclusivity` insufficient when USPTO rows exist.
- Unit tests + `bundle:pii-03` / `bundle:pii-09`. Deployed same day (see Slice E6 deploy + smoke).

### 2026-09-15 (E5 sign-off)

- Owner verified E5 smoke checks (company-news evidence + growth news inventory claim). Slice E5 signed off for product use.

### 2026-09-15 (Slice E5 deploy + smoke)

- Enabled `collectors.company_ir` (`finnhub_company_news`) on active config via temp n8n Postgres (exec `2372`; archived). Full migration `020` partnership-text softener optional / not required for smoke.
- Published PII-03 `IqoALspzvN3PL5Cq` → `bfe2cf6f-f083-4fc4-913d-c3c51260bdd0` (FDA → company-news path → Evaluate; credential `Finnhub API key` / `Vw9IKcbH2s66dV5i`).
- Published PII-05 `sdamxDo9SUdo4QxC` → `5eda536b-d371-4b57-a95f-c61b450e91df` (news inventory + partnership headline evaluate).
- REGN case `a87fa88d-2508-4150-b01f-da7f03a6d8c0` via manual wrapper (archived): PII-03 exec `2374` COLLECTED (`news_stored_count=25`, `fda_stored_count=7`, `company_ir` ok); PII-05 exec `2375` ANALYZED (`news_count=25`, `claim_count=8`, `recent_company_news_inventory` present; no partnership-keyword hits so `partnerships_licensing` remained insufficient).

### 2026-09-15 (Slice E5 local)

- Implemented **E5 Finnhub company-news compact headlines** (no article HTML): `company_ir` enabled (`finnhub_company_news`); migration `020_collection_company_news_v1.sql`.
- PII-03: Prepare → Fetch `/company-news` (credential `Finnhub API key`) → normalize → upsert `finnhub_company_news`; coverage `news_*`.
- PII-05: `recent_company_news_inventory` + partnership keyword headline signal; skips `partnerships_licensing` insufficient when hits exist.
- Unit tests + `bundle:pii-03` / `bundle:pii-05`. Deployed same day (see Slice E5 deploy + smoke).

### 2026-09-15 (E4 sign-off)

- Owner verified E4 smoke checks (FDA evidence + regulatory claims). Slice E4 signed off for product use.

### 2026-09-15 (Slice E4 deploy + smoke)

- VPS `019` applied (enable `fda_openfda` in active config). Published PII-03 `IqoALspzvN3PL5Cq` → `a4df2f33-96d8-483d-aa5a-abbcdfdfcd41`; PII-07 `4AqBDr5hjZeMLy99` → `024718e7-9cd9-4fe8-ba7b-0598b405f3c4`.
- REGN case `a87fa88d-2508-4150-b01f-da7f03a6d8c0` via manual wrapper: PII-03 exec `2368` COLLECTED (`fda_stored_count=7`, brands include EYLEA/LIBTAYO/PRALUENT/…); PII-07 exec `2369` ANALYZED with `approved_product_inventory` + `fda_origin_approvals`; `fda_decision_calendar` not in insufficient list.

### 2026-09-15 (Slice E4 local)

- Implemented **E4 openFDA Drugs@FDA compact facts** (no label/PDF blobs): `config/collection.v1.json` enables `fda_openfda` (`drugsfda_compact`); migration `019_collection_fda_openfda_v1.sql`.
- PII-03: Prepare OpenFDA Query → fetch → normalize → upsert `fda_drugsfda` evidence; coverage reports `fda_*` counts (NOT_FOUND = empty success).
- PII-07: `approved_product_inventory` + `fda_origin_approvals` facts; skips `fda_decision_calendar` insufficient when FDA rows exist (designations/PDUFA/AdCom remain insufficient).
- Unit tests + `bundle:pii-03` / `bundle:pii-07`. Deployed same day (see Slice E4 deploy + smoke).

### 2026-09-15 (Slack completion DM verified)

- Confirmed bot scopes already include `im:write` / `chat:write`. Hosted proof: `/pii RARE` → PII-15 exec `2354` outcome `SENT` (`provider_message_ts` present). No further scope change required.

### 2026-09-15 (E1 sign-off; skip blobs)

- Owner signed off E1 for high-level cash/debt facts; **explicitly declined E2/E3** (no large filing HTML/blob imports; do not retain bulky raw evidence archives).
- Enrichment backlog updated: E2–E3 declined; E4–E7 on hold. Next focus: Slack `im:write` completion DM.

### 2026-09-15 (Slice E1 smoke)

- Hotfix PII-03: strip commas from expand title/publisher fields and XBRL chunk_text (n8n `queryReplacement` CSV). Published `fa57d2eb-51ee-4b98-a8f1-4c8789b4a9ab`.
- REGN case `a87fa88d-2508-4150-b01f-da7f03a6d8c0` via manual wrapper: PII-03 exec `2362` COLLECTED (`xbrl_stored_count=1`, `xbrl_metric_count=7`); PII-04 `2363` cash_debt fact; PII-10 `2364` `cash_debt_from_filing` PASS; PII-11 `2365` `publication_ready=true`.
- Full webhook REGN still hits eligibility `duplicate_recent_case` for siblings — E1 path validated after VPS `018` via direct subworkflow smoke.

### 2026-09-15 (Slice E1 deploy)

- Deployed/published E1 updates (existing workflow IDs preserved; Postgres `Fkr5XG72D2ddc9ix` / `Postgres account` on new nodes):
  - PII-03 `IqoALspzvN3PL5Cq` → `5d5b0689-1a3c-42c1-bff0-09ffeeee13f7` (companyfacts XBRL path between SEC count and CT.gov)
  - PII-04 `RvIlyuDV0MEsXezL` → `f84c082f-4f5a-4e69-a7b5-9be64c2e1e19` (Load Financial Metrics + evaluate jsCode)
  - PII-10 `lIjKOZS7qDizvynm` → `74ad0610-407a-46fe-8e13-cc238cec2dc3` (`cash_debt_from_filing` gate)
  - PII-11 `CLiHq1zJ1Euwhrxb` → `65614b81-f873-4f1c-ad89-05e6df8dcb35` (publication_ready vs XBRL claims)
- Hosted smoke still blocked until VPS migration `018` is applied.

### 2026-09-15 (Slice E1 local)

- Implemented **E1 SEC XBRL cash/debt**: `config/collection.v1.json` enables `sec_filing_bodies` (`companyfacts_cash_debt`); migration `018_collection_sec_xbrl_cash_debt_v1.sql`.
- PII-03: fetch companyfacts → normalize → upsert `sec_companyfacts` evidence + `financial_periods`/`financial_metrics` + `evidence_chunks`; coverage reports `xbrl_*` counts.
- PII-04: Load Financial Metrics → real `cash_debt` claims (`deterministic_xbrl_metrics`) when facts exist.
- PII-10 / PII-11: `cash_debt_from_filing` / `publication_ready` honor filing-backed XBRL claims.
- Unit tests + `bundle:pii-03/04/10/11`.

### 2026-09-15 (enrichment spec)

- Authored [`docs/ENRICHMENT.md`](docs/ENRICHMENT.md): architecture, slices **E1–E7**, smoke/sign-off checklists, AGENTS backlog map. E1 = SEC XBRL cash/debt (Postgres facts; blobs deferred to E2). Linked from README, PII-03 README, and Next Steps.

### 2026-09-15 (PII-14 on orchestrator)

- Wired **PII-14** into PII-00 after PII-11 (before PII-15): always emails; uses `TEST_DELIVERY` when not `publication_ready`, else `INVESTIGATION_REPORT`.
- Published PII-14 version `9a7c0bf0-1a1f-4234-99af-d0ec88a6b846`; republished PII-00 version `84997803-a604-4438-b2d6-f1911f616af6`.


### 2026-09-02

- Created this repository starter and formalized the repo-first, hosted-n8n deployment workflow.
- Confirmed n8n MCP connectivity to personal project `FaU28ckb88bAPAfT`.
- Chose managed/VPS PostgreSQL over n8n Data Tables for the research system of record.
- Added Phase 0 Docker Compose Postgres, initial schema migration (`001_initial_schema.sql`), migrate runner, and `docs/DATABASE.md`. Workflows intentionally not started yet.
- Deployed Postgres to VPS under `/opt/apps/PI_OpportunityInvestigator`; host `108.174.153.74:5433`; UFW allowlisted n8n Cloud IPs on 5433; n8n credential connectivity confirmed.
- Documented workflow development agreements: SDK source in `workflows/`, credential `Postgres account`, user-gated MCP deploys, token-efficient local-first context.
- Authored local PII-00 Case Orchestrator (webhook intake, validation, idempotent case create, 202 ack, async IDENTITY_REVIEW advance).
- Deployed PII-00 to n8n Cloud: workflow `4jvmYtTHKufojJRK`, version `35ab680a-7cbf-4d74-be46-d5af860c4ca2` (inactive).
- PII-00 hosted smoke test passed via webhook-test URL (`POST`, header `X-PII-API-Key`, fixture ACAD/NASDAQ/FULL); **202** ack confirmed from PowerShell.
- Added reusable hosted smoke test script (`scripts/smoke/Invoke-PiiWebhook.ps1`) and `docs/SMOKE_TESTS.md`.
- Diagnosed first smoke test: workflow stopped after **Lookup Existing Case** returned 0 rows (n8n skips downstream nodes). Deployed fix: `alwaysOutputData: true` on lookup node ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `669f4961-0bb8-4243-92b0-b67314b477de`.
- Fixed **Insert Research Case** null handling: n8n passes JS `null` as string `"null"` for `as_of_date` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `dff4899c-ad27-4db6-9113-506b836efee5`.
- Re-ran smoke test: **202** ack with `created: true`; `research_cases` row confirmed on VPS Postgres.

### 2026-09-03

- Authored local **PII-01 Identity Resolver** (`workflows/pii-01-identity/`): Execute Workflow Trigger ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ cache lookup ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ SEC `company_tickers_exchange.json` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ upsert `companies` / `securities` / `company_aliases` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ advance to `ELIGIBILITY_REVIEW` or `AWAITING_HUMAN_REVIEW`.
- Shared Code nodes + unit tests for identity validation, EDGAR resolve/score, and cached reuse (`npm test` 19/19).
- Deployed PII-01 to n8n Cloud: workflow `Xf6DjDUMyfOyNX3G`, version `c1ddb33b-ac90-4d40-beb9-acf4991d7706` (inactive). Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/Xf6DjDUMyfOyNX3G
- Wired PII-00 to Execute Sub-workflow PII-01 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `14de1e73-e209-447b-98c0-70999f27e4f8`.
- Hosted PII-01 smoke: SEC User-Agent Fair Access, EDGAR `{fields,data}` parser, then n8n `queryReplacement` comma-split (provenance bound as `confidence`). Alias/company SQL now hardcodes provenance.
- VPS confirmation: case `91e5b497-a6f2-4f55-bf37-c995b8e8aef4` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ `ELIGIBILITY_REVIEW`, `ACADIA PHARMACEUTICALS INC`, CIK `0001070494`. Older ACAD rows from failed runs remain unlinked (`IDENTITY_REVIEW` / `AWAITING_HUMAN_REVIEW`) and can be ignored or cleaned up.

### 2026-09-04

- Authored local **PII-02 Eligibility Gate** (`workflows/pii-02-eligibility/`): config-driven rules + Twelve Data `/profile`, `/statistics`, `/quote` via credential `TwelveData API key`; outcomes PASS / PASS_WITH_EXCEPTION / HUMAN_REVIEW / FAIL ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ `COLLECTING` / `AWAITING_HUMAN_REVIEW` / `INCOMPLETE`.
- Added `config/eligibility.v1.json` and migration `002_eligibility_config_v1.sql` (market-cap/ADV enabled, TwelveData industry allowlist).
- Shared Code + unit tests for eligibility validate/evaluate/build; `npm run bundle:pii-02`.
- Deployed PII-02 to n8n: workflow `hqgFoP7ny6jnycxx`, canvas https://teacherjoseluis.app.n8n.cloud/workflow/hqgFoP7ny6jnycxx ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â credentials `Postgres account` + `TwelveData API key`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ PII-02 after PII-01 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `fdf1c645-66ef-4854-926c-24e00c7574d7`.
- Smoke exec `2226`: PII-02 sub-exec `2228` succeeded after fixing `workflow_runs` numeric `"null"` cast (version `af8afe61-93e3-4205-9150-2a817274b52e`). Outcome `HUMAN_REVIEW` (duplicates + missing profile/statistics).

### 2026-09-07

- Authored local **PII-03 Evidence Collector** (`workflows/pii-03-evidence/`): SEC EDGAR submissions + ClinicalTrials.gov API v2; SHA-256 dedupe into `evidence_documents`; coverage ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ `ANALYZING` / `INCOMPLETE`.
- Added `config/collection.v1.json` and migration `003_collection_config_v1.sql` (`gates_json.collection`); deferred collectors listed `enabled: false`.
- Shared Code + unit tests for collection validate/normalize/coverage/build; `npm run bundle:pii-03`.
- Wired local PII-00 IF `next_state === COLLECTING` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-03 (hosted ID placeholder `PENDING_PII_03_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-07 (deploy)

- Deployed **PII-03** to n8n: workflow `IqoALspzvN3PL5Cq`, version `7d91b362-5a52-446c-b727-afcda717d955` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/IqoALspzvN3PL5Cq ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-03 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `336e502f-c538-4d04-9764-5d66a9819778`.
- VPS migrations `002` + `003` confirmed applied by user before deploy.
- Smoke fix: CT.gov partial dates (`YYYY-MM`) broke Postgres `publication_date`; coerce via `toSqlDate` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â PII-03 version `e3115ed1-7194-46e4-85be-f7ed0f4e83a7`.
- Re-applied date fix after discovering `setNodeParameter` path `/parameters/jsCode` nested wrongly; correct paths `/jsCode` and `/query` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `b83e7eae-1187-4fd8-b219-307a73b4e919` (verified `toSqlDate` + SQL `CASE WHEN`).
- PII-03 hosted smoke (manual Execute): case `fb342540-1bd9-49a4-a38b-5328501ccac4` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ `ANALYZING`; evidence counts submissions 1 / filings 10 / CT.gov 10.
- Recorded **PII-03 enrichment circle-back backlog** in Current Status (XBRL, FDA, IR, patents, object storage, chunks, full-chain smoke). Starting **PII-04** Phase 1 (deterministic claims from metadata only).

### 2026-09-07 (PII-04 local)

- Authored local **PII-04 Financial and Business Analyst** (`workflows/pii-04-financial/`): deterministic claims from SEC/CT.gov metadata; explicit INSUFFICIENT_EVIDENCE for cash/runway/margins/revenue/dilution; persists `claims` + `claim_evidence_links`; stays in `ANALYZING`.
- Added `config/analysis-financial.v1.json` and migration `004_analysis_financial_config_v1.sql` (`gates_json.analysis.financial`).
- Shared Code + unit tests; `npm run bundle:pii-04`.
- Wired local PII-00 IF `next_state === ANALYZING` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-04 (hosted ID placeholder `PENDING_PII_04_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-07 (PII-04 deploy)

- Deployed **PII-04** to n8n: workflow `RvIlyuDV0MEsXezL`, version `5506674e-e381-4274-a3a4-9ccc3730ed97` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/RvIlyuDV0MEsXezL ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-04 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `a26a8922-9937-4f5c-a899-1dc381cdbd3a`.
- VPS migration `004` confirmed applied by user before deploy.
- Smoke fix: Log Financial State paired-item error after multi-item claim links ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â use `.first()` instead of `.item` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `c087e5d5-40cb-4539-aff7-7728afbf6fd0`.
- Hosted smoke chain (ACAD case `fb342540-1bd9-49a4-a38b-5328501ccac4` where applicable): PII-00 exec `2229` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ PII-01 `2230` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ PII-02 `2231` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ PII-03 `2239` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ PII-04 `2242`. PII-04 VPS check: state `ANALYZING`, claims written + 16 `claim_evidence_links`, `workflow_runs` PII-04 `SUCCEEDED`.

### 2026-09-08 (PII-05 local)

- Authored local **PII-05 Growth Analyst** (`workflows/pii-05-growth/`): deterministic growth claims from SEC/CT.gov metadata (clinical-activity dependence, event filings); explicit INSUFFICIENT_EVIDENCE for TAM, product growth, geo, share, partnerships, consensus; stays in `ANALYZING`.
- Added `config/analysis-growth.v1.json` and migration `005_analysis_growth_config_v1.sql` (`gates_json.analysis.growth`).
- Shared Code + unit tests; `npm run bundle:pii-05`.
- Wired local PII-00 IF after PII-04 `ANALYZING` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-05 (hosted ID placeholder `PENDING_PII_05_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-08 (PII-05 deploy)

- Deployed **PII-05** to n8n: workflow `sdamxDo9SUdo4QxC`, version `389fc1f4-038a-47d6-8e24-89956c51bdae` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/sdamxDo9SUdo4QxC ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-05 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `3236bde7-eb89-4908-8c81-7dbdf16f7e91`.
- VPS migration `005` confirmed applied by user before deploy.
- Hosted smoke PII-05 exec `2248` on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `ANALYZING`, 3 `growth_prospects` claims + 7 `claim_evidence_links`, `workflow_runs` PII-05 `SUCCEEDED`.

### 2026-09-09 (PII-06 local)

- Authored local **PII-06 Pipeline and Clinical Analyst** (`workflows/pii-06-pipeline/`): deterministic pipeline claims from CT.gov metadata (study inventory, phase/status mix, late-stage concentration) + SEC periodic anchors; explicit INSUFFICIENT_EVIDENCE for ownership, endpoints, enrollment, efficacy, safety, designations, competition, PoS; stays in `ANALYZING`.
- Added `config/analysis-pipeline.v1.json` and migration `006_analysis_pipeline_config_v1.sql` (`gates_json.analysis.pipeline`).
- Shared Code + unit tests; `npm run bundle:pii-06`.
- Wired local PII-00 IF after PII-05 `ANALYZING` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-06 (hosted ID placeholder `PENDING_PII_06_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-09 (PII-06 deploy)

- Deployed **PII-06** to n8n: workflow `b8CxYW8T8FrGl62x`, version `e870be1a-98c3-4cfa-8286-c5e374e0b512` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/b8CxYW8T8FrGl62x ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-06 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â version `37d9c70f-97b0-4f4c-9de9-02678099d76b`.
- VPS: migrations `002`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“`006` applied; analysis financial/growth wiped by shallow jsonb `||` then repaired so `financial`+`growth`+`pipeline` all present (insufficient_topics temporarily empty).
- Added local migration `007_repair_analysis_deep_merge.sql` and fixed `004`ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“`006` to use `jsonb_set` deep-merge.
- Hosted smoke PII-06 exec `2251` on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `ANALYZING`, 4 `pipeline_clinical` claims + 16 `claim_evidence_links`, `workflow_runs` PII-06 `SUCCEEDED`.

### 2026-09-09 (PII-07 local)

- Authored local **PII-07 Regulatory and Catalyst Analyst** (`workflows/pii-07-regulatory/`): deterministic catalyst signals from SEC event forms (+ CT.gov status); explicit INSUFFICIENT_EVIDENCE for FDA calendar, PDUFA, designations, AdCom, asset linkage, date status, thesis impact; stays in `ANALYZING`.
- Added `config/analysis-regulatory.v1.json` and migration `008_analysis_regulatory_config_v1.sql` (`jsonb_set` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ `gates_json.analysis.regulatory`).
- Shared Code + unit tests; `npm run bundle:pii-07`.
- Wired local PII-00 IF after PII-06 `ANALYZING` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Execute PII-07 (hosted ID placeholder `PENDING_PII_07_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-09 (PII-07 deploy)

- Deployed **PII-07** to n8n: workflow `4AqBDr5hjZeMLy99`, version `b59227a2-9bad-4d44-9c1c-d7dabf4b1b93` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/4AqBDr5hjZeMLy99 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Execute PII-07 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â version `b7040dcd-b9f5-49bf-87a6-36c1f8e02ed5`.
- VPS migration `008` confirmed applied by user before deploy.
- Hosted smoke PII-07 exec `2252` on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `ANALYZING`, 10 `regulatory_catalyst` claims + 21 `claim_evidence_links`, `workflow_runs` PII-07 `SUCCEEDED`.
### 2026-09-09 (PII-08 local)

- Authored local **PII-08 Valuation and Market Analyst** (`workflows/pii-08-valuation/`): deterministic valuation anchors from SEC metadata; explicit INSUFFICIENT_EVIDENCE for market-cap/EV, net cash, multiples, peers, ADV, volatility, short interest, entry timing; stays in `ANALYZING`.
- Added `config/analysis-valuation.v1.json` and migration `009_analysis_valuation_config_v1.sql` (`jsonb_set` Ã¢â€ â€™ `gates_json.analysis.valuation`).
- Shared Code + unit tests; `npm run bundle:pii-08`.
- Wired local PII-00 IF after PII-07 `ANALYZING` Ã¢â€ â€™ Execute PII-08 (hosted ID placeholder `PENDING_PII_08_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-09 (PII-08 deploy)

- Deployed **PII-08** to n8n: workflow `1PuOVYf0O3GThRwq`, version `630de67e-510a-4ea3-b2a3-42b7f4f6f58d` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/1PuOVYf0O3GThRwq - credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF after PII-07 -> Execute PII-08 - version `c5f7efac-7e91-4761-ba82-d06ad385accd`.
- VPS migration `009` confirmed applied by user before deploy.
- Hosted smoke PII-08 exec `2254` on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `ANALYZING`, 10 `valuation_market` claims, `workflow_runs` PII-08 `SUCCEEDED` / outcome `ANALYZED`.

### 2026-09-10 (PII-09 local)

- Authored local **PII-09 Risk and Red-Team Reviewer** (`workflows/pii-09-risk/`): deterministic risk signals from SEC/CT.gov metadata; explicit INSUFFICIENT_EVIDENCE for deeper financing, efficacy/safety, regulatory, commercial, competitive, patent, manufacturing, legal, governance, concentration, contradictions, thesis-breakers; stays in `ANALYZING`.
- Added `config/analysis-risk.v1.json` and migration `010_analysis_risk_config_v1.sql` (`jsonb_set` -> `gates_json.analysis.risk`).
- Shared Code + unit tests; `npm run bundle:pii-09`.
- Wired local PII-00 IF after PII-08 `ANALYZING` -> Execute PII-09 (hosted ID placeholder `PENDING_PII_09_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-10 (PII-09 deploy)

- Deployed **PII-09** to n8n: workflow `mioSWLKBMLAaBGzs`, version `eef8fbae-5b9e-4b10-b4b5-ea5e453b4436` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/mioSWLKBMLAaBGzs - credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF after PII-08 -> Execute PII-09 - version 0e01cf32-66f9-4c14-bf5a-a531227b4d42.
- VPS migration `010` confirmed applied by user before deploy.
- Hosted smoke PII-09 exec `2256` on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `ANALYZING`, 15 `risk_red_team` claims, `workflow_runs` PII-09 `SUCCEEDED` / outcome `ANALYZED`.

### 2026-09-10 (PII-10 local)

- Authored local **PII-10 Scoring and Quality Gate** (`workflows/pii-10-scoring/`): coverage-aware scores from claims/evidence; quality gates; upsert `scores` + `score_components`; expected Phase 1 state `AWAITING_HUMAN_REVIEW` / outcome `MONITOR` (not COMPLETE while cash/debt and report gates fail).
- Added `config/analysis-scoring.v1.json` and migration `011_analysis_scoring_config_v1.sql` (`jsonb_set` -> `gates_json.analysis.scoring` + `scores_json` thresholds).
- Shared Code + unit tests; `npm run bundle:pii-10`.
- Wired local PII-00 IF after PII-09 `ANALYZING` -> Execute PII-10 (hosted ID placeholder `PENDING_PII_10_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-10 (PII-10 deploy)

- Deployed **PII-10** to n8n: workflow `lIjKOZS7qDizvynm`, version `f8cee04b-460e-427d-ac5b-b1c1c8add2d1` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/lIjKOZS7qDizvynm - credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF after PII-09 -> Execute PII-10 - version 4eff6ccb-ce58-4a3a-80cc-fa4e6f21e4c4.
- VPS migration `011` confirmed applied by user before deploy.
- Smoke fix: Upsert Scores failed on n8n JS `null` → string `"null"` for numeric casts — coerce via `NULLIF(NULLIF(TRIM($n), ''), 'null')` + harden evaluate `sqlNum` — version `37c522f4-926d-49d4-a604-df6d687beda5`.
- Hosted smoke PII-10 on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `AWAITING_HUMAN_REVIEW`, `outcome_class` `MONITOR`, scores row + 7 `score_components`, `workflow_runs` PII-10 `SUCCEEDED` / outcome `GATES_FAILED` (`cash_debt_from_filing`, `schema_valid_report`); `business_quality_score` null (coverage missing) as expected in Phase 1.

### 2026-09-11 (PII-11 local)

- Authored local **PII-11 Report Generator** (`workflows/pii-11-report/`): deterministic JSON + Markdown from claims/scores/evidence; insert `research_reports`; seed `monitoring_rules`; Phase 1 stays `AWAITING_HUMAN_REVIEW` / `REPORT_DRAFT` while cash/debt blocks publication.
- Added `config/analysis-report.v1.json` and migration `012_analysis_report_config_v1.sql` (`jsonb_set` -> `gates_json.analysis.report`).
- Shared Code + unit tests; `npm run bundle:pii-11` (72/72).
- Wired local PII-00 IF after PII-10 `AWAITING_HUMAN_REVIEW` -> Execute PII-11 (hosted ID placeholder `PENDING_PII_11_DEPLOY`). **Not deployed** until explicitly requested.

### 2026-09-11 (PII-11 deploy)

- Deployed **PII-11** to n8n: workflow `CLiHq1zJ1Euwhrxb`, version `e32403d7-8456-4110-b2a4-2b3c7e63a34a` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/CLiHq1zJ1Euwhrxb - credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Wired hosted PII-00 IF after PII-10 -> Execute PII-11 - version `1b902685-ba2f-4111-b32f-0679663dc3cf`.
- VPS migration `012` confirmed applied by user before deploy.
- Smoke fix: IF true branch wrongly fed monitoring-rule items into Advance Case State (missing `$2`/`$3`) — queryReplacement bound to Build Research Report + reconnect Prepare → Advance — version `cde17039-91aa-4e52-a18e-fc498860af0d`.
- Smoke fix: Prepare Report Aggregate OOM — drop raw report/markdown from item stream, slim restore/prepare, bulk-insert monitoring rules (no multi-item expand) — version `7c9bf708-4baf-4e9c-a6d6-cd7979eaefc0`.
- Smoke fix: Build Research Report OOM on ~1050 claim items — pack Load Claims/Evidence as single jsonb rows (≤12/category, ≤40 evidence) — version `6254ee70-18cf-4a1f-b4da-e8f8fd6000ba`.
- Hosted smoke PII-11 on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state `AWAITING_HUMAN_REVIEW` / `MONITOR`, `research_reports` v3 `schema_valid=true` `publication_ready=false`, 3 `monitoring_rules`, `workflow_runs` PII-11 `SUCCEEDED` / `REPORT_DRAFT` (blocked by `cash_debt_from_filing`).

### 2026-09-14 (PII-12 local)

- Authored local **PII-12 Monitoring and Reassessment** (`workflows/pii-12-monitoring/`): poll SEC + CT.gov vs last report `as_of` and evidence fingerprints; insert `detected_events` (dedupe); change memo; case state unchanged; `auto_launch_reassessment=false`.
- Added `config/monitoring.v1.json` and migration `013_monitoring_config_v1.sql` (`gates_json.monitoring`).
- Shared Code + unit tests; `npm run bundle:pii-12` (77/77).
- Standalone Phase 1 slice — **not wired into PII-00** and **not deployed** until explicitly requested.

### 2026-09-14 (PII-12 deploy)

- Deployed **PII-12** to n8n: workflow `go396vtpeHKcvtub`, version `2633c95f-34cf-4051-a384-a0ec7b78762e` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/go396vtpeHKcvtub - credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Not wired into PII-00 (standalone Phase 1 monitoring check).
- VPS migration `013` confirmed applied by user before deploy.
- Hosted smoke PII-12 on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: state unchanged `AWAITING_HUMAN_REVIEW` / `MONITOR`, 14 `detected_events` (1 HIGH `sec_new_filing` 8-K + 13 MEDIUM `ctgov_new_study`), `workflow_runs` PII-12 `SUCCEEDED` / outcome `MATERIAL_EVENTS` (`material_event_count=1`, `auto_launch_reassessment=false`). CT.gov “new study” rows include older NCTs not in the limited PII-03 evidence fingerprint set — expected Phase 1 noise until collection coverage improves.

### 2026-09-14 (PII-13 local)

- Authored local **PII-13 Operations and Alerts** (`workflows/pii-13-operations/`): DB-only health scan for stuck/stale cases, failed `workflow_runs`, unresolved `dead_letter_items`, budget overruns; persist deduped `ops_alerts`; log `workflow_runs` PII-13; no external delivery; case state unchanged.
- Added `config/ops-alerts.v1.json` and migration `014_ops_alerts_config_v1.sql` (`ops_alerts` table + `gates_json.operations`).
- Shared Code + unit tests; `npm run bundle:pii-13` (84/84).
- Standalone Phase 1 slice — **not wired into PII-00** and **not deployed** until explicitly requested.

### 2026-09-14 (PII-13 deploy)

- Deployed **PII-13** to n8n: workflow `ldPDfkqkkuDBfLe5`, version `be2d45ee-bd56-4e1a-b588-bdf46d2143f1` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/ldPDfkqkkuDBfLe5 - credential `Postgres account`; `callerPolicy=workflowsFromSameOwner`.
- Not wired into PII-00 (standalone Phase 1 ops check).
- VPS migration `014` confirmed applied by user before deploy.
- Hosted smoke PII-13: `workflow_runs` PII-13 `SUCCEEDED` / outcome `MATERIAL_ALERTS` (`alert_count=7`, `material_alert_count=4`, `delivery=db_only`). `ops_alerts`: 4 HIGH `stuck_case` (IDENTITY_REVIEW / ELIGIBILITY_REVIEW leftovers) + 3 MEDIUM `stale_review` (AWAITING_HUMAN_REVIEW). Expected Phase 1 signal from early ACAD smoke debris — not a workflow failure. Re-run should not duplicate (dedupe keys).

### 2026-09-14 (PII-14 local)

- Authored local **PII-14 Email Digest and Report Delivery** (`workflows/pii-14-email-delivery/`): SMTP send via credential `SMTP account`; `TEST_DELIVERY` labeled drafts when not publication-ready; `INVESTIGATION_REPORT` only when `publication_ready`; persist `email_deliveries` + `workflow_runs` PII-14; weekly digest deferred; case state unchanged.
- Added `config/email-delivery.v1.json` and migration `015_email_delivery_config_v1.sql` (`gates_json.email_delivery`).
- Shared Code + unit tests; `npm run bundle:pii-14` (92/92).
- Standalone Phase 1 slice — **not wired into PII-00** and **not deployed** until explicitly requested.

### 2026-09-14 (PII-14 deploy)

- Deployed **PII-14** to n8n: workflow `kf6pC1t7J1XavbiE`, version `49c21b70-9f26-4c30-b7f7-f1085a8b73e5` (inactive); canvas https://teacherjoseluis.app.n8n.cloud/workflow/kf6pC1t7J1XavbiE — credentials `Postgres account` + `SMTP account`; `callerPolicy=workflowsFromSameOwner`.
- Not wired into PII-00 (standalone Phase 1 email delivery).
- VPS migration `015` confirmed applied by user before deploy.
- Smoke fix: `delivery_json_b64` must be a JSON **array** for `jsonb_to_recordset` — version `9b0c7a99-4451-4e19-92e0-b40ebb1a71bd`.
- Hosted smoke PII-14 `TEST_DELIVERY` on case `fb342540-1bd9-49a4-a38b-5328501ccac4`: `email_deliveries` SENT to `teacherjoseluis@gmail.com` (subject draft ACAD MONITOR), `workflow_runs` PII-14 `SUCCEEDED` / outcome `SENT` (`publication_ready=false`, `gates_blocking=["cash_debt_from_filing"]`, report v3). Re-run should `SKIPPED_DUPLICATE`.

### 2026-09-14 (eligibility TwelveData plan gap)

- Root cause: hosted TwelveData key on Basic — `/profile` 403 (Grow+), `/statistics` 403 (Pro+); `/quote` OK. REGN/ACAD falsely `HUMAN_REVIEW` (`profile_unavailable` / `market_cap_unavailable`).
- Fix: PII-02 Finnhub `/stock/profile2` fallback (credential `Finnhub API key`); evaluate uses Finnhub industry + `marketCapitalization`×1e6; keyword match on legal name when profile missing; mcap max → $150B + `Pharmaceuticals` industry (`016_eligibility_finnhub_fallback_v1.sql`).
- Deployed PII-02 version `567e37d5-1cd7-41cd-9399-9ae3055f69e0` (inactive). Applied `016` on VPS via temporary n8n Postgres workflow (archived).
- REGN full-chain smoke PII-00 `2286` case `a732aa53-a065-4682-b062-5173e2e4f88d`: PII-02 `PASS` / `COLLECTING` (mcap ~$80.5B, provenance `twelvedata.quote+finnhub.profile2`) → PII-03…PII-11 success → `AWAITING_HUMAN_REVIEW` / `MONITOR`, report v1 `publication_ready=false` (`cash_debt_from_filing`).

### 2026-09-14 (PII-14 research-memo email format)

- Implemented approved mockup layout in `evaluate-email-delivery.js`: navy header, draft strip, Supporting/Challenging columns, score strip, Watch next, Evidence gaps, disclaimer footer (table HTML for clients).
- Load Case SQL now pulls scores + claim sections + monitoring plan from `report_json`.
- Deployed PII-14 version `9a7c0bf0-1a1f-4234-99af-d0ec88a6b846` (inactive). REGN `TEST_DELIVERY` resent to `teacherjoseluis@gmail.com` (exec `2302`, outcome `SENT`).

### 2026-09-14 (PII Slack Intake local)

- Authored local **PII Slack Intake** (`workflows/pii-slack-intake/`): webhook `pii/slack` → parse `/pii TICKER [EXCHANGE] [question]` → immediate Slack ack → HTTP POST PII-00 `/webhook/pii/investigate` with `PII Webhook Header Auth` → follow-up via Slack `response_url`.
- Shared Code + unit tests for parse/follow-up; `npm run bundle:pii-slack`.
- Standalone Phase 1 slice — **not wired into PII-00**.
- Credential `Slack PII bot` exists in n8n (optional for this slice; follow-up uses `response_url`).

### 2026-09-14 (PII Slack Intake deploy + publish)

- Deployed **PII Slack Intake** to n8n: workflow `Co5hmZSuqqk97rhg`, version `ea286637-10af-4dd0-9fcd-18e825878c47` (**published**); canvas https://teacherjoseluis.app.n8n.cloud/workflow/Co5hmZSuqqk97rhg — credential `PII Webhook Header Auth`; `callerPolicy=workflowsFromSameOwner`.
- Production Slack webhook: `https://teacherjoseluis.app.n8n.cloud/webhook/pii/slack`.
- Published PII-01…PII-11 then **PII-00** so `/webhook/pii/investigate` is live for Slack outbound POSTs.
- User must set Slack Slash Command Request URL to the production Slack webhook, then smoke `/pii REGN`.

### 2026-09-14 (PII-15 Slack completion notify local)

- Authored local **PII-15 Slack Completion Notify** (`workflows/pii-15-slack-notify/`): after PII-11, DM requester via `Slack PII bot` using `research_cases.request_context_json.slack`.
- Migration `017_slack_notify_v1.sql`: `request_context_json`, `slack_deliveries`, `gates_json.slack_notify`.
- Extended investigation intake schema/validate + PII-00 insert + Slack intake POST to store Slack user/channel.
- Wired local PII-00 IF after PII-11 → Execute PII-15 (now hosted `3Q4goJz1gGKJRLMI`).
- Shared Code + unit tests; `npm run bundle:pii-15` / `bundle:pii-00` / `bundle:pii-slack`.

### 2026-09-14 (PII-15 deploy + publish)

- Deployed **PII-15** to n8n: workflow `3Q4goJz1gGKJRLMI`, version `763f7250-d903-4a24-8b57-a40be09f7c4f` (**published**); canvas https://teacherjoseluis.app.n8n.cloud/workflow/3Q4goJz1gGKJRLMI — credentials `Postgres account` + `Slack PII bot`; `callerPolicy=workflowsFromSameOwner`.
- Updated hosted **PII-00** (`4jvmYtTHKufojJRK`) version `84681f22-5cd4-4e96-a8b2-28463a492c5d` (**published**): `request_context_json` on Insert Research Case, validate jsCode with `request_context_b64`, Execute PII-15 after PII-11.
- Updated hosted **PII Slack Intake** (`Co5hmZSuqqk97rhg`) version `1d358400-1f6c-4a08-afca-ed776cbceb9e` (**published**): parse/follow-up jsCode + Post Investigate `request_context`.
- VPS migration `017` applied by user before deploy. Manual remaining: Slack `im:write` scope + bot reinstall; smoke `/pii REGN` for DM.
