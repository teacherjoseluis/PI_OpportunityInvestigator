# PII-15 Slack Completion Notify

DM the Slack user who started `/pii` after PII-11 writes a report draft, or when the orchestrator stops early (eligibility / evidence). Uses stored `research_cases.request_context_json.slack` (not slash `response_url`).

## Invocation

Wired from PII-00:

- After **Execute PII-11 Report Generator** with `mode=COMPLETION`
- On eligibility not advancing to `COLLECTING` with `mode=EARLY_EXIT`, `stage=eligibility`
- On evidence not advancing to `ANALYZING` with `mode=EARLY_EXIT`, `stage=evidence`

Also runnable standalone.

**Input:** `{ case_id, ticker?, exchange?, mode?, stage?, reason?, outcome?, next_state?, detail? }`

- `mode`: `COMPLETION` (default) | `EARLY_EXIT`

**Output:** `{ case_id, ticker, exchange, outcome, reason, delivery_status, recipient, report_id, … }`

Outcomes: `SENT` | `SKIPPED` | `SKIPPED_DUPLICATE` | `FAILED`.

## Behavior

1. Load `gates_json.slack_notify` + case `request_context_json` + latest report summary + prior `slack_deliveries`
2. **COMPLETION:** skip if disabled / no Slack user / missing report / duplicate (`slack:COMPLETION:<case_id>:v<N>`)
3. **EARLY_EXIT:** skip if disabled / no Slack user / `notify_on_early_exit=false` / duplicate (`slack:EARLY_EXIT:<case_id>:<stage>`); report not required
4. If sending: Slack `message.post` to user (DM) via **Slack PII bot**
5. Insert `slack_deliveries`; log `workflow_runs` PII-15; leave case state unchanged

## Config

[`config/slack-notify.v1.json`](../../config/slack-notify.v1.json) → migrations `017` + `023` (`notify_on_early_exit`).

## Credentials

- **Postgres account**
- **Slack PII bot** (`slackApi`) — requires bot scopes `chat:write` and `im:write`, then reinstall app

## Regenerate

```bash
npm run bundle:pii-15
npm run bundle:pii-00
```

## Deploy

Hosted (completion path): workflow `3Q4goJz1gGKJRLMI`, version `763f7250-d903-4a24-8b57-a40be09f7c4f`. Credentials: **Postgres account** + **Slack PII bot**. `callerPolicy=workflowsFromSameOwner`. Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/3Q4goJz1gGKJRLMI

**Local early-exit wiring (PII-00 + PII-15 mode inputs + migration `023`) is not deployed until explicitly requested.**

## Smoke

1. Slack app: ensure bot scopes include `chat:write` + `im:write`, then **reinstall**
2. `/pii REGN` → wait for PII-11 → expect completion DM
3. Early exit (after deploy): ticker that fails eligibility → expect EARLY_EXIT DM with stage/reason
4. Verify `slack_deliveries` + `workflow_runs` PII-15 as below

```sql
SELECT delivery_type, status, recipient, subject, dedupe_key, sent_at
FROM slack_deliveries
ORDER BY created_at DESC
LIMIT 5;

SELECT workflow_key, status, metadata_json, created_at
FROM workflow_runs
WHERE workflow_key = 'PII-15'
ORDER BY created_at DESC
LIMIT 3;
```
