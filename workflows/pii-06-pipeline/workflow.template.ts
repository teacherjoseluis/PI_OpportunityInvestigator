import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validatePipelineRequestCode = `__VALIDATE_PIPELINE_REQUEST__`;
const evaluatePipelineClinicalCode = `__EVALUATE_PIPELINE_CLINICAL__`;
const expandPipelineClaimsCode = `__EXPAND_PIPELINE_CLAIMS__`;
const expandPipelineClaimLinksCode = `__EXPAND_PIPELINE_CLAIM_LINKS__`;
const preparePipelineAggregateCode = `__PREPARE_PIPELINE_AGGREGATE__`;
const buildPipelineResultCode = `__BUILD_PIPELINE_RESULT__`;

const pipelineTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Pipeline Analyst Trigger',
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

const validatePipelineRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Pipeline Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validatePipelineRequestCode,
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
        queryReplacement: expr('{{ $("Validate Pipeline Request").item.json.case_id }}'),
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
        queryReplacement: expr('{{ $("Validate Pipeline Request").item.json.case_id }}'),
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

const evaluatePipelineClinical = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Pipeline Clinical',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluatePipelineClinicalCode,
    },
  },
});

const expandPipelineClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Pipeline Claims',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandPipelineClaimsCode,
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

const insertPipelineClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Pipeline Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claims (case_id, claim_text, claim_category, claim_kind, confidence, materiality, extraction_method, model_version, is_active) VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7, 'pii-06-v1', TRUE) RETURNING id AS claim_id, case_id, claim_text",
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
      jsCode: expandPipelineClaimLinksCode,
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

const preparePipelineAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Pipeline Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: preparePipelineAggregateCode,
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
      jsCode: preparePipelineAggregateCode,
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

const logPipelineState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Pipeline State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ANALYZING', $2, $3, 'pii-06', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Evaluate Pipeline Clinical").first().json.reason }},{{ $("Evaluate Pipeline Clinical").first().json.n8n_execution_id }}',
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
    name: 'Log PII-06 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-06', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Pipeline Clinical").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Pipeline Clinical").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergePipelineOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Pipeline Output',
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
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.outcome }}'),
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
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.insufficient_topics }}'),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Pipeline Clinical").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildPipelineResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Pipeline Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildPipelineResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-06 Pipeline Analyst\nPhase 1: deterministic pipeline claims from CT.gov metadata (+ light SEC).\nDistinct from growth. No invented efficacy/safety.',
  [pipelineTrigger, validatePipelineRequest, loadEvidenceDocuments],
  { color: 4 },
);

const claimsNote = sticky(
  '## Claims\nPersist claims + claim_evidence_links.\nExplicit INSUFFICIENT_EVIDENCE for ownership, endpoints, enrollment, efficacy, safety, designations, competition, PoS.',
  [evaluatePipelineClinical, insertPipelineClaims, insertClaimEvidenceLinks],
  { color: 5 },
);

const stateNote = sticky(
  '## State\nStay in ANALYZING for later analysts.\nHard failure only → INCOMPLETE.',
  [advanceCaseState, buildPipelineResult],
  { color: 6 },
);

const finishPath = advanceCaseState
  .to(logPipelineState)
  .to(logWorkflowRun)
  .to(mergePipelineOutput)
  .to(buildPipelineResult);

const afterClaimsPath = expandClaimEvidenceLinks.to(
  hasLinks
    .onTrue(insertClaimEvidenceLinks.to(preparePipelineAggregate.to(finishPath)))
    .onFalse(preparePipelineAggregate.to(finishPath)),
);

export default workflow('pii-06-pipeline', 'PII-06 Pipeline and Clinical Analyst')
  .add(pipelineTrigger)
  .to(validatePipelineRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildPipelineResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadEvidenceDocuments.to(
            loadAnalysisConfig.to(
              evaluatePipelineClinical.to(
                expandPipelineClaims.to(
                  hasClaims
                    .onTrue(insertPipelineClaims.to(afterClaimsPath))
                    .onFalse(prepareZeroClaims.to(finishPath)),
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
