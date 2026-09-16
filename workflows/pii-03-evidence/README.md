# PII-03 Evidence Collector

Collect primary evidence for a case in `COLLECTING`, persist `evidence_documents` (and Slice E1 financial metrics), advance state.

## Invocation

Subworkflow. Called by PII-00 after PII-02 only when `next_state === COLLECTING`.

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
  "outcome": "COLLECTED",
  "next_state": "ANALYZING",
  "counts": {
    "sec_stored_count": 4,
    "ct_stored_count": 2,
    "xbrl_stored_count": 1,
    "xbrl_metric_count": 6
  },
  "collector_status": [
    { "key": "sec_edgar", "ok": true },
    { "key": "clinicaltrials_gov", "ok": true },
    { "key": "sec_filing_bodies", "ok": true, "metric_count": 6 }
  ]
}
```

Outcomes: `COLLECTED` | `PARTIAL` | `FAILED`.

## Live collectors

| Collector | Source |
|---|---|
| SEC EDGAR | `data.sec.gov/submissions/CIK….json` — summary + recent filing metadata |
| ClinicalTrials.gov | API v2 `/studies` by sponsor name — NCT + phase/status + enrollment when present |
| SEC companyfacts (E1/E8) | `data.sec.gov/api/xbrl/companyfacts/CIK….json` — cash/debt/income/OCF/shares → `financial_periods` / `financial_metrics` + `evidence_chunks` |
| openFDA Drugs@FDA (E4) | `api.fda.gov/drug/drugsfda.json` — compact application facts; credential `openFDA API key` |
| CourtListener (E8) | `www.courtlistener.com/api/rest/v4/search/` — compact docket/opinion hits; credential `CourtListener API Token` |

## Deferred collectors

Configured in `config/collection.v1.json` with `enabled: false` (except `sec_filing_bodies` for E1):

- FDA / openFDA
- Company IR / press
- USPTO / patents
- Full SEC filing HTML bodies (E3; companyfacts path is E1)
- Object storage for raw blobs (E2)

Roadmap: **[docs/ENRICHMENT.md](../../docs/ENRICHMENT.md)**.

## Behavior

1. Validate input; load case + CIK/legal_name; load `gates_json.collection`
2. Fetch SEC submissions → normalize → upsert `evidence_documents` (SHA-256 dedupe)
3. Fetch SEC companyfacts → normalize cash/debt → upsert evidence + period/metrics + chunk
4. Fetch CT.gov studies → normalize → upsert
5. Evaluate coverage (`min_sec_documents` default 1; XBRL failure is non-blocking when SEC/CT ok)
6. Advance `COLLECTING` → `ANALYZING` (or `INCOMPLETE` / human review per config)
7. Log `case_state_history` + `workflow_runs` (`PII-03`)

## Regenerate

```bash
npm run bundle:pii-03
```

## Deploy

Hosted: workflow `IqoALspzvN3PL5Cq` — https://teacherjoseluis.app.n8n.cloud/workflow/IqoALspzvN3PL5Cq  
Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`.

## Smoke note

PII-03 does not run when PII-02 returns `AWAITING_HUMAN_REVIEW`. Force a case to `COLLECTING` or obtain an eligibility PASS, then Execute this workflow in n8n with `{ case_id, ticker, exchange }` (MCP cannot drive Execute Workflow Trigger).

Before hosted E1 smoke: apply migration `018_collection_sec_xbrl_cash_debt_v1.sql` on VPS, then deploy updated PII-03 (and PII-04 / PII-10 / PII-11) when requested.
