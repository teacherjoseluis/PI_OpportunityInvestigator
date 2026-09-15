-- Slack completion notify v1: case request context + slack_deliveries + gates.

ALTER TABLE research_cases
  ADD COLUMN IF NOT EXISTS request_context_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS slack_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  report_id UUID REFERENCES research_reports (id) ON DELETE SET NULL,
  delivery_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  channel_id TEXT,
  subject TEXT,
  text_preview TEXT,
  provider_message_ts TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  dedupe_key TEXT,
  sent_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS slack_deliveries_dedupe_uidx
  ON slack_deliveries (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TRIGGER slack_deliveries_updated_at
  BEFORE UPDATE ON slack_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{slack_notify}',
    '{
      "enabled": true,
      "notify_on_report_draft": true,
      "require_slack_user_id": true,
      "delivery_type": "COMPLETION",
      "dedupe_on_report_version": true,
      "max_message_chars": 3500,
      "include_scores": true,
      "include_gates": true
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Slack notify v1: DM completion after PII-11.',
  updated_at = NOW()
WHERE is_active = TRUE;
