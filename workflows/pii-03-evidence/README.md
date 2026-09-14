# PII-03 Evidence Collector

Phase 1 vertical slice — collect primary evidence for a case in `COLLECTING`, persist `evidence_documents`, advance state.

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
  "counts": { "sec_stored_count": 4, "ct_stored_count": 2 },
  "collector_status": [{ "key": "sec_edgar", "ok": true }]
}
```

Outcomes: `COLLECTED` | `PARTIAL` | `FAILED`.

## Phase 1 collectors (live)

| Collector | Source |
|---|---|
| SEC EDGAR | `data.sec.gov/submissions/CIK….json` — summary + recent filing metadata |
| ClinicalTrials.gov | API v2 `/studies` by sponsor name — one row per NCT |

## Deferred collectors (extension points)

Configured in `config/collection.v1.json` with `enabled: false`:

- FDA / openFDA
- Company IR / press
- USPTO / patents
- Full SEC filing bodies / XBRL
- Object storage for raw blobs

## Behavior

1. Validate input; load case + CIK/legal_name; load `gates_json.collection`
2. Fetch SEC submissions → normalize → upsert `evidence_documents` (SHA-256 dedupe)
3. Fetch CT.gov studies → normalize → upsert
4. Evaluate coverage (`min_sec_documents` default 1)
5. Advance `COLLECTING` → `ANALYZING` (or `INCOMPLETE` / human review per config)
6. Log `case_state_history` + `workflow_runs` (`PII-03`)

## Regenerate

```bash
npm run bundle:pii-03
```

## Deploy

Hosted: workflow `IqoALspzvN3PL5Cq` — https://teacherjoseluis.app.n8n.cloud/workflow/IqoALspzvN3PL5Cq  
Credential: **Postgres account**. `callerPolicy=workflowsFromSameOwner`.

## Smoke note

PII-03 does not run when PII-02 returns `AWAITING_HUMAN_REVIEW`. Force a case to `COLLECTING` or obtain an eligibility PASS, then Execute this workflow in n8n with `{ case_id, ticker, exchange }` (MCP cannot drive Execute Workflow Trigger).
