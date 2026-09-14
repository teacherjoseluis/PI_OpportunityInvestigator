# PII-13 Operations and Alerts

Phase 1 slice — DB-only operational health scan. Detect stuck/stale cases, failed `workflow_runs`, unresolved `dead_letter_items`, and budget overruns. Persist deduped `ops_alerts` and log `workflow_runs` (`PII-13`). Does **not** send email/Slack/webhooks (PII-14 / later).

## Invocation

Standalone subworkflow (not wired into the PII-00 happy path). Manual Execute or future schedule.

**Input:** `{}` or optional `{ lookback_hours }` (overrides failed-run lookback).

**Output:** `{ outcome, alert_count, material_alert_count, alert_types[], summary, delivery }`

Outcomes: `HEALTHY` | `ALERTS_RECORDED` | `MATERIAL_ALERTS` | `FAILED`.

## Behavior

1. Load active `gates_json.operations` + packed health snapshot (cases / failed runs / DLQ)
2. Evaluate deterministic alert rules with stable `dedupe_key`s
3. Insert new `ops_alerts` (skip existing `dedupe_key`)
4. Log `workflow_runs` (`PII-13`); leave all case states unchanged

## Config

[`config/ops-alerts.v1.json`](../../config/ops-alerts.v1.json) → migration `014`.

## Regenerate

```bash
npm run bundle:pii-13
```

## Deploy

Deployed inactive: workflow `ldPDfkqkkuDBfLe5`, version `be2d45ee-bd56-4e1a-b588-bdf46d2143f1`. Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Migration `014` applied on VPS. Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/ldPDfkqkkuDBfLe5

## Smoke (after deploy + migration 014)

Execute **Ops Trigger** with `{}`. Verify:

```sql
SELECT alert_type, severity, title, dedupe_key, status, created_at
FROM ops_alerts
ORDER BY created_at DESC
LIMIT 20;

SELECT workflow_key, status, metadata_json, created_at
FROM workflow_runs
WHERE workflow_key = 'PII-13'
ORDER BY created_at DESC
LIMIT 3;
```

Expect: `workflow_runs` PII-13 `SUCCEEDED`. On long-lived `AWAITING_HUMAN_REVIEW` cases you may see `stale_review` / `ALERTS_RECORDED` — valid Phase 1 signal.
