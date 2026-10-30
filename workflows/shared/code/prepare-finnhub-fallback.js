// Items that TwelveData rejected, for a Finnhub candle fallback.

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
