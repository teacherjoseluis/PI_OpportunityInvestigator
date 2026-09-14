import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateEmailRequestCode = `__VALIDATE_EMAIL_REQUEST__`;
const evaluateEmailDeliveryCode = `__EVALUATE_EMAIL_DELIVERY__`;
const prepareEmailAggregateCode = `__PREPARE_EMAIL_AGGREGATE__`;
const buildEmailResultCode = `__BUILD_EMAIL_RESULT__`;

const emailTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Email Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'mode', type: 'string' },
          { name: 'recipient', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      mode: 'TEST_DELIVERY',
    },
  ],
});

const validateEmailRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Email Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateEmailRequestCode,
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
            id: 'delivery-status',
            name: 'delivery_status',
            value: 'FAILED',
            type: 'string',
          },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
      },
    },
  },
});

const loadEmailConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Email Config',
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

const loadCaseAndLatestReport = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Latest Report',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT rc.id AS case_id, rc.ticker, rc.exchange, rc.state AS case_state, rc.outcome_class, rc.company_id, c.legal_name, rr.id AS report_id, rr.version_number, rr.schema_valid, rr.publication_ready, rr.as_of, rr.report_json->'executive_brief' AS executive_brief, rr.report_json->'outcome' AS outcome_json, rr.report_json->'scores' AS scores_json, rr.report_json->'monitoring_plan' AS monitoring_plan, rr.report_json->'contradictions_unresolved' AS unresolved_json, rr.report_json->'business_financial' AS business_json, rr.report_json->'growth' AS growth_json, rr.report_json->'pipeline' AS pipeline_json, rr.report_json->'risks' AS risks_json, LEFT(COALESCE(rr.report_markdown, ''), 20000) AS report_markdown_preview FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id LEFT JOIN LATERAL (SELECT id, version_number, schema_valid, publication_ready, as_of, report_json, report_markdown FROM research_reports r WHERE r.case_id = rc.id ORDER BY version_number DESC LIMIT 1) rr ON TRUE WHERE rc.id = $1::uuid LIMIT 1",
      options: {
        queryReplacement: expr('{{ $("Validate Email Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadPriorDeliveries = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Prior Deliveries',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'dedupe_key', dedupe_key, 'status', status, 'delivery_type', delivery_type, 'sent_at', sent_at) ORDER BY created_at DESC), '[]'::jsonb) AS deliveries_json FROM (SELECT id, dedupe_key, status, delivery_type, sent_at, created_at FROM email_deliveries WHERE case_id = $1::uuid ORDER BY created_at DESC LIMIT 20) e",
      options: {
        queryReplacement: expr('{{ $("Validate Email Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const evaluateEmailDelivery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Email Delivery',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateEmailDeliveryCode,
    },
  },
});

const shouldSend = ifElse({
  version: 2.3,
  config: {
    name: 'Should Send?',
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
            leftValue: expr('{{ $json.should_send }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const sendInvestigationEmail = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Send Investigation Email',
    parameters: {
      fromEmail: expr('{{ $json.from_email }}'),
      toEmail: expr('{{ $json.recipient }}'),
      subject: expr('{{ $json.subject }}'),
      emailFormat: 'both',
      text: expr('{{ $json.text_body }}'),
      html: expr('{{ $json.html_body }}'),
      options: {
        appendAttribution: false,
      },
    },
    credentials: {
      smtp: newCredential('SMTP account'),
    },
  },
});

const insertEmailDelivery = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Email Delivery',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO email_deliveries (case_id, report_id, delivery_type, recipient, subject, status, dedupe_key, sent_at, error_summary) SELECT NULLIF(NULLIF(TRIM(x.case_id), ''), 'null')::uuid, NULLIF(NULLIF(TRIM(x.report_id), ''), 'null')::uuid, x.delivery_type, x.recipient, x.subject, x.status, x.dedupe_key, CASE WHEN UPPER(x.status) = 'SENT' THEN NOW() ELSE NULL END, x.error_summary FROM jsonb_to_recordset(convert_from(decode($1, 'base64'), 'UTF8')::jsonb) AS x(case_id text, report_id text, delivery_type text, recipient text, subject text, status text, dedupe_key text, error_summary text) WHERE NOT EXISTS (SELECT 1 FROM email_deliveries ed WHERE ed.dedupe_key = x.dedupe_key AND UPPER(ed.status) = 'SENT') RETURNING id AS email_delivery_id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Email Delivery").first().json.delivery_json_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareEmailAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Email Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEmailAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-14 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, finished_at, metadata_json) VALUES (NULLIF(NULLIF(TRIM($1), ''), 'null')::uuid, 'PII-14', $2, NULLIF(NULLIF(TRIM($1), ''), 'null')::uuid, 'SUCCEEDED', NOW(), convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Email Aggregate").first().json.case_id }},{{ $("Prepare Email Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Email Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeEmailOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Email Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Prepare Email Aggregate").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Email Aggregate").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Email Aggregate").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'mode',
            name: 'mode',
            value: expr('{{ $("Prepare Email Aggregate").first().json.mode }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Email Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Email Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'delivery-type',
            name: 'delivery_type',
            value: expr('{{ $("Prepare Email Aggregate").first().json.delivery_type }}'),
            type: 'string',
          },
          {
            id: 'delivery-status',
            name: 'delivery_status',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.delivery_status }}',
            ),
            type: 'string',
          },
          {
            id: 'report-id',
            name: 'report_id',
            value: expr('{{ $("Prepare Email Aggregate").first().json.report_id }}'),
            type: 'string',
          },
          {
            id: 'report-version',
            name: 'report_version',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.report_version }}',
            ),
            type: 'number',
          },
          {
            id: 'recipient',
            name: 'recipient',
            value: expr('{{ $("Prepare Email Aggregate").first().json.recipient }}'),
            type: 'string',
          },
          {
            id: 'subject',
            name: 'subject',
            value: expr('{{ $("Prepare Email Aggregate").first().json.subject }}'),
            type: 'string',
          },
          {
            id: 'schema-valid',
            name: 'schema_valid',
            value: expr('{{ $("Prepare Email Aggregate").first().json.schema_valid }}'),
            type: 'boolean',
          },
          {
            id: 'publication-ready',
            name: 'publication_ready',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.publication_ready }}',
            ),
            type: 'boolean',
          },
          {
            id: 'gates-blocking',
            name: 'gates_blocking',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.gates_blocking }}',
            ),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Email Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildEmailResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Email Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildEmailResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-14 Email Delivery\nTEST_DELIVERY drafts + gated production sends.\nSMTP account → teacherjoseluis@gmail.com.\nWeekly digest deferred.',
  [emailTrigger, validateEmailRequest, evaluateEmailDelivery],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nemail_deliveries + workflow_runs PII-14.\nCase state unchanged.',
  [sendInvestigationEmail, insertEmailDelivery, logWorkflowRun],
  { color: 5 },
);

export default workflow('pii-14-email-delivery', 'PII-14 Email Digest and Report Delivery')
  .add(emailTrigger)
  .to(validateEmailRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildEmailResult))
      .onTrue(
        loadEmailConfig
          .to(loadCaseAndLatestReport)
          .to(loadPriorDeliveries)
          .to(evaluateEmailDelivery)
          .to(
            shouldSend
              .onTrue(
                sendInvestigationEmail
                  .to(insertEmailDelivery)
                  .to(prepareEmailAggregate)
                  .to(logWorkflowRun)
                  .to(mergeEmailOutput)
                  .to(buildEmailResult),
              )
              .onFalse(
                insertEmailDelivery
                  .to(prepareEmailAggregate)
                  .to(logWorkflowRun)
                  .to(mergeEmailOutput)
                  .to(buildEmailResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
