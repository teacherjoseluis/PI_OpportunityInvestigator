# PII-05 Growth Analyst

Phase 1 — deterministic growth-prospect claims from existing SEC/CT.gov metadata. Distinct from pipeline quality (PII-06). No LLM. No invented TAM or product-growth rates.

## Invocation

Subworkflow. Called by PII-00 after PII-04 when `next_state === ANALYZING`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, claim_count, insufficient_topics[], counts }`

Outcomes: `ANALYZED` | `PARTIAL` | `INSUFFICIENT` | `FAILED`. State stays `ANALYZING` on success.

## Behavior

1. Load case + evidence + `gates_json.analysis.growth`
2. Emit growth-framed claims: clinical-activity dependence, material-event form presence, periodic filing anchors
3. Emit explicit `INSUFFICIENT_EVIDENCE` for TAM, product growth, geo expansion, competitive share, partnerships, consensus
4. Persist `claims` (`claim_category=growth_prospects`) + `claim_evidence_links`
5. Log `workflow_runs` (`PII-05`)

## Config

[`config/analysis-growth.v1.json`](../../config/analysis-growth.v1.json) → migration `005`.

## Regenerate

```bash
npm run bundle:pii-05
```

## Deploy

Hosted: workflow `sdamxDo9SUdo4QxC` — https://teacherjoseluis.app.n8n.cloud/workflow/sdamxDo9SUdo4QxC  
Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Apply migration `005` on VPS before first smoke.

## Smoke

Execute **Growth Analyst Trigger** with `{ case_id, ticker, exchange }` on an `ANALYZING` case (e.g. `fb342540-1bd9-49a4-a38b-5328501ccac4`). Verify `claims` where `claim_category = 'growth_prospects'` and state stays `ANALYZING`.
