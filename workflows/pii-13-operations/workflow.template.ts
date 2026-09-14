import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateOpsRequestCode = `__VALIDATE_OPS_REQUEST__`;
const evaluateOpsAlertsCode = `__EVALUATE_OPS_ALERTS__`;
const prepareOpsAggregateCode = `__PREPARE_OPS_AGGREGATE__`;
const buildOpsResultCode = `__BUILD_OPS_RESULT__`;

const opsTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Ops Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [{ name: 'lookback_hours', type: 'number' }],
      },
    },
  },
  output: [{}],
});

const validateOpsRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Ops Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateOpsRequestCode,
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
            id: 'reason',
            name: 'reason',
            value: 'validation_failed',
            type: 'string',
          },
          {
            id: 'summary',
            name: 'summary',
            value: 'Ops request validation failed.',
            type: 'string',
          },
          { id: 'alert-count', name: 'alert_count', value: 0, type: 'number' },
          {
            id: 'material-alert-count',
            name: 'material_alert_count',
            value: 0,
            type: 'number',
          },
          {
            id: 'alert-types',
            name: 'alert_types',
            value: expr('{{ ([]) }}'),
            type: 'array',
          },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
      },
    },
  },
});

const loadOpsConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Ops Config',
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

const loadHealthSnapshot = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Health Snapshot',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('case_id', id, 'ticker', ticker, 'exchange', exchange, 'state', state, 'outcome_class', outcome_class, 'updated_at', updated_at, 'budget_usd_limit', budget_usd_limit, 'budget_usd_actual', budget_usd_actual) ORDER BY updated_at ASC) FROM (SELECT id, ticker, exchange, state, outcome_class, updated_at, budget_usd_limit, budget_usd_actual FROM research_cases WHERE state NOT IN ('COMPLETE', 'INCOMPLETE', 'FAILED', 'SUPERSEDED') ORDER BY updated_at ASC LIMIT 100) c), '[]'::jsonb) AS cases_json, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'case_id', case_id, 'workflow_key', workflow_key, 'status', status, 'error_summary', LEFT(COALESCE(error_summary, ''), 400), 'started_at', started_at, 'finished_at', finished_at, 'created_at', created_at) ORDER BY created_at DESC) FROM (SELECT id, case_id, workflow_key, status, error_summary, started_at, finished_at, created_at FROM workflow_runs WHERE UPPER(status) IN ('FAILED', 'ERROR') AND created_at > NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 100) w), '[]'::jsonb) AS failed_runs_json, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'case_id', case_id, 'workflow_key', workflow_key, 'error_class', error_class, 'error_summary', LEFT(COALESCE(error_summary, ''), 400), 'created_at', created_at) ORDER BY created_at ASC) FROM (SELECT id, case_id, workflow_key, error_class, error_summary, created_at FROM dead_letter_items WHERE resolved = FALSE ORDER BY created_at ASC LIMIT 100) d), '[]'::jsonb) AS dead_letters_json",
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

const evaluateOpsAlerts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Ops Alerts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateOpsAlertsCode,
    },
  },
});

const hasAlerts = ifElse({
  version: 2.3,
  config: {
    name: 'Has Alerts?',
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
            leftValue: expr('{{ $json.has_alerts }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertOpsAlerts = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Ops Alerts',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO ops_alerts (case_id, workflow_key, alert_type, severity, dedupe_key, title, detail, payload_json, status) SELECT NULLIF(NULLIF(TRIM(x.case_id), ''), 'null')::uuid, NULLIF(NULLIF(TRIM(x.workflow_key), ''), 'null'), x.alert_type, x.severity, x.dedupe_key, x.title, x.detail, COALESCE(x.payload_json, '{}'::jsonb), COALESCE(NULLIF(TRIM(x.status), ''), 'OPEN') FROM jsonb_to_recordset(convert_from(decode($1, 'base64'), 'UTF8')::jsonb) AS x(case_id text, workflow_key text, alert_type text, severity text, dedupe_key text, title text, detail text, payload_json jsonb, status text) WHERE NOT EXISTS (SELECT 1 FROM ops_alerts oa WHERE oa.dedupe_key = x.dedupe_key) RETURNING id AS ops_alert_id",
      options: {
        queryReplacement: expr('{{ $json.alerts_json_b64 }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareOpsAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Ops Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareOpsAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-13 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, finished_at, metadata_json) VALUES (NULL, 'PII-13', $1, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, 'SUCCEEDED', NOW(), convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Ops Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Ops Aggregate").first().json.ops_run_id }},{{ $("Prepare Ops Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeOpsOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Ops Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'summary',
            name: 'summary',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.summary }}'),
            type: 'string',
          },
          {
            id: 'alert-count',
            name: 'alert_count',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.alert_count }}'),
            type: 'number',
          },
          {
            id: 'material-alert-count',
            name: 'material_alert_count',
            value: expr(
              '{{ $("Prepare Ops Aggregate").first().json.material_alert_count }}',
            ),
            type: 'number',
          },
          {
            id: 'alert-types',
            name: 'alert_types',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.alert_types }}'),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildOpsResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Ops Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildOpsResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-13 Operations\nDB-only health scan: stuck/stale cases,\nfailed runs, DLQ, budget overruns.\nNo external delivery in Phase 1.',
  [opsTrigger, validateOpsRequest, evaluateOpsAlerts],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nops_alerts upsert-by-dedupe,\nworkflow_runs PII-13. Case state unchanged.',
  [insertOpsAlerts, logWorkflowRun, buildOpsResult],
  { color: 5 },
);

export default workflow('pii-13-operations', 'PII-13 Operations and Alerts')
  .add(opsTrigger)
  .to(validateOpsRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildOpsResult))
      .onTrue(
        loadOpsConfig
          .to(loadHealthSnapshot)
          .to(evaluateOpsAlerts)
          .to(
            hasAlerts
              .onTrue(
                insertOpsAlerts
                  .to(prepareOpsAggregate)
                  .to(logWorkflowRun)
                  .to(mergeOpsOutput)
                  .to(buildOpsResult),
              )
              .onFalse(
                prepareOpsAggregate
                  .to(logWorkflowRun)
                  .to(mergeOpsOutput)
                  .to(buildOpsResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
