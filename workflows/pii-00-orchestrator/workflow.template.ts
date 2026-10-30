import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  merge,
  expr,
} from '@n8n/workflow-sdk';

const validateInvestigationRequestCode = `__VALIDATE_INVESTIGATION_REQUEST__`;

const buildAckResponseCode = `__BUILD_ACK_RESPONSE__`;
const planAgentTasksCode = `__PLAN_AGENT_TASKS__`;

const investigationWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Investigation Request Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'pii/investigate',
      responseMode: 'responseNode',
      authentication: 'headerAuth',
      options: {},
    },
    credentials: {
      httpHeaderAuth: newCredential('PII Webhook Header Auth'),
    },
  },
  output: [
    {
      body: {
        ticker: 'ACAD',
        exchange: 'NASDAQ',
        research_question: 'Does the current evidence justify deeper research?',
        mode: 'FULL',
        requested_by: 'user',
        configuration_version: 'v1',
        force_refresh: false,
      },
      headers: {},
      params: {},
      query: {},
    },
  ],
});

const validateInvestigationRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Investigation Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateInvestigationRequestCode,
    },
  },
  output: [
    {
      valid: true,
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
      research_question: 'Does the current evidence justify deeper research?',
      mode: 'FULL',
      requested_by: 'user',
      as_of_date: null,
      configuration_version: 'v1',
      force_refresh: false,
      correlation_id: '550e8400-e29b-41d4-a716-446655440000',
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

const respondValidationError = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Validation Error',
    parameters: {
      respondWith: 'json',
      responseBody: expr(
        '{{ { "error": "validation_failed", "details": $json.errors } }}',
      ),
      options: {
        responseCode: 400,
      },
    },
  },
});

const lookupExistingCase = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Lookup Existing Case',
    // Required so "Case Already Exists?" runs when the SELECT returns 0 rows.
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS case_id, request_id, ticker, state, false AS created FROM research_cases WHERE request_id = $1 LIMIT 1',
      options: {
        queryReplacement: expr(
          '{{ $("Validate Investigation Request").item.json.request_id }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [],
});

const caseAlreadyExists = ifElse({
  version: 2.3,
  config: {
    name: 'Case Already Exists?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.case_id }}'),
            operator: { type: 'string', operation: 'exists' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertResearchCase = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Research Case',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO research_cases (request_id, ticker, exchange, research_question, mode, state, requested_by, as_of_date, force_refresh, configuration_version_id, request_context_json) SELECT $1, $2, $3, NULLIF(NULLIF(TRIM($4), ''), 'null'), $5, 'REQUESTED', $6, NULLIF(NULLIF(TRIM($7), ''), 'null')::date, $8, cv.id, COALESCE(convert_from(decode(NULLIF(NULLIF(TRIM($10), ''), 'null'), 'base64'), 'UTF8')::jsonb, '{}'::jsonb) FROM configuration_versions cv WHERE cv.version_label = $9 AND cv.is_active = true LIMIT 1 RETURNING id AS case_id, request_id, ticker, state, true AS created",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Investigation Request").item.json.request_id }},{{ $("Validate Investigation Request").item.json.ticker }},{{ $("Validate Investigation Request").item.json.exchange }},{{ $("Validate Investigation Request").item.json.research_question }},{{ $("Validate Investigation Request").item.json.mode }},{{ $("Validate Investigation Request").item.json.requested_by }},{{ $("Validate Investigation Request").item.json.as_of_date }},{{ $("Validate Investigation Request").item.json.force_refresh }},{{ $("Validate Investigation Request").item.json.configuration_version }},{{ $("Validate Investigation Request").item.json.request_context_b64 }}',
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
      case_id: '660e8400-e29b-41d4-a716-446655440001',
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      ticker: 'ACAD',
      state: 'REQUESTED',
      created: true,
    },
  ],
});

const logCaseCreatedState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Case Created State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1, NULL, 'REQUESTED', 'Case created from investigation request', 'pii-00', $2)",
      options: {
        queryReplacement: expr(
          '{{ $("Insert Research Case").item.json.case_id }},{{ $("Validate Investigation Request").item.json.n8n_execution_id }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [{ case_id: '660e8400-e29b-41d4-a716-446655440001' }],
});

const logWorkflowRunStart = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Workflow Run Start',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1, 'PII-00', $2, $3, 'STARTED', $4::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Insert Research Case").item.json.case_id }},{{ $("Validate Investigation Request").item.json.n8n_execution_id }},{{ $("Validate Investigation Request").item.json.correlation_id }},{{ JSON.stringify({ ticker: $("Validate Investigation Request").item.json.ticker, mode: $("Validate Investigation Request").item.json.mode }) }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [{ workflow_run_id: '770e8400-e29b-41d4-a716-446655440002' }],
});


const planAgentTasks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Agent Tasks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: planAgentTasksCode,
    },
  },
});

const persistAgentTasks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Persist Agent Tasks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH planned AS (SELECT convert_from(decode($4, 'base64'), 'UTF8')::jsonb AS tasks), updated AS (UPDATE research_cases SET supervisor_cursor = jsonb_build_object('graph_hash', $2, 'mode', $3, 'shadow_plan_only', $5 = 'true', 'canvas_executes', $6) WHERE id = $1::uuid RETURNING id) INSERT INTO agent_tasks (case_id, agent_key, status, wave, depends_on_keys, mandatory, objective, provider, graph_hash, shadow, input_json) SELECT $1::uuid, elem->>'agent_key', COALESCE(elem->>'status', 'BLOCKED'), elem->>'wave', COALESCE(ARRAY(SELECT jsonb_array_elements_text(elem->'depends_on')), ARRAY[]::text[]), COALESCE((elem->>'mandatory')::boolean, true), elem->>'objective', NULLIF(elem->>'provider', ''), $2, $5 = 'true', '{}'::jsonb FROM updated, planned, LATERAL jsonb_array_elements(planned.tasks) elem RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Insert Research Case").item.json.case_id }},{{ $("Plan Agent Tasks").item.json.graph_hash }},{{ $("Plan Agent Tasks").item.json.mode }},{{ $("Plan Agent Tasks").item.json.plan_b64 }},{{ $("Plan Agent Tasks").item.json.shadow_plan_only }},{{ $("Plan Agent Tasks").item.json.canvas_executes }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const executePii03Mkt = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03-MKT Market Collector',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'EE1ZJNOJcULErIOJ',
        cachedResultName: 'PII-03-MKT Market Data Collector',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii16Technical = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-16 Technical Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'Lwyh7GEDocAaj0V8',
        cachedResultName: 'PII-16 Technical and Market Behavior Analyst',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          focus: expr('{{ "full" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'focus', displayName: 'focus', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const technicalAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Technical Advanced To Analyzing?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareExistingCaseAck = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Existing Case Ack',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'created-flag',
            name: 'created',
            value: false,
            type: 'boolean',
          },
        ],
      },
    },
  },
  output: [
    {
      case_id: '660e8400-e29b-41d4-a716-446655440001',
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      ticker: 'ACAD',
      state: 'REQUESTED',
      created: false,
    },
  ],
});

const prepareNewCaseAck = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare New Case Ack',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Insert Research Case").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'request-id',
            name: 'request_id',
            value: expr('{{ $("Insert Research Case").item.json.request_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Insert Research Case").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'state',
            name: 'state',
            value: expr('{{ $("Insert Research Case").item.json.state }}'),
            type: 'string',
          },
          {
            id: 'created-flag',
            name: 'created',
            value: true,
            type: 'boolean',
          },
        ],
      },
    },
  },
  output: [
    {
      case_id: '660e8400-e29b-41d4-a716-446655440001',
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      ticker: 'ACAD',
      state: 'REQUESTED',
      created: true,
    },
  ],
});

const buildAckResponse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Ack Response',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildAckResponseCode,
    },
  },
  output: [
    {
      case_id: '660e8400-e29b-41d4-a716-446655440001',
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      ticker: 'ACAD',
      state: 'REQUESTED',
      created: true,
      message: 'Investigation case created. Processing continues asynchronously.',
      as_of: '2026-09-02T00:00:00.000Z',
    },
  ],
});

const respondAccepted = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Accepted',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ $json }}'),
      options: {
        responseCode: 202,
      },
    },
  },
});

const advanceToIdentityReview = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Advance To Identity Review',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE research_cases SET state = 'IDENTITY_REVIEW', updated_at = NOW() WHERE id = $1 AND state = 'REQUESTED' RETURNING id AS case_id, state",
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }}'),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [{ case_id: '660e8400-e29b-41d4-a716-446655440001', state: 'IDENTITY_REVIEW' }],
});

const logIdentityReviewState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Identity Review State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1, 'REQUESTED', 'IDENTITY_REVIEW', 'Orchestrator advancing to identity resolution', 'pii-00', $2)",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $("Validate Investigation Request").item.json.n8n_execution_id }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [{ case_id: '660e8400-e29b-41d4-a716-446655440001' }],
});

const executePii01Identity = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-01 Identity Resolver',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'Xf6DjDUMyfOyNX3G',
        cachedResultName: 'PII-01 Identity Resolver',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Advance To Identity Review").item.json.case_id }}'),
          ticker: expr('{{ $("Validate Investigation Request").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const executePii02Eligibility = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-02 Eligibility Gate',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'hqgFoP7ny6jnycxx',
        cachedResultName: 'PII-02 Eligibility Gate',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Execute PII-01 Identity Resolver").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-01 Identity Resolver").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-01 Identity Resolver").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const eligibilityAdvancedToCollecting = ifElse({
  version: 2.3,
  config: {
    name: 'Eligibility Advanced To Collecting?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'COLLECTING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii03Evidence = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 Evidence Collector',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'Uo5s0TUOFVMQywQX',
        cachedResultName: 'PII-03 Evidence Collector',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const evidenceAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Evidence Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii04Financial = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-04 Financial Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'RvIlyuDV0MEsXezL',
        cachedResultName: 'PII-04 Financial and Business Analyst',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const financialAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Financial Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii05Growth = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-05 Growth Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'sdamxDo9SUdo4QxC',
        cachedResultName: 'PII-05 Growth Analyst',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const growthAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Growth Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii06Pipeline = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-06 Pipeline Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'b8CxYW8T8FrGl62x',
        cachedResultName: 'PII-06 Pipeline and Clinical Analyst',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const pipelineAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Pipeline Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii07Regulatory = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-07 Regulatory Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '4AqBDr5hjZeMLy99',
        cachedResultName: 'PII-07 Regulatory and Catalyst Analyst',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const regulatoryAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Regulatory Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii08Valuation = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-08 Valuation Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '1PuOVYf0O3GThRwq',
        cachedResultName: 'PII-08 Valuation and Market Analyst',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const valuationAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Valuation Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii09Risk = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-09 Risk Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'mioSWLKBMLAaBGzs',
        cachedResultName: 'PII-09 Risk and Red-Team Reviewer',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const riskAdvancedToAnalyzing = ifElse({
  version: 2.3,
  config: {
    name: 'Risk Advanced To Analyzing?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'ANALYZING',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii10Scoring = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-10 Scoring Gate',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'lIjKOZS7qDizvynm',
        cachedResultName: 'PII-10 Scoring and Quality Gate',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const scoringAdvancedToReview = ifElse({
  version: 2.3,
  config: {
    name: 'Scoring Advanced To Review?',
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
            leftValue: expr('{{ $json.next_state }}'),
            rightValue: 'AWAITING_HUMAN_REVIEW',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const executePii11Report = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-11 Report Generator',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'CLiHq1zJ1Euwhrxb',
        cachedResultName: 'PII-11 Report Generator',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'ticker',
            displayName: 'ticker',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'exchange',
            displayName: 'exchange',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const executePii14Email = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-14 Email Delivery',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: 'kf6pC1t7J1XavbiE',
        cachedResultName: 'PII-14 Email Digest and Report Delivery',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          mode: expr(
            '{{ $("Execute PII-11 Report Generator").item.json.publication_ready === true || $("Execute PII-11 Report Generator").item.json.publication_ready === "true" ? "INVESTIGATION_REPORT" : "TEST_DELIVERY" }}',
          ),
        },
        matchingColumns: [],
        schema: [
          {
            id: 'case_id',
            displayName: 'case_id',
            required: true,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'mode',
            displayName: 'mode',
            required: false,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
          {
            id: 'recipient',
            displayName: 'recipient',
            required: false,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const pii15InputSchema = [
  {
    id: 'case_id',
    displayName: 'case_id',
    required: true,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'ticker',
    displayName: 'ticker',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'exchange',
    displayName: 'exchange',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'mode',
    displayName: 'mode',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'stage',
    displayName: 'stage',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'reason',
    displayName: 'reason',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'outcome',
    displayName: 'outcome',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'next_state',
    displayName: 'next_state',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
  {
    id: 'detail',
    displayName: 'detail',
    required: false,
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type: 'string',
  },
];

const executePii15SlackNotify = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-15 Slack Notify',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '3Q4goJz1gGKJRLMI',
        cachedResultName: 'PII-15 Slack Completion Notify',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr(
            '{{ $("Validate Investigation Request").item.json.exchange }}',
          ),
          mode: expr('{{ "COMPLETION" }}'),
          stage: expr('{{ "" }}'),
          reason: expr('{{ "" }}'),
          outcome: expr('{{ "" }}'),
          next_state: expr('{{ "" }}'),
          detail: expr('{{ "" }}'),
        },
        matchingColumns: [],
        schema: pii15InputSchema,
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const notifySlackEligibilityEarlyExit = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Notify Slack Eligibility Early Exit',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '3Q4goJz1gGKJRLMI',
        cachedResultName: 'PII-15 Slack Completion Notify',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.exchange }}'),
          mode: expr('{{ "EARLY_EXIT" }}'),
          stage: expr('{{ "eligibility" }}'),
          reason: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.reason }}'),
          outcome: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.outcome }}'),
          next_state: expr(
            '{{ $("Execute PII-02 Eligibility Gate").item.json.next_state }}',
          ),
          detail: expr('{{ $("Execute PII-02 Eligibility Gate").item.json.reason }}'),
        },
        matchingColumns: [],
        schema: pii15InputSchema,
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const notifySlackEvidenceEarlyExit = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Notify Slack Evidence Early Exit',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '3Q4goJz1gGKJRLMI',
        cachedResultName: 'PII-15 Slack Completion Notify',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr(
            '{{ $("Validate Investigation Request").item.json.exchange }}',
          ),
          mode: expr('{{ "EARLY_EXIT" }}'),
          stage: expr('{{ "evidence" }}'),
          reason: expr('{{ $("Execute PII-03 Coverage Join").item.json.reason }}'),
          outcome: expr('{{ $("Execute PII-03 Coverage Join").item.json.outcome }}'),
          next_state: expr(
            '{{ $("Execute PII-03 Coverage Join").item.json.next_state }}',
          ),
          detail: expr('{{ $("Execute PII-03 Coverage Join").item.json.reason }}'),
        },
        matchingColumns: [],
        schema: pii15InputSchema,
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: {
        waitForSubWorkflow: true,
      },
    },
  },
});

const executePii03Sec = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 SEC',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-SEC" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03Xbrl = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 XBRL',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-XBRL" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03Ct = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 CT',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-CT" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03Fda = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 FDA',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-FDA" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03News = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 News',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-NEWS" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03Uspto = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 USPTO',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-USPTO" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03Cl = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 CourtListener',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-CL" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii03Cover = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-03 Coverage Join',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-COVER" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillSec = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 SEC',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-SEC" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillXbrl = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 XBRL',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-XBRL" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillCt = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 CT',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-CT" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillFda = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 FDA',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-FDA" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillNews = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 News',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-NEWS" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillUspto = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 USPTO',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-USPTO" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillCl = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03 CourtListener',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Uo5s0TUOFVMQywQX', cachedResultName: 'PII-03 Evidence Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          collector_key: expr('{{ "PII-03-CL" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'collector_key', displayName: 'collector_key', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fillMkt = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-03-MKT',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'EE1ZJNOJcULErIOJ', cachedResultName: 'PII-03-MKT Market Data Collector' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fill04 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-04 Financial Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'RvIlyuDV0MEsXezL', cachedResultName: 'PII-04 Financial and Business Analyst' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fill05 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-05 Growth Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'sdamxDo9SUdo4QxC', cachedResultName: 'PII-05 Growth Analyst' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fill06 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-06 Pipeline Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'b8CxYW8T8FrGl62x', cachedResultName: 'PII-06 Pipeline and Clinical Analyst' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fill07 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-07 Regulatory Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: '4AqBDr5hjZeMLy99', cachedResultName: 'PII-07 Regulatory and Catalyst Analyst' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const fill16 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Fill-In PII-16 Technical Analyst',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Lwyh7GEDocAaj0V8', cachedResultName: 'PII-16 Technical and Market Behavior Analyst' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          focus: expr('{{ "full" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'focus', displayName: 'focus', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const executePii16Events = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Execute PII-16 Event Reaction',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Lwyh7GEDocAaj0V8', cachedResultName: 'PII-16 Technical and Market Behavior Analyst' },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {
          case_id: expr('{{ $("Insert Research Case").item.json.case_id }}'),
          ticker: expr('{{ $("Insert Research Case").item.json.ticker }}'),
          exchange: expr('{{ $("Validate Investigation Request").item.json.exchange }}'),
          focus: expr('{{ "events" }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'case_id', displayName: 'case_id', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'ticker', displayName: 'ticker', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'exchange', displayName: 'exchange', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
          { id: 'focus', displayName: 'focus', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
      options: { waitForSubWorkflow: true },
    },
  },
});

const mergeCollectors = merge({
  version: 3.2,
  config: { name: 'Merge Collector Wave', parameters: { mode: 'append', numberInputs: 7 } },
});
const mergeSpecialists = merge({
  version: 3.2,
  config: { name: 'Merge Specialist Wave', parameters: { mode: 'append', numberInputs: 6 } },
});
const mergeDelivery = merge({
  version: 3.2,
  config: { name: 'Merge Delivery', parameters: { mode: 'append', numberInputs: 2 } },
});

const startCollectors = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Start Collector Wave',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'collect', type: 'string' }],
      },
    },
  },
});

const joinCollectors = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Join Collector Wave',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'collect', type: 'string' }],
      },
    },
  },
});

const afterXbrl = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'After XBRL',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'collect', type: 'string' }],
      },
    },
  },
});

const startSpecialists = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Start Specialist Wave',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'specialists', type: 'string' }],
      },
    },
  },
});

const joinSpecialists = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Join Specialist Wave',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'specialists', type: 'string' }],
      },
    },
  },
});

const startDelivery = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Start Delivery',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'delivery', type: 'string' }],
      },
    },
  },
});

const joinDelivery = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Join Delivery',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'wave', name: 'wave', value: 'delivery', type: 'string' }],
      },
    },
  },
});

const EligibilityRecordPrepare = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Eligibility Record Prepare',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'action', name: 'action', value: 'record', type: 'string' }],
      },
    },
  },
});
const EligibilityRecordApply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Eligibility Record Apply',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: planAgentTasksCode },
  },
});
const EligibilityRecordUpdate = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Eligibility Record Update',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE agent_tasks AS t SET status = elem->>'status', result_json = COALESCE(elem->'result_json', '{}'::jsonb), shadow = false, updated_at = NOW() FROM jsonb_array_elements(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS elem WHERE t.case_id = $1::uuid AND t.agent_key = elem->>'agent_key' AND t.graph_hash = $3 RETURNING t.id",
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},{{ $("Eligibility Record Apply").first().json.tasks_b64 }},{{ $("Eligibility Record Apply").first().json.graph_hash }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});
EligibilityRecordPrepare.to(EligibilityRecordApply).to(EligibilityRecordUpdate);

const EvidenceRecordPrepare = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Evidence Record Prepare',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'action', name: 'action', value: 'record', type: 'string' }],
      },
    },
  },
});
const EvidenceRecordApply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evidence Record Apply',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: planAgentTasksCode },
  },
});
const EvidenceRecordUpdate = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Evidence Record Update',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE agent_tasks AS t SET status = elem->>'status', result_json = COALESCE(elem->'result_json', '{}'::jsonb), shadow = false, updated_at = NOW() FROM jsonb_array_elements(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS elem WHERE t.case_id = $1::uuid AND t.agent_key = elem->>'agent_key' AND t.graph_hash = $3 RETURNING t.id",
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},{{ $("Evidence Record Apply").first().json.tasks_b64 }},{{ $("Evidence Record Apply").first().json.graph_hash }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});
EvidenceRecordPrepare.to(EvidenceRecordApply).to(EvidenceRecordUpdate);

const CompletionRecordPrepare = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Completion Record Prepare',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'action', name: 'action', value: 'record', type: 'string' }],
      },
    },
  },
});
const CompletionRecordApply = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Completion Record Apply',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: planAgentTasksCode },
  },
});
const CompletionRecordUpdate = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Completion Record Update',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE agent_tasks AS t SET status = elem->>'status', result_json = COALESCE(elem->'result_json', '{}'::jsonb), shadow = false, updated_at = NOW() FROM jsonb_array_elements(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS elem WHERE t.case_id = $1::uuid AND t.agent_key = elem->>'agent_key' AND t.graph_hash = $3 RETURNING t.id",
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},{{ $("Completion Record Apply").first().json.tasks_b64 }},{{ $("Completion Record Apply").first().json.graph_hash }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});
CompletionRecordPrepare.to(CompletionRecordApply).to(CompletionRecordUpdate);

EligibilityRecordUpdate.to(notifySlackEligibilityEarlyExit);

EvidenceRecordUpdate.to(notifySlackEvidenceEarlyExit);

const runXbrl = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-XBRL?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-XBRL|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipXbrl = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-XBRL',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredRunXbrl = runXbrl.onTrue(executePii03Xbrl.to(afterXbrl)).onFalse(skipXbrl.to(afterXbrl));
joinCollectors.to(wiredRunXbrl);

const runCover = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-COVER?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-COVER|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const wiredRunCover = runCover.onTrue(
  executePii03Cover.to(
    evidenceAdvancedToAnalyzing.onTrue(startSpecialists).onFalse(EvidenceRecordPrepare),
  ),
).onFalse(startSpecialists);
afterXbrl.to(wiredRunCover);

const prepareFillIn = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Fill-In',
    executeOnce: true,
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [{ id: 'action', name: 'action', value: 'canvas_fill_in', type: 'string' }],
      },
    },
  },
});
const decideFillIn = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Decide Fill-In',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: planAgentTasksCode,
    },
  },
});
prepareFillIn.to(decideFillIn);

const gateReport = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-11?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-11|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipReport = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-11',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateReport = gateReport.onTrue(executePii11Report.to(startDelivery)).onFalse(skipReport.to(startDelivery));

const gateScoring = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-10?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-10|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipScoring = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-10',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateScoring = gateScoring.onTrue(executePii10Scoring.to(gateReport)).onFalse(skipScoring.to(gateReport));

const gateRisk = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-09?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-09|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipRisk = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-09',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateRisk = gateRisk.onTrue(executePii09Risk.to(gateScoring)).onFalse(skipRisk.to(gateScoring));

const gateEvents = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-16-EVENTS?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-16-EVENTS|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipEvents = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-16-EVENTS',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateEvents = gateEvents.onTrue(executePii16Events.to(gateRisk)).onFalse(skipEvents.to(gateRisk));

const rerunTechnical = ifElse({
  version: 2.3,
  config: {
    name: 'Rerun PII-16?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-MKT|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'or',
      },
    },
  },
});

const deactivateTechnical = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Deactivate Technical Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE claims SET is_active = FALSE WHERE case_id = $1::uuid AND claim_category = $2 AND is_active = TRUE RETURNING id',
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},technical_market'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const wiredRerunTechnical = rerunTechnical.onTrue(deactivateTechnical.to(fill16).to(gateEvents)).onFalse(gateEvents);

const rerunRegulatory = ifElse({
  version: 2.3,
  config: {
    name: 'Rerun PII-07?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-FDA|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'or',
      },
    },
  },
});

const deactivateRegulatory = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Deactivate Regulatory Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE claims SET is_active = FALSE WHERE case_id = $1::uuid AND claim_category = $2 AND is_active = TRUE RETURNING id',
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},regulatory_catalyst'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const wiredRerunRegulatory = rerunRegulatory.onTrue(deactivateRegulatory.to(fill07).to(rerunTechnical)).onFalse(rerunTechnical);

const rerunPipeline = ifElse({
  version: 2.3,
  config: {
    name: 'Rerun PII-06?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-CT|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'or',
      },
    },
  },
});

const deactivatePipeline = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Deactivate Pipeline Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE claims SET is_active = FALSE WHERE case_id = $1::uuid AND claim_category = $2 AND is_active = TRUE RETURNING id',
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},pipeline_clinical'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const wiredRerunPipeline = rerunPipeline.onTrue(deactivatePipeline.to(fill06).to(rerunRegulatory)).onFalse(rerunRegulatory);

const rerunGrowth = ifElse({
  version: 2.3,
  config: {
    name: 'Rerun PII-05?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-NEWS|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'or',
      },
    },
  },
});

const deactivateGrowth = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Deactivate Growth Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE claims SET is_active = FALSE WHERE case_id = $1::uuid AND claim_category = $2 AND is_active = TRUE RETURNING id',
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},growth_prospects'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const wiredRerunGrowth = rerunGrowth.onTrue(deactivateGrowth.to(fill05).to(rerunPipeline)).onFalse(rerunPipeline);

const rerunFinancial = ifElse({
  version: 2.3,
  config: {
    name: 'Rerun PII-04?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-SEC|',
            operator: { type: 'string', operation: 'contains' },
          },
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-XBRL|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'or',
      },
    },
  },
});

const deactivateFinancial = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Deactivate Financial Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE claims SET is_active = FALSE WHERE case_id = $1::uuid AND claim_category = $2 AND is_active = TRUE RETURNING id',
      options: {
        queryReplacement: expr('{{ $("Insert Research Case").item.json.case_id }},business_financial'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const wiredRerunFinancial = rerunFinancial.onTrue(deactivateFinancial.to(fill04).to(rerunGrowth)).onFalse(rerunGrowth);

const gateFillMkt = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-MKT?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-MKT|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillMkt = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-MKT',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillMkt = gateFillMkt.onTrue(fillMkt.to(rerunFinancial)).onFalse(skipFillMkt.to(rerunFinancial));

const gateFillCl = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-CL?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-CL|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillCl = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-CL',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillCl = gateFillCl.onTrue(fillCl.to(gateFillMkt)).onFalse(skipFillCl.to(gateFillMkt));

const gateFillUspto = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-USPTO?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-USPTO|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillUspto = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-USPTO',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillUspto = gateFillUspto.onTrue(fillUspto.to(gateFillCl)).onFalse(skipFillUspto.to(gateFillCl));

const gateFillNews = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-NEWS?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-NEWS|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillNews = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-NEWS',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillNews = gateFillNews.onTrue(fillNews.to(gateFillUspto)).onFalse(skipFillNews.to(gateFillUspto));

const gateFillFda = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-FDA?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-FDA|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillFda = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-FDA',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillFda = gateFillFda.onTrue(fillFda.to(gateFillNews)).onFalse(skipFillFda.to(gateFillNews));

const gateFillCt = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-CT?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-CT|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillCt = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-CT',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillCt = gateFillCt.onTrue(fillCt.to(gateFillFda)).onFalse(skipFillCt.to(gateFillFda));

const gateFillXbrl = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-XBRL?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-XBRL|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillXbrl = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-XBRL',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillXbrl = gateFillXbrl.onTrue(fillXbrl.to(gateFillCt)).onFalse(skipFillXbrl.to(gateFillCt));

const gateFillSec = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In PII-03-SEC?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Decide Fill-In").item.json.fill_in_keys }}'),
            rightValue: '|PII-03-SEC|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipFillSec = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip Fill-In PII-03-SEC',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateFillSec = gateFillSec.onTrue(fillSec.to(gateFillXbrl)).onFalse(skipFillSec.to(gateFillXbrl));

const fillNeeded = ifElse({
  version: 2.3,
  config: {
    name: 'Fill-In Needed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $json.run_fill_in }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});
const wiredFillNeeded = fillNeeded.onTrue(gateFillSec).onFalse(gateEvents);
decideFillIn.to(wiredFillNeeded);

const runIdentity = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-01?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-01|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const runEligibility = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-02?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-02|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const wiredRunIdentity = runIdentity.onTrue(
  advanceToIdentityReview.to(logIdentityReviewState).to(executePii01Identity).to(
    runEligibility
      .onTrue(
        executePii02Eligibility.to(
          eligibilityAdvancedToCollecting.onTrue(startCollectors).onFalse(EligibilityRecordPrepare),
        ),
      )
      .onFalse(startCollectors),
  ),
).onFalse(startCollectors);

const gateCollectSec = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-SEC?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-SEC|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectSec = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-SEC',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectSec = gateCollectSec.onTrue(executePii03Sec.to(mergeCollectors.input(0))).onFalse(skipCollectSec.to(mergeCollectors.input(0)));

const gateCollectCt = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-CT?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-CT|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectCt = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-CT',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectCt = gateCollectCt.onTrue(executePii03Ct.to(mergeCollectors.input(1))).onFalse(skipCollectCt.to(mergeCollectors.input(1)));

const gateCollectFda = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-FDA?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-FDA|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectFda = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-FDA',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectFda = gateCollectFda.onTrue(executePii03Fda.to(mergeCollectors.input(2))).onFalse(skipCollectFda.to(mergeCollectors.input(2)));

const gateCollectNews = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-NEWS?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-NEWS|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectNews = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-NEWS',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectNews = gateCollectNews.onTrue(executePii03News.to(mergeCollectors.input(3))).onFalse(skipCollectNews.to(mergeCollectors.input(3)));

const gateCollectUspto = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-USPTO?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-USPTO|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectUspto = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-USPTO',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectUspto = gateCollectUspto.onTrue(executePii03Uspto.to(mergeCollectors.input(4))).onFalse(skipCollectUspto.to(mergeCollectors.input(4)));

const gateCollectCl = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-CL?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-CL|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectCl = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-CL',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectCl = gateCollectCl.onTrue(executePii03Cl.to(mergeCollectors.input(5))).onFalse(skipCollectCl.to(mergeCollectors.input(5)));

const gateCollectMkt = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-03-MKT?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-03-MKT|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipCollectMkt = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-03-MKT',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateCollectMkt = gateCollectMkt.onTrue(executePii03Mkt.to(mergeCollectors.input(6))).onFalse(skipCollectMkt.to(mergeCollectors.input(6)));

const gateSpec04 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-04?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-04|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipSpec04 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-04',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateSpec04 = gateSpec04.onTrue(executePii04Financial.to(mergeSpecialists.input(0))).onFalse(skipSpec04.to(mergeSpecialists.input(0)));

const gateSpec05 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-05?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-05|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipSpec05 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-05',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateSpec05 = gateSpec05.onTrue(executePii05Growth.to(mergeSpecialists.input(1))).onFalse(skipSpec05.to(mergeSpecialists.input(1)));

const gateSpec06 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-06?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-06|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipSpec06 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-06',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateSpec06 = gateSpec06.onTrue(executePii06Pipeline.to(mergeSpecialists.input(2))).onFalse(skipSpec06.to(mergeSpecialists.input(2)));

const gateSpec07 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-07?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-07|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipSpec07 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-07',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateSpec07 = gateSpec07.onTrue(executePii07Regulatory.to(mergeSpecialists.input(3))).onFalse(skipSpec07.to(mergeSpecialists.input(3)));

const gateSpec08 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-08?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-08|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipSpec08 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-08',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateSpec08 = gateSpec08.onTrue(executePii08Valuation.to(mergeSpecialists.input(4))).onFalse(skipSpec08.to(mergeSpecialists.input(4)));

const gateSpec16 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-16?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-16|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipSpec16 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-16',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateSpec16 = gateSpec16.onTrue(executePii16Technical.to(mergeSpecialists.input(5))).onFalse(skipSpec16.to(mergeSpecialists.input(5)));

const gateDel14 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-14?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-14|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipDel14 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-14',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateDel14 = gateDel14.onTrue(executePii14Email.to(mergeDelivery.input(0))).onFalse(skipDel14.to(mergeDelivery.input(0)));

const gateDel15 = ifElse({
  version: 2.3,
  config: {
    name: 'Run PII-15?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $("Plan Agent Tasks").item.json.dispatch_keys }}'),
            rightValue: '|PII-15|',
            operator: { type: 'string', operation: 'contains' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const skipDel15 = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Skip PII-15',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'skipped', name: 'skipped', value: true, type: 'boolean' },
          { id: 'status', name: 'status', value: 'SKIPPED', type: 'string' },
        ],
      },
    },
  },
});

const wiredGateDel15 = gateDel15.onTrue(executePii15SlackNotify.to(mergeDelivery.input(1))).onFalse(skipDel15.to(mergeDelivery.input(1)));

const intakeNote = sticky(
  '## PII-00 Intake\nPOST /pii/investigate\nValidate → idempotent case create → 202 ack',
  [investigationWebhook, validateInvestigationRequest, validationPassed],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nPostgres: research_cases, case_state_history, workflow_runs, agent_tasks',
  [lookupExistingCase, insertResearchCase, logCaseCreatedState, persistAgentTasks],
  { color: 5 },
);

const asyncNote = sticky(
  '## Supervisor waves\nIdentity and eligibility stay serial. Collector workers and specialists fan out when the plan includes them. EVENT_REASSESSMENT and REFRESH skip agents absent from dispatch_keys. Fill-in runs once inside the HTTP budget.',
  [
    respondAccepted,
    runIdentity,
    startCollectors,
    executePii03Cover,
    startSpecialists,
    decideFillIn,
    executePii09Risk,
    startDelivery,
    notifySlackEligibilityEarlyExit,
    notifySlackEvidenceEarlyExit,
  ],
  { color: 6 },
);

export default workflow('pii-00-orchestrator', 'PII-00 Case Orchestrator')
  .add(investigationWebhook)
  .to(validateInvestigationRequest)
  .to(
    validationPassed
      .onFalse(respondValidationError)
      .onTrue(
        lookupExistingCase.to(
          caseAlreadyExists
            .onTrue(prepareExistingCaseAck.to(buildAckResponse.to(respondAccepted)))
            .onFalse(
              insertResearchCase
                .to(logCaseCreatedState)
                .to(logWorkflowRunStart)
                .to(prepareNewCaseAck)
                .to(buildAckResponse.to(respondAccepted))
                .to(planAgentTasks)
                .to(persistAgentTasks)
                .to(wiredRunIdentity),
            ),
        ),
      ),
  )
  .add(startCollectors)
  .to(wiredGateCollectSec)
  .add(startCollectors)
  .to(wiredGateCollectCt)
  .add(startCollectors)
  .to(wiredGateCollectFda)
  .add(startCollectors)
  .to(wiredGateCollectNews)
  .add(startCollectors)
  .to(wiredGateCollectUspto)
  .add(startCollectors)
  .to(wiredGateCollectCl)
  .add(startCollectors)
  .to(wiredGateCollectMkt)
  .add(mergeCollectors)
  .to(joinCollectors)
  .add(startSpecialists)
  .to(wiredGateSpec04)
  .add(startSpecialists)
  .to(wiredGateSpec05)
  .add(startSpecialists)
  .to(wiredGateSpec06)
  .add(startSpecialists)
  .to(wiredGateSpec07)
  .add(startSpecialists)
  .to(wiredGateSpec08)
  .add(startSpecialists)
  .to(wiredGateSpec16)
  .add(mergeSpecialists)
  .to(joinSpecialists)
  .to(prepareFillIn)
  .add(startDelivery)
  .to(wiredGateDel14)
  .add(startDelivery)
  .to(wiredGateDel15)
  .add(mergeDelivery)
  .to(joinDelivery)
  .to(CompletionRecordPrepare)
  .add(wiredGateReport)
  .add(wiredGateScoring)
  .add(wiredGateRisk)
  .add(wiredGateEvents)
  .add(wiredRerunTechnical)
  .add(wiredRerunRegulatory)
  .add(wiredRerunPipeline)
  .add(wiredRerunGrowth)
  .add(wiredRerunFinancial)
  .add(wiredGateFillMkt)
  .add(wiredGateFillCl)
  .add(wiredGateFillUspto)
  .add(wiredGateFillNews)
  .add(wiredGateFillFda)
  .add(wiredGateFillCt)
  .add(wiredGateFillXbrl)
  .add(wiredGateFillSec)
  .add(intakeNote)
  .add(persistenceNote)
  .add(asyncNote);
