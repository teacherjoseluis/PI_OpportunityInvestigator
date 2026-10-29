# PII-10 Scoring and Quality Gate

Phase 1 â€” deterministic coverage-aware scores and quality gates from existing claims/evidence. No LLM. Does not invent financials or mark `COMPLETE` while cash/debt and report gates fail.

## Invocation

Subworkflow. Called by PII-00 after PII-09 when `next_state === ANALYZING`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, outcome_class, scores, gates_failed[], hard_stop, score_id }`

Typical Phase 1 result: `next_state = AWAITING_HUMAN_REVIEW`, `outcome_class = MONITOR`.

## Behavior

1. Load case + packed evidence/claims jsonb (one row each; no `metadata_json` / full claim text) + config (`gates_json.analysis.scoring`, `scores_json`, `freshness_json`). Per-row Postgres items previously OOM'd Evaluate Scoring Quality on n8n Cloud.
2. Compute domain scores from claim coverage; mark missing domains explicitly
3. Evaluate quality gates (SEC present, red-team present, citations, cash/debt fail, report schema fail)
4. Upsert `scores` + replace `score_components`
5. Set `research_cases.state` + `outcome_class`; log `workflow_runs` (`PII-10`)

## Config

[`config/analysis-scoring.v1.json`](../../config/analysis-scoring.v1.json) â†’ migration `011`.

## Regenerate

```bash
npm run bundle:pii-10
```

## Deploy

Deployed/published: workflow `lIjKOZS7qDizvynm`, version `8b776acf-27a8-4627-9693-c9683c873eae`. Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Packed Load Claims/Evidence jsonb (OOM fix). Migration `011` applied on VPS.

## Smoke

Execute **Scoring Gate Trigger** with `{ case_id, ticker, exchange }` after PII-04â€“09 claims exist. Verify `scores` row, `score_components`, `outcome_class`, and state `AWAITING_HUMAN_REVIEW`.
