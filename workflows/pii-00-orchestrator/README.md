# PII-00 Case Orchestrator

Phase 1 vertical slice â€” investigation request intake, idempotent case creation, immediate webhook ack, async state advance.

## Endpoint (after deploy)

- **Method:** `POST`
- **Path:** `/webhook/pii/investigate` (exact URL assigned by n8n on deploy)
- **Auth:** Header auth credential `PII Webhook Header Auth` (create in n8n before deploy)
- **Response:** `202` with `{ case_id, request_id, ticker, state, created, message, as_of }`

## Request body

See `workflows/shared/schemas/investigation-request.schema.json`.

Minimal example:

```json
{
  "ticker": "ACAD",
  "exchange": "NASDAQ",
  "research_question": "Does the current evidence justify deeper research?",
  "mode": "FULL"
}
```

## Local files

| File | Purpose |
|---|---|
| `workflow.template.ts` | SDK source with embed placeholders |
| `workflow.ts` | Generated deploy artifact (do not edit by hand) |
| `../shared/code/*.js` | Code node logic |
| `../scripts/bundle-workflow.mjs` | Embeds shared code into template |

## Regenerate workflow.ts

```bash
node workflows/scripts/bundle-workflow.mjs pii-00-orchestrator
```

## Deploy

Per project agreements, deploy to hosted n8n **only when you explicitly request a push** (MCP `create_workflow_from_code`).

## Smoke test (hosted)

After deploy, click **Execute workflow** in n8n, then from repo root:

```powershell
.\scripts\smoke\Invoke-PiiWebhook.ps1
```

See [docs/SMOKE_TESTS.md](../../docs/SMOKE_TESTS.md) for URLs, fixtures, and DB verification.

## Current scope

- Validate investigation request
- Idempotent lookup by `request_id`
- Insert `research_cases`, `case_state_history`, `workflow_runs`
- Return case ack without holding connection for full investigation
- Advance new cases to `IDENTITY_REVIEW` after response
- **Wired:** PII-01 Identity Resolver (`Xf6DjDUMyfOyNX3G`) via Execute Sub-workflow after IDENTITY_REVIEW
- **Wired:** PII-02 Eligibility Gate (`hqgFoP7ny6jnycxx`) after PII-01
- **Wired:** PII-03 Evidence Collector (`IqoALspzvN3PL5Cq`) after PII-02 only when `next_state === COLLECTING`
- **Wired:** PII-04 Financial Analyst (`RvIlyuDV0MEsXezL`) after PII-03 only when `next_state === ANALYZING`
- **Wired:** PII-05 Growth Analyst (`sdamxDo9SUdo4QxC`) after PII-04 only when `next_state === ANALYZING`
- **Wired:** PII-06 Pipeline Analyst (`b8CxYW8T8FrGl62x`) after PII-05 only when `next_state === ANALYZING`
- **Wired:** PII-07 Regulatory Analyst (`4AqBDr5hjZeMLy99`) after PII-06 only when `next_state === ANALYZING`
- **Wired (local):** PII-08 Valuation Analyst (`1PuOVYf0O3GThRwq`) after PII-07 only when `next_state === ANALYZING`

## Postgres credential

Uses n8n credential **`Postgres account`** â†’ VPS `108.174.153.74:5433` / `pii_research`.
- **Wired (local):** PII-10 Scoring Gate (lIjKOZS7qDizvynm) after PII-09 only when 
ext_state === ANALYZING`r
