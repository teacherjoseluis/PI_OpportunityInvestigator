const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'scripts/tmp-e7-ops');
fs.mkdirSync(out, { recursive: true });

const fin = fs.readFileSync(
  path.join(root, 'workflows/shared/code/evaluate-financial-business.js'),
  'utf8',
);
const val = fs.readFileSync(
  path.join(root, 'workflows/shared/code/evaluate-valuation-market.js'),
  'utf8',
);
const risk = fs.readFileSync(
  path.join(root, 'workflows/shared/code/evaluate-risk-redteam.js'),
  'utf8',
);
const prepChunk = fs.readFileSync(
  path.join(root, 'workflows/shared/code/prepare-evidence-chunk-upsert.js'),
  'utf8',
);

const metricsQuery =
  "SELECT fm.metric_key, fm.metric_value, fm.currency, fm.unit, fm.assumption_set, fm.source_evidence_id, fm.calculation_notes, fp.period_label, fp.period_end, fp.period_start, fp.fiscal_year, fp.fiscal_quarter FROM financial_metrics fm JOIN financial_periods fp ON fp.id = fm.financial_period_id WHERE fp.case_id = $1::uuid OR fp.company_id = NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid ORDER BY fp.period_end DESC NULLS LAST, fm.metric_key ASC";

const chunkSql =
  "INSERT INTO evidence_chunks (evidence_id, chunk_index, chunk_text, token_estimate, metadata_json) VALUES ($1::uuid, COALESCE(NULLIF(NULLIF(TRIM($2), ''), 'null')::integer, 0), $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::integer, convert_from(decode($5, 'base64'), 'UTF8')::jsonb) ON CONFLICT (evidence_id, chunk_index) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, token_estimate = EXCLUDED.token_estimate, metadata_json = EXCLUDED.metadata_json RETURNING id AS chunk_id, evidence_id";

const pgCred = {
  postgres: { id: 'Fkr5XG72D2ddc9ix', name: 'Postgres account' },
};

const ifParams = {
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

function chunkTriplet(upsertName, countName, prepareName, hasName, upsertChunkName, basePos) {
  const [x, y] = basePos;
  return [
    { type: 'removeConnection', source: upsertName, target: countName },
    {
      type: 'addNode',
      node: {
        name: prepareName,
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [x + 112, y + 192],
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          jsCode: prepChunk,
        },
      },
    },
    {
      type: 'addNode',
      node: {
        name: hasName,
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [x + 224, y + 192],
        parameters: ifParams,
      },
    },
    {
      type: 'addNode',
      node: {
        name: upsertChunkName,
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.7,
        position: [x + 336, y + 96],
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
      type: 'setNodeSettings',
      nodeName: upsertChunkName,
      settings: { alwaysOutputData: true },
    },
    { type: 'addConnection', source: upsertName, target: prepareName },
    { type: 'addConnection', source: prepareName, target: hasName },
    {
      type: 'addConnection',
      source: hasName,
      target: upsertChunkName,
      sourceIndex: 0,
    },
    { type: 'addConnection', source: upsertChunkName, target: countName },
    {
      type: 'addConnection',
      source: hasName,
      target: countName,
      sourceIndex: 1,
    },
  ];
}

const pii03 = [
  ...chunkTriplet(
    'Upsert SEC Evidence',
    'Count SEC Upserts',
    'Prepare SEC Evidence Chunks',
    'Has SEC Chunks?',
    'Upsert SEC Evidence Chunks',
    [2016, 0],
  ),
  ...chunkTriplet(
    'Upsert CT.gov Evidence',
    'Count CT.gov Upserts',
    'Prepare CT.gov Evidence Chunks',
    'Has CT.gov Chunks?',
    'Upsert CT.gov Evidence Chunks',
    [3360, 0],
  ),
  ...chunkTriplet(
    'Upsert FDA Evidence',
    'Count FDA Upserts',
    'Prepare FDA Evidence Chunks',
    'Has FDA Chunks?',
    'Upsert FDA Evidence Chunks',
    [5056, 208],
  ),
  ...chunkTriplet(
    'Upsert Company News Evidence',
    'Count Company News Upserts',
    'Prepare Company News Evidence Chunks',
    'Has Company News Chunks?',
    'Upsert Company News Evidence Chunks',
    [6848, 208],
  ),
  ...chunkTriplet(
    'Upsert USPTO Evidence',
    'Count USPTO Upserts',
    'Prepare USPTO Evidence Chunks',
    'Has USPTO Chunks?',
    'Upsert USPTO Evidence Chunks',
    [8640, 208],
  ),
];

const pii04 = [
  {
    type: 'setNodeParameter',
    nodeName: 'Evaluate Financial Business',
    path: '/jsCode',
    value: fin,
  },
];

const pii08 = [
  {
    type: 'removeConnection',
    source: 'Load Evidence Documents',
    target: 'Load Analysis Config',
  },
  {
    type: 'addNode',
    node: {
      name: 'Load Financial Metrics',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.7,
      position: [1008, 176],
      credentials: pgCred,
      parameters: {
        operation: 'executeQuery',
        query: metricsQuery,
        options: {
          queryReplacement:
            '={{ $("Validate Valuation Request").item.json.case_id }},{{ $("Load Case And Company").item.json.company_id }}',
          replaceEmptyStrings: true,
        },
      },
    },
  },
  {
    type: 'setNodeSettings',
    nodeName: 'Load Financial Metrics',
    settings: { alwaysOutputData: true },
  },
  {
    type: 'addConnection',
    source: 'Load Evidence Documents',
    target: 'Load Financial Metrics',
  },
  {
    type: 'addConnection',
    source: 'Load Financial Metrics',
    target: 'Load Analysis Config',
  },
  {
    type: 'setNodeParameter',
    nodeName: 'Evaluate Valuation Market',
    path: '/jsCode',
    value: val,
  },
];

const pii09 = [
  {
    type: 'removeConnection',
    source: 'Load Evidence Documents',
    target: 'Load Analysis Config',
  },
  {
    type: 'addNode',
    node: {
      name: 'Load Financial Metrics',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.7,
      position: [1008, 176],
      credentials: pgCred,
      parameters: {
        operation: 'executeQuery',
        query: metricsQuery,
        options: {
          queryReplacement:
            '={{ $("Validate Risk Request").item.json.case_id }},{{ $("Load Case And Company").item.json.company_id }}',
          replaceEmptyStrings: true,
        },
      },
    },
  },
  {
    type: 'setNodeSettings',
    nodeName: 'Load Financial Metrics',
    settings: { alwaysOutputData: true },
  },
  {
    type: 'addConnection',
    source: 'Load Evidence Documents',
    target: 'Load Financial Metrics',
  },
  {
    type: 'addConnection',
    source: 'Load Financial Metrics',
    target: 'Load Analysis Config',
  },
  {
    type: 'setNodeParameter',
    nodeName: 'Evaluate Risk Red Team',
    path: '/jsCode',
    value: risk,
  },
];

function write(name, payload) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(payload));
}

write('pii-04.json', {
  workflowId: 'RvIlyuDV0MEsXezL',
  versionName: 'E7 dilution soft-close',
  versionDescription:
    'Update Evaluate Financial Business for E7 dilution soft-close when offering forms present.',
  operations: pii04,
});
write('pii-08.json', {
  workflowId: '1PuOVYf0O3GThRwq',
  versionName: 'E7 net_cash_debt metrics',
  versionDescription:
    'Add Load Financial Metrics and net_cash_debt fact from XBRL metrics (E7).',
  operations: pii08,
});
write('pii-09.json', {
  workflowId: 'mioSWLKBMLAaBGzs',
  versionName: 'E7 liquidity inventory',
  versionDescription:
    'Add Load Financial Metrics and liquidity_balance_sheet_inventory soft-close (E7).',
  operations: pii09,
});
write('pii-03.json', {
  workflowId: 'IqoALspzvN3PL5Cq',
  versionName: 'E7 evidence chunk backfill',
  versionDescription:
    'After SEC/CT/FDA/news/USPTO document upserts, write evidence_chunks from existing chunk_text (E7).',
  operations: pii03,
});

console.log({
  ops: {
    pii03: pii03.length,
    pii04: pii04.length,
    pii08: pii08.length,
    pii09: pii09.length,
  },
  sizes: Object.fromEntries(
    ['pii-03', 'pii-04', 'pii-08', 'pii-09'].map((n) => [
      n,
      fs.statSync(path.join(out, `${n}.json`)).size,
    ]),
  ),
});
