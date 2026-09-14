-- Merge Phase 1 pipeline/clinical analysis settings into active configuration_versions.gates_json.
-- Uses jsonb_set so nested analysis.* keys are not wiped by later migrations.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{analysis}',
    COALESCE(gates_json->'analysis', '{}'::jsonb) || '{
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
  description = COALESCE(description, '') || ' Analysis pipeline v1: deterministic CT.gov metadata claims + explicit insufficient topics.',
  updated_at = NOW()
WHERE is_active = TRUE;
