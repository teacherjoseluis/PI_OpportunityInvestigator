import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateMarketRequestCode = `__VALIDATE_MARKET_REQUEST__`;
const prepareMarketQueriesCode = `__PREPARE_MARKET_QUERIES__`;
const prepareFinnhubFallbackCode = `__PREPARE_FINNHUB_FALLBACK__`;
const normalizeMarketEvidenceCode = `__NORMALIZE_MARKET_EVIDENCE__`;
const buildMarketResultCode = `__BUILD_MARKET_RESULT__`;

const twelveDataAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

const marketTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Market Collector Trigger',
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
  output: [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD', exchange: 'NASDAQ' }],
});

const validateMarketRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Market Request',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: validateMarketRequestCode },
  },
});

const validationPassed = ifElse({
  version: 2.3,
  config: {
    name: 'Validation Passed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          { leftValue: expr('{{ $json.valid }}'), operator: { type: 'boolean', operation: 'true' } },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareMarketQueries = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Market Queries',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareMarketQueriesCode },
  },
});

const fetchTwelveDataTimeSeries = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Time Series',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/time_series',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'symbol', value: expr('{{ $json.symbol }}') },
          { name: 'interval', value: expr('{{ $json.interval }}') },
          { name: 'outputsize', value: expr('{{ $json.outputsize }}') },
          { name: 'order', value: 'ASC' },
        ],
      },
      options: { timeout: 30000, response: { response: { neverError: true, responseFormat: 'json' } } },
    },
    credentials: { httpQueryAuth: newCredential('TwelveData API key') },
  },
});

const prepareFinnhubFallback = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Finnhub Fallback',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareFinnhubFallbackCode },
  },
});

const needsFinnhub = ifElse({
  version: 2.3,
  config: {
    name: 'Needs Finnhub Fallback?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            leftValue: expr('{{ $json.skip }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const fetchFinnhubCandles = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Finnhub Candles',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: 'https://finnhub.io/api/v1/stock/candle',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'symbol', value: expr('{{ $json.symbol }}') },
          { name: 'resolution', value: expr('{{ $json.resolution }}') },
          { name: 'from', value: expr('{{ $json.from_unix }}') },
          { name: 'to', value: expr('{{ $json.to_unix }}') },
        ],
      },
      options: { timeout: 30000, response: { response: { neverError: true, responseFormat: 'json' } } },
    },
    credentials: { httpQueryAuth: newCredential('Finnhub API key') },
  },
});

const normalizeMarketEvidence = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Market Evidence',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: normalizeMarketEvidenceCode },
  },
});

const upsertMarketBars = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Market Bars',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO market_bars (symbol, interval, bar_time, open, high, low, close, volume, source) SELECT r.symbol, r.interval, r.bar_time::date, r.open, r.high, r.low, r.close, r.volume, r.source FROM jsonb_to_recordset(convert_from(decode($1, 'base64'), 'UTF8')::jsonb) AS r(symbol text, interval text, bar_time text, open numeric, high numeric, low numeric, close numeric, volume numeric, source text) ON CONFLICT (symbol, interval, bar_time, source) DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume RETURNING id",
      options: {
        queryReplacement: expr('{{ $json.bars_b64 }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const upsertMarketDocuments = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Market Documents',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO evidence_documents (case_id, source_type, publisher, stable_source_id, title, content_sha256, access_status, parsing_status, metadata_json) SELECT $1::uuid, r.source_type, r.publisher, r.stable_source_id, r.title, r.content_sha256, r.access_status, 'market_bars_stored', r.metadata FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS r(source_type text, publisher text, stable_source_id text, title text, content_sha256 text, access_status text, metadata jsonb) ON CONFLICT DO NOTHING RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Normalize Market Evidence").first().json.case_id }},{{ $("Normalize Market Evidence").first().json.documents_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const buildMarketResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Market Result',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildMarketResultCode },
  },
});

const note = sticky(
  '## PII-03-MKT\nTwelveData /time_series once per investigation. Finnhub candle is the fallback when the plan denies the series. Indicators are not fetched from the vendor.',
  [marketTrigger, fetchTwelveDataTimeSeries, normalizeMarketEvidence],
  { color: 4 },
);

const afterNormalize = upsertMarketBars.to(upsertMarketDocuments).to(buildMarketResult);

export default workflow('pii-03-mkt', 'PII-03-MKT Market Data Collector')
  .add(marketTrigger)
  .to(validateMarketRequest)
  .to(
    validationPassed
      .onFalse(buildMarketResult)
      .onTrue(
        prepareMarketQueries
          .to(fetchTwelveDataTimeSeries)
          .to(prepareFinnhubFallback)
          .to(
            needsFinnhub
              .onTrue(fetchFinnhubCandles.to(normalizeMarketEvidence).to(afterNormalize))
              .onFalse(normalizeMarketEvidence.to(afterNormalize)),
          ),
      ),
  )
  .add(note);
