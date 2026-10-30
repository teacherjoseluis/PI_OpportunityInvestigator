import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateTechnicalRequestCode = `__VALIDATE_TECHNICAL_REQUEST__`;
const evaluateTechnicalMarketCode = `__EVALUATE_TECHNICAL_MARKET__`;
const buildTechnicalResultCode = `__BUILD_TECHNICAL_RESULT__`;

const technicalTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Technical Analyst Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'ticker', type: 'string' },
          { name: 'exchange', type: 'string' },
          { name: 'focus', type: 'string' },
        ],
      },
    },
  },
  output: [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD', exchange: 'NASDAQ' }],
});

const validateTechnicalRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Technical Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateTechnicalRequestCode,
    },
  },
});

const validationPassed = ifElse({
  version: 2.3,
  config: {
    name: 'Validation Passed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          { leftValue: expr('{{ $json.valid }}'), operator: { type: 'boolean', operation: 'true' } },
        ],
        combinator: 'and',
      },
    },
  },
});

const loadCaseAndCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Company',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT rc.id AS case_id, rc.ticker, rc.exchange, rc.company_id, rc.as_of_date, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Technical Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const loadMarketBars = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Market Bars',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_object_agg(symbol, intervals), '{}'::jsonb) AS bars_json FROM (SELECT symbol, jsonb_object_agg(interval, bars) AS intervals FROM (SELECT symbol, interval, jsonb_agg(jsonb_build_object('bar_time', bar_time, 'open', open, 'high', high, 'low', low, 'close', close, 'volume', volume) ORDER BY bar_time) AS bars FROM market_bars WHERE symbol = $1 OR symbol IN ('SPY', 'XBI', 'XLV') GROUP BY symbol, interval) s GROUP BY symbol) t",
      options: {
        queryReplacement: expr('{{ $("Validate Technical Request").item.json.ticker }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const loadCatalystDates = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Catalyst Dates',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(expected_date ORDER BY expected_date), '[]'::jsonb) AS catalyst_dates FROM catalysts WHERE case_id = $1::uuid AND expected_date IS NOT NULL",
      options: {
        queryReplacement: expr('{{ $("Validate Technical Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const loadAnalysisConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Analysis Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, gates_json, scores_json, eligibility_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const evaluateTechnicalMarket = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Technical Market',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateTechnicalMarketCode,
    },
  },
});

const insertTechnicalIndicators = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Technical Indicators',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO technical_indicator_values (case_id, symbol, interval, as_of, indicator_key, params_hash, metric_value, calculation_notes, source_evidence_id) SELECT $1::uuid, r.symbol, r.interval, NULLIF(r.as_of, '')::date, r.indicator_key, r.params_hash, r.metric_value, r.calculation_notes, NULLIF(r.source_evidence_id, '')::uuid FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS r(symbol text, interval text, as_of text, indicator_key text, params_hash text, metric_value numeric, calculation_notes text, source_evidence_id text) ON CONFLICT (case_id, symbol, interval, indicator_key, params_hash) DO UPDATE SET metric_value = EXCLUDED.metric_value, calculation_notes = EXCLUDED.calculation_notes RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Technical Market").first().json.case_id }},{{ $("Evaluate Technical Market").first().json.indicators_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const deleteEventClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Delete Prior Event Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "DELETE FROM claims WHERE case_id = $1::uuid AND claim_category = 'technical_market' AND (claim_text LIKE 'Latest dated catalyst window:%' OR claim_text LIKE 'INSUFFICIENT_EVIDENCE: Event-window%') RETURNING id",
      options: {
        queryReplacement: expr('{{ $("Evaluate Technical Market").first().json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const insertTechnicalClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Technical Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH src AS (SELECT * FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS r(claim_index int, claim_text text, claim_category text, claim_kind text, confidence numeric, materiality text, extraction_method text, evidence_ids jsonb)), ins AS (INSERT INTO claims (case_id, claim_text, claim_category, claim_kind, confidence, materiality, extraction_method, model_version, is_active) SELECT $1::uuid, src.claim_text, src.claim_category, src.claim_kind, src.confidence, src.materiality, src.extraction_method, 'pii-16-v1', TRUE FROM src RETURNING id, claim_text) INSERT INTO claim_evidence_links (claim_id, evidence_id, link_role) SELECT ins.id, eid::uuid, 'SUPPORTS' FROM ins JOIN src ON src.claim_text = ins.claim_text CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(src.evidence_ids, '[]'::jsonb)) AS eid WHERE eid ~ '^[0-9a-f-]{36}$' ON CONFLICT (claim_id, evidence_id, link_role) DO NOTHING RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Technical Market").first().json.case_id }},{{ $("Evaluate Technical Market").first().json.claims_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-16 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, status, metadata_json) VALUES ($1::uuid, 'PII-16', $2, 'SUCCEEDED', convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Technical Market").first().json.case_id }},{{ $("Evaluate Technical Market").first().json.n8n_execution_id }},{{ $("Evaluate Technical Market").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const buildTechnicalResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Technical Result',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildTechnicalResultCode },
  },
});

const note = sticky(
  '## PII-16 Technical analyst\nIndicators are computed from stored bars. No buy or sell language. technical_context_score is not part of research priority.',
  [technicalTrigger, evaluateTechnicalMarket],
  { color: 5 },
);

export default workflow('pii-16-technical', 'PII-16 Technical and Market Behavior Analyst')
  .add(technicalTrigger)
  .to(validateTechnicalRequest)
  .to(
    validationPassed
      .onFalse(buildTechnicalResult)
      .onTrue(
        loadCaseAndCompany
          .to(loadMarketBars)
          .to(loadCatalystDates)
          .to(loadAnalysisConfig)
          .to(evaluateTechnicalMarket)
          .to(deleteEventClaims)
          .to(insertTechnicalIndicators)
          .to(insertTechnicalClaims)
          .to(logWorkflowRun)
          .to(buildTechnicalResult),
      ),
  )
  .add(note);
