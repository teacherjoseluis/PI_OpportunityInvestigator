-- Slack early-exit notify v1: DM when eligibility/evidence stops before full analysis.

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{slack_notify,notify_on_early_exit}',
    'true'::jsonb,
    true
  ),
  description = COALESCE(description, '') || ' Slack early-exit notify: DM when eligibility/evidence stops before full analysis.',
  updated_at = NOW()
WHERE is_active = TRUE;
