const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'scripts/tmp-e8-ops');
fs.mkdirSync(out, { recursive: true });

function readCode(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const pgCred = {
  postgres: { id: 'Fkr5XG72D2ddc9ix', name: 'Postgres account' },
};
const clCred = {
  httpHeaderAuth: { id: 'Ve0yaFI4wjj8yZxF', name: 'CourtListener API Token' },
};

const boolFalseIf = {
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'strict',
      version: 2,
    },
    conditions: [
      {
        leftValue: '={{ $json.skip_fetch }}',
        operator: { type: 'boolean', operation: 'false', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  options: {},
};

const skipUpsertIf = {
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'strict',
      version: 2,
    },
    conditions: [
      {
        leftValue: '={{ $json.skip_upsert }}',
        operator: { type: 'boolean', operation: 'false', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  options: {},
};

const skipChunkIf = {
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'strict',
      version: 2,
    },
    conditions: [
      {
        leftValue: '={{ $json.skip_chunk }}',
        operator: { type: 'boolean', operation: 'false', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  options: {},
};

const upsertSql =
  "INSERT INTO evidence_documents (case_id, company_id, source_type, publisher, canonical_url, stable_source_id, title, publication_date, content_sha256, authority_tier, access_status, parsing_status, raw_content_location, metadata_json) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, $3, $4, $5, $6, $7, CASE WHEN NULLIF(NULLIF(TRIM($8), ''), 'null') IS NULL THEN NULL WHEN TRIM($8) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(TRIM($8), 10)::date WHEN TRIM($8) ~ '^\\d{4}-\\d{2}$' THEN (TRIM($8) || '-01')::date WHEN TRIM($8) ~ '^\\d{4}$' THEN (TRIM($8) || '-01-01')::date ELSE NULL END, $9, 'primary', 'retrieved', 'docket_facts_extracted', 'inline:metadata_json', convert_from(decode($10, 'base64'), 'UTF8')::jsonb) ON CONFLICT (content_sha256) WHERE content_sha256 IS NOT NULL DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, evidence_documents.case_id), company_id = COALESCE(EXCLUDED.company_id, evidence_documents.company_id), parsing_status = EXCLUDED.parsing_status, metadata_json = EXCLUDED.metadata_json, updated_at = NOW() RETURNING id AS evidence_id, case_id, source_type, stable_source_id";

const chunkSql =
  "INSERT INTO evidence_chunks (evidence_id, chunk_index, chunk_text, token_estimate, metadata_json) VALUES ($1::uuid, COALESCE(NULLIF(NULLIF(TRIM($2), ''), 'null')::integer, 0), $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::integer, convert_from(decode($5, 'base64'), 'UTF8')::jsonb) ON CONFLICT (evidence_id, chunk_index) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, token_estimate = EXCLUDED.token_estimate, metadata_json = EXCLUDED.metadata_json RETURNING id AS chunk_id, evidence_id";

const x = 10352;
const y = 208;

const pii03 = {
  workflowId: 'IqoALspzvN3PL5Cq',
  versionName: 'E8 CourtListener + openFDA key',
  versionDescription:
    'Attach openFDA query auth; add CourtListener search v4 compact path after USPTO; widen XBRL/CT.gov coverage code.',
  operations: [
    {
      type: 'removeConnection',
      source: 'Count USPTO Upserts',
      target: 'Evaluate Collection Coverage',
    },
    {
      type: 'removeConnection',
      source: 'Prepare USPTO Zero Count',
      target: 'Evaluate Collection Coverage',
    },
    {
      type: 'addNode',
      node: {
        name: 'Prepare CourtListener Query',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x, y],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: readCode('workflows/shared/code/prepare-courtlistener-query.js'),
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'CourtListener Enabled?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [x + 224, y],
        parameters: boolFalseIf,
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Fetch CourtListener Search',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.5,
        position: [x + 448, y - 48],
        credentials: clCred,
        parameters: {
          method: 'GET',
          url: 'https://www.courtlistener.com/api/rest/v4/search/',
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendQuery: true,
          specifyQuery: 'keypair',
          queryParameters: {
            parameters: [
              {
                name: 'q',
                value: '={{ $("Prepare CourtListener Query").item.json.query }}',
              },
              { name: 'type', value: 'r' },
              { name: 'order_by', value: 'score desc' },
              {
                name: 'page_size',
                value:
                  '={{ $("Prepare CourtListener Query").item.json.courtlistener_limit }}',
              },
            ],
          },
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
    },
    {
      type: 'addNode',
      node: {
        name: 'Normalize CourtListener Evidence',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x + 672, y - 48],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: readCode('workflows/shared/code/normalize-courtlistener-evidence.js'),
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Expand CourtListener Documents',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x + 896, y - 48],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: readCode('workflows/shared/code/expand-evidence-documents.js'),
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Has CourtListener Docs?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [x + 1120, y - 48],
        parameters: skipUpsertIf,
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Upsert CourtListener Evidence',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.7,
        position: [x + 1344, y - 96],
        credentials: pgCred,
        parameters: {
          operation: 'executeQuery',
          query: upsertSql,
          options: {
            queryReplacement:
              '={{ $json.case_id }},{{ $json.company_id }},{{ $json.source_type }},{{ $json.publisher }},{{ $json.canonical_url }},{{ $json.stable_source_id }},{{ $json.title_safe }},{{ $json.publication_date }},{{ $json.content_sha256 }},{{ $json.metadata_b64 }}',
            replaceEmptyStrings: true,
          },
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Prepare CourtListener Evidence Chunks',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x + 1456, y + 96],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: readCode('workflows/shared/code/prepare-evidence-chunk-upsert.js'),
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Has CourtListener Chunks?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [x + 1568, y + 96],
        parameters: skipChunkIf,
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Upsert CourtListener Evidence Chunks',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.7,
        position: [x + 1680, y],
        credentials: pgCred,
        parameters: {
          operation: 'executeQuery',
          query: chunkSql,
          options: {
            queryReplacement:
              '={{ $json.evidence_id }},{{ $json.chunk_index }},{{ $json.chunk_text }},{{ $json.chunk_token_estimate }},{{ $json.chunk_metadata_b64 }}',
            replaceEmptyStrings: true,
          },
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Count CourtListener Upserts',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x + 1904, y],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: readCode('workflows/shared/code/count-courtlistener-upserts.js'),
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: 'Prepare CourtListener Zero Count',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x + 1344, y + 192],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: readCode('workflows/shared/code/prepare-courtlistener-zero-count.js'),
        },
      },
    },
    {
      type: 'setNodeSettings',
      nodeName: 'Fetch CourtListener Search',
      settings: {
        onError: 'continueRegularOutput',
        retryOnFail: true,
        maxTries: 2,
        waitBetweenTries: 1000,
      },
    },
    {
      type: 'setNodeSettings',
      nodeName: 'Upsert CourtListener Evidence',
      settings: { alwaysOutputData: true },
    },
    {
      type: 'setNodeSettings',
      nodeName: 'Upsert CourtListener Evidence Chunks',
      settings: { alwaysOutputData: true },
    },
    { type: 'addConnection', source: 'Count USPTO Upserts', target: 'Prepare CourtListener Query' },
    {
      type: 'addConnection',
      source: 'Prepare USPTO Zero Count',
      target: 'Prepare CourtListener Query',
    },
    {
      type: 'addConnection',
      source: 'Prepare CourtListener Query',
      target: 'CourtListener Enabled?',
    },
    {
      type: 'addConnection',
      source: 'CourtListener Enabled?',
      target: 'Fetch CourtListener Search',
      sourceIndex: 0,
    },
    {
      type: 'addConnection',
      source: 'Fetch CourtListener Search',
      target: 'Normalize CourtListener Evidence',
    },
    {
      type: 'addConnection',
      source: 'Normalize CourtListener Evidence',
      target: 'Expand CourtListener Documents',
    },
    {
      type: 'addConnection',
      source: 'Expand CourtListener Documents',
      target: 'Has CourtListener Docs?',
    },
    {
      type: 'addConnection',
      source: 'Has CourtListener Docs?',
      target: 'Upsert CourtListener Evidence',
      sourceIndex: 0,
    },
    {
      type: 'addConnection',
      source: 'Upsert CourtListener Evidence',
      target: 'Prepare CourtListener Evidence Chunks',
    },
    {
      type: 'addConnection',
      source: 'Prepare CourtListener Evidence Chunks',
      target: 'Has CourtListener Chunks?',
    },
    {
      type: 'addConnection',
      source: 'Has CourtListener Chunks?',
      target: 'Upsert CourtListener Evidence Chunks',
      sourceIndex: 0,
    },
    {
      type: 'addConnection',
      source: 'Upsert CourtListener Evidence Chunks',
      target: 'Count CourtListener Upserts',
    },
    {
      type: 'addConnection',
      source: 'Has CourtListener Chunks?',
      target: 'Count CourtListener Upserts',
      sourceIndex: 1,
    },
    {
      type: 'addConnection',
      source: 'Has CourtListener Docs?',
      target: 'Prepare CourtListener Zero Count',
      sourceIndex: 1,
    },
    {
      type: 'addConnection',
      source: 'CourtListener Enabled?',
      target: 'Prepare CourtListener Zero Count',
      sourceIndex: 1,
    },
    {
      type: 'addConnection',
      source: 'Count CourtListener Upserts',
      target: 'Evaluate Collection Coverage',
    },
    {
      type: 'addConnection',
      source: 'Prepare CourtListener Zero Count',
      target: 'Evaluate Collection Coverage',
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Fetch OpenFDA DrugsFDA',
      path: '/authentication',
      value: 'genericCredentialType',
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Fetch OpenFDA DrugsFDA',
      path: '/genericAuthType',
      value: 'httpQueryAuth',
    },
    {
      type: 'setNodeCredential',
      nodeName: 'Fetch OpenFDA DrugsFDA',
      credentialKey: 'httpQueryAuth',
      credentialId: 'm1RMa7Lmpdqw0w5F',
      credentialName: 'openFDA API key',
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Normalize SEC XBRL Facts',
      path: '/jsCode',
      value: readCode('workflows/shared/code/normalize-sec-xbrl-evidence.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Normalize CT.gov Evidence',
      path: '/jsCode',
      value: readCode('workflows/shared/code/normalize-ctgov-evidence.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Evaluate Collection Coverage',
      path: '/jsCode',
      value: readCode('workflows/shared/code/evaluate-collection-coverage.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Prepare SEC Evidence Chunks',
      path: '/jsCode',
      value: readCode('workflows/shared/code/prepare-evidence-chunk-upsert.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Prepare CT.gov Evidence Chunks',
      path: '/jsCode',
      value: readCode('workflows/shared/code/prepare-evidence-chunk-upsert.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Prepare FDA Evidence Chunks',
      path: '/jsCode',
      value: readCode('workflows/shared/code/prepare-evidence-chunk-upsert.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Prepare Company News Evidence Chunks',
      path: '/jsCode',
      value: readCode('workflows/shared/code/prepare-evidence-chunk-upsert.js'),
    },
    {
      type: 'setNodeParameter',
      nodeName: 'Prepare USPTO Evidence Chunks',
      path: '/jsCode',
      value: readCode('workflows/shared/code/prepare-evidence-chunk-upsert.js'),
    },
  ],
};

const pii04 = {
  workflowId: 'RvIlyuDV0MEsXezL',
  versionName: 'E8 XBRL margins runway shares',
  versionDescription:
    'Emit filing-backed margins, burn/runway, and share-count claims from widened companyfacts metrics.',
  operations: [
    {
      type: 'setNodeParameter',
      nodeName: 'Evaluate Financial Business',
      path: '/jsCode',
      value: readCode('workflows/shared/code/evaluate-financial-business.js'),
    },
  ],
};

const pii06 = {
  workflowId: 'b8CxYW8T8FrGl62x',
  versionName: 'E8 CT.gov enrollment inventory',
  versionDescription:
    'Add enrollment_inventory claims from stored CT.gov designModule enrollment counts.',
  operations: [
    {
      type: 'setNodeParameter',
      nodeName: 'Evaluate Pipeline Clinical',
      path: '/jsCode',
      value: readCode('workflows/shared/code/evaluate-pipeline-clinical.js'),
    },
  ],
};

const pii09 = {
  workflowId: 'mioSWLKBMLAaBGzs',
  versionName: 'E8 CourtListener litigation inventory',
  versionDescription:
    'Add litigation_docket_inventory claims from courtlistener_docket evidence rows.',
  operations: [
    {
      type: 'setNodeParameter',
      nodeName: 'Evaluate Risk Red Team',
      path: '/jsCode',
      value: readCode('workflows/shared/code/evaluate-risk-redteam.js'),
    },
  ],
};

const pii10 = {
  workflowId: 'lIjKOZS7qDizvynm',
  versionName: 'E8 business_financial score map',
  versionDescription:
    'Score business_quality from PII-04 business_financial claims so the email Business score is numeric.',
  operations: [
    {
      type: 'setNodeParameter',
      nodeName: 'Evaluate Scoring Quality',
      path: '/jsCode',
      value: readCode('workflows/shared/code/evaluate-scoring-quality.js'),
    },
  ],
};

for (const [name, payload] of Object.entries({
  'pii-03': pii03,
  'pii-04': pii04,
  'pii-06': pii06,
  'pii-09': pii09,
  'pii-10': pii10,
})) {
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(payload));
  console.log(name, 'ops', payload.operations.length);
}
