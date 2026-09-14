-- Merge Phase 1 report-generator settings into active configuration_versions.
-- Uses jsonb_set so nested analysis.* keys are not wiped.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb) || '{
      "report": {
        "schema_version": "report.v1",
        "max_claims_per_section": 8,
        "max_sources": 40,
        "include_html": false,
        "publication_requires_cash_debt": true,
        "publication_requires_schema_valid": true,
        "seed_monitoring_rules": true,
        "category_map": {
          "business_financial": "financial_business",
          "growth": "growth_prospects",
          "pipeline": "pipeline_clinical",
          "regulatory": "regulatory_catalyst",
          "valuation": "valuation_market",
          "risk": "risk_red_team"
        },
        "disclaimer": "This report is an automated research aid based on public information as of the stated as-of timestamp. It may contain errors or omissions. It is not personalized investment, legal, tax, or accounting advice. Independently verify material facts before making an investment decision."
      }
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Analysis report v1: deterministic JSON+Markdown report assembly.',
  updated_at = NOW()
WHERE is_active = TRUE;
