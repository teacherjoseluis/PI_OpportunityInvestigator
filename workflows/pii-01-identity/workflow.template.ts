import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateIdentityRequestCode = `__VALIDATE_IDENTITY_REQUEST__`;
const prepareCachedIdentityCode = `__PREPARE_CACHED_IDENTITY__`;
const resolveEdgarIdentityCode = `__RESOLVE_EDGAR_IDENTITY__`;
const buildIdentityResultCode = `__BUILD_IDENTITY_RESULT__`;

const identityTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Identity Resolve Trigger',
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
      case_id: '70883370-8893-4534-a148-2aa4172f497b',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateIdentityRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Identity Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateIdentityRequestCode,
    },
  },
  output: [
    {
      valid: true,
      case_id: '70883370-8893-4534-a148-2aa4172f497b',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
      force_refresh: false,
      min_identity_confidence: 80,
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
          {
            id: 'outcome',
            name: 'outcome',
            value: 'NEEDS_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: 'AWAITING_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: 'validation_failed',
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: 0,
            type: 'number',
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
});

const lookupExistingSecurity = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Lookup Existing Security',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT s.id AS security_id, s.ticker, s.exchange, c.id AS company_id, c.legal_name, c.cik, c.identity_confidence FROM securities s JOIN companies c ON c.id = s.company_id WHERE s.ticker = $1 AND s.exchange = $2 LIMIT 1',
      options: {
        queryReplacement: expr(
          '{{ $("Validate Identity Request").item.json.ticker }},{{ $("Validate Identity Request").item.json.exchange }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [],
});

const securityAlreadyExists = ifElse({
  version: 2.3,
  config: {
    name: 'Security Already Exists?',
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
            leftValue: expr('{{ $json.security_id }}'),
            operator: { type: 'string', operation: 'exists' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareCachedIdentity = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Cached Identity',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCachedIdentityCode,
    },
  },
});

const fetchEdgarTickers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Edgar Company Tickers',
    // SEC requires a descriptive User-Agent; retry helps with transient 429/5xx.
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: 'https://www.sec.gov/files/company_tickers_exchange.json',
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value:
              'PI-OpportunityInvestigator/1.0 (github.com/teacherjoseluis/PI_OpportunityInvestigator; research)',
          },
          {
            name: 'Accept',
            value: 'application/json',
          },
        ],
      },
      options: {
        timeout: 60000,
        response: {
          response: {
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const resolveEdgarIdentity = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolve Edgar Identity',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: resolveEdgarIdentityCode,
    },
  },
});

const edgarResolved = ifElse({
  version: 2.3,
  config: {
    name: 'Edgar Resolved?',
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
            leftValue: expr('{{ $json.resolved }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Company',
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH upsert AS (INSERT INTO companies (legal_name, cik, identity_confidence, notes) VALUES ($1, $2, $3::numeric, $4) ON CONFLICT (cik) WHERE cik IS NOT NULL DO UPDATE SET legal_name = EXCLUDED.legal_name, identity_confidence = EXCLUDED.identity_confidence, notes = EXCLUDED.notes, updated_at = NOW() RETURNING id AS company_id) SELECT company_id FROM upsert",
      options: {
        queryReplacement: expr(
          '{{ $json.legal_name }},{{ $json.cik }},{{ $json.identity_confidence }},{{ $json.provenance }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertSecurity = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Security',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO securities (company_id, ticker, exchange, listing_status, is_primary) VALUES ($1::uuid, $2, $3, 'ACTIVE', true) ON CONFLICT (ticker, exchange) DO UPDATE SET company_id = EXCLUDED.company_id, listing_status = 'ACTIVE', updated_at = NOW() RETURNING id AS security_id, company_id",
      options: {
        queryReplacement: expr(
          '{{ $json.company_id }},{{ $("Resolve Edgar Identity").item.json.ticker }},{{ $("Resolve Edgar Identity").item.json.exchange }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertTickerAlias = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Ticker Alias',
    parameters: {
      operation: 'executeQuery',
      query:
        'INSERT INTO company_aliases (company_id, alias_type, alias_value, confidence, provenance, requires_human_approval) VALUES ($1::uuid, $2, $3, $4::numeric, $5, $6::boolean) ON CONFLICT (company_id, alias_type, alias_value) DO UPDATE SET confidence = EXCLUDED.confidence, provenance = EXCLUDED.provenance, requires_human_approval = EXCLUDED.requires_human_approval, updated_at = NOW() RETURNING id AS alias_id',
      options: {
        queryReplacement: expr(
          '{{ $("Upsert Company").item.json.company_id }},ticker,{{ $("Resolve Edgar Identity").item.json.ticker }},{{ $("Resolve Edgar Identity").item.json.identity_confidence }},{{ $("Resolve Edgar Identity").item.json.provenance }},{{ $("Resolve Edgar Identity").item.json.outcome === "NEEDS_HUMAN_REVIEW" }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertLegalNameAlias = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Legal Name Alias',
    parameters: {
      operation: 'executeQuery',
      query:
        'INSERT INTO company_aliases (company_id, alias_type, alias_value, confidence, provenance, requires_human_approval) VALUES ($1::uuid, $2, $3, $4::numeric, $5, $6::boolean) ON CONFLICT (company_id, alias_type, alias_value) DO UPDATE SET confidence = EXCLUDED.confidence, provenance = EXCLUDED.provenance, requires_human_approval = EXCLUDED.requires_human_approval, updated_at = NOW() RETURNING id AS alias_id',
      options: {
        queryReplacement: expr(
          '{{ $("Upsert Company").item.json.company_id }},legal_name,{{ $("Resolve Edgar Identity").item.json.legal_name }},{{ $("Resolve Edgar Identity").item.json.identity_confidence }},{{ $("Resolve Edgar Identity").item.json.provenance }},{{ $("Resolve Edgar Identity").item.json.outcome === "NEEDS_HUMAN_REVIEW" }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const preparePersistedIdentity = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Persisted Identity',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Resolve Edgar Identity").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Upsert Company").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Upsert Security").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Resolve Edgar Identity").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Resolve Edgar Identity").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Resolve Edgar Identity").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Resolve Edgar Identity").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: expr('{{ $("Resolve Edgar Identity").item.json.identity_confidence }}'),
            type: 'number',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Resolve Edgar Identity").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Resolve Edgar Identity").item.json.next_state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Resolve Edgar Identity").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Resolve Edgar Identity").item.json.provenance }}'),
            type: 'string',
          },
          {
            id: 'reused',
            name: 'reused_existing',
            value: false,
            type: 'boolean',
          },
        ],
      },
    },
  },
});

const linkCaseAndAdvance = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Link Case And Advance',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE research_cases SET company_id = NULLIF($2, '')::uuid, security_id = NULLIF($3, '')::uuid, state = $4, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, company_id, security_id, state, ticker, exchange",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.security_id }},{{ $json.next_state }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logIdentityState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Identity State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'IDENTITY_REVIEW', $2, $3, 'pii-01', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Link Case And Advance").item.json.case_id }},{{ $json.state }},{{ $("Build Identity Fields").item.json.reason }},{{ $("Validate Identity Request").item.json.n8n_execution_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

// Helper Set so both cache and edgar paths expose a stable "Build Identity Fields" node name.
const buildIdentityFieldsFromCache = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Build Identity Fields',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'marker',
            name: 'identity_path',
            value: 'cache_or_edgar',
            type: 'string',
          },
        ],
      },
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-01 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-01', $2, $3, 'SUCCEEDED', $4::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Link Case And Advance").item.json.case_id }},{{ $("Validate Identity Request").item.json.n8n_execution_id }},{{ $("Validate Identity Request").item.json.case_id }},{{ JSON.stringify({ outcome: $("Build Identity Fields").item.json.outcome, identity_confidence: $("Build Identity Fields").item.json.identity_confidence, cik: $("Build Identity Fields").item.json.cik }) }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeAfterLink = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Identity Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Link Case And Advance").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Link Case And Advance").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Link Case And Advance").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Build Identity Fields").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Build Identity Fields").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Build Identity Fields").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Build Identity Fields").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: expr('{{ $("Build Identity Fields").item.json.identity_confidence }}'),
            type: 'number',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Build Identity Fields").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Link Case And Advance").item.json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Build Identity Fields").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Build Identity Fields").item.json.provenance }}'),
            type: 'string',
          },
          {
            id: 'reused',
            name: 'reused_existing',
            value: expr('{{ $("Build Identity Fields").item.json.reused_existing }}'),
            type: 'boolean',
          },
        ],
      },
    },
  },
});

const buildIdentityResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Identity Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildIdentityResultCode,
    },
  },
});

const unresolvedAdvance = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Advance Unresolved Case',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE research_cases SET state = 'AWAITING_HUMAN_REVIEW', updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, company_id, security_id, state, ticker, exchange",
      options: {
        queryReplacement: expr('{{ $("Resolve Edgar Identity").item.json.case_id }}'),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logUnresolvedState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Unresolved State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'IDENTITY_REVIEW', 'AWAITING_HUMAN_REVIEW', $2, 'pii-01', $3)",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $("Resolve Edgar Identity").item.json.reason }},{{ $("Validate Identity Request").item.json.n8n_execution_id }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareUnresolvedResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Unresolved Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Resolve Edgar Identity").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Resolve Edgar Identity").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Resolve Edgar Identity").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: 'NEEDS_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: 'AWAITING_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: 0,
            type: 'number',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Resolve Edgar Identity").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Resolve Edgar Identity").item.json.provenance }}'),
            type: 'string',
          },
          {
            id: 'reused',
            name: 'reused_existing',
            value: false,
            type: 'boolean',
          },
        ],
      },
    },
  },
});

const intakeNote = sticky(
  '## PII-01 Identity Resolver\nSubworkflow input: case_id, ticker, exchange\nCache hit → reuse; else SEC company_tickers_exchange.json',
  [identityTrigger, validateIdentityRequest, lookupExistingSecurity],
  { color: 4 },
);

const edgarNote = sticky(
  '## EDGAR path\nRequires User-Agent. Upserts companies, securities, aliases.\nConfidence < 80 → AWAITING_HUMAN_REVIEW (still stores candidate).',
  [fetchEdgarTickers, resolveEdgarIdentity, upsertCompany],
  { color: 5 },
);

const gateNote = sticky(
  '## Gate\nmin_identity_confidence default 80 (config gates_json).\nSuccess → ELIGIBILITY_REVIEW for PII-02.',
  [linkCaseAndAdvance, buildIdentityResult],
  { color: 6 },
);

const finishPath = buildIdentityFieldsFromCache
  .to(linkCaseAndAdvance)
  .to(logIdentityState)
  .to(logWorkflowRun)
  .to(mergeAfterLink)
  .to(buildIdentityResult);

export default workflow('pii-01-identity', 'PII-01 Identity Resolver')
  .add(identityTrigger)
  .to(validateIdentityRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildIdentityResult))
      .onTrue(
        lookupExistingSecurity.to(
          securityAlreadyExists
            .onTrue(prepareCachedIdentity.to(finishPath))
            .onFalse(
              fetchEdgarTickers.to(
                resolveEdgarIdentity.to(
                  edgarResolved
                    .onTrue(
                      upsertCompany
                        .to(upsertSecurity)
                        .to(upsertTickerAlias)
                        .to(upsertLegalNameAlias)
                        .to(preparePersistedIdentity)
                        .to(finishPath),
                    )
                    .onFalse(
                      unresolvedAdvance
                        .to(logUnresolvedState)
                        .to(prepareUnresolvedResult)
                        .to(buildIdentityResult),
                    ),
                ),
              ),
            ),
        ),
      ),
  )
  .add(intakeNote)
  .add(edgarNote)
  .add(gateNote);
