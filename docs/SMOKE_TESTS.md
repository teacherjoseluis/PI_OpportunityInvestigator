# Hosted smoke tests

Local `npm test` validates shared Code node logic. **Hosted smoke tests** validate the deployed n8n workflow: webhook auth, request parsing, Postgres writes, and response shape.

Run these **after** an approved MCP deploy, before publish/activate.

## Prerequisites

1. Workflow deployed to n8n (see `AGENTS.md` for workflow ID and version).
2. Local `.env` with `PII_WEBHOOK_HEADER_VALUE` matching n8n credential **`PII Webhook Header Auth`**.
3. For **test** URLs: open the workflow in n8n and click **Execute workflow** / **Listen for test event** before each call (test webhooks are short-lived and often accept one request per listen).

## PII-00 Case Orchestrator

| | URL |
|---|---|
| Test | `https://teacherjoseluis.app.n8n.cloud/webhook-test/pii/investigate` |
| Production | `https://teacherjoseluis.app.n8n.cloud/webhook/pii/investigate` (requires publish/activate) |

**Fixture:** `tests/fixtures/investigation-request-valid.json`

**Expected:** HTTP **202** with JSON containing `case_id`, `request_id`, `ticker`, `state`, and `created`.

**Optional DB check** (on the **VPS** — n8n writes to hosted Postgres, not local Docker):

```powershell
docker compose exec postgres psql -U pii_app -d pii_research -c "SELECT id AS case_id, request_id, ticker, state, created_at FROM research_cases ORDER BY created_at DESC LIMIT 3;"
```

If the webhook returned **202** but this query is empty, open the n8n execution and confirm nodes after **Lookup Existing Case** ran (especially **Insert Research Case**). A known n8n behavior: Postgres nodes that return 0 rows skip downstream nodes unless `alwaysOutputData` is enabled on the lookup node.

### Run (PowerShell, from repo root)

```powershell
.\scripts\smoke\Invoke-PiiWebhook.ps1
```

Production URL (after publish):

```powershell
.\scripts\smoke\Invoke-PiiWebhook.ps1 -Mode production
```

### Manual equivalent

```powershell
$line = Get-Content .env | Where-Object { $_ -match '^PII_WEBHOOK_HEADER_VALUE=' }
$env:PII_WEBHOOK_HEADER_VALUE = ($line -split '=', 2)[1].Trim()

$headers = @{
  "Content-Type"  = "application/json"
  "X-PII-API-Key" = $env:PII_WEBHOOK_HEADER_VALUE
}

$body = Get-Content tests/fixtures/investigation-request-valid.json -Raw

Invoke-RestMethod -Method POST `
  -Uri "https://teacherjoseluis.app.n8n.cloud/webhook-test/pii/investigate" `
  -Headers $headers `
  -Body $body
```

## Adding smoke tests for new workflows

When you add PII-01, PII-02, etc.:

1. Add a JSON fixture under `tests/fixtures/` (reuse or extend existing schemas).
2. Document the test/production webhook path in that workflow’s `workflows/pii-XX-*/README.md`.
3. Add a section above in this file with expected status code and response fields.
4. Call the shared script with `-Uri` and `-Fixture`, or add a thin wrapper script if the workflow needs extra steps.

**PII-01** is a subworkflow (no public webhook). After deploy, smoke-test via n8n **Execute workflow** / MCP `execute_workflow` with `{ case_id, ticker, exchange }`, then verify on VPS:

```bash
docker compose exec postgres psql -U pii_app -d pii_research -c "SELECT c.legal_name, c.cik, s.ticker, s.exchange, rc.state FROM research_cases rc JOIN companies c ON c.id = rc.company_id JOIN securities s ON s.id = rc.security_id ORDER BY rc.updated_at DESC LIMIT 3;"
```

Example for a future HTTP endpoint:

```powershell
.\scripts\smoke\Invoke-PiiWebhook.ps1 `
  -Uri "https://teacherjoseluis.app.n8n.cloud/webhook-test/pii/identity" `
  -Fixture "tests/fixtures/identity-request-valid.json"
```

## What not to commit

- `.env` or real `PII_WEBHOOK_HEADER_VALUE`
- Execution output that includes secrets or PII

Record successful smoke test workflow version and execution ID in `AGENTS.md` milestone log after validation.
