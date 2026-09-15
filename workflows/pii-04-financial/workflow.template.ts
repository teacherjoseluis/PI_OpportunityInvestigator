import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateFinancialRequestCode = `__VALIDATE_FINANCIAL_REQUEST__`;
const evaluateFinancialBusinessCode = `__EVALUATE_FINANCIAL_BUSINESS__`;
const expandFinancialClaimsCode = `__EXPAND_FINANCIAL_CLAIMS__`;
const expandClaimEvidenceLinksCode = `__EXPAND_CLAIM_EVIDENCE_LINKS__`;
const prepareFinancialAggregateCode = `__PREPARE_FINANCIAL_AGGREGATE__`;
const buildFinancialResultCode = `__BUILD_FINANCIAL_RESULT__`;

const financialTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Financial Analyst Trigger',
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

const validateFinancialRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Financial Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateFinancialRequestCode,
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
          { id: 'next-state', name: 'next_state', value: 'INCOMPLETE', type: 'string' },
          { id: 'reason', name: 'reason', value: 'validation_failed', type: 'string' },
          { id: 'claim-count', name: 'claim_count', value: 0, type: 'number' },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ [] }}'),
            type: 'array',
          },
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Financial Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadEvidenceDocuments = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Evidence Documents',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id, source_type, publisher, stable_source_id, title, publication_date, metadata_json FROM evidence_documents WHERE case_id = $1::uuid ORDER BY created_at ASC',
      options: {
        queryReplacement: expr('{{ $("Validate Financial Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadFinancialMetrics = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Financial Metrics',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT fm.metric_key, fm.metric_value, fm.currency, fm.unit, fm.assumption_set, fm.source_evidence_id, fm.calculation_notes, fp.period_label, fp.period_end, fp.period_start, fp.fiscal_year, fp.fiscal_quarter FROM financial_metrics fm JOIN financial_periods fp ON fp.id = fm.financial_period_id WHERE fp.case_id = $1::uuid OR fp.company_id = NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid ORDER BY fp.period_end DESC NULLS LAST, fm.metric_key ASC",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Financial Request").item.json.case_id }},{{ $("Load Case And Company").item.json.company_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadAnalysisConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Analysis Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, gates_json, scores_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const evaluateFinancialBusiness = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Financial Business',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateFinancialBusinessCode,
    },
  },
});

const expandFinancialClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Financial Claims',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandFinancialClaimsCode,
    },
  },
});

const hasClaims = ifElse({
  version: 2.3,
  config: {
    name: 'Has Claims?',
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
            leftValue: expr('{{ $json.skip_upsert }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertFinancialClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Financial Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claims (case_id, claim_text, claim_category, claim_kind, confidence, materiality, extraction_method, model_version, is_active) VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7, 'pii-04-v1', TRUE) RETURNING id AS claim_id, case_id, claim_text",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.claim_text }},{{ $json.claim_category }},{{ $json.claim_kind }},{{ $json.confidence }},{{ $json.materiality }},{{ $json.extraction_method }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const expandClaimEvidenceLinks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Claim Evidence Links',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandClaimEvidenceLinksCode,
    },
  },
});

const hasLinks = ifElse({
  version: 2.3,
  config: {
    name: 'Has Claim Links?',
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
            leftValue: expr('{{ $json.skip_link }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertClaimEvidenceLinks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Claim Evidence Links',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claim_evidence_links (claim_id, evidence_id, link_role) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (claim_id, evidence_id, link_role) DO NOTHING RETURNING id AS link_id",
      options: {
        queryReplacement: expr(
          '{{ $json.claim_id }},{{ $json.evidence_id }},{{ $json.link_role }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareFinancialAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Financial Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareFinancialAggregateCode,
    },
  },
});

const prepareZeroClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Zero Claims Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareFinancialAggregateCode,
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
        'UPDATE research_cases SET state = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr('{{ $json.case_id }},{{ $json.next_state }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logFinancialState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Financial State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ANALYZING', $2, $3, 'pii-04', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Evaluate Financial Business").first().json.reason }},{{ $("Evaluate Financial Business").first().json.n8n_execution_id }}',
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
    name: 'Log PII-04 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-04', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Financial Business").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Financial Business").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeFinancialOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Financial Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Evaluate Financial Business").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Financial Business").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Financial Business").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Financial Business").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Financial Business").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").first().json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Evaluate Financial Business").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Evaluate Financial Business").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ $("Evaluate Financial Business").first().json.insufficient_topics }}'),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Financial Business").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildFinancialResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Financial Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildFinancialResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-04 Financial Analyst\nDeterministic claims from SEC/CT.gov metadata + Slice E1 XBRL cash/debt metrics.\nNo LLM. No invented cash/runway numbers.',
  [financialTrigger, validateFinancialRequest, loadEvidenceDocuments],
  { color: 4 },
);

const claimsNote = sticky(
  '## Claims\nPersist claims + claim_evidence_links.\nCash/debt facts when financial_metrics present; else INSUFFICIENT_EVIDENCE.',
  [evaluateFinancialBusiness, insertFinancialClaims, insertClaimEvidenceLinks],
  { color: 5 },
);

const stateNote = sticky(
  '## State\nStay in ANALYZING for later analysts.\nHard failure only → INCOMPLETE.',
  [advanceCaseState, buildFinancialResult],
  { color: 6 },
);

const finishPath = advanceCaseState
  .to(logFinancialState)
  .to(logWorkflowRun)
  .to(mergeFinancialOutput)
  .to(buildFinancialResult);

const afterClaimsPath = expandClaimEvidenceLinks.to(
  hasLinks
    .onTrue(insertClaimEvidenceLinks.to(prepareFinancialAggregate.to(finishPath)))
    .onFalse(prepareFinancialAggregate.to(finishPath)),
);

export default workflow('pii-04-financial', 'PII-04 Financial and Business Analyst')
  .add(financialTrigger)
  .to(validateFinancialRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildFinancialResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadEvidenceDocuments.to(
            loadFinancialMetrics.to(
              loadAnalysisConfig.to(
                evaluateFinancialBusiness.to(
                  expandFinancialClaims.to(
                    hasClaims
                      .onTrue(insertFinancialClaims.to(afterClaimsPath))
                      .onFalse(prepareZeroClaims.to(finishPath)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
  )
  .add(intakeNote)
  .add(claimsNote)
  .add(stateNote);
