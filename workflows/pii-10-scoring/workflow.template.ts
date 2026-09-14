import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateScoringRequestCode = `__VALIDATE_SCORING_REQUEST__`;
const evaluateScoringQualityCode = `__EVALUATE_SCORING_QUALITY__`;
const attachScoreIdCode = `__ATTACH_SCORE_ID__`;
const expandScoreComponentsCode = `__EXPAND_SCORE_COMPONENTS__`;
const prepareScoringAggregateCode = `__PREPARE_SCORING_AGGREGATE__`;
const buildScoringResultCode = `__BUILD_SCORING_RESULT__`;

const scoringTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Scoring Gate Trigger',
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

const validateScoringRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Scoring Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateScoringRequestCode,
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
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: 'REASSESS_OR_EXCLUDE',
            type: 'string',
          },
          { id: 'claim-count', name: 'claim_count', value: 0, type: 'number' },
          {
            id: 'gates-failed',
            name: 'gates_failed',
            value: expr('{{ [] }}'),
            type: 'array',
          },
          { id: 'scores', name: 'scores', value: expr('{{ ({}) }}'), type: 'object' },
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, rc.configuration_version_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Scoring Request").item.json.case_id }}'),
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
        queryReplacement: expr('{{ $("Validate Scoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT c.id, c.claim_category, c.claim_text, c.claim_kind, c.confidence, c.materiality, c.extraction_method, c.model_version, COALESCE((SELECT COUNT(*)::int FROM claim_evidence_links cel WHERE cel.claim_id = c.id), 0) AS evidence_link_count FROM claims c WHERE c.case_id = $1::uuid AND c.is_active = TRUE ORDER BY c.created_at ASC",
      options: {
        queryReplacement: expr('{{ $("Validate Scoring Request").item.json.case_id }}'),
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
        'SELECT id AS configuration_version_id, version_label, gates_json, scores_json, freshness_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const evaluateScoringQuality = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Scoring Quality',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateScoringQualityCode,
    },
  },
});

const upsertScores = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Scores',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO scores (case_id, configuration_version_id, business_quality_score, growth_score, pipeline_score, valuation_context_score, risk_score, evidence_confidence_score, data_freshness_score, research_priority_score, outcome_class, hard_stop) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, NULLIF(NULLIF(TRIM($3), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($4), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($5), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($6), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($7), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($8), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($9), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($10), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($11), ''), 'null'), (NULLIF(TRIM($12), '') = 'true')) ON CONFLICT (case_id) DO UPDATE SET configuration_version_id = EXCLUDED.configuration_version_id, business_quality_score = EXCLUDED.business_quality_score, growth_score = EXCLUDED.growth_score, pipeline_score = EXCLUDED.pipeline_score, valuation_context_score = EXCLUDED.valuation_context_score, risk_score = EXCLUDED.risk_score, evidence_confidence_score = EXCLUDED.evidence_confidence_score, data_freshness_score = EXCLUDED.data_freshness_score, research_priority_score = EXCLUDED.research_priority_score, outcome_class = EXCLUDED.outcome_class, hard_stop = EXCLUDED.hard_stop, updated_at = NOW() RETURNING id AS score_id, case_id",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.configuration_version_id }},{{ $json.business_quality_score }},{{ $json.growth_score }},{{ $json.pipeline_score }},{{ $json.valuation_context_score }},{{ $json.risk_score }},{{ $json.evidence_confidence_score }},{{ $json.data_freshness_score }},{{ $json.research_priority_score }},{{ $json.outcome_class }},{{ $json.hard_stop_sql }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const attachScoreId = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Attach Score Id',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: attachScoreIdCode,
    },
  },
});

const deleteScoreComponents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Delete Score Components',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'DELETE FROM score_components WHERE score_id = $1::uuid',
      options: {
        queryReplacement: expr('{{ $json.score_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const reattachAfterDelete = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore Scoring Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}
const attached = nodeJson('Attach Score Id') || {};
return [{ json: attached }];
`,
    },
  },
});

const expandScoreComponents = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Score Components',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandScoreComponentsCode,
    },
  },
});

const hasComponents = ifElse({
  version: 2.3,
  config: {
    name: 'Has Score Components?',
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
            leftValue: expr('{{ $json.skip_component }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertScoreComponents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Score Components',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO score_components (score_id, component_key, parent_score_key, raw_value, normalized_value, weight, contribution, missing, notes) VALUES ($1::uuid, $2, $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($5), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($6), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($7), ''), 'null')::numeric, (NULLIF(TRIM($8), '') = 'true'), NULLIF(NULLIF(TRIM($9), ''), 'null')) ON CONFLICT (score_id, component_key) DO UPDATE SET raw_value = EXCLUDED.raw_value, normalized_value = EXCLUDED.normalized_value, weight = EXCLUDED.weight, contribution = EXCLUDED.contribution, missing = EXCLUDED.missing, notes = EXCLUDED.notes RETURNING id AS component_id",
      options: {
        queryReplacement: expr(
          '{{ $json.score_id }},{{ $json.component_key }},{{ $json.parent_score_key }},{{ $json.raw_value }},{{ $json.normalized_value }},{{ $json.weight }},{{ $json.contribution }},{{ $json.missing_sql }},{{ $json.notes }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareScoringAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Scoring Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareScoringAggregateCode,
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
        'UPDATE research_cases SET state = $2, outcome_class = $3, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, outcome_class, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.next_state }},{{ $json.outcome_class }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logScoringState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Scoring State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ANALYZING', $2, $3, 'pii-10', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Evaluate Scoring Quality").first().json.reason }},{{ $("Evaluate Scoring Quality").first().json.n8n_execution_id }}',
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
    name: 'Log PII-10 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-10', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Scoring Quality").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Scoring Quality").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeScoringOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Scoring Output',
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
            value: expr('{{ $("Evaluate Scoring Quality").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.outcome }}'),
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
            value: expr('{{ $("Evaluate Scoring Quality").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: expr('{{ $("Advance Case State").first().json.outcome_class }}'),
            type: 'string',
          },
          {
            id: 'hard-stop',
            name: 'hard_stop',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.hard_stop }}'),
            type: 'boolean',
          },
          {
            id: 'score-id',
            name: 'score_id',
            value: expr('{{ $("Upsert Scores").first().json.score_id }}'),
            type: 'string',
          },
          {
            id: 'scores',
            name: 'scores',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.scores }}'),
            type: 'object',
          },
          {
            id: 'gates-failed',
            name: 'gates_failed',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.gates_failed }}'),
            type: 'array',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildScoringResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Scoring Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildScoringResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-10 Scoring Gate\nPhase 1: coverage-aware scores from claims/evidence.\nNo LLM arithmetic. Quality gates fail honestly without XBRL/report.',
  [scoringTrigger, validateScoringRequest, loadClaims],
  { color: 4 },
);

const scoresNote = sticky(
  '## Persistence\nUpsert scores + score_components.\nSet research_cases.outcome_class.',
  [evaluateScoringQuality, upsertScores, insertScoreComponents],
  { color: 5 },
);

const stateNote = sticky(
  '## State\nExpected Phase 1: AWAITING_HUMAN_REVIEW + MONITOR.\nCOMPLETE only if all gates pass (rare until PII-03/PII-11).',
  [advanceCaseState, buildScoringResult],
  { color: 6 },
);

const finishPath = advanceCaseState
  .to(logScoringState)
  .to(logWorkflowRun)
  .to(mergeScoringOutput)
  .to(buildScoringResult);

const afterComponentsPath = hasComponents
  .onTrue(insertScoreComponents.to(prepareScoringAggregate.to(finishPath)))
  .onFalse(prepareScoringAggregate.to(finishPath));

export default workflow('pii-10-scoring', 'PII-10 Scoring and Quality Gate')
  .add(scoringTrigger)
  .to(validateScoringRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildScoringResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadEvidenceDocuments.to(
            loadClaims.to(
              loadAnalysisConfig.to(
                evaluateScoringQuality.to(
                  upsertScores.to(
                    attachScoreId.to(
                      deleteScoreComponents.to(
                        reattachAfterDelete.to(
                          expandScoreComponents.to(afterComponentsPath),
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
  .add(scoresNote)
  .add(stateNote);
