# PII-09 Risk and Red-Team Reviewer

Phase 1 â€” deterministic risk/red-team signals from existing SEC + CT.gov metadata. No LLM. No invented risk scores, thesis-breakers, or litigation outcomes.

## Invocation

Subworkflow. Called by PII-00 after PII-08 when `next_state === ANALYZING`.

**Input:** `{ case_id, ticker, exchange }`

**Output:** `{ case_id, outcome, next_state, claim_count, insufficient_topics[], counts }`

Outcomes: `ANALYZED` | `PARTIAL` | `INSUFFICIENT` | `FAILED`. State stays `ANALYZING` on success.

## Behavior

1. Load case + evidence + `gates_json.analysis.risk`
2. Emit risk-framed claims: periodic risk-factor anchors, financing/dilution signals, material-event risk signals, clinical execution signals
3. Emit explicit `INSUFFICIENT_EVIDENCE` for deeper financing, efficacy/safety, regulatory detail, commercial, competitive, patent, manufacturing, legal, governance, concentration, contradictions, thesis-breakers
4. Persist `claims` (`claim_category=risk_red_team`) + `claim_evidence_links`
5. Log `workflow_runs` (`PII-09`)

## Config

[`config/analysis-risk.v1.json`](../../config/analysis-risk.v1.json) â†’ migration `010`.

## Regenerate

```bash
npm run bundle:pii-09
```

## Deploy

Deployed inactive: workflow `mioSWLKBMLAaBGzs`, version `eef8fbae-5b9e-4b10-b4b5-ea5e453b4436`. Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Migration `010` applied on VPS.

## Smoke

Execute **Risk Analyst Trigger** with `{ case_id, ticker, exchange }` on an `ANALYZING` case (e.g. `fb342540-1bd9-49a4-a38b-5328501ccac4`). Verify `claims` where `claim_category = 'risk_red_team'` and state stays `ANALYZING`.
