-- Merge Phase 1 email delivery settings into active configuration_versions.
-- Uses jsonb_set so nested analysis.* / monitoring / operations keys are not wiped.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{email_delivery}',
    '{
      "default_recipient": "teacherjoseluis@gmail.com",
      "from_email": "teacherjoseluis@gmail.com",
      "default_mode": "INVESTIGATION_REPORT",
      "allow_draft_test_delivery": true,
      "production_requires_publication_ready": true,
      "production_requires_schema_valid": true,
      "subject_prefix_test": "[PII DRAFT — NOT PUBLICATION READY]",
      "subject_prefix_prod": "[PII Report]",
      "max_body_chars": 50000,
      "max_markdown_chars": 20000
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Email delivery v1: investigation report + TEST_DELIVERY draft path.',
  updated_at = NOW()
WHERE is_active = TRUE;
