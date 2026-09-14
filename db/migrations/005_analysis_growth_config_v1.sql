-- Merge Phase 1 growth analysis settings into active configuration_versions.gates_json.
-- Uses jsonb_set so nested analysis.* keys are not wiped by later migrations.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb) || '{
      "growth": {
        "min_evidence_documents": 1,
        "min_structural_claims": 1,
        "claim_category": "growth_prospects",
        "watched_event_forms": ["8-K", "6-K"],
        "insufficient_topics": [
          {
            "key": "tam_addressable_market",
            "text": "INSUFFICIENT_EVIDENCE: Addressable market / diagnosed-treated population cannot be quantified from SEC/CT.gov metadata alone (needs labeled market sources; PII-03 circle-back)."
          },
          {
            "key": "product_growth_rates",
            "text": "INSUFFICIENT_EVIDENCE: Growth of currently marketed products requires product revenue time series (XBRL/IR; PII-03 circle-back)."
          },
          {
            "key": "geographic_expansion",
            "text": "INSUFFICIENT_EVIDENCE: Geographic expansion cannot be assessed from filing index or trial registry metadata alone."
          },
          {
            "key": "competitive_share",
            "text": "INSUFFICIENT_EVIDENCE: Market penetration and competitive share require licensed or labeled market data not yet collected."
          },
          {
            "key": "partnerships_licensing",
            "text": "INSUFFICIENT_EVIDENCE: Partnerships, licensing, and royalties need full filing/IR body text; 8-K presence alone is not sufficient (PII-03 circle-back)."
          },
          {
            "key": "consensus_expectations",
            "text": "INSUFFICIENT_EVIDENCE: Consensus growth expectations require a licensed estimates source (not configured in Phase 1)."
          }
        ]
      }
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Analysis growth v1: deterministic metadata claims + explicit insufficient topics.',
  updated_at = NOW()
WHERE is_active = TRUE;
