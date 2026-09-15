import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateInvestigationRequestCode = `// Canonical source for PII-00 "Validate Investigation Request" Code node.
// Bundled into workflow.ts via workflows/scripts/bundle-workflow.mjs

const ALLOWED_MODES = ['FULL', 'EVENT_REASSESSMENT', 'REFRESH', 'COMPARE'];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pickBody(raw) {
  if (raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)) {
    return raw.body;
  }
  return raw;
}

const results = [];

for (const item of $input.all()) {
  const body = pickBody(item.json);
  const errors = [];

  const ticker = String(body.ticker || '')
    .trim()
    .toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    errors.push('ticker is required and must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  const mode = String(body.mode || 'FULL')
    .trim()
    .toUpperCase();
  if (!ALLOWED_MODES.includes(mode)) {
    errors.push('mode must be one of: ' + ALLOWED_MODES.join(', '));
  }

  let requestId = body.request_id || body.requestId || null;
  if (requestId != null) {
    requestId = String(requestId).trim();
    if (!UUID_RE.test(requestId)) {
      errors.push('request_id must be a UUID when provided');
    }
  } else {
    requestId = uuidv4();
  }

  const exchange = String(body.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();
  const researchQuestion = body.research_question ?? body.researchQuestion ?? null;
  const requestedBy = String(body.requested_by ?? body.requestedBy ?? 'user').trim();
  const asOfDate = body.as_of_date ?? body.asOfDate ?? null;
  const configurationVersion = String(
    body.configuration_version ?? body.configurationVersion ?? 'v1',
  ).trim();
  const forceRefresh = Boolean(body.force_refresh ?? body.forceRefresh ?? false);

  if (asOfDate != null && asOfDate !== '') {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(asOfDate))) {
      errors.push('as_of_date must be YYYY-MM-DD when provided');
    }
  }

  let requestContext = body.request_context ?? body.requestContext ?? {};
  if (requestContext == null || typeof requestContext !== 'object' || Array.isArray(requestContext)) {
    requestContext = {};
  } else {
    const sanitized = {};
    if (requestContext.source != null) {
      sanitized.source = String(requestContext.source).trim().slice(0, 64);
    }
    const slackIn = requestContext.slack;
    if (slackIn && typeof slackIn === 'object' && !Array.isArray(slackIn)) {
      const slack = {};
      if (slackIn.user_id || slackIn.userId) {
        slack.user_id = String(slackIn.user_id || slackIn.userId).trim().slice(0, 64);
      }
      if (slackIn.channel_id || slackIn.channelId) {
        slack.channel_id = String(slackIn.channel_id || slackIn.channelId).trim().slice(0, 64);
      }
      if (slackIn.team_id || slackIn.teamId) {
        slack.team_id = String(slackIn.team_id || slackIn.teamId).trim().slice(0, 64);
      }
      if (slackIn.user_name || slackIn.userName) {
        slack.user_name = String(slackIn.user_name || slackIn.userName).trim().slice(0, 128);
      }
      if (Object.keys(slack).length > 0) {
        sanitized.slack = slack;
        if (!sanitized.source) sanitized.source = 'slack';
      }
    }
    requestContext = sanitized;
  }

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        statusCode: 400,
      },
    });
    continue;
  }

  const requestContextJson = JSON.stringify(requestContext);
  const requestContextB64 = Buffer.from(requestContextJson, 'utf8').toString('base64');

  results.push({
    json: {
      valid: true,
      request_id: requestId,
      ticker,
      exchange,
      research_question: researchQuestion,
      mode,
      requested_by: requestedBy,
      as_of_date: asOfDate || null,
      configuration_version: configurationVersion,
      force_refresh: forceRefresh,
      request_context: requestContext,
      request_context_b64: requestContextB64,
      correlation_id: requestId,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;

const buildAckResponseCode = `// Canonical source for PII-00 "Build Ack Response" Code node.

const item = $input.first().json;

const payload = {
  case_id: item.case_id,
  request_id: item.request_id,
  ticker: item.ticker,
  state: item.state || 'REQUESTED',
  created: item.created === true || item.created === 'true',
  message: item.created
    ? 'Investigation case created. Processing continues asynchronously.'
    : 'Existing case returned for idempotent request_id.',
  as_of: new Date().toISOString(),
};

return [{ json: payload }];
`;

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
  '## Async continuation\nPII-01 → … → PII-11 report → PII-14 email (TEST_DELIVERY unless publication_ready) → PII-15 Slack DM.',
  [
    respondAccepted,
    advanceToIdentityReview,
    executePii01Identity,
    executePii02Eligibility,
    executePii03Evidence,
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
                  eligibilityAdvancedToCollecting.onTrue(
                    executePii03Evidence.to(
                      evidenceAdvancedToAnalyzing.onTrue(
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
                      ),
                    ),
                  ),
                ),
            ),
        ),
      ),
  )
  .add(intakeNote)
  .add(persistenceNote)
  .add(asyncNote);
