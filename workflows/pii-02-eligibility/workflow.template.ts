import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateEligibilityRequestCode = `__VALIDATE_ELIGIBILITY_REQUEST__`;
const evaluateEligibilityCode = `__EVALUATE_ELIGIBILITY__`;
const buildEligibilityResultCode = `__BUILD_ELIGIBILITY_RESULT__`;

const eligibilityTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Eligibility Gate Trigger',
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
      case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateEligibilityRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Eligibility Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateEligibilityRequestCode,
    },
  },
  output: [
    {
      valid: true,
      case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
      ticker: 'ACAD',
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
          {
            id: 'outcome',
            name: 'outcome',
            value: 'HUMAN_REVIEW',
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
            id: 'rules',
            name: 'rules',
            value: expr('{{ [] }}'),
            type: 'array',
          },
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, c.cik, c.legal_name, c.sector, c.industry, c.website_url, s.listing_status, s.security_type FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id LEFT JOIN securities s ON s.id = rc.security_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Eligibility Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadActiveConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Active Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, eligibility_json, gates_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const countDuplicateCases = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Count Duplicate Cases',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COUNT(*)::int AS duplicate_count FROM research_cases WHERE ticker = $2 AND COALESCE(exchange, '') = COALESCE($3, '') AND id <> $1::uuid AND created_at >= NOW() - make_interval(days => $4::int) AND state NOT IN ('FAILED', 'SUPERSEDED')",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Eligibility Request").item.json.case_id }},{{ $("Validate Eligibility Request").item.json.ticker }},{{ $("Validate Eligibility Request").item.json.exchange }},{{ $("Load Active Config").item.json.eligibility_json.duplicate_lookback_days || 30 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const twelveDataAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

const fetchTwelveDataProfile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Profile',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/profile',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
          {
            name: 'exchange',
            value: expr('{{ $("Validate Eligibility Request").item.json.exchange }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('TwelveData API key'),
    },
  },
});

const fetchTwelveDataStatistics = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Statistics',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/statistics',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
          {
            name: 'exchange',
            value: expr('{{ $("Validate Eligibility Request").item.json.exchange }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('TwelveData API key'),
    },
  },
});

const fetchTwelveDataQuote = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Quote',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/quote',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
          {
            name: 'exchange',
            value: expr('{{ $("Validate Eligibility Request").item.json.exchange }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('TwelveData API key'),
    },
  },
});

const finnhubAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

// Fallback when TwelveData /profile (Grow+) or /statistics (Pro+) return plan 403s.
const fetchFinnhubProfile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Finnhub Profile',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://finnhub.io/api/v1/stock/profile2',
      ...finnhubAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('Finnhub API key'),
    },
  },
});

const evaluateEligibility = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Eligibility',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateEligibilityCode,
    },
  },
});

const hasCompany = ifElse({
  version: 2.3,
  config: {
    name: 'Has Company?',
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
            leftValue: expr('{{ $json.has_company }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const updateCompanyProfile = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Update Company Profile',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE companies SET sector = NULLIF($2, ''), industry = NULLIF($3, ''), website_url = NULLIF($4, ''), updated_at = NOW() WHERE id = $1::uuid RETURNING id AS company_id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Eligibility").item.json.company_id }},{{ $("Evaluate Eligibility").item.json.sector_safe }},{{ $("Evaluate Eligibility").item.json.industry_safe }},{{ $("Evaluate Eligibility").item.json.website_safe }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareAdvanceFields = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Advance Fields',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Evaluate Eligibility").item.json.next_state }}'),
            type: 'string',
          },
          {
            id: 'config-id',
            name: 'configuration_version_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.configuration_version_id }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Eligibility").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Evaluate Eligibility").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'rules-b64',
            name: 'rules_b64',
            value: expr('{{ $("Evaluate Eligibility").item.json.rules_b64 }}'),
            type: 'string',
          },
          {
            id: 'market-cap',
            name: 'market_cap_usd',
            value: expr('{{ $("Evaluate Eligibility").item.json.market_cap_usd }}'),
            type: 'number',
          },
          {
            id: 'adv',
            name: 'adv_dollar_usd',
            value: expr('{{ $("Evaluate Eligibility").item.json.adv_dollar_usd }}'),
            type: 'number',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Eligibility").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Eligibility").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Evaluate Eligibility").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Eligibility").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'sector',
            name: 'sector',
            value: expr('{{ $("Evaluate Eligibility").item.json.sector }}'),
            type: 'string',
          },
          {
            id: 'industry',
            name: 'industry',
            value: expr('{{ $("Evaluate Eligibility").item.json.industry }}'),
            type: 'string',
          },
          {
            id: 'exec-id',
            name: 'n8n_execution_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.n8n_execution_id }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Evaluate Eligibility").item.json.provenance }}'),
            type: 'string',
          },
        ],
      },
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
        'UPDATE research_cases SET state = $2, configuration_version_id = NULLIF($3, \'\')::uuid, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, configuration_version_id, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.next_state }},{{ $json.configuration_version_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logEligibilityState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Eligibility State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ELIGIBILITY_REVIEW', $2, $3, 'pii-02', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Advance Case State").item.json.state }},{{ $("Prepare Advance Fields").item.json.reason }},{{ $("Prepare Advance Fields").item.json.n8n_execution_id }}',
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
    name: 'Log PII-02 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-02', $2, $3::uuid, 'SUCCEEDED', jsonb_build_object('outcome', $4, 'next_state', $5, 'market_cap_usd', NULLIF(NULLIF(TRIM($6), ''), 'null')::numeric, 'adv_dollar_usd', NULLIF(NULLIF(TRIM($7), ''), 'null')::numeric, 'rules', convert_from(decode($8, 'base64'), 'UTF8')::jsonb)) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Prepare Advance Fields").item.json.n8n_execution_id }},{{ $("Advance Case State").item.json.case_id }},{{ $("Prepare Advance Fields").item.json.outcome }},{{ $("Advance Case State").item.json.state }},{{ $("Prepare Advance Fields").item.json.market_cap_usd }},{{ $("Prepare Advance Fields").item.json.adv_dollar_usd }},{{ $("Prepare Advance Fields").item.json.rules_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeEligibilityOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Eligibility Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Prepare Advance Fields").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Prepare Advance Fields").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Advance Fields").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Advance Fields").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Prepare Advance Fields").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Prepare Advance Fields").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'config-id',
            name: 'configuration_version_id',
            value: expr('{{ $("Advance Case State").item.json.configuration_version_id }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Advance Fields").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").item.json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Advance Fields").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'sector',
            name: 'sector',
            value: expr('{{ $("Prepare Advance Fields").item.json.sector }}'),
            type: 'string',
          },
          {
            id: 'industry',
            name: 'industry',
            value: expr('{{ $("Prepare Advance Fields").item.json.industry }}'),
            type: 'string',
          },
          {
            id: 'market-cap',
            name: 'market_cap_usd',
            value: expr('{{ $("Prepare Advance Fields").item.json.market_cap_usd }}'),
            type: 'number',
          },
          {
            id: 'adv',
            name: 'adv_dollar_usd',
            value: expr('{{ $("Prepare Advance Fields").item.json.adv_dollar_usd }}'),
            type: 'number',
          },
          {
            id: 'rules',
            name: 'rules',
            value: expr('{{ $("Evaluate Eligibility").item.json.rules }}'),
            type: 'array',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Evaluate Eligibility").item.json.provenance }}'),
            type: 'string',
          },
        ],
      },
    },
  },
});

const buildEligibilityResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Eligibility Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildEligibilityResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-02 Eligibility Gate\nSubworkflow input: case_id, ticker, exchange\nLoads case + active eligibility_json then TwelveData profile/statistics/quote.',
  [eligibilityTrigger, validateEligibilityRequest, loadCaseAndCompany],
  { color: 4 },
);

const marketNote = sticky(
  '## Market data\nTwelveData profile/statistics/quote + Finnhub profile2 fallback (plan 403s).\nonError continue → evaluate uses whichever sources succeed.',
  [fetchTwelveDataProfile, fetchTwelveDataStatistics, fetchTwelveDataQuote, fetchFinnhubProfile],
  { color: 5 },
);

const gateNote = sticky(
  '## Outcomes\nPASS / PASS_WITH_EXCEPTION → COLLECTING\nHUMAN_REVIEW → AWAITING_HUMAN_REVIEW\nFAIL → INCOMPLETE',
  [evaluateEligibility, advanceCaseState, buildEligibilityResult],
  { color: 6 },
);

const finishPath = prepareAdvanceFields
  .to(advanceCaseState)
  .to(logEligibilityState)
  .to(logWorkflowRun)
  .to(mergeEligibilityOutput)
  .to(buildEligibilityResult);

export default workflow('pii-02-eligibility', 'PII-02 Eligibility Gate')
  .add(eligibilityTrigger)
  .to(validateEligibilityRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildEligibilityResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadActiveConfig.to(
            countDuplicateCases.to(
              fetchTwelveDataProfile.to(
                fetchTwelveDataStatistics.to(
                  fetchTwelveDataQuote.to(
                    fetchFinnhubProfile.to(
                      evaluateEligibility.to(
                        hasCompany
                          .onTrue(updateCompanyProfile.to(finishPath))
                          .onFalse(finishPath),
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
  .add(marketNote)
  .add(gateNote);
