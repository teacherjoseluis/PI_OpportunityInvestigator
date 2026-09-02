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
        "INSERT INTO research_cases (request_id, ticker, exchange, research_question, mode, state, requested_by, as_of_date, force_refresh, configuration_version_id) SELECT $1, $2, $3, $4, $5, 'REQUESTED', $6, NULLIF($7, '')::date, $8, cv.id FROM configuration_versions cv WHERE cv.version_label = $9 AND cv.is_active = true LIMIT 1 RETURNING id AS case_id, request_id, ticker, state, true AS created",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Investigation Request").item.json.request_id }},{{ $("Validate Investigation Request").item.json.ticker }},{{ $("Validate Investigation Request").item.json.exchange }},{{ $("Validate Investigation Request").item.json.research_question }},{{ $("Validate Investigation Request").item.json.mode }},{{ $("Validate Investigation Request").item.json.requested_by }},{{ $("Validate Investigation Request").item.json.as_of_date }},{{ $("Validate Investigation Request").item.json.force_refresh }},{{ $("Validate Investigation Request").item.json.configuration_version }}',
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

const orchestrationPhase1Stub = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Orchestration Phase 1 Stub',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'next-step',
            name: 'next_step',
            value: 'PII-01 Identity Resolver (not wired yet)',
            type: 'string',
          },
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $json.case_id }}'),
            type: 'string',
          },
        ],
      },
    },
  },
  output: [
    {
      next_step: 'PII-01 Identity Resolver (not wired yet)',
      case_id: '660e8400-e29b-41d4-a716-446655440001',
    },
  ],
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
  '## Async continuation\nAfter webhook response: advance to IDENTITY_REVIEW.\nPII-01 subworkflow wiring is Phase 1 next slice.',
  [respondAccepted, advanceToIdentityReview, orchestrationPhase1Stub],
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
                .to(orchestrationPhase1Stub),
            ),
        ),
      ),
  )
  .add(intakeNote)
  .add(persistenceNote)
  .add(asyncNote);
