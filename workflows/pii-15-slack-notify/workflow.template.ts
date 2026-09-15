import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateSlackNotifyRequestCode = `__VALIDATE_SLACK_NOTIFY_REQUEST__`;
const evaluateSlackNotifyCode = `__EVALUATE_SLACK_NOTIFY__`;
const prepareSlackNotifyAggregateCode = `__PREPARE_SLACK_NOTIFY_AGGREGATE__`;
const buildSlackNotifyResultCode = `__BUILD_SLACK_NOTIFY_RESULT__`;

const slackNotifyTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Slack Notify Trigger',
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
      case_id: 'a732aa53-a065-4682-b062-5173e2e4f88d',
      ticker: 'REGN',
      exchange: 'NASDAQ',
    },
  ],
});

const validateSlackNotifyRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Slack Notify Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateSlackNotifyRequestCode,
    },
  },
  output: [
    {
      valid: true,
      case_id: 'a732aa53-a065-4682-b062-5173e2e4f88d',
      ticker: 'REGN',
      exchange: 'NASDAQ',
      n8n_execution_id: '1',
    },
  ],
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
  output: [
    {
      outcome: 'FAILED',
      reason: 'validation_failed',
      delivery_status: 'FAILED',
      counts: {},
    },
  ],
});

const loadSlackNotifyConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Slack Notify Config',
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
  output: [
    {
      configuration_version_id: '00000000-0000-4000-8000-000000000001',
      version_label: 'v1',
      gates_json: {
        slack_notify: {
          enabled: true,
          notify_on_report_draft: true,
        },
      },
    },
  ],
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
        "SELECT rc.id AS case_id, rc.ticker, rc.exchange, rc.state AS case_state, rc.outcome_class, rc.company_id, rc.request_context_json, c.legal_name, rr.id AS report_id, rr.version_number, rr.schema_valid, rr.publication_ready, rr.as_of, rr.report_json->'outcome' AS outcome_json, rr.report_json->'scores' AS scores_json FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id LEFT JOIN LATERAL (SELECT id, version_number, schema_valid, publication_ready, as_of, report_json FROM research_reports r WHERE r.case_id = rc.id ORDER BY version_number DESC LIMIT 1) rr ON TRUE WHERE rc.id = $1::uuid LIMIT 1",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Slack Notify Request").item.json.case_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [
    {
      case_id: 'a732aa53-a065-4682-b062-5173e2e4f88d',
      ticker: 'REGN',
      exchange: 'NASDAQ',
      case_state: 'AWAITING_HUMAN_REVIEW',
      outcome_class: 'MONITOR',
      request_context_json: {
        source: 'slack',
        slack: { user_id: 'U00000000', channel_id: 'C00000000', user_name: 'joseluis' },
      },
      report_id: '11111111-1111-4111-8111-111111111111',
      version_number: 1,
      schema_valid: true,
      publication_ready: false,
      scores_json: { growth_score: 55 },
      outcome_json: { gates_blocking: ['cash_debt_from_filing'] },
    },
  ],
});

const loadPriorSlackDeliveries = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Prior Slack Deliveries',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'dedupe_key', dedupe_key, 'status', status, 'delivery_type', delivery_type, 'sent_at', sent_at) ORDER BY created_at DESC), '[]'::jsonb) AS deliveries_json FROM (SELECT id, dedupe_key, status, delivery_type, sent_at, created_at FROM slack_deliveries WHERE case_id = $1::uuid ORDER BY created_at DESC LIMIT 20) e",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Slack Notify Request").item.json.case_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [
    {
      deliveries_json: [],
    },
  ],
});

const evaluateSlackNotify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Slack Notify',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateSlackNotifyCode,
    },
  },
  output: [
    {
      should_send: true,
      outcome: 'SENT',
      recipient: 'U00000000',
      message_text: 'PII investigation complete — REGN',
      delivery_json_b64: '',
      metadata_b64: '',
    },
  ],
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

const sendSlackCompletionDm = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Send Slack Completion DM',
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'post',
      authentication: 'accessToken',
      select: 'user',
      user: {
        __rl: true,
        mode: 'id',
        value: expr('{{ $json.recipient }}'),
      },
      messageType: 'text',
      text: expr('{{ $json.message_text }}'),
      otherOptions: {
        includeLinkToWorkflow: false,
        mrkdwn: true,
        ephemeral: false,
      },
    },
    credentials: {
      slackApi: newCredential('Slack PII bot'),
    },
  },
  output: [
    {
      ok: true,
      ts: '1234567890.123456',
    },
  ],
});

const insertSlackDelivery = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Slack Delivery',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO slack_deliveries (case_id, report_id, delivery_type, recipient, channel_id, subject, text_preview, status, dedupe_key, sent_at, error_summary) SELECT NULLIF(NULLIF(TRIM(x.case_id), ''), 'null')::uuid, NULLIF(NULLIF(TRIM(x.report_id), ''), 'null')::uuid, x.delivery_type, x.recipient, NULLIF(NULLIF(TRIM(x.channel_id), ''), 'null'), x.subject, x.text_preview, x.status, x.dedupe_key, CASE WHEN UPPER(x.status) = 'SENT' THEN NOW() ELSE NULL END, x.error_summary FROM jsonb_to_recordset(convert_from(decode($1, 'base64'), 'UTF8')::jsonb) AS x(case_id text, report_id text, delivery_type text, recipient text, channel_id text, subject text, text_preview text, status text, dedupe_key text, error_summary text) WHERE NOT EXISTS (SELECT 1 FROM slack_deliveries sd WHERE sd.dedupe_key = x.dedupe_key AND UPPER(sd.status) = 'SENT') RETURNING id AS slack_delivery_id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Slack Notify").first().json.delivery_json_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [
    {
      slack_delivery_id: '22222222-2222-4222-8222-222222222222',
    },
  ],
});

const prepareSlackNotifyAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Slack Notify Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareSlackNotifyAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-15 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, finished_at, metadata_json) VALUES (NULLIF(NULLIF(TRIM($1), ''), 'null')::uuid, 'PII-15', $2, NULLIF(NULLIF(TRIM($1), ''), 'null')::uuid, 'SUCCEEDED', NOW(), convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Slack Notify Aggregate").first().json.case_id }},{{ $("Prepare Slack Notify Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Slack Notify Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeSlackNotifyOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Slack Notify Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Prepare Slack Notify Aggregate").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Slack Notify Aggregate").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.exchange }}',
            ),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Slack Notify Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Slack Notify Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'delivery-type',
            name: 'delivery_type',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.delivery_type }}',
            ),
            type: 'string',
          },
          {
            id: 'delivery-status',
            name: 'delivery_status',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.delivery_status }}',
            ),
            type: 'string',
          },
          {
            id: 'report-id',
            name: 'report_id',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.report_id }}',
            ),
            type: 'string',
          },
          {
            id: 'report-version',
            name: 'report_version',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.report_version }}',
            ),
            type: 'number',
          },
          {
            id: 'recipient',
            name: 'recipient',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.recipient }}',
            ),
            type: 'string',
          },
          {
            id: 'subject',
            name: 'subject',
            value: expr('{{ $("Prepare Slack Notify Aggregate").first().json.subject }}'),
            type: 'string',
          },
          {
            id: 'provider-ts',
            name: 'provider_message_ts',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.provider_message_ts }}',
            ),
            type: 'string',
          },
          {
            id: 'schema-valid',
            name: 'schema_valid',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.schema_valid }}',
            ),
            type: 'boolean',
          },
          {
            id: 'publication-ready',
            name: 'publication_ready',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.publication_ready }}',
            ),
            type: 'boolean',
          },
          {
            id: 'gates-blocking',
            name: 'gates_blocking',
            value: expr(
              '{{ $("Prepare Slack Notify Aggregate").first().json.gates_blocking }}',
            ),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Slack Notify Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildSlackNotifyResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Slack Notify Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildSlackNotifyResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-15 Slack Notify\nDM completion after PII-11 when request_context.slack.user_id is present.\nCredential: Slack PII bot. Case state unchanged.',
  [slackNotifyTrigger, validateSlackNotifyRequest, evaluateSlackNotify],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nslack_deliveries + workflow_runs PII-15.\nDedupe by case + report version + COMPLETION.',
  [sendSlackCompletionDm, insertSlackDelivery, logWorkflowRun],
  { color: 5 },
);

export default workflow('pii-15-slack-notify', 'PII-15 Slack Completion Notify')
  .add(slackNotifyTrigger)
  .to(validateSlackNotifyRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildSlackNotifyResult))
      .onTrue(
        loadSlackNotifyConfig
          .to(loadCaseAndLatestReport)
          .to(loadPriorSlackDeliveries)
          .to(evaluateSlackNotify)
          .to(
            shouldSend
              .onTrue(
                sendSlackCompletionDm
                  .to(insertSlackDelivery)
                  .to(prepareSlackNotifyAggregate)
                  .to(logWorkflowRun)
                  .to(mergeSlackNotifyOutput)
                  .to(buildSlackNotifyResult),
              )
              .onFalse(
                insertSlackDelivery
                  .to(prepareSlackNotifyAggregate)
                  .to(logWorkflowRun)
                  .to(mergeSlackNotifyOutput)
                  .to(buildSlackNotifyResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
