-- Merge Phase 1 scoring/quality-gate settings into active configuration_versions.
-- Uses jsonb_set so nested analysis.* / scores_json keys are not wiped.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb) || '{
      "scoring": {
        "min_evidence_documents": 1,
        "category_map": {
          "business_quality": "financial_business",
          "growth": "growth_prospects",
          "pipeline": "pipeline_clinical",
          "valuation": "valuation_market",
          "risk": "risk_red_team"
        },
        "insufficient_topic_penalty": 5,
        "max_insufficient_penalty": 40,
        "require_sec_filing": true,
        "require_cash_debt_from_filing": true,
        "require_red_team": true,
        "require_schema_valid_report": true,
        "hard_stop_zero_evidence": true,
        "min_evidence_confidence_for_watchlist": 70,
        "min_research_priority_for_watchlist": 60,
        "min_research_priority_for_high_conviction": 75
      }
    }'::jsonb
  ),
  scores_json = COALESCE(scores_json, '{}'::jsonb) || '{
    "weights": {
      "business_quality": 0.4,
      "growth": 0.3,
      "pipeline": 0.3
    },
    "risk_penalty_factor": 0.25,
    "outcome_thresholds": {
      "min_evidence_confidence_for_watchlist": 70,
      "min_research_priority_for_watchlist": 60,
      "min_research_priority_for_high_conviction": 75
    }
  }'::jsonb,
  description = COALESCE(description, '') || ' Analysis scoring v1: coverage-aware scores + Phase 1 quality gates.',
  updated_at = NOW()
WHERE is_active = TRUE;
