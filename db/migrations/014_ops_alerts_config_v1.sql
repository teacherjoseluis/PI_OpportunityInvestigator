-- Phase 1 ops alerts: first-class alert rows + gates_json.operations.
-- Uses jsonb_set so nested analysis.* / monitoring keys are not wiped.

CREATE TABLE IF NOT EXISTS ops_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  workflow_key TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  dedupe_key TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'OPEN',
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_alerts_dedupe_uidx
  ON ops_alerts (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ops_alerts_status_idx
  ON ops_alerts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ops_alerts_case_idx
  ON ops_alerts (case_id)
  WHERE case_id IS NOT NULL;

DROP TRIGGER IF EXISTS ops_alerts_updated_at ON ops_alerts;
CREATE TRIGGER ops_alerts_updated_at
  BEFORE UPDATE ON ops_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    COALESCE(gates_json, '{}'::jsonb),
    '{operations}',
    '{
      "stuck_case_hours": 48,
      "stale_review_hours": 168,
      "failed_run_lookback_hours": 72,
      "unresolved_dead_letter_hours": 1,
      "budget_overrun_enabled": true,
      "max_alerts_per_run": 50,
      "terminal_states": ["COMPLETE", "INCOMPLETE", "FAILED", "SUPERSEDED"],
      "review_states": ["AWAITING_HUMAN_REVIEW"],
      "material_alert_types": [
        "failed_workflow_run",
        "unresolved_dead_letter",
        "budget_overrun",
        "stuck_case"
      ]
    }'::jsonb
  ),
  description = COALESCE(description, '') || ' Operations v1: stuck/stale cases, failed runs, DLQ, budget overruns.',
  updated_at = NOW()
WHERE is_active = TRUE;
