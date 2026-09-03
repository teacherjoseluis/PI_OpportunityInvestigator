# PII-01 Identity Resolver

Phase 1 vertical slice — resolve company/security identity for a case in `IDENTITY_REVIEW`, persist to Postgres, advance state.

## Invocation

Subworkflow (not a public webhook). Called by PII-00 via **Execute Sub-workflow** after deploy.

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
  "company_id": "uuid",
  "security_id": "uuid",
  "cik": "0001561582",
  "legal_name": "ACADIA PHARMACEUTICALS INC",
  "identity_confidence": 95,
  "outcome": "RESOLVED",
  "next_state": "ELIGIBILITY_REVIEW",
  "reused_existing": false
}
```

`outcome` is `NEEDS_HUMAN_REVIEW` and `next_state` is `AWAITING_HUMAN_REVIEW` when confidence &lt; 80 or EDGAR has no usable match.

## Behavior

1. Validate `case_id` / ticker / exchange
2. Lookup existing `securities` + `companies` (idempotent cache)
3. Else fetch `https://www.sec.gov/files/company_tickers_exchange.json` (requires User-Agent)
4. Match ticker + exchange; score confidence; upsert company, security, aliases
5. Link `research_cases.company_id` / `security_id` and advance state
6. Log `case_state_history` + `workflow_runs` (`PII-01`)

## Local files

| File | Purpose |
|---|---|
| `workflow.template.ts` | SDK source with embed placeholders |
| `workflow.ts` | Generated deploy artifact (do not edit by hand) |
| `../shared/code/validate-identity-request.js` | Input validation |
| `../shared/code/resolve-edgar-identity.js` | EDGAR match + confidence |
| `../shared/code/prepare-cached-identity.js` | Cache-hit path |
| `../shared/code/build-identity-result.js` | Output shape |

## Regenerate workflow.ts

```bash
npm run bundle:pii-01
```

## Local tests

```bash
npm test
```

## Deploy

Per project agreements, deploy to hosted n8n **only when explicitly requested**. Hosted workflow ID: `Xf6DjDUMyfOyNX3G`. PII-00 calls this workflow via Execute Sub-workflow.

## Postgres credential

Uses n8n credential **`Postgres account`**.

## Out of scope (later)

- LEI / HQ enrichment beyond EDGAR tickers file
- Drug / ClinicalTrials.gov aliases
- Human-approval UI for low-confidence aliases
- Caching the EDGAR tickers file between runs
