-- Multi-agent blackboard (M0) and technical-analysis storage (T0/T1).
-- Does not change research_priority weights. technical_context_score stays nullable.

ALTER TABLE research_cases
  ADD COLUMN IF NOT EXISTS supervisor_cursor JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS technical_context_score NUMERIC(5, 2);

CREATE TABLE IF NOT EXISTS agent_definitions (
  agent_key TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  wave TEXT NOT NULL,
  claim_category TEXT,
  tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  hosted_workflow_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'BLOCKED',
  wave TEXT,
  depends_on UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  depends_on_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  objective TEXT,
  provider TEXT,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_http_calls INTEGER,
  max_runtime_sec INTEGER,
  max_usd NUMERIC(12, 4),
  graph_hash TEXT,
  shadow BOOLEAN NOT NULL DEFAULT TRUE,
  fill_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_tasks_case_idx ON agent_tasks (case_id, status);
CREATE INDEX IF NOT EXISTS agent_tasks_graph_idx ON agent_tasks (case_id, graph_hash);

DROP TRIGGER IF EXISTS agent_tasks_updated_at ON agent_tasks;
CREATE TRIGGER agent_tasks_updated_at
  BEFORE UPDATE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS market_bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  bar_time DATE NOT NULL,
  open NUMERIC(20, 6),
  high NUMERIC(20, 6),
  low NUMERIC(20, 6),
  close NUMERIC(20, 6),
  volume NUMERIC(20, 4),
  source TEXT NOT NULL,
  source_evidence_id UUID REFERENCES evidence_documents (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, interval, bar_time, source)
);

CREATE INDEX IF NOT EXISTS market_bars_symbol_idx ON market_bars (symbol, interval, bar_time);

CREATE TABLE IF NOT EXISTS technical_indicator_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  as_of DATE,
  indicator_key TEXT NOT NULL,
  params_hash TEXT NOT NULL DEFAULT '',
  metric_value NUMERIC(20, 6),
  calculation_notes TEXT,
  source_evidence_id UUID REFERENCES evidence_documents (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, symbol, interval, indicator_key, params_hash)
);

CREATE INDEX IF NOT EXISTS technical_indicator_case_idx
  ON technical_indicator_values (case_id, indicator_key);

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(gates_json, '{}'::jsonb),
        '{analysis,scoring,category_map,technical}',
        '"technical_market"'::jsonb,
        true
      ),
      '{analysis,scoring,timing_can_defer_watchlist}',
      'false'::jsonb,
      true
    ),
    '{analysis,scoring,missing_market_ohlcv_confidence_penalty}',
    '8'::jsonb,
    true
  ),
  scores_json = COALESCE(scores_json, '{}'::jsonb) || '{
    "technical": {
      "feed_risk": true,
      "weights": {
        "trend_alignment": 1,
        "drawdown_from_high": 1,
        "relative_strength_xbi_3m": 1,
        "liquidity_adv": 1,
        "volatility_regime": 1,
        "event_reaction": 1
      }
    }
  }'::jsonb,
  description = COALESCE(description, '') || ' | orchestration M0 + technical context score (excluded from research priority)',
  updated_at = NOW()
WHERE is_active = TRUE;

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    gates_json,
    '{analysis,valuation,rehomed_topic_keys}',
    '["liquidity_adv","volatility_drawdown","short_interest","entry_timing"]'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE;

UPDATE configuration_versions
SET
  gates_json = jsonb_set(
    jsonb_set(
      gates_json,
      '{collection,market}',
      '{
        "enabled": true,
        "mode": "ohlcv_compact",
        "provider_order": ["twelvedata", "finnhub"],
        "intervals": ["1day", "1week"],
        "benchmark_symbols": ["SPY", "XBI", "XLV"],
        "provider_plan_unverified": true
      }'::jsonb,
      true
    ),
    '{analysis,report,category_map,technical}',
    '"technical_market"'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE is_active = TRUE;
