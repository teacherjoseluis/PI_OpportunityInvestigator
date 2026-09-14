-- Merge Phase 1 monitoring/reassessment settings into active configuration_versions.
-- Uses jsonb_set so nested analysis.* / other gates keys are not wiped.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{monitoring}',
    '{
      "sec_recent_filings_limit": 15,
      "ctgov_page_size": 20,
      "lookback_days_if_no_report": 90,
      "max_events_per_run": 20,
      "material_sec_forms": ["8-K", "10-K", "10-Q", "S-3", "S-3ASR", "424B5", "424B3", "6-K"],
      "financing_sec_forms": ["S-3", "S-3ASR", "424B5", "424B3", "F-3"],
      "auto_launch_reassessment": false,
      "rule_event_map": {
        "sec_filings": ["sec_new_filing", "sec_financing_signal"],
        "clinical_trials": ["ctgov_status_change", "ctgov_new_study"],
        "financing": ["sec_financing_signal"]
      }
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Monitoring v1: SEC/CT.gov change detection + change memos.',
  updated_at = NOW()
WHERE is_active = TRUE;
