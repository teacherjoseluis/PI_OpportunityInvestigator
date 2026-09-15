-- Slice E1: enable SEC companyfacts XBRL cash/debt collector in active collection config.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{collection,collectors,sec_filing_bodies}',
    jsonb_build_object(
      'enabled', true,
      'description', 'Slice E1 — SEC companyfacts XBRL cash/debt metrics (not full HTML bodies)',
      'mode', 'companyfacts_cash_debt'
    ),
    true
  ),
  description = COALESCE(description, '') || ' | collection: sec_filing_bodies E1 companyfacts cash/debt enabled',
  updated_at = NOW()
WHERE is_active = TRUE;
