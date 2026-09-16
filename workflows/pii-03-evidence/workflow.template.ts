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
const normalizeSecXbrlEvidenceCode = `__NORMALIZE_SEC_XBRL_EVIDENCE__`;
const normalizeCtgovEvidenceCode = `__NORMALIZE_CTGOV_EVIDENCE__`;
const prepareOpenfdaQueryCode = `__PREPARE_OPENFDA_QUERY__`;
const normalizeFdaOpenfdaEvidenceCode = `__NORMALIZE_FDA_OPENFDA_EVIDENCE__`;
const prepareCompanyNewsQueryCode = `__PREPARE_COMPANY_NEWS_QUERY__`;
const normalizeCompanyNewsEvidenceCode = `__NORMALIZE_COMPANY_NEWS_EVIDENCE__`;
const expandEvidenceDocumentsCode = `__EXPAND_EVIDENCE_DOCUMENTS__`;
const prepareEvidenceChunkUpsertsCode = `__PREPARE_EVIDENCE_CHUNK_UPSERTS__`;
const countSecUpsertsCode = `__COUNT_SEC_UPSERTS__`;
const countCtgovUpsertsCode = `__COUNT_CTGOV_UPSERTS__`;
const prepareCtgovZeroCountCode = `__PREPARE_CTGOV_ZERO_COUNT__`;
const prepareXbrlFinancialUpsertsCode = `__PREPARE_XBRL_FINANCIAL_UPSERTS__`;
const countXbrlUpsertsCode = `__COUNT_XBRL_UPSERTS__`;
const prepareXbrlZeroCountCode = `__PREPARE_XBRL_ZERO_COUNT__`;
const countFdaUpsertsCode = `__COUNT_FDA_UPSERTS__`;
const prepareFdaZeroCountCode = `__PREPARE_FDA_ZERO_COUNT__`;
const countCompanyNewsUpsertsCode = `__COUNT_COMPANY_NEWS_UPSERTS__`;
const prepareCompanyNewsZeroCountCode = `__PREPARE_COMPANY_NEWS_ZERO_COUNT__`;
const prepareUsptoQueryCode = `__PREPARE_USPTO_QUERY__`;
const normalizeUsptoPatentsEvidenceCode = `__NORMALIZE_USPTO_PATENTS_EVIDENCE__`;
const countUsptoUpsertsCode = `__COUNT_USPTO_UPSERTS__`;
const prepareUsptoZeroCountCode = `__PREPARE_USPTO_ZERO_COUNT__`;
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

const upsertEvidenceChunkSql =
  "INSERT INTO evidence_chunks (evidence_id, chunk_index, chunk_text, token_estimate, metadata_json) VALUES ($1::uuid, COALESCE(NULLIF(NULLIF(TRIM($2), ''), 'null')::integer, 0), $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::integer, convert_from(decode($5, 'base64'), 'UTF8')::jsonb) ON CONFLICT (evidence_id, chunk_index) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, token_estimate = EXCLUDED.token_estimate, metadata_json = EXCLUDED.metadata_json RETURNING id AS chunk_id, evidence_id";

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

const prepareSecEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare SEC Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasSecChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has SEC Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertSecEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert SEC Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
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

const fetchSecCompanyfacts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch SEC Companyfacts',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: expr(
        '=https://data.sec.gov/api/xbrl/companyfacts/CIK{{ $("Load Case And Company").item.json.cik }}.json',
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
        timeout: 90000,
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

const normalizeSecXbrlEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize SEC XBRL Facts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeSecXbrlEvidenceCode,
    },
  },
});

const expandXbrlDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand XBRL Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasXbrlDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has XBRL Docs?',
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

const upsertXbrlEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'xbrl_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertXbrlEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertXbrlEvidenceSql,
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

const prepareXbrlFinancialUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare XBRL Financial Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareXbrlFinancialUpsertsCode,
    },
  },
});

const upsertXbrlFinancialPeriod = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Financial Period',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO financial_periods (company_id, case_id, period_label, period_start, period_end, fiscal_year, fiscal_quarter, source_evidence_id) VALUES ($1::uuid, $2::uuid, $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::date, NULLIF(NULLIF(TRIM($5), ''), 'null')::date, NULLIF(NULLIF(TRIM($6), ''), 'null')::integer, NULLIF(NULLIF(TRIM($7), ''), 'null')::integer, $8::uuid) ON CONFLICT (company_id, period_label) DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, financial_periods.case_id), period_end = COALESCE(EXCLUDED.period_end, financial_periods.period_end), fiscal_year = COALESCE(EXCLUDED.fiscal_year, financial_periods.fiscal_year), fiscal_quarter = COALESCE(EXCLUDED.fiscal_quarter, financial_periods.fiscal_quarter), source_evidence_id = COALESCE(EXCLUDED.source_evidence_id, financial_periods.source_evidence_id), updated_at = NOW() RETURNING id AS financial_period_id, company_id, case_id",
      options: {
        queryReplacement: expr(
          '{{ $json.company_id }},{{ $json.case_id }},{{ $json.period_label }},{{ $json.period_start }},{{ $json.period_end }},{{ $json.fiscal_year }},{{ $json.fiscal_quarter }},{{ $json.evidence_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertXbrlFinancialMetrics = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Financial Metrics',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH metrics AS (SELECT * FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS x(metric_key text, metric_value numeric, currency text, unit text, scale text, assumption_set text, calculation_notes text)) INSERT INTO financial_metrics (financial_period_id, metric_key, metric_value, currency, unit, scale, assumption_set, source_evidence_id, calculation_notes) SELECT $1::uuid, metric_key, metric_value, COALESCE(currency, 'USD'), COALESCE(unit, 'USD'), COALESCE(scale, 'as_reported'), COALESCE(NULLIF(assumption_set, ''), 'reported'), $3::uuid, calculation_notes FROM metrics ON CONFLICT (financial_period_id, metric_key, assumption_set) DO UPDATE SET metric_value = EXCLUDED.metric_value, currency = EXCLUDED.currency, unit = EXCLUDED.unit, scale = EXCLUDED.scale, source_evidence_id = EXCLUDED.source_evidence_id, calculation_notes = EXCLUDED.calculation_notes RETURNING id AS financial_metric_id, metric_key",
      options: {
        queryReplacement: expr(
          '{{ $json.financial_period_id }},{{ $("Prepare XBRL Financial Upserts").item.json.metrics_b64 }},{{ $("Prepare XBRL Financial Upserts").item.json.evidence_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertXbrlEvidenceChunk = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert XBRL Evidence Chunk',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $("Prepare XBRL Financial Upserts").item.json.evidence_id }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_index }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_text }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_token_estimate }},{{ $("Prepare XBRL Financial Upserts").item.json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countXbrlUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count XBRL Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countXbrlUpsertsCode,
    },
  },
});

const prepareXbrlZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare XBRL Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareXbrlZeroCountCode,
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

const prepareCtgovEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare CT.gov Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasCtgovChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has CT.gov Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertCtgovEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert CT.gov Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
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

const prepareOpenfdaQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare OpenFDA Query',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareOpenfdaQueryCode,
    },
  },
});

const openfdaEnabled = ifElse({
  version: 2.3,
  config: {
    name: 'OpenFDA Enabled?',
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
            leftValue: expr('{{ $json.skip_fetch }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchOpenfdaDrugsfda = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch OpenFDA DrugsFDA',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: expr('={{ $("Prepare OpenFDA Query").item.json.openfda_url }}'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' },
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
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

const normalizeFdaOpenfdaEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize OpenFDA Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeFdaOpenfdaEvidenceCode,
    },
  },
});

const expandFdaDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand FDA Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasFdaDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has FDA Docs?',
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

const upsertFdaEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'fda_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertFdaEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert FDA Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertFdaEvidenceSql,
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

const prepareFdaEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare FDA Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasFdaChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has FDA Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertFdaEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert FDA Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countFdaUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count FDA Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countFdaUpsertsCode,
    },
  },
});

const prepareFdaZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare FDA Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareFdaZeroCountCode,
    },
  },
});

const finnhubAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

const prepareCompanyNewsQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Company News Query',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCompanyNewsQueryCode,
    },
  },
});

const companyNewsEnabled = ifElse({
  version: 2.3,
  config: {
    name: 'Company News Enabled?',
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
            leftValue: expr('{{ $json.skip_fetch }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchCompanyNews = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Company News',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://finnhub.io/api/v1/company-news',
      ...finnhubAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Prepare Company News Query").item.json.ticker }}'),
          },
          {
            name: 'from',
            value: expr('{{ $("Prepare Company News Query").item.json.from_date }}'),
          },
          {
            name: 'to',
            value: expr('{{ $("Prepare Company News Query").item.json.to_date }}'),
          },
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
    credentials: {
      httpQueryAuth: newCredential('Finnhub API key'),
    },
  },
});

const normalizeCompanyNewsEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Company News Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeCompanyNewsEvidenceCode,
    },
  },
});

const expandCompanyNewsDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Company News Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasCompanyNewsDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has Company News Docs?',
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

const upsertCompanyNewsEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'secondary', 'retrieved', 'news_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertCompanyNewsEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Company News Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertCompanyNewsEvidenceSql,
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

const prepareCompanyNewsEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Company News Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasCompanyNewsChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has Company News Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertCompanyNewsEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Company News Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countCompanyNewsUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count Company News Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countCompanyNewsUpsertsCode,
    },
  },
});

const prepareCompanyNewsZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Company News Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCompanyNewsZeroCountCode,
    },
  },
});

const usptoAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
};

const prepareUsptoQuery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare USPTO Query',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareUsptoQueryCode,
    },
  },
});

const usptoEnabled = ifElse({
  version: 2.3,
  config: {
    name: 'USPTO Patents Enabled?',
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
            leftValue: expr('{{ $json.skip_fetch }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchUsptoPatents = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch USPTO Patents',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.uspto.gov/api/v1/patent/applications/search',
      ...usptoAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'q',
            value: expr('{{ $("Prepare USPTO Query").item.json.query }}'),
          },
          {
            name: 'limit',
            value: expr('{{ $("Prepare USPTO Query").item.json.uspto_patents_limit }}'),
          },
          {
            name: 'fields',
            value:
              'applicationNumberText,applicationMetaData.inventionTitle,applicationMetaData.patentNumber,applicationMetaData.filingDate,applicationMetaData.grantDate,applicationMetaData.applicationStatusDescriptionText',
          },
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
    credentials: {
      httpHeaderAuth: newCredential('USPTO ODP API Key'),
    },
  },
});

const normalizeUsptoPatentsEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize USPTO Patents Evidence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: normalizeUsptoPatentsEvidenceCode,
    },
  },
});

const expandUsptoDocuments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand USPTO Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandEvidenceDocumentsCode,
    },
  },
});

const hasUsptoDocs = ifElse({
  version: 2.3,
  config: {
    name: 'Has USPTO Docs?',
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

const upsertUsptoEvidenceSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'patent_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const upsertUsptoEvidence = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert USPTO Evidence',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertUsptoEvidenceSql,
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

const prepareUsptoEvidenceChunks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare USPTO Evidence Chunks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEvidenceChunkUpsertsCode,
    },
  },
});

const hasUsptoChunks = ifElse({
  version: 2.3,
  config: {
    name: 'Has USPTO Chunks?',
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
            leftValue: expr('{{ $json.skip_chunk }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertUsptoEvidenceChunks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert USPTO Evidence Chunks',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: upsertEvidenceChunkSql,
      options: {
        queryReplacement: expr(
          '{{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countUsptoUpserts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Count USPTO Upserts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: countUsptoUpsertsCode,
    },
  },
});

const prepareUsptoZeroCount = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare USPTO Zero Count',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareUsptoZeroCountCode,
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
  '## PII-03 Evidence Collector\nSEC + CT.gov + E1 XBRL + E4 openFDA + E5 Finnhub company-news + E6 USPTO patents.\nDeferred: full HTML bodies, object storage.',
  [collectionTrigger, validateCollectionRequest, loadCaseAndCompany],
  { color: 4 },
);

const collectorsNote = sticky(
  '## Collectors\nSEC Fair Access User-Agent required.\nUpsert evidence_documents by content_sha256; Finnhub for news; USPTO ODP header auth for Patent File Wrapper.',
  [
    fetchSecSubmissions,
    fetchSecCompanyfacts,
    fetchCtgovStudies,
    fetchOpenfdaDrugsfda,
    fetchCompanyNews,
    fetchUsptoPatents,
    upsertSecEvidence,
  ],
  { color: 5 },
);

const coverageNote = sticky(
  '## Coverage\nmin_sec_documents default 1 → ANALYZING.\nXBRL/FDA/news/USPTO failure is partial (does not block ANALYZING when SEC/CT ok).\nE7: non-XBRL collectors write evidence_chunks after document upsert when chunk_text present.',
  [evaluateCollectionCoverage, advanceCaseState, buildCollectionResult],
  { color: 6 },
);

const finishPath = evaluateCollectionCoverage
  .to(advanceCaseState)
  .to(logCollectionState)
  .to(logWorkflowRun)
  .to(mergeCollectionOutput)
  .to(buildCollectionResult);

const patentsAndFinish = prepareUsptoQuery.to(
  usptoEnabled
    .onTrue(
      fetchUsptoPatents.to(
        normalizeUsptoPatentsEvidence.to(
          expandUsptoDocuments.to(
            hasUsptoDocs
              .onTrue(
                upsertUsptoEvidence.to(
                  prepareUsptoEvidenceChunks.to(
                    hasUsptoChunks
                      .onTrue(upsertUsptoEvidenceChunks.to(countUsptoUpserts.to(finishPath)))
                      .onFalse(countUsptoUpserts.to(finishPath)),
                  ),
                ),
              )
              .onFalse(prepareUsptoZeroCount.to(finishPath)),
          ),
        ),
      ),
    )
    .onFalse(prepareUsptoZeroCount.to(finishPath)),
);

const newsAndFinish = prepareCompanyNewsQuery.to(
  companyNewsEnabled
    .onTrue(
      fetchCompanyNews.to(
        normalizeCompanyNewsEvidence.to(
          expandCompanyNewsDocuments.to(
            hasCompanyNewsDocs
              .onTrue(
                upsertCompanyNewsEvidence.to(
                  prepareCompanyNewsEvidenceChunks.to(
                    hasCompanyNewsChunks
                      .onTrue(
                        upsertCompanyNewsEvidenceChunks.to(
                          countCompanyNewsUpserts.to(patentsAndFinish),
                        ),
                      )
                      .onFalse(countCompanyNewsUpserts.to(patentsAndFinish)),
                  ),
                ),
              )
              .onFalse(prepareCompanyNewsZeroCount.to(patentsAndFinish)),
          ),
        ),
      ),
    )
    .onFalse(prepareCompanyNewsZeroCount.to(patentsAndFinish)),
);

const fdaAndFinish = prepareOpenfdaQuery.to(
  openfdaEnabled
    .onTrue(
      fetchOpenfdaDrugsfda.to(
        normalizeFdaOpenfdaEvidence.to(
          expandFdaDocuments.to(
            hasFdaDocs
              .onTrue(
                upsertFdaEvidence.to(
                  prepareFdaEvidenceChunks.to(
                    hasFdaChunks
                      .onTrue(upsertFdaEvidenceChunks.to(countFdaUpserts.to(newsAndFinish)))
                      .onFalse(countFdaUpserts.to(newsAndFinish)),
                  ),
                ),
              )
              .onFalse(prepareFdaZeroCount.to(newsAndFinish)),
          ),
        ),
      ),
    )
    .onFalse(prepareFdaZeroCount.to(newsAndFinish)),
);

const ctgovAndFinish = fetchCtgovStudies.to(
  normalizeCtgovEvidence.to(
    expandCtgovDocuments.to(
      hasCtgovDocs
        .onTrue(
          upsertCtgovEvidence.to(
            prepareCtgovEvidenceChunks.to(
              hasCtgovChunks
                .onTrue(upsertCtgovEvidenceChunks.to(countCtgovUpserts.to(fdaAndFinish)))
                .onFalse(countCtgovUpserts.to(fdaAndFinish)),
            ),
          ),
        )
        .onFalse(prepareCtgovZeroCount.to(fdaAndFinish)),
    ),
  ),
);

const xbrlAndFinish = fetchSecCompanyfacts.to(
  normalizeSecXbrlEvidence.to(
    expandXbrlDocuments.to(
      hasXbrlDocs
        .onTrue(
          upsertXbrlEvidence.to(
            prepareXbrlFinancialUpserts.to(
              upsertXbrlFinancialPeriod.to(
                upsertXbrlFinancialMetrics.to(
                  upsertXbrlEvidenceChunk.to(countXbrlUpserts.to(ctgovAndFinish)),
                ),
              ),
            ),
          ),
        )
        .onFalse(prepareXbrlZeroCount.to(ctgovAndFinish)),
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
                    .onTrue(
                      upsertSecEvidence.to(
                        prepareSecEvidenceChunks.to(
                          hasSecChunks
                            .onTrue(upsertSecEvidenceChunks.to(countSecUpserts.to(xbrlAndFinish)))
                            .onFalse(countSecUpserts.to(xbrlAndFinish)),
                        ),
                      ),
                    )
                    .onFalse(prepareSecZeroCount.to(xbrlAndFinish)),
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
