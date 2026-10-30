// Prepare one fetch item per symbol and interval for PII-03-MKT.

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
