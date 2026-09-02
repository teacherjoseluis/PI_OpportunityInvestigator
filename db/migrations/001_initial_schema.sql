-- Phase 0 initial schema for Pharma Investment Opportunity Investigator
-- Spec section 14. UUIDs, append-only history, provenance, and versioning.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Configuration and prompt versioning
-- ---------------------------------------------------------------------------

CREATE TABLE configuration_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label TEXT NOT NULL UNIQUE,
  description TEXT,
  gates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  budgets_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  models_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  eligibility_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX configuration_versions_one_active_idx
  ON configuration_versions ((is_active))
  WHERE is_active;

CREATE TRIGGER configuration_versions_updated_at
  BEFORE UPDATE ON configuration_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key TEXT NOT NULL,
  version_label TEXT NOT NULL,
  role_description TEXT NOT NULL,
  template_text TEXT NOT NULL,
  output_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_hint TEXT,
  temperature NUMERIC(4, 3),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prompt_key, version_label)
);

CREATE TRIGGER prompt_versions_updated_at
  BEFORE UPDATE ON prompt_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Company / security identity
-- ---------------------------------------------------------------------------

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL,
  cik TEXT,
  lei TEXT,
  headquarters_jurisdiction TEXT,
  sector TEXT,
  industry TEXT,
  website_url TEXT,
  ir_domain TEXT,
  operating_status TEXT,
  identity_confidence NUMERIC(5, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX companies_cik_uidx ON companies (cik) WHERE cik IS NOT NULL;

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE company_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  confidence NUMERIC(5, 2),
  provenance TEXT,
  requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, alias_type, alias_value)
);

CREATE INDEX company_aliases_value_idx ON company_aliases (alias_value);

CREATE TRIGGER company_aliases_updated_at
  BEFORE UPDATE ON company_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE securities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  exchange TEXT NOT NULL,
  security_type TEXT,
  listing_status TEXT,
  currency TEXT DEFAULT 'USD',
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, exchange)
);

CREATE INDEX securities_company_idx ON securities (company_id);

CREATE TRIGGER securities_updated_at
  BEFORE UPDATE ON securities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Research cases and audit
-- ---------------------------------------------------------------------------

CREATE TABLE research_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  company_id UUID REFERENCES companies (id),
  security_id UUID REFERENCES securities (id),
  ticker TEXT NOT NULL,
  exchange TEXT,
  research_question TEXT,
  mode TEXT NOT NULL DEFAULT 'FULL',
  state TEXT NOT NULL DEFAULT 'REQUESTED',
  requested_by TEXT,
  as_of_date DATE,
  configuration_version_id UUID REFERENCES configuration_versions (id),
  force_refresh BOOLEAN NOT NULL DEFAULT FALSE,
  parent_case_id UUID REFERENCES research_cases (id),
  supersedes_case_id UUID REFERENCES research_cases (id),
  outcome_class TEXT,
  budget_usd_limit NUMERIC(12, 4),
  budget_usd_actual NUMERIC(12, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id)
);

CREATE INDEX research_cases_state_idx ON research_cases (state);
CREATE INDEX research_cases_ticker_idx ON research_cases (ticker);
CREATE INDEX research_cases_company_idx ON research_cases (company_id);

CREATE TRIGGER research_cases_updated_at
  BEFORE UPDATE ON research_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE case_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  workflow_execution_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX case_state_history_case_idx ON case_state_history (case_id, created_at);

CREATE TABLE case_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  priority TEXT,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER case_questions_updated_at
  BEFORE UPDATE ON case_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  workflow_key TEXT NOT NULL,
  n8n_execution_id TEXT,
  correlation_id UUID,
  status TEXT NOT NULL DEFAULT 'STARTED',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error_summary TEXT,
  cost_usd_estimate NUMERIC(12, 4),
  cost_usd_actual NUMERIC(12, 4),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX workflow_runs_case_idx ON workflow_runs (case_id);
CREATE INDEX workflow_runs_execution_idx ON workflow_runs (n8n_execution_id);

CREATE TRIGGER workflow_runs_updated_at
  BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Evidence and claims
-- ---------------------------------------------------------------------------

CREATE TABLE evidence_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  publisher TEXT,
  canonical_url TEXT,
  stable_source_id TEXT,
  title TEXT,
  publication_date DATE,
  event_effective_date DATE,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reporting_period TEXT,
  raw_content_location TEXT,
  extracted_text_location TEXT,
  content_sha256 TEXT,
  authority_tier TEXT,
  access_status TEXT,
  parsing_status TEXT,
  supersedes_evidence_id UUID REFERENCES evidence_documents (id),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX evidence_documents_sha_uidx
  ON evidence_documents (content_sha256)
  WHERE content_sha256 IS NOT NULL;

CREATE INDEX evidence_documents_case_idx ON evidence_documents (case_id);
CREATE INDEX evidence_documents_company_idx ON evidence_documents (company_id);
CREATE INDEX evidence_documents_source_type_idx ON evidence_documents (source_type);

CREATE TRIGGER evidence_documents_updated_at
  BEFORE UPDATE ON evidence_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE evidence_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES evidence_documents (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_estimate INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (evidence_id, chunk_index)
);

CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  claim_category TEXT NOT NULL,
  claim_kind TEXT NOT NULL,
  confidence NUMERIC(5, 2),
  materiality TEXT,
  extraction_method TEXT,
  model_version TEXT,
  prompt_version_id UUID REFERENCES prompt_versions (id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX claims_case_idx ON claims (case_id);
CREATE INDEX claims_category_idx ON claims (claim_category);

CREATE TRIGGER claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE claim_evidence_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence_documents (id) ON DELETE CASCADE,
  link_role TEXT NOT NULL DEFAULT 'SUPPORTS',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (claim_id, evidence_id, link_role)
);

-- ---------------------------------------------------------------------------
-- Drugs, pipeline, trials
-- ---------------------------------------------------------------------------

CREATE TABLE drugs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  primary_name TEXT NOT NULL,
  mechanism TEXT,
  modality TEXT,
  ownership_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER drugs_updated_at
  BEFORE UPDATE ON drugs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drug_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_id UUID NOT NULL REFERENCES drugs (id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  confidence NUMERIC(5, 2),
  provenance TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (drug_id, alias_type, alias_value)
);

CREATE TABLE asset_indications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  drug_id UUID NOT NULL REFERENCES drugs (id) ON DELETE CASCADE,
  indication TEXT NOT NULL,
  development_phase TEXT,
  latest_status TEXT,
  ownership_rights TEXT,
  competitive_notes TEXT,
  next_milestone TEXT,
  next_milestone_window TEXT,
  date_confidence TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (drug_id, indication)
);

CREATE TRIGGER asset_indications_updated_at
  BEFORE UPDATE ON asset_indications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE clinical_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_indication_id UUID REFERENCES asset_indications (id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
  nct_id TEXT,
  title TEXT,
  phase TEXT,
  status TEXT,
  sponsor TEXT,
  collaborators_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  design_notes TEXT,
  primary_endpoints TEXT,
  secondary_endpoints TEXT,
  enrollment INTEGER,
  start_date DATE,
  primary_completion_date DATE,
  results_summary TEXT,
  source_evidence_id UUID REFERENCES evidence_documents (id),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX clinical_trials_nct_uidx
  ON clinical_trials (nct_id)
  WHERE nct_id IS NOT NULL;

CREATE TRIGGER clinical_trials_updated_at
  BEFORE UPDATE ON clinical_trials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Financials, catalysts, risks, scores
-- ---------------------------------------------------------------------------

CREATE TABLE financial_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  period_label TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  fiscal_year INTEGER,
  fiscal_quarter INTEGER,
  source_evidence_id UUID REFERENCES evidence_documents (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, period_label)
);

CREATE TRIGGER financial_periods_updated_at
  BEFORE UPDATE ON financial_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE financial_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_period_id UUID NOT NULL REFERENCES financial_periods (id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_value NUMERIC(20, 6),
  currency TEXT,
  unit TEXT,
  scale TEXT,
  assumption_set TEXT,
  source_evidence_id UUID REFERENCES evidence_documents (id),
  calculation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (financial_period_id, metric_key, assumption_set)
);

CREATE TABLE catalysts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
  asset_indication_id UUID REFERENCES asset_indications (id) ON DELETE SET NULL,
  catalyst_type TEXT NOT NULL,
  expected_date DATE,
  expected_date_end DATE,
  date_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  source_evidence_id UUID REFERENCES evidence_documents (id),
  last_verified_at DATE,
  potential_impact TEXT,
  monitoring_source TEXT,
  expiration_rule TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX catalysts_case_idx ON catalysts (case_id);
CREATE INDEX catalysts_expected_date_idx ON catalysts (expected_date);

CREATE TRIGGER catalysts_updated_at
  BEFORE UPDATE ON catalysts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  risk_category TEXT NOT NULL,
  description TEXT NOT NULL,
  likelihood_band TEXT,
  impact_band TEXT,
  time_horizon TEXT,
  monitoring_signal TEXT,
  thesis_breaking_condition TEXT,
  evidence_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX risks_case_idx ON risks (case_id);

CREATE TRIGGER risks_updated_at
  BEFORE UPDATE ON risks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  configuration_version_id UUID REFERENCES configuration_versions (id),
  business_quality_score NUMERIC(5, 2),
  growth_score NUMERIC(5, 2),
  pipeline_score NUMERIC(5, 2),
  valuation_context_score NUMERIC(5, 2),
  risk_score NUMERIC(5, 2),
  evidence_confidence_score NUMERIC(5, 2),
  data_freshness_score NUMERIC(5, 2),
  research_priority_score NUMERIC(5, 2),
  outcome_class TEXT,
  hard_stop BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id)
);

CREATE TRIGGER scores_updated_at
  BEFORE UPDATE ON scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE score_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id UUID NOT NULL REFERENCES scores (id) ON DELETE CASCADE,
  component_key TEXT NOT NULL,
  parent_score_key TEXT NOT NULL,
  raw_value NUMERIC(20, 6),
  normalized_value NUMERIC(5, 2),
  weight NUMERIC(8, 4),
  contribution NUMERIC(8, 4),
  missing BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (score_id, component_key)
);

-- ---------------------------------------------------------------------------
-- Reports, monitoring, discovery, email, ops
-- ---------------------------------------------------------------------------

CREATE TABLE research_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  report_json JSONB NOT NULL,
  report_markdown TEXT,
  report_html TEXT,
  schema_valid BOOLEAN NOT NULL DEFAULT FALSE,
  publication_ready BOOLEAN NOT NULL DEFAULT FALSE,
  as_of TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, version_number)
);

CREATE TRIGGER research_reports_updated_at
  BEFORE UPDATE ON research_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE monitoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES research_cases (id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  description TEXT,
  expected_date DATE,
  date_window_start DATE,
  date_window_end DATE,
  source_types_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  materiality_condition TEXT,
  refresh_sections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX monitoring_rules_case_idx ON monitoring_rules (case_id);
CREATE INDEX monitoring_rules_active_idx ON monitoring_rules (is_active);

CREATE TRIGGER monitoring_rules_updated_at
  BEFORE UPDATE ON monitoring_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE detected_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_date DATE,
  materiality TEXT,
  dedupe_key TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_assets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX detected_events_dedupe_uidx
  ON detected_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TRIGGER detected_events_updated_at
  BEFORE UPDATE ON detected_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'STARTED',
  screened_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  qualified_count INTEGER NOT NULL DEFAULT 0,
  coverage_ok BOOLEAN,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER discovery_runs_updated_at
  BEFORE UPDATE ON discovery_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  discovery_run_id UUID REFERENCES discovery_runs (id) ON DELETE SET NULL,
  report_id UUID REFERENCES research_reports (id) ON DELETE SET NULL,
  delivery_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  dedupe_key TEXT,
  sent_at TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX email_deliveries_dedupe_uidx
  ON email_deliveries (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TRIGGER email_deliveries_updated_at
  BEFORE UPDATE ON email_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dead_letter_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES research_cases (id) ON DELETE SET NULL,
  workflow_key TEXT,
  n8n_execution_id TEXT,
  error_class TEXT,
  error_summary TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dead_letter_unresolved_idx
  ON dead_letter_items (resolved, created_at)
  WHERE resolved = FALSE;

CREATE TRIGGER dead_letter_items_updated_at
  BEFORE UPDATE ON dead_letter_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: inactive placeholder config row (activate after editing thresholds)
-- ---------------------------------------------------------------------------

INSERT INTO configuration_versions (
  version_label,
  description,
  gates_json,
  scores_json,
  freshness_json,
  budgets_json,
  models_json,
  eligibility_json,
  is_active
) VALUES (
  'v1',
  'Initial configuration scaffold. Review thresholds before activating workflows.',
  '{
    "min_identity_confidence": 80,
    "require_sec_filing": true,
    "require_cash_debt_from_filing": true,
    "require_red_team": true,
    "require_schema_valid_report": true
  }'::jsonb,
  '{
    "weights": {
      "business_quality": 0.4,
      "growth": 0.3,
      "pipeline": 0.3
    },
    "risk_penalty_factor": 0.25
  }'::jsonb,
  '{
    "sec_days": 120,
    "clinical_trials_days": 30,
    "market_data_days": 7
  }'::jsonb,
  '{
    "max_case_usd": 5,
    "max_documents": 100,
    "max_model_calls": 40
  }'::jsonb,
  '{
    "extraction_model": "TBD",
    "synthesis_model": "TBD",
    "temperature_structured": 0.1
  }'::jsonb,
  '{
    "allowed_exchanges": ["NYSE", "NASDAQ", "AMEX"],
    "industries": ["Pharmaceutical Preparations", "Biological Products"],
    "prefer_mid_small_cap": true
  }'::jsonb,
  TRUE
);
