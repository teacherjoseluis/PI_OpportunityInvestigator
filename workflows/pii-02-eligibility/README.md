# PII-02 Eligibility Gate

Phase 1 vertical slice — deterministic eligibility checks for a case in `ELIGIBILITY_REVIEW`, using active `configuration_versions.eligibility_json` and Twelve Data market/profile data.

## Invocation

Subworkflow (not a public webhook). Called by PII-00 via **Execute Sub-workflow** after PII-01 (local wiring; deploy when requested).

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
  "outcome": "PASS",
  "next_state": "COLLECTING",
  "configuration_version_id": "uuid",
  "market_cap_usd": 2500000000,
  "adv_dollar_usd": 45100000,
  "rules": [{ "key": "allowed_exchange", "status": "PASS", "detail": "exchange_allowed" }]
}
```

Outcomes: `PASS` | `PASS_WITH_EXCEPTION` | `HUMAN_REVIEW` | `FAIL`.

State mapping: PASS / PASS_WITH_EXCEPTION → `COLLECTING`; HUMAN_REVIEW → `AWAITING_HUMAN_REVIEW`; FAIL → `INCOMPLETE`.

## Behavior

1. Validate `case_id` / ticker / exchange
2. Load case + company/security; load active eligibility config; count recent duplicate cases
3. Fetch Twelve Data `/profile`, `/statistics`, `/quote` (credential **TwelveData API key**)
4. Evaluate deterministic rules (exchange, identity, type, industry, shell/SPAC, market cap, ADV, duplicates)
5. Optionally update `companies.sector` / `industry` / `website_url`
6. Advance case state; log `case_state_history` + `workflow_runs` (`PII-02`) with base64-safe rules metadata

## Local files

| File | Purpose |
|---|---|
| `workflow.template.ts` | SDK source with embed placeholders |
| `workflow.ts` | Generated deploy artifact (do not edit by hand) |
| `../shared/code/validate-eligibility-request.js` | Input validation |
| `../shared/code/evaluate-eligibility.js` | Rules engine |
| `../shared/code/build-eligibility-result.js` | Output shape |
| `../../config/eligibility.v1.json` | Mirrored eligibility thresholds |

## Regenerate workflow.ts

```bash
npm run bundle:pii-02
```

## Local tests

```bash
npm test
```

## Deploy

Per project agreements, deploy to hosted n8n **only when explicitly requested**.

## Credentials

- **Postgres account**
- **TwelveData API key** (`httpQueryAuth`)

## Out of scope (later)

- PII-03 evidence collection
- SEC submissions depth check beyond linked CIK
- Human-approval UI for PASS_WITH_EXCEPTION
