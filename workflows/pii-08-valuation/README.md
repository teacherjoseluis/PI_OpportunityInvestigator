# PII-08 Valuation and Market Analyst

Phase 1 â€” deterministic valuation/market claims from existing SEC metadata. No LLM. No invented market-cap, EV, multiples, peers, or volatility.

## Invocation

Subworkflow. Called by PII-00 after PII-07 when `next_state === ANALYZING`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, claim_count, insufficient_topics[], counts }`

Outcomes: `ANALYZED` | `PARTIAL` | `INSUFFICIENT` | `FAILED`. State stays `ANALYZING` on success.

## Behavior

1. Load case + evidence + `gates_json.analysis.valuation`
2. Emit valuation-framed claims: periodic filing anchors, offering-form dilution context, material-event market context
3. Emit explicit `INSUFFICIENT_EVIDENCE` for market-cap/EV, net cash, multiples, peers, ADV, volatility, short interest, entry timing
4. Persist `claims` (`claim_category=valuation_market`) + `claim_evidence_links`
5. Log `workflow_runs` (`PII-08`)

## Config

[`config/analysis-valuation.v1.json`](../../config/analysis-valuation.v1.json) â†’ migration `009`.

## Regenerate

```bash
npm run bundle:pii-08
```

## Deploy

Deployed inactive: workflow `1PuOVYf0O3GThRwq`, version `630de67e-510a-4ea3-b2a3-42b7f4f6f58d`. Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Migration `009` applied on VPS.

## Smoke

Execute **Valuation Analyst Trigger** with `{ case_id, ticker, exchange }` on an `ANALYZING` case (e.g. `fb342540-1bd9-49a4-a38b-5328501ccac4`). Verify `claims` where `claim_category = 'valuation_market'` and state stays `ANALYZING`.
