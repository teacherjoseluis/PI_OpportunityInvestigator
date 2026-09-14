# PII-11 Report Generator

Phase 1 — deterministic JSON + Markdown report assembly from persisted claims, scores, and evidence. No LLM. Seeds basic monitoring rules. Does not mark `COMPLETE` / `publication_ready` while cash/debt (and related) gates still fail.

## Invocation

Subworkflow. Called by PII-00 after PII-10 when `next_state === AWAITING_HUMAN_REVIEW`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, outcome_class, schema_valid, publication_ready, report_id, report_version }`

Typical Phase 1 result: `next_state = AWAITING_HUMAN_REVIEW`, `outcome = REPORT_DRAFT`, `publication_ready = false`.

## Behavior

1. Load case + evidence + active claims + scores/components + prior report version + config (`gates_json.analysis.report`)
2. Assemble report contract sections from claims (capped per section) + scores + sources
3. Validate required sections; render Markdown
4. Insert `research_reports` (versioned) and seed `monitoring_rules`
5. Set `research_cases.state`; log `workflow_runs` (`PII-11`)

## Config

[`config/analysis-report.v1.json`](../../config/analysis-report.v1.json) → migration `012`.

## Regenerate

```bash
npm run bundle:pii-11
```

## Deploy

Deployed inactive: workflow `CLiHq1zJ1Euwhrxb`, version `e32403d7-8456-4110-b2a4-2b3c7e63a34a`. Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Migration `012` applied on VPS. Canvas: https://teacherjoseluis.app.n8n.cloud/workflow/CLiHq1zJ1Euwhrxb

## Smoke

Execute **Report Generator Trigger** with `{ case_id, ticker, exchange }` after PII-10. Verify `research_reports` row, `monitoring_rules`, and state `AWAITING_HUMAN_REVIEW`.
