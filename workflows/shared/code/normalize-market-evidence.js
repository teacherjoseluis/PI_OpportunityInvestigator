// Canonical source for PII-03-MKT "Normalize Market Evidence".
// Compact OHLCV bars and a quote. No vendor chart images. No indicator endpoints.

const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2} /.test(raw)) return raw.slice(0, 10);
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
