import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateMonitoringRequestCode = `__VALIDATE_MONITORING_REQUEST__`;
const evaluateMonitoringSignalsCode = `__EVALUATE_MONITORING_SIGNALS__`;
const prepareMonitoringAggregateCode = `__PREPARE_MONITORING_AGGREGATE__`;
const buildMonitoringResultCode = `__BUILD_MONITORING_RESULT__`;

const monitoringTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Monitoring Trigger',
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

const validateMonitoringRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Monitoring Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateMonitoringRequestCode,
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
          {
            id: 'next-state',
            name: 'next_state',
            value: 'INCOMPLETE',
            type: 'string',
          },
          { id: 'reason', name: 'reason', value: 'validation_failed', type: 'string' },
          { id: 'event-count', name: 'event_count', value: 0, type: 'number' },
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, rc.outcome_class, rc.configuration_version_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadMonitoringRules = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Monitoring Rules',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'rule_type', rule_type, 'description', LEFT(COALESCE(description, ''), 240), 'is_active', is_active, 'expected_date', expected_date, 'refresh_sections_json', refresh_sections_json) ORDER BY created_at ASC), '[]'::jsonb) AS rules_json FROM monitoring_rules WHERE case_id = $1::uuid AND is_active = TRUE",
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadLatestReport = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Latest Report',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS report_id, version_number, as_of, schema_valid, publication_ready FROM research_reports WHERE case_id = $1::uuid ORDER BY version_number DESC LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadEvidenceFingerprints = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Evidence Fingerprints',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'source_type', source_type, 'stable_source_id', stable_source_id, 'publication_date', publication_date, 'metadata_json', metadata_json) ORDER BY created_at ASC), '[]'::jsonb) AS evidence_json FROM (SELECT id, source_type, stable_source_id, publication_date, metadata_json, created_at FROM evidence_documents WHERE case_id = $1::uuid ORDER BY created_at DESC LIMIT 80) e",
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadMonitoringConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Monitoring Config',
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

const fetchSecSubmissions = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch SEC Submissions',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: expr(
        '=https://data.sec.gov/submissions/CIK{{ $("Load Case And Company").item.json.cik }}.json',
      ),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
          { name: 'Accept', value: 'application/json' },
          { name: 'Accept-Encoding', value: 'gzip, deflate' },
        ],
      },
      options: {
        timeout: 60000,
        lowercaseHeaders: false,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const fetchCtgovStudies = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch CT.gov Studies',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://clinicaltrials.gov/api/v2/studies',
      authentication: 'none',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'query.spons',
            value: expr('{{ $("Load Case And Company").item.json.legal_name }}'),
          },
          {
            name: 'pageSize',
            value: expr(
              '{{ $("Load Monitoring Config").item.json.gates_json.monitoring.ctgov_page_size || 20 }}',
            ),
          },
          { name: 'format', value: 'json' },
        ],
      },
      options: {
        timeout: 60000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const evaluateMonitoringSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Monitoring Signals',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateMonitoringSignalsCode,
    },
  },
});

const hasEvents = ifElse({
  version: 2.3,
  config: {
    name: 'Has Events?',
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
            leftValue: expr('{{ $json.has_events }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertDetectedEvents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Detected Events',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO detected_events (case_id, company_id, event_type, event_date, materiality, dedupe_key, verified, source_evidence_ids, change_memo) SELECT $1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, x.event_type, NULLIF(NULLIF(TRIM(x.event_date), ''), 'null')::date, x.materiality, x.dedupe_key, COALESCE(x.verified, false), COALESCE(x.source_evidence_ids, '[]'::jsonb), x.change_memo FROM jsonb_to_recordset(convert_from(decode($3, 'base64'), 'UTF8')::jsonb) AS x(event_type text, event_date text, materiality text, dedupe_key text, verified boolean, source_evidence_ids jsonb, change_memo text) WHERE NOT EXISTS (SELECT 1 FROM detected_events de WHERE de.dedupe_key = x.dedupe_key) RETURNING id AS detected_event_id",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.events_json_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareMonitoringAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Monitoring Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareMonitoringAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-12 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-12', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Monitoring Aggregate").first().json.case_id }},{{ $("Prepare Monitoring Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Monitoring Aggregate").first().json.case_id }},{{ $("Prepare Monitoring Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeMonitoringOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Monitoring Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.next_state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.outcome_class }}'),
            type: 'string',
          },
          {
            id: 'as-of-baseline',
            name: 'as_of_baseline',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.as_of_baseline }}'),
            type: 'string',
          },
          {
            id: 'event-count',
            name: 'event_count',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.event_count }}'),
            type: 'number',
          },
          {
            id: 'material-event-count',
            name: 'material_event_count',
            value: expr(
              '{{ $("Prepare Monitoring Aggregate").first().json.material_event_count }}',
            ),
            type: 'number',
          },
          {
            id: 'matched-rule-types',
            name: 'matched_rule_types',
            value: expr(
              '{{ $("Prepare Monitoring Aggregate").first().json.matched_rule_types }}',
            ),
            type: 'array',
          },
          {
            id: 'change-memo',
            name: 'change_memo',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.change_memo }}'),
            type: 'string',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildMonitoringResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Monitoring Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildMonitoringResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-12 Monitoring\nPoll SEC + CT.gov vs last report as_of.\nPersist detected_events + change memo.\nPhase 1: no auto re-analysis.',
  [monitoringTrigger, validateMonitoringRequest, evaluateMonitoringSignals],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\ndetected_events upsert-by-dedupe,\nworkflow_runs PII-12. Case state unchanged.',
  [insertDetectedEvents, logWorkflowRun, buildMonitoringResult],
  { color: 5 },
);

export default workflow('pii-12-monitoring', 'PII-12 Monitoring and Reassessment')
  .add(monitoringTrigger)
  .to(validateMonitoringRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildMonitoringResult))
      .onTrue(
        loadCaseAndCompany
          .to(loadMonitoringRules)
          .to(loadLatestReport)
          .to(loadEvidenceFingerprints)
          .to(loadMonitoringConfig)
          .to(fetchSecSubmissions)
          .to(fetchCtgovStudies)
          .to(evaluateMonitoringSignals)
          .to(
            hasEvents
              .onTrue(
                insertDetectedEvents
                  .to(prepareMonitoringAggregate)
                  .to(logWorkflowRun)
                  .to(mergeMonitoringOutput)
                  .to(buildMonitoringResult),
              )
              .onFalse(
                prepareMonitoringAggregate
                  .to(logWorkflowRun)
                  .to(mergeMonitoringOutput)
                  .to(buildMonitoringResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
