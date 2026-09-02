# PII-00 Case Orchestrator

Phase 1 vertical slice — investigation request intake, idempotent case creation, immediate webhook ack, async state advance.

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

## Current scope

- Validate investigation request
- Idempotent lookup by `request_id`
- Insert `research_cases`, `case_state_history`, `workflow_runs`
- Return case ack without holding connection for full investigation
- Advance new cases to `IDENTITY_REVIEW` after response
- **Not yet wired:** PII-01 Identity Resolver subworkflow

## Postgres credential

Uses n8n credential **`Postgres account`** → VPS `108.174.153.74:5433` / `pii_research`.
