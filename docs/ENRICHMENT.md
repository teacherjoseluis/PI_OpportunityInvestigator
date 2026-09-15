# Evidence enrichment (PII-03+)

Design and slice roadmap for upgrading Phase 1 **metadata-only** collection into filing-backed facts, blobs, chunks, and downstream analyst claims. Product requirements live in [`PHARMA_INVESTMENT_OPPORTUNITY_INVESTIGATOR.md`](../PHARMA_INVESTMENT_OPPORTUNITY_INVESTIGATOR.md) (§6.2, §7, §10.1, §12). Live status and deploy IDs stay in [`AGENTS.md`](../AGENTS.md).

## Purpose

Unblock research quality that Phase 1 deliberately deferred:

- Real **cash / debt / net cash** (and related financial claims) instead of `INSUFFICIENT_EVIDENCE`
- PII-10 gate `cash_debt_from_filing` and PII-11 `publication_ready` when filing-backed metrics exist
- Richer evidence for FDA, IR, patents, and narrative sections over later slices

## Non-goals

- Weekly **discovery / ticker picking** (separate product track)
- Using an LLM as the evidence source (snippets must cite stored evidence IDs)
- Rewriting PII-00…PII-15 orchestration topology (enrichment extends PII-03 and analyst consumers)
- Implementing all collectors in one change set

## Current baseline (Phase 1)

| Area | State |
|---|---|
| Config | [`config/collection.v1.json`](../config/collection.v1.json) → `gates_json.collection` |
| Enabled collectors | `sec_edgar`, `clinicaltrials_gov`, `sec_filing_bodies` (E1 companyfacts cash/debt) |
| Deferred collectors | `fda_openfda`, `company_ir`, `uspto_patents`; full HTML bodies deferred to E3 |
| `evidence_documents` | Metadata rows for SEC/CT; E1 adds `sec_companyfacts` with `parsing_status='xbrl_facts_extracted'` |
| `evidence_chunks` | E1 writes minimal cash/debt summary chunk for companyfacts |
| `financial_periods` / `financial_metrics` | E1 populates cash/debt/net cash (`assumption_set='reported'`) |
| PII-04 | Emits filing-backed `cash_debt` when metrics exist; other insufficient topics unchanged |
| PII-10 | Gate `cash_debt_from_filing` passes when `deterministic_xbrl_metrics` claim present |
| PII-11 | `publication_requires_cash_debt` clears when XBRL cash/debt claim present |

Workflow entry: [`workflows/pii-03-evidence/`](../workflows/pii-03-evidence/). Shared normalize/coverage: `workflows/shared/code/normalize-sec-evidence.js`, `normalize-ctgov-evidence.js`, `evaluate-collection-coverage.js`.

## Target architecture

```text
SEC / FDA / IR / USPTO ──► PII-03 collectors ──► evidence_documents
                                      │
                                      ├─► object storage URIs (raw blobs)     [slice E2+]
                                      ├─► evidence_chunks (extracts)          [E1 minimal, E3/E7]
                                      └─► financial_periods + financial_metrics  [E1]
                                               │
                                               ▼
                                         PII-04…PII-11 claims / gates / report
```

| Layer | Authority |
|---|---|
| Case state, claims, scores, reports | PostgreSQL (`pii_research`) |
| Numeric filing facts | `financial_periods` + `financial_metrics` (+ `source_evidence_id`) |
| Raw filing/API blobs | Object storage URIs in `raw_content_location` / `extracted_text_location` (after E2) |
| Evidence integrity | SHA-256 dedupe, stable URLs, `parsing_status`, supersession per product §7.3–7.4 |

**E1 storage default:** persist XBRL **facts in Postgres** only. Do **not** require MinIO/S3 for Slice E1. Blobs move to object storage in **E2**.

## Working agreement (same as Phase 1 workflows)

For each slice:

1. Author locally (config, migrations, shared Code, workflow template).
2. `npm test` and relevant `npm run bundle:pii-*`.
3. You apply VPS migrations when required.
4. Deploy to hosted n8n **only when you explicitly ask**.
5. One focused smoke (case such as REGN or ACAD).
6. You sign off; outcome recorded in `AGENTS.md`.
7. Only then start the next slice.

## Slice catalog

Dependencies: later slices assume earlier ones unless noted.

| ID | Name | Depends on |
|---|---|---|
| E1 | SEC XBRL cash & debt | — |
| E2 | Object storage for raw blobs | — (before E3 bodies) |
| E3 | SEC filing HTML / primary documents | E2 |
| E4 | FDA / openFDA collector | — (E2 recommended for large payloads) |
| E5 | Company IR / press collector | E2 recommended |
| E6 | USPTO / patents collector | E2 recommended |
| E7 | Chunk backfill + analyst sweep | E1+; ideally E3–E6 |

---

### Slice E1 — SEC XBRL cash & debt

**Why first:** Unblocks `cash_debt_from_filing`, denser financial claims, and publication path without new blob infra.

**Scope**

- Implement `collectors.sec_filing_bodies` **narrowly**: SEC **companyfacts / companyconcept** by CIK (not full HTML 10-K dump).
- Upsert `evidence_documents` for the XBRL/companyfacts source (compact JSON; may remain inline or small Postgres-backed location until E2).
- Write cash, marketable securities, debt, and derived net cash into `financial_periods` + `financial_metrics` with `source_evidence_id`.
- Write minimal `evidence_chunks` summarizing the facts used in claims.
- Rewire [`workflows/shared/code/evaluate-financial-business.js`](../workflows/shared/code/evaluate-financial-business.js): when metrics exist, emit real `cash_debt` (and related) claims instead of insufficient gates.
- Rewire [`workflows/shared/code/evaluate-scoring-quality.js`](../workflows/shared/code/evaluate-scoring-quality.js): gate `cash_debt_from_filing` **passes** when filing-backed metrics exist (today it always fails in Phase 1).
- Align PII-11 publication cash/debt check with the same signal ([`workflows/shared/code/build-research-report.js`](../workflows/shared/code/build-research-report.js)).
- Config/migration updates for collection + any financial analysis keys as needed.

**Likely touch points**

- `config/collection.v1.json`, `config/analysis-financial.v1.json`, scoring/report configs if gate wording changes
- `db/migrations/` (collection flag + any metric key conventions)
- `workflows/pii-03-evidence/`, `workflows/pii-04-financial/` (and scoring/report bundles if Code changes)
- Unit tests under `tests/unit/`

**Out of scope for E1**

- Object storage buckets
- Full primary-document HTML download
- FDA / IR / patents
- Closing every insufficient topic (burn/runway may remain insufficient without multi-period burn logic)

**Smoke checklist (you)**

1. Apply any new migration on VPS.
2. Deploy updated PII-03 / PII-04 / PII-10 / PII-11 when requested.
3. Run a clean case (e.g. REGN) through COLLECTING → report (webhook or orchestrated path).
4. VPS checks:
   - `financial_metrics` rows for the case/company with cash/debt keys
   - PII-04 claim for cash/debt is **not** `INSUFFICIENT_EVIDENCE` when facts resolved
   - PII-10: `cash_debt_from_filing` **PASS** (other gates may still fail—note which)
   - PII-11: document whether `publication_ready` flipped or which blockers remain
5. Optional: PII-14 delivery shows stronger Supporting / fewer cash gaps.

**Sign-off**

- [ ] Metrics persisted and linked to evidence
- [ ] Cash/debt claim + scoring gate behavior match smoke notes
- [ ] Milestone logged in `AGENTS.md`

---

### Slice E2 — Object storage for raw blobs

**Scope**

- Introduce URI scheme for `raw_content_location` / `extracted_text_location` (replace `inline:metadata_json` for large payloads).
- Choose hostable store at E2 kickoff (e.g. VPS MinIO or other project credential)—record decision in this doc’s “E2 decision” subsection when implemented.
- Config for bucket/prefix; migration only if new tables/columns required.
- No claim-semantics change required.

**Smoke checklist (you)**

1. Upload + read-back of one SEC/CT payload via collector path.
2. `evidence_documents` locations are URIs; n8n can resolve for a follow-on node or verification script.
3. Existing metadata collectors still succeed.

**Sign-off**

- [ ] Blob round-trip verified on VPS/store
- [ ] No regression on Phase 1 SEC/CT metadata collection
- [ ] Milestone in `AGENTS.md`

---

### Slice E3 — SEC filing HTML / primary documents

**Depends on:** E2

**Scope**

- Download selected `primaryDocument` files for recent 10-K / 10-Q / 8-K (limits from collection config).
- Store blobs via E2; extract text → `evidence_chunks`.
- Optionally improve offering/dilution narrative claims in PII-04 / PII-09.

**Smoke checklist (you)**

1. Case has body evidence rows + chunks for at least one periodic filing.
2. SHA-256 dedupe on re-run.
3. Spot-check chunk text non-empty.

**Sign-off**

- [ ] Bodies + chunks present for smoke ticker
- [ ] Milestone in `AGENTS.md`

---

### Slice E4 — FDA / openFDA collector

**Scope**

- Enable `fda_openfda` in collection config; coverage rule; normalize → `evidence_documents` (+ chunks when useful).
- Downstream: close or reduce PII-07 insufficient topics that FDA can satisfy.

**Smoke checklist (you)**

1. Collector runs for a known label/approval-rich ticker.
2. Evidence rows with `source_type` for FDA; PII-03 coverage reflects enabled collector.
3. Note which regulatory insufficient claims improved (if any in same deploy).

**Sign-off**

- [ ] FDA evidence persisted
- [ ] Milestone in `AGENTS.md`

---

### Slice E5 — Company IR / press collector

**Scope**

- Enable `company_ir`; dedupe carefully vs SEC 8-K.
- Chunks + hooks for growth/catalyst claims where deterministic.

**Smoke checklist (you)**

1. IR/press documents stored without duplicate storms.
2. No false coverage pass if IR fails but SEC/CT ok (per config).

**Sign-off**

- [ ] IR collector smoke passed
- [ ] Milestone in `AGENTS.md`

---

### Slice E6 — USPTO / patents collector

**Scope**

- Enable `uspto_patents`; feed risk/IP insufficient topics in PII-09 where possible.

**Smoke checklist (you)**

1. Patent evidence rows for smoke ticker (or explicit empty-success if none).
2. Deduped re-run.

**Sign-off**

- [ ] Patents collector smoke passed
- [ ] Milestone in `AGENTS.md`

---

### Slice E7 — Chunk backfill + analyst sweep

**Depends on:** E1 at minimum; better after E3–E6

**Scope**

- Ensure all enabled collectors write `evidence_chunks` consistently.
- Sweep remaining `insufficient_topics` across PII-05…PII-09 that enrichment can close.
- Full-chain webhook smoke; production email path when publication gates pass.

**Smoke checklist (you)**

1. End-to-end webhook for a fresh ticker → report.
2. `publication_ready` / COMPLETE behavior documented against remaining gates.
3. Optional production `INVESTIGATION_REPORT` email when ready.

**Sign-off**

- [ ] Chunk policy consistent
- [ ] Analyst insufficient list reduced as documented
- [ ] Full-chain smoke + `AGENTS.md` milestone

---

## Backlog traceability (AGENTS.md → slices)

| AGENTS PII-03 circle-back item | Slice |
|---|---|
| 1. Full SEC filing bodies / XBRL (`sec_filing_bodies`) | **E1** (XBRL facts) + **E3** (HTML bodies) |
| 2. FDA / openFDA collector | **E4** |
| 3. Company IR / press collector | **E5** |
| 4. USPTO / patents collector | **E6** |
| 5. Object storage for raw blobs | **E2** |
| 6. Populate `evidence_chunks` from collector summaries | **E1** (minimal) + **E3**/E4–E6 + **E7** |
| 7. Full-chain webhook smoke / eligibility COLLECTING | Largely done for Finnhub path; residual cleanup + publication path in **E7** |

## Gate and claim reference

| Signal | Where |
|---|---|
| Insufficient `cash_debt` (and peers) | `config/analysis-financial.v1.json` → PII-04 `evaluate-financial-business.js` |
| Gate `cash_debt_from_filing` | `config/analysis-scoring.v1.json` → PII-10 `evaluate-scoring-quality.js` |
| Publication cash/debt | `config/analysis-report.v1.json` → PII-11 `build-research-report.js` |
| Related later | Valuation `net_cash_debt`; risk financing/runway topics |

## Related docs

| Doc | Role |
|---|---|
| [DATABASE.md](DATABASE.md) | Postgres / migrations |
| [SMOKE_TESTS.md](SMOKE_TESTS.md) | Webhook smoke helpers |
| [workflows/pii-03-evidence/README.md](../workflows/pii-03-evidence/README.md) | Collector invocation |
| [AGENTS.md](../AGENTS.md) | Deploy IDs, milestones, next steps |

## Status

- **Spec:** signed off.
- **E1:** done (VPS `018`, published workflows, REGN smoke: `cash_debt_from_filing` PASS, `publication_ready=true`). **Signed off** for product use.
- **E2–E3 (blobs / full SEC HTML): deferred indefinitely** — owner preference (2026-09-15): keep **high-level facts only** (e.g. companyfacts metrics); do **not** import large filing bodies into workflows or retain bulky raw evidence blobs.
- **E4–E7:** on hold pending a later need for more high-level structured collectors (not full-document archives).
- **Next product focus:** Slack completion DM (`im:write`) and ops polish — not object storage.
