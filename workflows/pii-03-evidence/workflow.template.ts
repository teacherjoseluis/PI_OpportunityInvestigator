import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateCollectionRequestCode = `__VALIDATE_COLLECTION_REQUEST__`;
const normalizeSecEvidenceCode = `__NORMALIZE_SEC_EVIDENCE__`;
const normalizeCtgovEvidenceCode = `__NORMALIZE_CTGOV_EVIDENCE__`;
const expandEvidenceDocumentsCode = `__EXPAND_EVIDENCE_DOCUMENTS__`;
const countSecUpsertsCode = `__COUNT_SEC_UPSERTS__`;
const countCtgovUpsertsCode = `__COUNT_CTGOV_UPSERTS__`;
const prepareCtgovZeroCountCode = `__PREPARE_CTGOV_ZERO_COUNT__`;
const evaluateCollectionCoverageCode = `__EVALUATE_COLLECTION_COVERAGE__`;
const buildCollectionResultCode = `__BUILD_COLLECTION_RESULT__`;

const collectionTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Evidence Collect Trigger',
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
      case_id: '91815cf2-865d-4173-8263-f490cc129608',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateCollectionRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Collection Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateCollectionRequestCode,
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
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
          {
            id: 'status',
            name: 'collector_status',
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Collection Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadCollectionConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Collection Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, gates_json, freshness_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const fetchSecSubmissions = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch SEC Submissions',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: expr(
        '=https://data.sec.gov/submissions/CIK{{ $("Load Case And Company").item.json.cik }}.json',
      ),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
          { name: 'Accept', value: 'application/json' },
          { name: 'Accept-Encoding', value: 'gzip, deflate' },
        ],
      },
      options: {
        timeout: 60000,
        lowercaseHeaders: false,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const normalizeSecEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize SEC Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeSecEvidenceCode,
    },
  },
});

const expandSecDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand SEC Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasSecDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has SEC Docs?',
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

const upsertEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'metadata_only', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertSecEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert SEC Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceSql,
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.source_type }},{{ $json.publisher }},{{ $json.canonical_url }},{{ $json.stable_source_id }},{{ $json.title_safe }},{{ $json.publication_date }},{{ $json.content_sha256 }},{{ $json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countSecUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count SEC Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countSecUpsertsCode,
    },
  },
});

const prepareSecZeroCount = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare SEC Zero Count',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Normalize SEC Evidence").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Normalize SEC Evidence").item.json.company_id }}'),
            type: 'string',
          },
          { id: 'sec-count', name: 'sec_stored_count', value: 0, type: 'number' },
          { id: 'sec-ok', name: 'sec_ok', value: false, type: 'boolean' },
        ],
      },
    },
  },
});

const fetchCtgovStudies = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch CT.gov Studies',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://clinicaltrials.gov/api/v2/studies',
      authentication: 'none',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'query.spons',
            value: expr('{{ $("Load Case And Company").item.json.legal_name }}'),
          },
          {
            name: 'pageSize',
            value: expr(
              '{{ $("Load Collection Config").item.json.gates_json.collection.ctgov_page_size || 20 }}',
            ),
          },
          { name: 'format', value: 'json' },
        ],
      },
      options: {
        timeout: 60000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const normalizeCtgovEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize CT.gov Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeCtgovEvidenceCode,
    },
  },
});

const expandCtgovDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand CT.gov Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasCtgovDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has CT.gov Docs?',
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

const upsertCtgovEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert CT.gov Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceSql,
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.source_type }},{{ $json.publisher }},{{ $json.canonical_url }},{{ $json.stable_source_id }},{{ $json.title_safe }},{{ $json.publication_date }},{{ $json.content_sha256 }},{{ $json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countCtgovUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count CT.gov Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countCtgovUpsertsCode,
    },
  },
});

const prepareCtgovZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare CT.gov Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCtgovZeroCountCode,
    },
  },
});

const evaluateCollectionCoverage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Collection Coverage',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateCollectionCoverageCode,
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

const logCollectionState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Collection State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'COLLECTING', $2, $3, 'pii-03', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Advance Case State").item.json.state }},{{ $("Evaluate Collection Coverage").item.json.reason }},{{ $("Evaluate Collection Coverage").item.json.n8n_execution_id }}',
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
    name: 'Log PII-03 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-03', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Evaluate Collection Coverage").item.json.n8n_execution_id }},{{ $("Advance Case State").item.json.case_id }},{{ $("Evaluate Collection Coverage").item.json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeCollectionOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Collection Output',
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
            value: expr('{{ $("Evaluate Collection Coverage").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.outcome }}'),
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
            value: expr('{{ $("Evaluate Collection Coverage").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.counts }}'),
            type: 'object',
          },
          {
            id: 'status',
            name: 'collector_status',
            value: expr('{{ $("Evaluate Collection Coverage").item.json.collector_status }}'),
            type: 'array',
          },
        ],
      },
    },
  },
});

const buildCollectionResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Collection Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildCollectionResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-03 Evidence Collector\nPhase 1: SEC submissions + ClinicalTrials.gov.\nDeferred: FDA, IR, patents, full filing bodies, object storage.',
  [collectionTrigger, validateCollectionRequest, loadCaseAndCompany],
  { color: 4 },
);

const collectorsNote = sticky(
  '## Collectors\nSEC Fair Access User-Agent required.\nUpsert evidence_documents by content_sha256.',
  [fetchSecSubmissions, fetchCtgovStudies, upsertSecEvidence],
  { color: 5 },
);

const coverageNote = sticky(
  '## Coverage\nmin_sec_documents default 1 → ANALYZING.\nPARTIAL still advances unless config requires human review.',
  [evaluateCollectionCoverage, advanceCaseState, buildCollectionResult],
  { color: 6 },
);

const finishPath = evaluateCollectionCoverage
  .to(advanceCaseState)
  .to(logCollectionState)
  .to(logWorkflowRun)
  .to(mergeCollectionOutput)
  .to(buildCollectionResult);

const ctgovAndFinish = fetchCtgovStudies.to(
  normalizeCtgovEvidence.to(
    expandCtgovDocuments.to(
      hasCtgovDocs
        .onTrue(upsertCtgovEvidence.to(countCtgovUpserts.to(finishPath)))
        .onFalse(prepareCtgovZeroCount.to(finishPath)),
    ),
  ),
);

export default workflow('pii-03-evidence', 'PII-03 Evidence Collector')
  .add(collectionTrigger)
  .to(validateCollectionRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildCollectionResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadCollectionConfig.to(
            fetchSecSubmissions.to(
              normalizeSecEvidence.to(
                expandSecDocuments.to(
                  hasSecDocs
                    .onTrue(upsertSecEvidence.to(countSecUpserts.to(ctgovAndFinish)))
                    .onFalse(prepareSecZeroCount.to(ctgovAndFinish)),
                ),
              ),
            ),
          ),
        ),
      ),
  )
  .add(intakeNote)
  .add(collectorsNote)
  .add(coverageNote);
