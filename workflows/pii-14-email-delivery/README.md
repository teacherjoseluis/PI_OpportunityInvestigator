# PII-14 Email Digest and Report Delivery

Phase 1 slice — email investigation reports via existing n8n **SMTP account**. Supports `TEST_DELIVERY` (labeled draft when not publication-ready) and `INVESTIGATION_REPORT` (send only when publication gates pass). Weekly discovery digest is deferred.

## Invocation

Standalone subworkflow (not wired into PII-00). Manual Execute or future schedule / orchestrator call.

**Input:** `{ case_id, mode?, recipient? }`

- `mode`: `TEST_DELIVERY` | `INVESTIGATION_REPORT` (default from config)
- `recipient`: optional override (default `teacherjoseluis@gmail.com`)

**Output:** `{ case_id, ticker, mode, outcome, reason, delivery_status, report_id, recipient, subject, … }`

Outcomes: `SENT` | `SKIPPED_GATES` | `SKIPPED_DUPLICATE` | `FAILED`.

## Behavior

1. Load `gates_json.email_delivery` + case + latest `research_reports` (executive brief only) + prior `email_deliveries`
2. Decide send vs skip (gates / dedupe / test flag)
3. If sending: SMTP email (text + HTML)
4. Insert `email_deliveries` (dedupe skip if already SENT)
5. Log `workflow_runs` (`PII-14`); leave case state unchanged

## Config

[`config/email-delivery.v1.json`](../../config/email-delivery.v1.json) → migration `015`.

## Credentials

- **Postgres account**
- **SMTP account** (same as Investment Concierge weekly summary)

## Regenerate

```bash
npm run bundle:pii-14
```

## Deploy

Deployed inactive: workflow `kf6pC1t7J1XavbiE`, version `49c21b70-9f26-4c30-b7f7-f1085a8b73e5`. Credentials: **Postgres account** + **SMTP account**. `callerPolicy=workflowsFromSameOwner`. Migration `015` applied on VPS. Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/kf6pC1t7J1XavbiE

## Smoke (after deploy + migration 015)

Execute **Email Trigger** with:

```json
{
  "case_id": "fb342540-1bd9-49a4-a38b-5328501ccac4",
  "mode": "TEST_DELIVERY"
}
```

Expect inbox draft to `teacherjoseluis@gmail.com` and:

```sql
SELECT delivery_type, status, recipient, subject, dedupe_key, sent_at
FROM email_deliveries
WHERE case_id = 'fb342540-1bd9-49a4-a38b-5328501ccac4'
ORDER BY created_at DESC
LIMIT 5;

SELECT workflow_key, status, metadata_json, created_at
FROM workflow_runs
WHERE workflow_key = 'PII-14'
ORDER BY created_at DESC
LIMIT 3;
```
