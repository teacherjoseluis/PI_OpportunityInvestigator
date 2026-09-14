# PII-12 Monitoring and Reassessment

Phase 1 slice of Phase 2 monitoring — poll SEC EDGAR submissions + ClinicalTrials.gov against the last report `as_of` and known evidence fingerprints. Persist `detected_events` with dedupe keys and a change memo. Does **not** auto-launch collectors/analysts (`auto_launch_reassessment: false`).

## Invocation

Standalone subworkflow (not wired into the PII-00 happy path in Phase 1). Manual Execute or future schedule.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, event_count, material_event_count, matched_rule_types[], change_memo }`

Outcomes: `NO_EVENTS` | `EVENTS_RECORDED` | `MATERIAL_EVENTS` | `FAILED`.

## Behavior

1. Load case + active `monitoring_rules` + latest `research_reports.as_of` + packed evidence fingerprints + `gates_json.monitoring`
2. Fetch SEC submissions (Fair Access User-Agent) and CT.gov studies by sponsor
3. Diff new filings / new or status-changed trials vs baseline
4. Insert new `detected_events` (skip existing `dedupe_key`)
5. Log `workflow_runs` (`PII-12`); leave case state unchanged

## Config

[`config/monitoring.v1.json`](../../config/monitoring.v1.json) → migration `013`.

## Regenerate

```bash
npm run bundle:pii-12
```

## Deploy

Deployed inactive: workflow `go396vtpeHKcvtub`, version `2633c95f-34cf-4051-a384-a0ec7b78762e`. Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Migration `013` applied on VPS. Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/go396vtpeHKcvtub

## Smoke

Execute **Monitoring Trigger** with `{ case_id, ticker, exchange }` after PII-11. Verify `detected_events` and `workflow_runs` PII-12.
