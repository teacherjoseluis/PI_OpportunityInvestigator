# PII-06 Pipeline and Clinical Analyst

Phase 1 — deterministic pipeline/clinical claims from existing CT.gov (+ light SEC) metadata. Distinct from growth prospects (PII-05). No LLM. No invented efficacy, safety, or probability-of-success scores.

## Invocation

Subworkflow. Called by PII-00 after PII-05 when `next_state === ANALYZING`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, claim_count, insufficient_topics[], counts }`

Outcomes: `ANALYZED` | `PARTIAL` | `INSUFFICIENT` | `FAILED`. State stays `ANALYZING` on success.

## Behavior

1. Load case + evidence + `gates_json.analysis.pipeline`
2. Emit pipeline-framed claims: study inventory, phase/status mix, late-stage concentration, optional SEC periodic anchors
3. Emit explicit `INSUFFICIENT_EVIDENCE` for ownership, endpoints/design, enrollment/timelines, efficacy, safety, designations, competitive differentiation, probability-adjusted relevance
4. Persist `claims` (`claim_category=pipeline_clinical`) + `claim_evidence_links`
5. Log `workflow_runs` (`PII-06`)

## Config

[`config/analysis-pipeline.v1.json`](../../config/analysis-pipeline.v1.json) → migration `006`.

## Regenerate

```bash
npm run bundle:pii-06
```

## Deploy

Hosted: workflow `b8CxYW8T8FrGl62x` — https://teacherjoseluis.app.n8n.cloud/workflow/b8CxYW8T8FrGl62x  
Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Apply migrations through `007` / analysis deep-merge repair on VPS before first smoke.

## Smoke

Execute **Pipeline Analyst Trigger** with `{ case_id, ticker, exchange }` on an `ANALYZING` case (e.g. `fb342540-1bd9-49a4-a38b-5328501ccac4`). Verify `claims` where `claim_category = 'pipeline_clinical'` and state stays `ANALYZING`.
