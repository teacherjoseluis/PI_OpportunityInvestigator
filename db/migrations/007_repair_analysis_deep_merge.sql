-- Repair: deep-merge analysis.financial / growth / pipeline.
-- Needed because jsonb || is shallow and 004→005→006 overwrote analysis keys.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb)
      || '{
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
      || '{
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
      || '{
          "pipeline": {
            "min_evidence_documents": 1,
            "min_structural_claims": 1,
            "claim_category": "pipeline_clinical",
            "insufficient_topics": [
              {
                "key": "ownership_economic_rights",
                "text": "INSUFFICIENT_EVIDENCE: Asset ownership and economic rights cannot be confirmed from CT.gov/SEC metadata alone (needs filing/IR body text; PII-03 circle-back)."
              },
              {
                "key": "endpoints_and_design",
                "text": "INSUFFICIENT_EVIDENCE: Primary/secondary endpoints, comparator, blinding, and randomization are not in Phase-1 CT.gov metadata (needs full study modules)."
              },
              {
                "key": "enrollment_and_timelines",
                "text": "INSUFFICIENT_EVIDENCE: Enrollment targets, actual enrollment, and milestone windows require fuller registry/design modules than currently stored."
              },
              {
                "key": "efficacy_and_durability",
                "text": "INSUFFICIENT_EVIDENCE: Efficacy magnitude and durability require results publications or labeled result modules (not collected in Phase 1)."
              },
              {
                "key": "safety_and_tolerability",
                "text": "INSUFFICIENT_EVIDENCE: Safety, tolerability, dropout, and discontinuation signals need adverse-event / results evidence (PII-03 circle-back)."
              },
              {
                "key": "regulatory_designations",
                "text": "INSUFFICIENT_EVIDENCE: Breakthrough, orphan, Fast Track, and other designations require FDA/openFDA or labeled company disclosures (PII-07 / PII-03)."
              },
              {
                "key": "competitive_differentiation",
                "text": "INSUFFICIENT_EVIDENCE: Competitive landscape and differentiation cannot be assessed from registry index metadata alone."
              },
              {
                "key": "probability_adjusted_relevance",
                "text": "INSUFFICIENT_EVIDENCE: Probability-adjusted pipeline relevance is deferred until richer clinical evidence and scoring (PII-10) are available."
              }
            ]
          }
        }'::jsonb
  ),
  description = COALESCE(description, '') || ' Repair analysis deep-merge: financial + growth + pipeline.',
  updated_at = NOW()
WHERE is_active = TRUE;
