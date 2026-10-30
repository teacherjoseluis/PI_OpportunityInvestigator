import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateMarketRequestCode = `// Canonical source for PII-03-MKT "Validate Market Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];
  const caseId = String(body.case_id || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) errors.push('case_id is required and must be a UUID');
  const ticker = String(body.ticker || '').trim().toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) errors.push('ticker is required');
  const exchange = String(body.exchange || 'NASDAQ').trim().toUpperCase();
  if (errors.length) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        next_state: 'ANALYZING',
        reason: 'validation_failed',
        status: 'FAILED',
        agent_key: 'PII-03-MKT',
      },
    });
    continue;
  }
  results.push({
    json: {
      valid: true,
      case_id: caseId,
      ticker,
      exchange,
      task_id: body.task_id || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const prepareMarketQueriesCode = `// Prepare one fetch item per symbol and interval for PII-03-MKT.

const validated = (() => {
  try {
    return $('Validate Market Request').first().json;
  } catch {
    return $input.first().json || {};
  }
})();

const ticker = String(validated.ticker || '').toUpperCase();
const benchmarks = ['SPY', 'XBI', 'XLV'];
const symbols = [{ symbol: ticker, role: 'bars' }].concat(
  benchmarks.map((symbol) => ({ symbol, role: 'benchmark' })),
);
const intervals = ['1day', '1week'];
const outputsize = { '1day': 504, '1week': 260 };
const items = [];

for (const row of symbols) {
  if (!row.symbol) continue;
  for (const interval of intervals) {
    items.push({
      json: {
        case_id: validated.case_id,
        ticker,
        exchange: validated.exchange,
        symbol: row.symbol,
        role: row.role,
        interval,
        outputsize: outputsize[interval],
      },
    });
  }
}

if (!items.length) {
  return [{ json: { skip: true, case_id: validated.case_id || null } }];
}

return items;
`;
const prepareFinnhubFallbackCode = `// Items that TwelveData rejected, for a Finnhub candle fallback.

function denied(body) {
  if (!body || typeof body !== 'object') return false;
  const status = String(body.status || '').toLowerCase();
  const code = Number(body.code || 0);
  const message = String(body.message || '').toLowerCase();
  return status === 'error' || code === 401 || code === 403 || message.includes('plan');
}

const prepared = $('Prepare Market Queries').all();
const fetched = $('Fetch TwelveData Time Series').all();
const now = Math.floor(Date.now() / 1000);
const items = [];

for (let i = 0; i < prepared.length; i += 1) {
  const row = prepared[i].json || {};
  const body = (fetched[i] && fetched[i].json) || {};
  if (!denied(body)) continue;
  const weekly = row.interval === '1week';
  items.push({
    json: {
      skip: false,
      case_id: row.case_id,
      ticker: row.ticker,
      exchange: row.exchange,
      symbol: row.symbol,
      role: row.role,
      interval: row.interval,
      resolution: weekly ? 'W' : 'D',
      from_unix: now - (weekly ? 260 * 7 * 86400 : 504 * 86400),
      to_unix: now,
    },
  });
}

if (!items.length) return [{ json: { skip: true } }];
return items;
`;
const normalizeMarketEvidenceCode = `// Canonical source for PII-03-MKT "Normalize Market Evidence".
// Compact OHLCV bars and a quote. No vendor chart images. No indicator endpoints.

const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\\d{4}-\\d{2}-\\d{2} /.test(raw)) return raw.slice(0, 10);
  return raw.slice(0, 10);
}

function isDenied(body) {
  if (!body || typeof body !== 'object') return false;
  const status = String(body.status || body.s || '').toLowerCase();
  const code = Number(body.code || 0);
  const message = String(body.message || body.error || '').toLowerCase();
  return (
    status === 'error' ||
    code === 401 ||
    code === 403 ||
    code === 404 ||
    message.includes('plan') ||
    message.includes('forbidden') ||
    message.includes('not available') ||
    message.includes('upgrade')
  );
}

function barsFromTwelve(body) {
  const values = Array.isArray(body && body.values) ? body.values : [];
  return values
    .map((row) => ({
      bar_time: toSqlDate(row.datetime || row.date),
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      close: num(row.close),
      volume: num(row.volume),
    }))
    .filter((row) => row.bar_time && row.close != null);
}

function barsFromFinnhub(body) {
  if (!body || body.s === 'no_data' || !Array.isArray(body.t)) return [];
  const out = [];
  for (let i = 0; i < body.t.length; i += 1) {
    const stamp = Number(body.t[i]);
    if (!Number.isFinite(stamp)) continue;
    const iso = new Date(stamp * 1000).toISOString().slice(0, 10);
    out.push({
      bar_time: iso,
      open: num(body.o && body.o[i]),
      high: num(body.h && body.h[i]),
      low: num(body.l && body.l[i]),
      close: num(body.c && body.c[i]),
      volume: num(body.v && body.v[i]),
    });
  }
  return out.filter((row) => row.close != null);
}

function normalizeOne(item) {
  const symbol = safeText(item.symbol || item.ticker || '').toUpperCase();
  const interval = item.interval === '1week' ? '1week' : '1day';
  const role = item.role || (item.benchmark ? 'benchmark' : 'bars');
  const provider = item.provider || 'twelvedata';
  const body = item.body || item.response || item;
  if (isDenied(body)) {
    return {
      symbol,
      interval,
      role,
      provider,
      access_status: 'denied',
      bars: [],
      message: safeText(body.message || body.error || body.status || 'denied'),
    };
  }
  const bars = provider === 'finnhub' ? barsFromFinnhub(body) : barsFromTwelve(body);
  return {
    symbol,
    interval,
    role,
    provider,
    access_status: bars.length ? 'ok' : 'empty',
    bars,
    message: bars.length ? '' : 'no bars',
  };
}

function summarize(symbol, bars) {
  if (!bars.length) return symbol + ' has no stored bars.';
  const sorted = bars.slice().sort((a, b) => String(a.bar_time).localeCompare(String(b.bar_time)));
  const last = sorted[sorted.length - 1];
  const high = Math.max(...sorted.map((row) => row.high || row.close));
  const low = Math.min(...sorted.map((row) => row.low || row.close));
  const tail = sorted.slice(-20);
  const adv =
    tail.reduce((acc, row) => acc + Number(row.close || 0) * Number(row.volume || 0), 0) /
    tail.length;
  return (
    symbol +
    ' latest close ' +
    last.close +
    ' on ' +
    last.bar_time +
    '; range ' +
    low +
    ' to ' +
    high +
    '; recent average dollar volume ' +
    Math.round(adv) +
    '.'
  );
}

function normalizeMarketBatch(items) {
  const normalized = (items || []).map((item) => normalizeOne(item.json ? item.json : item));
  const denied = normalized.filter((row) => row.access_status === 'denied');
  const documents = [];
  const bars = [];
  const groups = new Map();
  for (const row of normalized) {
    if (!row.symbol) continue;
    const key = row.symbol + '|' + row.interval + '|' + row.provider;
    if (!groups.has(key)) groups.set(key, row);
    else if (row.bars.length > groups.get(key).bars.length) groups.set(key, row);
  }
  for (const row of groups.values()) {
    const payload = {
      symbol: row.symbol,
      interval: row.interval,
      provider: row.provider,
      access_status: row.access_status,
      bar_count: row.bars.length,
    };
    const sha = sha256Hex(JSON.stringify(payload) + ':' + row.bars.length + ':' + (row.bars[0] && row.bars[0].bar_time));
    const sourceType = row.role === 'benchmark' ? 'market_benchmark' : 'market_ohlcv';
    documents.push({
      source_type: sourceType,
      publisher: row.provider,
      title: safeText(row.symbol + ' ' + row.interval + ' bars'),
      stable_source_id: safeText(row.provider + ':' + row.symbol + ':' + row.interval),
      content_sha256: sha,
      chunk_text: safeText(summarize(row.symbol, row.bars)),
      metadata: payload,
      access_status: row.access_status,
    });
    for (const bar of row.bars) {
      bars.push({
        symbol: row.symbol,
        interval: row.interval,
        bar_time: bar.bar_time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source: row.provider,
      });
    }
  }
  const issuerDenied = denied.some((row) => row.role !== 'benchmark');
  return {
    documents,
    bars,
    access_status: issuerDenied ? 'denied' : bars.length ? 'ok' : 'empty',
    denied_messages: denied.map((row) => row.symbol + ' ' + row.message),
    provider_plan_note:
      'TwelveData /time_series and Finnhub /stock/candle plan coverage is unverified. A denial is stored as access_status=denied and downstream technical claims stay INSUFFICIENT_EVIDENCE.',
  };
}

const rawItems = $input.all();
const first = (rawItems[0] && rawItems[0].json) || {};

function nodeAll(name) {
  try {
    return $(name).all();
  } catch {
    return null;
  }
}

function zipNode(prepareName, fetchName, provider) {
  const prepared = nodeAll(prepareName);
  const fetched = nodeAll(fetchName);
  if (!prepared || !fetched) return [];
  return prepared.map((row, index) => ({
    symbol: row.json.symbol,
    interval: row.json.interval,
    role: row.json.role,
    provider,
    body: (fetched[index] && fetched[index].json) || {},
  }));
}

let batch;
const zippedTwelve = zipNode('Prepare Market Queries', 'Fetch TwelveData Time Series', 'twelvedata');
if (zippedTwelve.length) {
  const fallback = zipNode('Prepare Finnhub Fallback', 'Fetch Finnhub Candles', 'finnhub');
  const fallbackByKey = new Map(
    fallback.map((row) => [row.symbol + '|' + row.interval, row]),
  );
  batch = zippedTwelve.map((row) => {
    const alt = fallbackByKey.get(row.symbol + '|' + row.interval);
    const denied = isDenied(row.body);
    if (denied && alt && !isDenied(alt.body)) return alt;
    return row;
  });
} else {
  batch = Array.isArray(first.fetches) ? first.fetches : rawItems.map((row) => row.json || {});
}
const normalized = normalizeMarketBatch(batch);
const validated = (() => {
  try {
    return $('Validate Market Request').first().json;
  } catch {
    return first;
  }
})();

return [
  {
    json: {
      case_id: validated.case_id || first.case_id || null,
      ticker: validated.ticker || first.ticker || null,
      exchange: validated.exchange || first.exchange || null,
      outcome: normalized.bars.length ? 'COLLECTED' : normalized.access_status === 'denied' ? 'INSUFFICIENT' : 'EMPTY',
      next_state: 'ANALYZING',
      reason: normalized.access_status === 'denied' ? 'market_data_plan_denied' : 'market_bars_normalized',
      status: normalized.bars.length ? 'SUCCEEDED' : 'INSUFFICIENT',
      agent_key: 'PII-03-MKT',
      access_status: normalized.access_status,
      bar_count: normalized.bars.length,
      document_count: normalized.documents.length,
      denied_messages: normalized.denied_messages,
      provider_plan_note: normalized.provider_plan_note,
      documents_b64: Buffer.from(JSON.stringify(normalized.documents), 'utf8').toString('base64'),
      bars_b64: Buffer.from(JSON.stringify(normalized.bars), 'utf8').toString('base64'),
      insufficient_topics: normalized.bars.length ? [] : ['market_ohlcv'],
      fill_in_suggestions: [],
      error_summary: normalized.access_status === 'denied' ? normalized.denied_messages.join('; ') : null,
    },
  },
];
`;
const buildMarketResultCode = `// Shape the PII-03-MKT subworkflow result.
// Upsert nodes return only a row id, so read the normalized evidence directly.

function normalizedItem() {
  try {
    const row = $('Normalize Market Evidence').first();
    if (row && row.json && row.json.case_id) return row.json;
  } catch {
    // Validation failed before normalization.
  }
  return $input.first().json || {};
}

const item = normalizedItem();

return [
  {
    json: {
      case_id: item.case_id,
      ticker: item.ticker,
      exchange: item.exchange,
      agent_key: 'PII-03-MKT',
      status: item.status || 'INSUFFICIENT',
      outcome: item.outcome || 'INSUFFICIENT',
      next_state: 'ANALYZING',
      reason: item.reason || null,
      bar_count: Number(item.bar_count || 0),
      access_status: item.access_status || 'empty',
      insufficient_topics: item.insufficient_topics || [],
      error_summary: item.error_summary || null,
      provider_plan_note: item.provider_plan_note || null,
    },
  },
];
`;

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
