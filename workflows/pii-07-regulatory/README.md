# PII-07 Regulatory and Catalyst Analyst

Phase 1 — deterministic regulatory/catalyst claims from existing SEC event forms (+ light CT.gov status). Distinct from pipeline quality (PII-06). No LLM. No invented PDUFA, AdCom, or designation calendars.

## Invocation

Subworkflow. Called by PII-00 after PII-06 when `next_state === ANALYZING`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, claim_count, insufficient_topics[], counts }`

Outcomes: `ANALYZED` | `PARTIAL` | `INSUFFICIENT` | `FAILED`. State stays `ANALYZING` on success.

## Behavior

1. Load case + evidence + `gates_json.analysis.regulatory`
2. Emit catalyst-framed claims: material-event form presence, periodic filing anchors, clinical-status milestone signals
3. Emit explicit `INSUFFICIENT_EVIDENCE` for FDA calendar, PDUFA/submissions, designations, AdCom, asset linkage, date status, thesis impact
4. Persist `claims` (`claim_category=regulatory_catalyst`) + `claim_evidence_links`
5. Log `workflow_runs` (`PII-07`)

## Config

[`config/analysis-regulatory.v1.json`](../../config/analysis-regulatory.v1.json) → migration `008`.

## Regenerate

```bash
npm run bundle:pii-07
```

## Deploy

Hosted: workflow `4AqBDr5hjZeMLy99` — https://teacherjoseluis.app.n8n.cloud/workflow/4AqBDr5hjZeMLy99  
Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Apply migration `008` on VPS before first smoke.

## Smoke

Execute **Regulatory Analyst Trigger** with `{ case_id, ticker, exchange }` on an `ANALYZING` case (e.g. `fb342540-1bd9-49a4-a38b-5328501ccac4`). Verify `claims` where `claim_category = 'regulatory_catalyst'` and state stays `ANALYZING`.
