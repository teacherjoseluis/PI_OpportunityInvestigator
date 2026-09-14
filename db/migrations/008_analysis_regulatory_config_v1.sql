-- Merge Phase 1 regulatory/catalyst analysis settings into active configuration_versions.gates_json.
-- Uses jsonb_set so nested analysis.* keys are not wiped by later migrations.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb) || '{
      "regulatory": {
        "min_evidence_documents": 1,
        "min_structural_claims": 1,
        "claim_category": "regulatory_catalyst",
        "watched_event_forms": ["8-K", "6-K"],
        "insufficient_topics": [
          {
            "key": "fda_decision_calendar",
            "text": "INSUFFICIENT_EVIDENCE: FDA decision calendar and approval/CRL outcomes require openFDA or labeled company disclosures (PII-03 fda_openfda circle-back)."
          },
          {
            "key": "pdufa_and_submission_dates",
            "text": "INSUFFICIENT_EVIDENCE: PDUFA dates and NDA/BLA/sNDA submission timelines cannot be confirmed from SEC index or CT.gov status metadata alone."
          },
          {
            "key": "regulatory_designations",
            "text": "INSUFFICIENT_EVIDENCE: Breakthrough, orphan, Fast Track, RMAT, and similar designations require FDA/openFDA or labeled disclosures."
          },
          {
            "key": "advisory_committee",
            "text": "INSUFFICIENT_EVIDENCE: Advisory committee (AdCom) scheduling and outcomes are not available from Phase-1 evidence collectors."
          },
          {
            "key": "asset_indication_linkage",
            "text": "INSUFFICIENT_EVIDENCE: Catalyst-to-asset/indication linkage needs normalized pipeline records and richer source text (PII-06 enrichment / filing bodies)."
          },
          {
            "key": "confirmed_date_status",
            "text": "INSUFFICIENT_EVIDENCE: Catalyst date status (confirmed, company-guided, inferred, unknown) cannot be assigned without dated regulatory sources."
          },
          {
            "key": "thesis_impact_scoring",
            "text": "INSUFFICIENT_EVIDENCE: Thesis impact bands for catalysts are deferred until scoring (PII-10) and richer catalyst records exist."
          }
        ]
      }
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Analysis regulatory v1: deterministic SEC/CT.gov catalyst signals + explicit insufficient topics.',
  updated_at = NOW()
WHERE is_active = TRUE;
