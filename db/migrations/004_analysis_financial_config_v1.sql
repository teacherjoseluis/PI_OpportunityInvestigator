-- Merge Phase 1 financial analysis settings into active configuration_versions.gates_json.
-- Uses jsonb_set so nested analysis.* keys are not wiped by later migrations.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb) || '{
      "financial": {
        "min_sec_filings": 1,
        "min_structural_claims": 1,
        "watched_forms": ["10-K", "10-Q", "8-K", "S-3", "424B", "424B5", "S-1"],
        "claim_category": "business_financial",
        "insufficient_topics": [
          {
            "key": "cash_debt",
            "text": "INSUFFICIENT_EVIDENCE: Cash, debt, and net cash cannot be determined from filing metadata alone; full SEC body/XBRL required (PII-03 circle-back)."
          },
          {
            "key": "burn_runway",
            "text": "INSUFFICIENT_EVIDENCE: Cash burn and runway cannot be calculated without period financials from XBRL or filing body (PII-03 circle-back)."
          },
          {
            "key": "margins",
            "text": "INSUFFICIENT_EVIDENCE: Gross/operating margins are not available from filing index metadata (PII-03 circle-back)."
          },
          {
            "key": "product_revenue",
            "text": "INSUFFICIENT_EVIDENCE: Product-level revenue and concentration cannot be extracted from metadata-only evidence (PII-03 circle-back)."
          },
          {
            "key": "dilution",
            "text": "INSUFFICIENT_EVIDENCE: Dilution and share-count impact cannot be quantified without offering details and XBRL share counts (PII-03 circle-back)."
          }
        ]
      }
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Analysis financial v1: deterministic metadata claims + explicit insufficient topics.',
  updated_at = NOW()
WHERE is_active = TRUE;
