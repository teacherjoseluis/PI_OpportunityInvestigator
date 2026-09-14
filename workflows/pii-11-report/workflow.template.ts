import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateReportRequestCode = `__VALIDATE_REPORT_REQUEST__`;
const buildResearchReportCode = `__BUILD_RESEARCH_REPORT__`;
const restoreReportPayloadCode = `__RESTORE_REPORT_PAYLOAD__`;
const restoreAfterClearRulesCode = `__RESTORE_AFTER_CLEAR_RULES__`;
const prepareReportAggregateCode = `__PREPARE_REPORT_AGGREGATE__`;
const buildReportResultCode = `__BUILD_REPORT_RESULT__`;

const reportTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Report Generator Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'ticker', type: 'string' },
          { name: 'exchange', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateReportRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Report Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateReportRequestCode,
    },
  },
});

const validationPassed = ifElse({
  version: 2.3,
  config: {
    name: 'Validation Passed?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.valid }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareValidationError = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Validation Error',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'outcome', name: 'outcome', value: 'FAILED', type: 'string' },
          { id: 'next-state', name: 'next_state', value: 'INCOMPLETE', type: 'string' },
          { id: 'reason', name: 'reason', value: 'validation_failed', type: 'string' },
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: 'REASSESS_OR_EXCLUDE',
            type: 'string',
          },
          { id: 'schema-valid', name: 'schema_valid', value: false, type: 'boolean' },
          {
            id: 'publication-ready',
            name: 'publication_ready',
            value: false,
            type: 'boolean',
          },
          { id: 'claim-count', name: 'claim_count', value: 0, type: 'number' },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, rc.configuration_version_id, rc.outcome_class, rc.research_question, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Report Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadEvidenceDocuments = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Evidence Documents',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT (SELECT COUNT(*)::int FROM evidence_documents ed WHERE ed.case_id = $1::uuid) AS evidence_total, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'source_type', e.source_type, 'publisher', e.publisher, 'stable_source_id', e.stable_source_id, 'title', LEFT(COALESCE(e.title, ''), 240), 'publication_date', e.publication_date) ORDER BY e.created_at ASC) FROM (SELECT id, source_type, publisher, stable_source_id, title, publication_date, created_at FROM evidence_documents WHERE case_id = $1::uuid ORDER BY created_at ASC LIMIT 40) e), '[]'::jsonb) AS evidence_json",
      options: {
        queryReplacement: expr('{{ $("Validate Report Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH ranked AS (SELECT c.id, c.claim_category, LEFT(c.claim_text, 500) AS claim_text, c.claim_kind, c.confidence, c.materiality, c.extraction_method, COALESCE((SELECT COUNT(*)::int FROM claim_evidence_links cel WHERE cel.claim_id = c.id), 0) AS evidence_link_count, ROW_NUMBER() OVER (PARTITION BY c.claim_category ORDER BY CASE WHEN c.extraction_method = 'deterministic_insufficient_gate' OR c.claim_text LIKE 'INSUFFICIENT_EVIDENCE%' THEN 0 ELSE 1 END, CASE UPPER(COALESCE(c.materiality::text, '')) WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE CASE WHEN COALESCE(c.materiality::text, '') ~ '^[0-9]+([.][0-9]+)?$' THEN (c.materiality::text)::numeric ELSE 0 END END DESC, COALESCE(c.confidence, 0) DESC, c.created_at ASC) AS rn FROM claims c WHERE c.case_id = $1::uuid AND c.is_active = TRUE), limited AS (SELECT id, claim_category, claim_text, claim_kind, confidence, materiality, extraction_method, evidence_link_count FROM ranked WHERE rn <= 12) SELECT (SELECT COUNT(*)::int FROM claims c WHERE c.case_id = $1::uuid AND c.is_active = TRUE) AS claim_total, COALESCE((SELECT jsonb_agg(to_jsonb(limited) ORDER BY claim_category, id) FROM limited), '[]'::jsonb) AS claims_json",
      options: {
        queryReplacement: expr('{{ $("Validate Report Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadScores = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Scores',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS score_id, case_id, business_quality_score, growth_score, pipeline_score, valuation_context_score, risk_score, evidence_confidence_score, data_freshness_score, research_priority_score, outcome_class, hard_stop FROM scores WHERE case_id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Report Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadScoreComponents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Score Components',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT sc.component_key, sc.parent_score_key, sc.normalized_value, sc.missing FROM score_components sc JOIN scores s ON s.id = sc.score_id WHERE s.case_id = $1::uuid ORDER BY sc.parent_score_key, sc.component_key',
      options: {
        queryReplacement: expr('{{ $("Validate Report Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadReportVersion = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Report Version',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT COALESCE(MAX(version_number), 0) AS max_version FROM research_reports WHERE case_id = $1::uuid',
      options: {
        queryReplacement: expr('{{ $("Validate Report Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
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
        'SELECT id AS configuration_version_id, version_label, gates_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
      options: {
        queryReplacement: '',
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const buildResearchReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Research Report',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildResearchReportCode,
    },
  },
});

const insertResearchReport = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Research Report',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO research_reports (case_id, version_number, report_json, report_markdown, report_html, schema_valid, publication_ready, as_of) VALUES ($1::uuid, $2::int, convert_from(decode($3, 'base64'), 'UTF8')::jsonb, convert_from(decode($4, 'base64'), 'UTF8'), NULLIF(NULLIF(TRIM($5), ''), 'null'), (NULLIF(TRIM($6), '') = 'true'), (NULLIF(TRIM($7), '') = 'true'), NULLIF(NULLIF(TRIM($8), ''), 'null')::timestamptz) RETURNING id AS report_id, case_id, version_number, schema_valid, publication_ready",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.report_version }},{{ $json.report_json_b64 }},{{ $json.report_markdown_b64 }},{{ $json.report_html }},{{ $json.schema_valid_sql }},{{ $json.publication_ready_sql }},{{ $json.as_of }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const restoreAfterInsert = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore Report Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: restoreReportPayloadCode,
    },
  },
});

const clearMonitoringRules = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Clear Seeded Monitoring Rules',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "DELETE FROM monitoring_rules WHERE case_id = $1::uuid AND rule_type = ANY(ARRAY['sec_filings','clinical_trials','financing'])",
      options: {
        queryReplacement: expr(
          '{{ $("Build Research Report").first().json.case_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const restoreAfterClear = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore After Clear Rules',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: restoreAfterClearRulesCode,
    },
  },
});

const insertMonitoringRules = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Monitoring Rules',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO monitoring_rules (case_id, rule_type, description, source_types_json, is_active) SELECT $1::uuid, x.rule_type, x.description, '[]'::jsonb, TRUE FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS x(rule_type text, description text) RETURNING id AS monitoring_rule_id",
      options: {
        queryReplacement: expr(
          '{{ $("Build Research Report").first().json.case_id }},{{ $("Build Research Report").first().json.monitoring_rules_json_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareReportAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Report Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareReportAggregateCode,
    },
  },
});

const advanceCaseState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Advance Case State',
    parameters: {
      operation: 'executeQuery',
      query:
        'UPDATE research_cases SET state = $2, outcome_class = $3, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, outcome_class, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr(
          '{{ $("Build Research Report").first().json.case_id }},{{ $("Build Research Report").first().json.next_state }},{{ $("Build Research Report").first().json.outcome_class }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logReportState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Report State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'AWAITING_HUMAN_REVIEW', $2, $3, 'pii-11', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Prepare Report Aggregate").first().json.reason }},{{ $("Prepare Report Aggregate").first().json.n8n_execution_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-11 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-11', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Prepare Report Aggregate").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Prepare Report Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeReportOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Report Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Prepare Report Aggregate").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Report Aggregate").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Report Aggregate").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Prepare Report Aggregate").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Report Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").first().json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Report Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: expr('{{ $("Advance Case State").first().json.outcome_class }}'),
            type: 'string',
          },
          {
            id: 'schema-valid',
            name: 'schema_valid',
            value: expr('{{ $("Prepare Report Aggregate").first().json.schema_valid }}'),
            type: 'boolean',
          },
          {
            id: 'publication-ready',
            name: 'publication_ready',
            value: expr('{{ $("Prepare Report Aggregate").first().json.publication_ready }}'),
            type: 'boolean',
          },
          {
            id: 'report-id',
            name: 'report_id',
            value: expr('{{ $("Prepare Report Aggregate").first().json.report_id }}'),
            type: 'string',
          },
          {
            id: 'report-version',
            name: 'report_version',
            value: expr('{{ $("Prepare Report Aggregate").first().json.report_version }}'),
            type: 'number',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Prepare Report Aggregate").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Report Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildReportResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Report Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildReportResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-11 Report Generator\nDeterministic JSON + Markdown from claims/scores.\nPersist research_reports + seed monitoring_rules.\nPhase 1 typically stays AWAITING_HUMAN_REVIEW.',
  [reportTrigger, validateReportRequest, buildResearchReport, insertResearchReport],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nresearch_reports, monitoring_rules,\nresearch_cases.state, workflow_runs PII-11',
  [advanceCaseState, logReportState, logWorkflowRun, buildReportResult],
  { color: 5 },
);

export default workflow('pii-11-report', 'PII-11 Report Generator')
  .add(reportTrigger)
  .to(validateReportRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildReportResult))
      .onTrue(
        loadCaseAndCompany
          .to(loadEvidenceDocuments)
          .to(loadClaims)
          .to(loadScores)
          .to(loadScoreComponents)
          .to(loadReportVersion)
          .to(loadAnalysisConfig)
          .to(buildResearchReport)
          .to(insertResearchReport)
          .to(restoreAfterInsert)
          .to(clearMonitoringRules)
          .to(restoreAfterClear)
          .to(insertMonitoringRules)
          .to(prepareReportAggregate)
          .to(advanceCaseState)
          .to(logReportState)
          .to(logWorkflowRun)
          .to(mergeReportOutput)
          .to(buildReportResult),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
