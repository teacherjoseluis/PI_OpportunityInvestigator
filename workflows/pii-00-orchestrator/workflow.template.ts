import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateInvestigationRequestCode = `__VALIDATE_INVESTIGATION_REQUEST__`;

const buildAckResponseCode = `__BUILD_ACK_RESPONSE__`;

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
        value: 'IqoALspzvN3PL5Cq',
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
          case_id: expr('{{ $("Execute PII-03 Evidence Collector").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-03 Evidence Collector").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-03 Evidence Collector").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-04 Financial Analyst").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-04 Financial Analyst").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-04 Financial Analyst").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-05 Growth Analyst").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-05 Growth Analyst").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-05 Growth Analyst").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-06 Pipeline Analyst").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-06 Pipeline Analyst").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-06 Pipeline Analyst").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-07 Regulatory Analyst").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-07 Regulatory Analyst").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-07 Regulatory Analyst").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-08 Valuation Analyst").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-08 Valuation Analyst").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-08 Valuation Analyst").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-09 Risk Analyst").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-09 Risk Analyst").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-09 Risk Analyst").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-10 Scoring Gate").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-10 Scoring Gate").item.json.ticker }}'),
          exchange: expr('{{ $("Execute PII-10 Scoring Gate").item.json.exchange }}'),
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
          case_id: expr('{{ $("Execute PII-11 Report Generator").item.json.case_id }}'),
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
          case_id: expr('{{ $("Execute PII-11 Report Generator").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-11 Report Generator").item.json.ticker }}'),
          exchange: expr(
            '{{ $("Execute PII-11 Report Generator").item.json.exchange }}',
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
          case_id: expr('{{ $("Execute PII-03 Evidence Collector").item.json.case_id }}'),
          ticker: expr('{{ $("Execute PII-03 Evidence Collector").item.json.ticker }}'),
          exchange: expr(
            '{{ $("Execute PII-03 Evidence Collector").item.json.exchange }}',
          ),
          mode: expr('{{ "EARLY_EXIT" }}'),
          stage: expr('{{ "evidence" }}'),
          reason: expr('{{ $("Execute PII-03 Evidence Collector").item.json.reason }}'),
          outcome: expr('{{ $("Execute PII-03 Evidence Collector").item.json.outcome }}'),
          next_state: expr(
            '{{ $("Execute PII-03 Evidence Collector").item.json.next_state }}',
          ),
          detail: expr('{{ $("Execute PII-03 Evidence Collector").item.json.reason }}'),
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

const intakeNote = sticky(
  '## PII-00 Intake\nPOST /pii/investigate\nValidate → idempotent case create → 202 ack',
  [investigationWebhook, validateInvestigationRequest, validationPassed],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nPostgres: research_cases, case_state_history, workflow_runs',
  [lookupExistingCase, insertResearchCase, logCaseCreatedState],
  { color: 5 },
);

const asyncNote = sticky(
  '## Async continuation\nPII-01 → … → PII-11 report → PII-14 email → PII-15 Slack DM (COMPLETION). Eligibility/evidence early exits also call PII-15 (EARLY_EXIT).',
  [
    respondAccepted,
    advanceToIdentityReview,
    executePii01Identity,
    executePii02Eligibility,
    notifySlackEligibilityEarlyExit,
    executePii03Evidence,
    notifySlackEvidenceEarlyExit,
    executePii04Financial,
    executePii05Growth,
    executePii06Pipeline,
    executePii07Regulatory,
    executePii08Valuation,
    executePii09Risk,
    executePii10Scoring,
    executePii11Report,
    executePii14Email,
    executePii15SlackNotify,
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
                .to(advanceToIdentityReview)
                .to(logIdentityReviewState)
                .to(executePii01Identity)
                .to(executePii02Eligibility)
                .to(
                  eligibilityAdvancedToCollecting
                    .onTrue(
                      executePii03Evidence.to(
                        evidenceAdvancedToAnalyzing
                          .onTrue(
                            executePii04Financial.to(
                              financialAdvancedToAnalyzing.onTrue(
                                executePii05Growth.to(
                                  growthAdvancedToAnalyzing.onTrue(
                                    executePii06Pipeline.to(
                                      pipelineAdvancedToAnalyzing.onTrue(
                                        executePii07Regulatory.to(
                                          regulatoryAdvancedToAnalyzing.onTrue(
                                            executePii08Valuation.to(
                                              valuationAdvancedToAnalyzing.onTrue(
                                                executePii09Risk.to(
                                                  riskAdvancedToAnalyzing.onTrue(
                                                    executePii10Scoring.to(
                                                      scoringAdvancedToReview.onTrue(
                                                        executePii11Report
                                                          .to(executePii14Email)
                                                          .to(executePii15SlackNotify),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          )
                          .onFalse(notifySlackEvidenceEarlyExit),
                      ),
                    )
                    .onFalse(notifySlackEligibilityEarlyExit),
                ),
            ),
        ),
      ),
  )
  .add(intakeNote)
  .add(persistenceNote)
  .add(asyncNote);
