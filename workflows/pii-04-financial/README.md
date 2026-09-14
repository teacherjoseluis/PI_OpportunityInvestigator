# PII-04 Financial and Business Analyst

Phase 1 — deterministic financial/business claims from existing evidence metadata. No LLM. No invented cash, debt, runway, or margin figures.

## Invocation

Subworkflow. Called by PII-00 after PII-03 when `next_state === ANALYZING`.

**Input:**

```json
{
  "case_id": "uuid",
  "ticker": "ACAD",
  "exchange": "NASDAQ"
}
```

**Output:**

```json
{
  "case_id": "uuid",
  "outcome": "ANALYZED",
  "next_state": "ANALYZING",
  "claim_count": 8,
  "insufficient_topics": ["cash_debt", "burn_runway", "margins", "product_revenue", "dilution"]
}
```

Outcomes: `ANALYZED` | `PARTIAL` | `INSUFFICIENT` | `FAILED`.

## Behavior

1. Validate input; load case, `evidence_documents`, `gates_json.analysis.financial`
2. Emit fact claims for watched SEC forms; inference for CT.gov pipeline mix / offering forms
3. Emit explicit `INSUFFICIENT_EVIDENCE` claims for cash/debt, runway, margins, product revenue, dilution (PII-03 XBRL circle-back)
4. Insert `claims` + `claim_evidence_links`
5. Keep case in `ANALYZING` (or `INCOMPLETE` on hard failure)
6. Log `case_state_history` + `workflow_runs` (`PII-04`)

## Config

[`config/analysis-financial.v1.json`](../../config/analysis-financial.v1.json) → migration `004` → `gates_json.analysis.financial`.

## Regenerate

```bash
npm run bundle:pii-04
```

## Deploy

Hosted: workflow `RvIlyuDV0MEsXezL` — https://teacherjoseluis.app.n8n.cloud/workflow/RvIlyuDV0MEsXezL  
Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`. Apply migration `004` on VPS before first smoke.

## Smoke

Execute on an `ANALYZING` case (e.g. `fb342540-1bd9-49a4-a38b-5328501ccac4`). Verify `claims` / `claim_evidence_links` and `next_state = ANALYZING`.
