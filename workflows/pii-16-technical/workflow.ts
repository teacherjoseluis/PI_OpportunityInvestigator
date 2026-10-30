import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateTechnicalRequestCode = `// Canonical source for PII-16 "Validate Technical Request" Code node.

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
        next_state: 'INCOMPLETE',
        reason: 'validation_failed',
        status: 'FAILED',
        agent_key: 'PII-16',
        claim_count: 0,
        insufficient_topics: [],
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
      focus: String(body.focus || 'full').trim().toLowerCase(),
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const evaluateTechnicalMarketCode = `// Canonical source for PII-16 indicator math and technical_market claims.
// Formulas run on stored OHLCV bars. Vendor RSI/MACD endpoints are not facts.
// action on the input selects a unit-test entry; the workflow path is "evaluate".

const crypto = require('crypto');

function round(n, digits) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const p = 10 ** digits;
  return Math.round(Number(n) * p) / p;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function closesOf(bars) {
  return (bars || []).map((bar) => num(bar.close)).filter((n) => n != null);
}

function sma(values, period) {
  const p = Number(period);
  if (!Array.isArray(values) || values.length < p || p < 1) return null;
  let sum = 0;
  for (let i = values.length - p; i < values.length; i += 1) sum += Number(values[i]);
  return sum / p;
}

function emaSeries(values, period) {
  const p = Number(period);
  if (!Array.isArray(values) || values.length < p || p < 1) return [];
  const k = 2 / (p + 1);
  let seed = 0;
  for (let i = 0; i < p; i += 1) seed += Number(values[i]);
  const out = new Array(values.length).fill(null);
  let prev = seed / p;
  out[p - 1] = prev;
  for (let i = p; i < values.length; i += 1) {
    prev = Number(values[i]) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function ema(values, period) {
  const series = emaSeries(values, period);
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] != null) return series[i];
  }
  return null;
}

function rsi(closes, period) {
  const p = Number(period);
  if (!Array.isArray(closes) || closes.length <= p || p < 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i += 1) {
    const delta = Number(closes[i]) - Number(closes[i - 1]);
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  for (let i = p + 1; i < closes.length; i += 1) {
    const delta = Number(closes[i]) - Number(closes[i - 1]);
    const g = delta > 0 ? delta : 0;
    const l = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes, fast, slow, signal) {
  const fastP = Number(fast);
  const slowP = Number(slow);
  const signalP = Number(signal);
  if (!Array.isArray(closes) || closes.length < slowP + signalP) return null;
  const fastEma = emaSeries(closes, fastP);
  const slowEma = emaSeries(closes, slowP);
  const line = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (fastEma[i] == null || slowEma[i] == null) line.push(null);
    else line.push(fastEma[i] - slowEma[i]);
  }
  const compact = line.filter((v) => v != null);
  const signalSeries = emaSeries(compact, signalP);
  const signalValue = signalSeries.length ? signalSeries[signalSeries.length - 1] : null;
  const macdValue = compact.length ? compact[compact.length - 1] : null;
  if (macdValue == null || signalValue == null) return null;
  return {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue,
  };
}

function trueRange(bar, prevClose) {
  const high = num(bar.high);
  const low = num(bar.low);
  if (high == null || low == null) return null;
  const parts = [high - low];
  if (prevClose != null) {
    parts.push(Math.abs(high - prevClose));
    parts.push(Math.abs(low - prevClose));
  }
  return Math.max(...parts);
}

function atr(bars, period) {
  const p = Number(period);
  if (!Array.isArray(bars) || bars.length <= p) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    trs.push(trueRange(bars[i], num(bars[i - 1].close)));
  }
  if (trs.length < p || trs.some((v) => v == null)) return null;
  let prev = 0;
  for (let i = 0; i < p; i += 1) prev += trs[i];
  prev /= p;
  for (let i = p; i < trs.length; i += 1) {
    prev = (prev * (p - 1) + trs[i]) / p;
  }
  return prev;
}

function adx(bars, period) {
  const p = Number(period);
  if (!Array.isArray(bars) || bars.length <= p * 2) return null;
  const trs = [];
  const plus = [];
  const minus = [];
  for (let i = 1; i < bars.length; i += 1) {
    const up = num(bars[i].high) - num(bars[i - 1].high);
    const down = num(bars[i - 1].low) - num(bars[i].low);
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
    trs.push(trueRange(bars[i], num(bars[i - 1].close)));
  }
  if (trs.length < p) return null;
  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 0; i < p; i += 1) {
    smoothTr += trs[i];
    smoothPlus += plus[i];
    smoothMinus += minus[i];
  }
  const dx = [];
  function pushDx(tr, pdm, mdm) {
    if (!tr) return;
    const plusDi = (100 * pdm) / tr;
    const minusDi = (100 * mdm) / tr;
    const denom = plusDi + minusDi;
    dx.push({
      plusDi,
      minusDi,
      dx: denom === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / denom,
    });
  }
  pushDx(smoothTr, smoothPlus, smoothMinus);
  for (let i = p; i < trs.length; i += 1) {
    smoothTr = smoothTr - smoothTr / p + trs[i];
    smoothPlus = smoothPlus - smoothPlus / p + plus[i];
    smoothMinus = smoothMinus - smoothMinus / p + minus[i];
    pushDx(smoothTr, smoothPlus, smoothMinus);
  }
  if (dx.length < p) return null;
  let adxValue = 0;
  for (let i = 0; i < p; i += 1) adxValue += dx[i].dx;
  adxValue /= p;
  for (let i = p; i < dx.length; i += 1) {
    adxValue = (adxValue * (p - 1) + dx[i].dx) / p;
  }
  const last = dx[dx.length - 1];
  return { adx: adxValue, plus_di: last.plusDi, minus_di: last.minusDi };
}

function drawdownFromHigh(bars, sessions) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const window = bars.slice(-Math.min(Number(sessions) || bars.length, bars.length));
  let high = null;
  let low = null;
  for (const bar of window) {
    const h = num(bar.high);
    const l = num(bar.low);
    if (h != null) high = high == null ? h : Math.max(high, h);
    if (l != null) low = low == null ? l : Math.min(low, l);
  }
  const close = num(window[window.length - 1].close);
  if (high == null || low == null || close == null || high === 0) return null;
  const span = high - low;
  return {
    drawdown_pct: ((high - close) / high) * 100,
    percentile: span === 0 ? 100 : ((close - low) / span) * 100,
    high,
    low,
    close,
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((acc, n) => acc + n, 0) / values.length;
}

function sampleStdev(values) {
  if (!values || values.length < 2) return null;
  const avg = mean(values);
  const sum = values.reduce((acc, n) => acc + (n - avg) ** 2, 0);
  return Math.sqrt(sum / (values.length - 1));
}

function realizedVol(closes, period, annualization) {
  const p = Number(period);
  if (!Array.isArray(closes) || closes.length <= p) return null;
  const returns = [];
  for (let i = closes.length - p; i < closes.length; i += 1) {
    const prev = Number(closes[i - 1]);
    const cur = Number(closes[i]);
    if (!(prev > 0) || !(cur > 0)) return null;
    returns.push(Math.log(cur / prev));
  }
  const sd = sampleStdev(returns);
  if (sd == null) return null;
  return sd * Math.sqrt(Number(annualization) || 252);
}

function adv(bars, window) {
  const p = Number(window);
  if (!Array.isArray(bars) || bars.length < p) return null;
  const slice = bars.slice(-p);
  const dollars = [];
  for (const bar of slice) {
    const close = num(bar.close);
    const volume = num(bar.volume);
    if (close == null || volume == null) return null;
    dollars.push(close * volume);
  }
  return mean(dollars);
}

function volumeRatio(bars, window) {
  const p = Number(window);
  if (!Array.isArray(bars) || bars.length < p + 1) return null;
  const last = num(bars[bars.length - 1].volume);
  const base = bars.slice(-(p + 1), -1).map((bar) => num(bar.volume));
  if (last == null || base.some((n) => n == null)) return null;
  const avg = mean(base);
  if (!avg) return null;
  return last / avg;
}

function totalReturnPct(closes, sessions) {
  const n = Number(sessions);
  if (!Array.isArray(closes) || closes.length <= n) return null;
  const then = Number(closes[closes.length - 1 - n]);
  const now = Number(closes[closes.length - 1]);
  if (!(then > 0) || now == null) return null;
  return (now / then - 1) * 100;
}

function relativeStrength(stockCloses, benchCloses, sessions) {
  const stock = totalReturnPct(stockCloses, sessions);
  const bench = totalReturnPct(benchCloses, sessions);
  if (stock == null || bench == null) return null;
  return { stock_return_pct: stock, benchmark_return_pct: bench, excess_ppt: stock - bench };
}

function monthSessions(months) {
  return Number(months) * 21;
}

function smaStackLabel(close, smas) {
  const present = smas.filter((row) => row.value != null);
  if (!present.length || close == null) return null;
  const above = present.every((row) => close > row.value);
  const below = present.every((row) => close < row.value);
  if (above) return 'above';
  if (below) return 'below';
  return 'mixed';
}

function timingRubric(metrics, rubric) {
  const rules = rubric || {};
  const constructive = rules.constructive || {};
  const unfavorable = rules.unfavorable || {};
  const required = [
    metrics.close,
    metrics.weekly_sma,
    metrics.drawdown_pct,
    metrics.rs_xbi_3m_ppt,
    metrics.adv20,
  ];
  if (required.some((v) => v == null || Number.isNaN(Number(v)))) {
    return { label: null, reason: 'missing_series' };
  }
  const smaPeriod = Number(constructive.close_above_weekly_sma || 40);
  const above = Number(metrics.close) > Number(metrics.weekly_sma);
  const below = Number(metrics.close) < Number(metrics.weekly_sma);
  const maxDd = Number(constructive.max_drawdown_from_52w_high_pct ?? 15);
  const minRs = Number(constructive.min_rs_vs_xbi_3m_ppt ?? -5);
  const minAdv = Number(metrics.adv_minimum);
  const advOk = minAdv > 0 ? Number(metrics.adv20) >= minAdv : true;
  if (
    above &&
    Number(metrics.drawdown_pct) <= maxDd &&
    Number(metrics.rs_xbi_3m_ppt) >= minRs &&
    advOk
  ) {
    return {
      label: 'CONSTRUCTIVE',
      reason:
        'close above weekly ' +
        smaPeriod +
        '-SMA; drawdown ' +
        round(metrics.drawdown_pct, 1) +
        '%; 3m RS vs XBI ' +
        round(metrics.rs_xbi_3m_ppt, 1) +
        ' ppt',
    };
  }
  const bad = unfavorable.any_of || {};
  const ddBad = Number(metrics.drawdown_pct) >= Number(bad.min_drawdown_from_52w_high_pct ?? 25);
  const rsBad = Number(metrics.rs_xbi_3m_ppt) <= Number(bad.max_rs_vs_xbi_3m_ppt ?? -15);
  const advBad = bad.adv_below_eligibility_minimum === true && minAdv > 0 && !advOk;
  if (below && (ddBad || rsBad || advBad)) {
    return {
      label: 'UNFAVORABLE',
      reason: 'close below weekly ' + smaPeriod + '-SMA with a weak backdrop condition',
    };
  }
  return { label: 'MIXED', reason: 'backdrop is neither constructive nor unfavorable' };
}

function eventExcessReturn(stockBars, benchBars, catalystDate, windowSessions) {
  const window = Number(windowSessions) || 5;
  if (!catalystDate || !Array.isArray(stockBars) || !Array.isArray(benchBars)) return null;
  const target = String(catalystDate).slice(0, 10);
  let index = -1;
  for (let i = 0; i < stockBars.length; i += 1) {
    if (String(stockBars[i].bar_time || '').slice(0, 10) >= target) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;
  const start = Math.max(1, index - window);
  const end = Math.min(stockBars.length - 1, index + window);
  if (end <= start) return null;
  const benchByTime = new Map(
    benchBars.map((bar) => [String(bar.bar_time || '').slice(0, 10), bar]),
  );
  let stockSum = 0;
  let benchSum = 0;
  let used = 0;
  for (let i = start; i <= end; i += 1) {
    const prev = num(stockBars[i - 1].close);
    const cur = num(stockBars[i].close);
    const day = String(stockBars[i].bar_time || '').slice(0, 10);
    const prevDay = String(stockBars[i - 1].bar_time || '').slice(0, 10);
    const bNow = benchByTime.get(day);
    const bPrev = benchByTime.get(prevDay);
    if (!(prev > 0) || cur == null || !bNow || !bPrev) continue;
    const bPrevClose = num(bPrev.close);
    const bClose = num(bNow.close);
    if (!(bPrevClose > 0) || bClose == null) continue;
    stockSum += cur / prev - 1;
    benchSum += bClose / bPrevClose - 1;
    used += 1;
  }
  if (!used) return null;
  return { excess_return_pct: (stockSum - benchSum) * 100, sessions: used };
}

const FORBIDDEN = [
  { re: /\\bbuy\\b/i, label: 'buy' },
  { re: /\\bsell\\b/i, label: 'sell' },
  { re: /\\badd\\b/i, label: 'add' },
  { re: /\\btrim\\b/i, label: 'trim' },
  { re: /price target/i, label: 'price target' },
  { re: /\\baccumulate\\b/i, label: 'accumulate' },
  { re: /\\bdistribute\\b/i, label: 'distribute' },
  { re: /go long/i, label: 'go long' },
  { re: /short the stock/i, label: 'short the stock' },
];

function forbiddenHits(text) {
  const hits = [];
  const value = String(text || '');
  for (const rule of FORBIDDEN) {
    if (rule.re.test(value)) hits.push(rule.label);
  }
  return hits;
}

function defaultTechnicalConfig() {
  return {
    claim_category: 'technical_market',
    indicators: {
      sma_daily: [50, 100, 200],
      sma_weekly: [10, 40],
      adx_period: 14,
      rsi_period: 14,
      macd: { fast: 12, slow: 26, signal: 9 },
      atr_period: 14,
      realized_vol_days: 20,
      adv_windows_days: [20, 60],
      relative_strength_months: [1, 3, 6, 12],
    },
    timing_rubric: {
      constructive: {
        close_above_weekly_sma: 40,
        max_drawdown_from_52w_high_pct: 15,
        min_rs_vs_xbi_3m_ppt: -5,
      },
      unfavorable: {
        close_below_weekly_sma: 40,
        any_of: {
          min_drawdown_from_52w_high_pct: 25,
          max_rs_vs_xbi_3m_ppt: -15,
          adv_below_eligibility_minimum: true,
        },
      },
    },
    benchmarks: ['SPY', 'XBI', 'XLV'],
    event_window_sessions: 5,
    eligibility_min_adv_usd: 1000000,
  };
}

function barsFor(book, symbol, interval) {
  if (!book) return [];
  const upper = String(symbol || '').toUpperCase();
  const bag = book[upper] || book[symbol] || {};
  const rows = bag[interval] || bag[String(interval).toLowerCase()] || [];
  return Array.isArray(rows) ? rows : [];
}

function componentScores(snapshot) {
  const out = {};
  if (snapshot.trend_alignment != null) out.trend_alignment = snapshot.trend_alignment;
  if (snapshot.drawdown_pct != null) {
    out.drawdown_from_high = Math.max(0, Math.min(100, 100 - Number(snapshot.drawdown_pct) * 1.5));
  }
  if (snapshot.rs_xbi_3m_ppt != null) {
    out.relative_strength_xbi_3m = Math.max(
      0,
      Math.min(100, 50 + Number(snapshot.rs_xbi_3m_ppt)),
    );
  }
  if (snapshot.adv20 != null && snapshot.adv_minimum > 0) {
    const ratio = Number(snapshot.adv20) / Number(snapshot.adv_minimum);
    out.liquidity_adv =
      ratio >= 1
        ? Math.max(0, Math.min(100, 70 + 15 * Math.log10(ratio)))
        : Math.max(0, Math.min(100, 40 * ratio));
  }
  if (snapshot.realized_vol != null) {
    const vol = Number(snapshot.realized_vol);
    let score = 60;
    if (vol >= 0.2 && vol <= 0.55) score = 75;
    else if (vol > 0.8) score = 30;
    else if (vol < 0.15) score = 55;
    out.volatility_regime = score;
  }
  if (snapshot.event_excess_return_pct != null) {
    out.event_reaction = Math.max(
      0,
      Math.min(100, 50 + Number(snapshot.event_excess_return_pct)),
    );
  }
  return out;
}

function technicalContextScore(components, weights) {
  const keys = Object.keys(components).filter((key) => components[key] != null);
  if (!keys.length) return { score: null, used: [] };
  const w = weights || {};
  let weightSum = 0;
  let acc = 0;
  const used = [];
  for (const key of keys) {
    const weight = Number(w[key] ?? 1);
    if (!(weight > 0)) continue;
    weightSum += weight;
    acc += weight * Number(components[key]);
    used.push(key);
  }
  if (!weightSum) return { score: null, used };
  return { score: round(acc / weightSum, 2), used };
}

function pushClaim(claims, claim) {
  const hits = forbiddenHits(claim.claim_text);
  if (hits.length) {
    throw new Error('technical claim contains forbidden language: ' + hits.join(','));
  }
  claims.push(claim);
}

function evaluateTechnical(input) {
  const cfg = Object.assign(defaultTechnicalConfig(), input.technical_config || {});
  const indicatorsCfg = cfg.indicators || defaultTechnicalConfig().indicators;
  const ticker = String(input.ticker || '').toUpperCase();
  const book = input.bars || {};
  const daily = barsFor(book, ticker, '1day');
  const weekly = barsFor(book, ticker, '1week');
  const evidenceIds = Array.isArray(input.evidence_ids) ? input.evidence_ids.filter(Boolean) : [];
  const claims = [];
  const indicatorRows = [];
  const insufficient = [];

  function addIndicator(key, value, notes, interval) {
    if (value == null || Number.isNaN(Number(value))) return;
    indicatorRows.push({
      symbol: ticker,
      interval: interval || '1day',
      as_of: input.as_of || '',
      indicator_key: key,
      params_hash: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
      metric_value: round(value, 6),
      calculation_notes: notes || key,
      source_evidence_id: evidenceIds[0] || '',
    });
  }

  if (daily.length < 20 || weekly.length < 10) {
    insufficient.push('market_ohlcv');
    pushClaim(claims, {
      topic_key: 'insufficient_market_ohlcv',
      claim_text:
        'INSUFFICIENT_EVIDENCE: Daily and weekly OHLCV bars from an authorized market-data source are required before technical claims can be computed.',
      claim_category: cfg.claim_category || 'technical_market',
      claim_kind: 'inference',
      confidence: 95,
      materiality: 'HIGH',
      extraction_method: 'deterministic_insufficient_gate',
      evidence_ids: evidenceIds.slice(0, 3),
    });
    pushClaim(claims, {
      topic_key: 'insufficient_short_interest',
      claim_text:
        'INSUFFICIENT_EVIDENCE: Short interest and days-to-cover require an authorized licensed field; not inferred from price.',
      claim_category: cfg.claim_category || 'technical_market',
      claim_kind: 'inference',
      confidence: 95,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_insufficient_gate',
      evidence_ids: evidenceIds.slice(0, 2),
    });
    return {
      status: 'INSUFFICIENT',
      outcome: 'INSUFFICIENT',
      next_state: 'ANALYZING',
      reason: 'missing_ohlcv',
      claims,
      indicator_rows: indicatorRows,
      insufficient_topics: insufficient.concat(['short_interest']),
      technical_snapshot: null,
      technical_context_score: null,
      fill_in_suggestions: [{ agent_key: 'PII-03-MKT', reason: 'missing_ohlcv' }],
      entry_timing_context: null,
    };
  }

  const dailyCloses = closesOf(daily);
  const weeklyCloses = closesOf(weekly);
  const lastClose = dailyCloses[dailyCloses.length - 1];
  const weeklyClose = weeklyCloses[weeklyCloses.length - 1];
  const smaDaily = (indicatorsCfg.sma_daily || [50, 100, 200]).map((period) => ({
    period,
    value: sma(dailyCloses, period),
  }));
  const smaWeekly = (indicatorsCfg.sma_weekly || [10, 40]).map((period) => ({
    period,
    value: sma(weeklyCloses, period),
  }));
  const weekly40 = smaWeekly.find((row) => row.period === 40) || smaWeekly[smaWeekly.length - 1];
  const stack = smaStackLabel(lastClose, smaDaily.filter((row) => row.value != null));
  const adxRow = adx(weekly, indicatorsCfg.adx_period || 14);
  const rsiValue = rsi(weeklyCloses, indicatorsCfg.rsi_period || 14);
  const macdCfg = indicatorsCfg.macd || { fast: 12, slow: 26, signal: 9 };
  const macdRow = macd(weeklyCloses, macdCfg.fast, macdCfg.slow, macdCfg.signal);
  const atrValue = atr(daily, indicatorsCfg.atr_period || 14);
  const vol = realizedVol(dailyCloses, indicatorsCfg.realized_vol_days || 20, 252);
  const range = drawdownFromHigh(daily, 252);
  const adv20 = adv(daily, 20);
  const adv60 = adv(daily, 60);
  const dailyVolRatio = volumeRatio(daily, 20);
  const weeklyVolRatio = volumeRatio(weekly, Math.min(20, weekly.length - 1));
  const downWeek =
    weeklyCloses.length >= 2 &&
    weeklyCloses[weeklyCloses.length - 1] < weeklyCloses[weeklyCloses.length - 2];

  const rs = {};
  for (const months of indicatorsCfg.relative_strength_months || [1, 3, 6, 12]) {
    rs['XBI_' + months + 'm'] = relativeStrength(
      dailyCloses,
      closesOf(barsFor(book, 'XBI', '1day')),
      monthSessions(months),
    );
    rs['SPY_' + months + 'm'] = relativeStrength(
      dailyCloses,
      closesOf(barsFor(book, 'SPY', '1day')),
      monthSessions(months),
    );
    rs['XLV_' + months + 'm'] = relativeStrength(
      dailyCloses,
      closesOf(barsFor(book, 'XLV', '1day')),
      monthSessions(months),
    );
  }
  const rs3 = rs.XBI_3m;

  let eventRow = null;
  const catalysts = Array.isArray(input.catalyst_dates) ? input.catalyst_dates : [];
  if (catalysts.length) {
    eventRow = eventExcessReturn(
      daily,
      barsFor(book, 'XBI', '1day'),
      catalysts[catalysts.length - 1],
      cfg.event_window_sessions || 5,
    );
  }

  const advMinimum = Number(
    input.eligibility_min_adv_usd || cfg.eligibility_min_adv_usd || 1000000,
  );
  const timing = timingRubric(
    {
      close: weeklyClose,
      weekly_sma: weekly40 ? weekly40.value : null,
      drawdown_pct: range ? range.drawdown_pct : null,
      rs_xbi_3m_ppt: rs3 ? rs3.excess_ppt : null,
      adv20,
      adv_minimum: advMinimum,
    },
    cfg.timing_rubric,
  );

  const trendBits = [];
  if (weekly40 && weekly40.value != null) {
    trendBits.push(
      'Weekly close ' +
        (weeklyClose > weekly40.value ? 'above' : 'below') +
        ' the 40-week SMA',
    );
  }
  if (adxRow) trendBits.push('ADX ' + round(adxRow.adx, 1));
  const trendStrong = adxRow && adxRow.adx >= 25;
  pushClaim(claims, {
    topic_key: 'trend_regime',
    claim_text:
      (trendBits.join('; ') || 'Weekly trend inputs are partial') +
      (trendStrong ? '; trend strength is elevated.' : '; trend strength is not elevated.') +
      ' Not a trade instruction.',
    claim_category: 'technical_market',
    claim_kind: 'calculation',
    confidence: weekly40 && weekly40.value != null ? 80 : 55,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_technical_indicators',
    evidence_ids: evidenceIds.slice(0, 4),
  });

  if (stack) {
    const ordered = smaDaily
      .filter((row) => row.value != null)
      .map((row) => row.period + '=' + round(row.value, 2))
      .join(' ');
    pushClaim(claims, {
      topic_key: 'sma_stack',
      claim_text:
        'Daily close versus SMA stack is ' + stack + (ordered ? ' (' + ordered + ').' : '.'),
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 78,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  }

  if (rsiValue != null || macdRow) {
    const parts = [];
    if (rsiValue != null) parts.push('Weekly RSI ' + round(rsiValue, 1));
    if (macdRow) {
      parts.push(
        'MACD histogram ' + (macdRow.histogram >= 0 ? 'non-negative' : 'negative'),
      );
    }
    pushClaim(claims, {
      topic_key: 'momentum_rsi_macd',
      claim_text: parts.join('; ') + '.',
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 76,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  }

  if (range || vol != null) {
    const parts = [];
    if (range) parts.push(round(range.drawdown_pct, 1) + '% below the 52-week high');
    if (vol != null) parts.push('20-day realized vol ' + round(vol * 100, 1) + '% annualized');
    if (atrValue != null) parts.push('ATR ' + round(atrValue, 2));
    pushClaim(claims, {
      topic_key: 'volatility_drawdown',
      claim_text: parts.join('; ') + '.',
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 82,
      materiality: 'HIGH',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  }

  if (adv20 != null) {
    const band = adv20 >= advMinimum ? 'at or above' : 'below';
    pushClaim(claims, {
      topic_key: 'liquidity_adv',
      claim_text:
        '20-day average dollar volume is ' +
        round(adv20, 0) +
        ' USD (' +
        band +
        ' the eligibility minimum of ' +
        advMinimum +
        ' USD).' +
        (adv60 != null ? ' 60-day average dollar volume is ' + round(adv60, 0) + ' USD.' : ''),
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 84,
      materiality: 'HIGH',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  }

  if (rs3) {
    pushClaim(claims, {
      topic_key: 'relative_strength',
      claim_text:
        round(rs3.excess_ppt, 1) +
        ' ppt versus XBI over 3 months (stock ' +
        round(rs3.stock_return_pct, 1) +
        '%; XBI ' +
        round(rs3.benchmark_return_pct, 1) +
        '%).',
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 74,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  } else {
    insufficient.push('relative_strength');
  }

  if (eventRow) {
    pushClaim(claims, {
      topic_key: 'event_price_reaction',
      claim_text:
        'Latest dated catalyst window: ' +
        round(eventRow.excess_return_pct, 1) +
        '% versus XBI across ' +
        eventRow.sessions +
        ' sessions. Not a trade instruction.',
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 70,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  } else {
    insufficient.push('event_price_reaction');
    pushClaim(claims, {
      topic_key: 'insufficient_event_price_reaction',
      claim_text:
        'INSUFFICIENT_EVIDENCE: Event-window price reaction needs a dated catalyst and aligned issuer plus XBI bars.',
      claim_category: 'technical_market',
      claim_kind: 'inference',
      confidence: 90,
      materiality: 'LOW',
      extraction_method: 'deterministic_insufficient_gate',
      evidence_ids: evidenceIds.slice(0, 2),
    });
  }

  if (timing.label) {
    pushClaim(claims, {
      topic_key: 'entry_timing_context',
      claim_text:
        'Entry-timing context is ' +
        timing.label +
        '. ' +
        timing.reason +
        '. Not a trade instruction.',
      claim_category: 'technical_market',
      claim_kind: 'inference',
      confidence: 72,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_timing_rubric',
      evidence_ids: evidenceIds.slice(0, 4),
    });
  } else {
    insufficient.push('entry_timing_context');
  }

  if (weeklyVolRatio != null) {
    pushClaim(claims, {
      topic_key: 'volume_confirmation',
      claim_text:
        (downWeek ? 'Down-week' : 'Up-week') +
        ' volume is ' +
        round(weeklyVolRatio, 2) +
        ' times the prior weekly average.' +
        (dailyVolRatio != null
          ? ' Latest session is ' + round(dailyVolRatio, 2) + ' times the 20-day average.'
          : ''),
      claim_category: 'technical_market',
      claim_kind: 'calculation',
      confidence: 70,
      materiality: 'LOW',
      extraction_method: 'deterministic_technical_indicators',
      evidence_ids: evidenceIds.slice(0, 3),
    });
  }

  if (input.short_interest_pct != null) {
    pushClaim(claims, {
      topic_key: 'short_interest',
      claim_text:
        'Authorized short-interest field is ' +
        round(input.short_interest_pct, 2) +
        '% of float.',
      claim_category: 'technical_market',
      claim_kind: 'fact',
      confidence: 70,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_licensed_field',
      evidence_ids: evidenceIds.slice(0, 2),
    });
  } else {
    insufficient.push('short_interest');
    pushClaim(claims, {
      topic_key: 'insufficient_short_interest',
      claim_text:
        'INSUFFICIENT_EVIDENCE: Short interest and days-to-cover require an authorized licensed field; not inferred from price.',
      claim_category: 'technical_market',
      claim_kind: 'inference',
      confidence: 95,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_insufficient_gate',
      evidence_ids: evidenceIds.slice(0, 2),
    });
  }

  const trendAlignment =
    stack === 'above' ? 85 : stack === 'mixed' ? 55 : stack === 'below' ? 25 : null;
  const snapshot = {
    trend_alignment: trendAlignment,
    drawdown_pct: range ? range.drawdown_pct : null,
    rs_xbi_3m_ppt: rs3 ? rs3.excess_ppt : null,
    adv20,
    adv_minimum: advMinimum,
    realized_vol: vol,
    event_excess_return_pct: eventRow ? eventRow.excess_return_pct : null,
    timing_label: timing.label,
    weekly_close: weeklyClose,
    weekly_sma_40: weekly40 ? weekly40.value : null,
  };
  addIndicator('trend_alignment', trendAlignment, 'sma stack score', '1day');
  addIndicator('drawdown_52w_pct', range ? range.drawdown_pct : null, 'from 52w high', '1day');
  addIndicator('rs_xbi_3m_ppt', rs3 ? rs3.excess_ppt : null, 'excess vs XBI', '1day');
  addIndicator('adv_20d', adv20, 'dollar volume', '1day');
  addIndicator('realized_vol_20d_ann', vol, 'log return stdev annualized', '1day');
  addIndicator(
    'event_excess_return_pct',
    eventRow ? eventRow.excess_return_pct : null,
    'vs XBI',
    '1day',
  );
  addIndicator('weekly_rsi_14', rsiValue, 'wilder', '1week');
  if (macdRow) addIndicator('weekly_macd_histogram', macdRow.histogram, '12/26/9', '1week');
  if (adxRow) addIndicator('weekly_adx_14', adxRow.adx, 'wilder', '1week');
  if (timing.label) {
    indicatorRows.push({
      symbol: ticker,
      interval: '1week',
      as_of: input.as_of || '',
      indicator_key: 'timing_label',
      params_hash: crypto.createHash('sha256').update('timing_label').digest('hex').slice(0, 16),
      metric_value: timing.label === 'CONSTRUCTIVE' ? 2 : timing.label === 'MIXED' ? 1 : 0,
      calculation_notes: timing.label,
      source_evidence_id: evidenceIds[0] || '',
    });
  }

  const components = componentScores(snapshot);
  const scored = technicalContextScore(components, input.technical_weights || null);

  return {
    status: 'SUCCEEDED',
    outcome: 'ANALYZED',
    next_state: 'ANALYZING',
    reason: 'technical_claims_written',
    claims,
    indicator_rows: indicatorRows,
    insufficient_topics: insufficient,
    technical_snapshot: snapshot,
    technical_components: components,
    technical_context_score: scored.score,
    fill_in_suggestions: [],
    entry_timing_context: timing.label,
    monitoring_seeds: [
      { rule_type: 'weekly_40_sma_cross', description: 'Weekly close crosses the 40-week SMA.' },
      {
        rule_type: 'drawdown_from_case_close',
        description: 'Drawdown from case-as-of close reaches 20 percent.',
      },
      {
        rule_type: 'volume_spike',
        description: 'Daily volume is at least 3 times the 20-day average.',
      },
      {
        rule_type: 'rs_vs_xbi_deterioration',
        description: '3-month relative strength versus XBI worsens by at least 10 ppt.',
      },
    ],
  };
}

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function parseMaybe(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function applyFocus(evaluated, focus) {
  const mode = String(focus || '').toLowerCase();
  const result = evaluated || { claims: [], indicator_rows: [] };
  if (mode !== 'events') {
    result.agent_key = result.agent_key || 'PII-16';
    return result;
  }
  const keep = new Set(['event_price_reaction', 'insufficient_event_price_reaction']);
  result.claims = (result.claims || []).filter((claim) => keep.has(claim.topic_key));
  result.indicator_rows = (result.indicator_rows || []).filter(
    (row) => row.indicator_key === 'event_excess_return_pct',
  );
  result.monitoring_seeds = [];
  result.agent_key = 'PII-16-EVENTS';
  return result;
}

const input = ($input.first() && $input.first().json) || {};
const action = input.action || 'evaluate';

if (action === 'sma') {
  return [{ json: { value: sma(input.values, input.period) } }];
}
if (action === 'ema') {
  return [{ json: { value: ema(input.values, input.period) } }];
}
if (action === 'rsi') {
  return [{ json: { value: rsi(input.values, input.period) } }];
}
if (action === 'macd') {
  return [
    {
      json: macd(input.values, input.fast, input.slow, input.signal) || {
        macd: null,
        signal: null,
        histogram: null,
      },
    },
  ];
}
if (action === 'atr') {
  return [{ json: { value: atr(input.bars, input.period) } }];
}
if (action === 'adx') {
  return [{ json: adx(input.bars, input.period) || { adx: null } }];
}
if (action === 'drawdown') {
  return [{ json: drawdownFromHigh(input.bars, input.sessions || 252) }];
}
if (action === 'realized_vol') {
  return [{ json: { value: realizedVol(input.values, input.period, input.annualization || 252) } }];
}
if (action === 'adv') {
  return [{ json: { value: adv(input.bars, input.window) } }];
}
if (action === 'relative_strength') {
  return [
    {
      json: relativeStrength(input.stock, input.benchmark, input.sessions) || { excess_ppt: null },
    },
  ];
}
if (action === 'rubric') {
  return [{ json: timingRubric(input.metrics, input.rubric) }];
}
if (action === 'audit_text') {
  return [{ json: { hits: forbiddenHits(input.text) } }];
}
if (action === 'apply_focus') {
  return [{ json: applyFocus(input.evaluated || { claims: input.claims || [], indicator_rows: input.indicator_rows || [] }, input.focus) }];
}
if (action === 'score') {
  const components = componentScores(input.snapshot || {});
  const scored = technicalContextScore(components, input.weights || null);
  return [{ json: { components, score: scored.score, used: scored.used } }];
}

const validated = nodeJson('Validate Technical Request') || input;
const caseRow = nodeJson('Load Case And Company') || {};
const barRow = nodeJson('Load Market Bars') || {};
const catalystRow = nodeJson('Load Catalyst Dates') || {};
const configRow = nodeJson('Load Analysis Config') || {};
const gates = (configRow.gates_json && configRow.gates_json.analysis) || {};
const technicalCfg = gates.technical || input.technical_config || {};
const bars = input.bars || parseMaybe(barRow.bars_json) || parseMaybe(input.bars_json) || {};
const catalystDates =
  input.catalyst_dates ||
  parseMaybe(catalystRow.catalyst_dates) ||
  parseMaybe(input.catalyst_dates_json) ||
  [];
const evidenceIds =
  input.evidence_ids ||
  (Array.isArray(barRow.evidence_ids) ? barRow.evidence_ids : []);

const evaluated = applyFocus(evaluateTechnical({
  ticker: validated.ticker || caseRow.ticker || input.ticker,
  bars,
  technical_config: technicalCfg,
  catalyst_dates: catalystDates,
  evidence_ids: evidenceIds,
  as_of: input.as_of || caseRow.as_of_date || null,
  eligibility_min_adv_usd:
    (configRow.eligibility_json && configRow.eligibility_json.min_avg_daily_dollar_volume_usd) ||
    technicalCfg.eligibility_min_adv_usd,
  short_interest_pct: input.short_interest_pct,
  technical_weights:
    (configRow.scores_json &&
      configRow.scores_json.technical &&
      configRow.scores_json.technical.weights) ||
    null,
}), validated.focus || input.focus);

const caseId = validated.case_id || caseRow.case_id || input.case_id || null;
const summary = {
  outcome: evaluated.outcome,
  next_state: evaluated.next_state,
  reason: evaluated.reason,
  claim_count: evaluated.claims.length,
  insufficient_topics: evaluated.insufficient_topics,
  entry_timing_context: evaluated.entry_timing_context,
  technical_context_score: evaluated.technical_context_score,
};
const metadata_b64 = Buffer.from(JSON.stringify(summary), 'utf8').toString('base64');
const indicators_b64 = Buffer.from(JSON.stringify(evaluated.indicator_rows), 'utf8').toString(
  'base64',
);
const claims_b64 = Buffer.from(
  JSON.stringify(
    evaluated.claims.map((claim, index) => ({
      claim_index: index,
      claim_text: String(claim.claim_text || '').replaceAll(',', ' '),
      claim_category: claim.claim_category,
      claim_kind: claim.claim_kind,
      confidence: claim.confidence,
      materiality: claim.materiality,
      extraction_method: claim.extraction_method,
      evidence_ids: claim.evidence_ids || [],
    })),
  ),
  'utf8',
).toString('base64');

return [
  {
    json: {
      task_id: validated.task_id || input.task_id || null,
      case_id: caseId,
      company_id: caseRow.company_id || validated.company_id || null,
      ticker: validated.ticker || caseRow.ticker || input.ticker || null,
      exchange: validated.exchange || caseRow.exchange || input.exchange || null,
      legal_name: caseRow.legal_name || null,
      agent_key: evaluated.agent_key || 'PII-16',
      status: evaluated.status,
      outcome: evaluated.outcome,
      next_state: evaluated.next_state,
      reason: evaluated.reason,
      claims: evaluated.claims,
      claim_ids: [],
      evidence_ids: evidenceIds,
      claim_count: evaluated.claims.length,
      insufficient_topics: evaluated.insufficient_topics,
      fill_in_suggestions: evaluated.fill_in_suggestions,
      cost_usd_actual: 0,
      error_summary: null,
      entry_timing_context: evaluated.entry_timing_context,
      technical_snapshot: evaluated.technical_snapshot,
      technical_context_score: evaluated.technical_context_score,
      indicator_rows: evaluated.indicator_rows,
      indicators_b64,
      claims_b64,
      monitoring_seeds: evaluated.monitoring_seeds || [],
      counts: {
        claim_count: evaluated.claims.length,
        indicator_count: evaluated.indicator_rows.length,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
`;
const buildTechnicalResultCode = `// Shape the PII-16 subworkflow result. Same envelope as other analysts.
// The insert/log nodes return only a row id, so read the evaluation directly.

function evaluatedItem() {
  try {
    const row = $('Evaluate Technical Market').first();
    if (row && row.json && row.json.case_id) return row.json;
  } catch {
    // Validation failed before evaluation.
  }
  return $input.first().json || {};
}

const item = evaluatedItem();
let insufficient = item.insufficient_topics;
if (typeof insufficient === 'string') {
  try {
    insufficient = JSON.parse(insufficient);
  } catch {
    insufficient = [];
  }
}
if (!Array.isArray(insufficient)) insufficient = [];

return [
  {
    json: {
      case_id: item.case_id,
      ticker: item.ticker,
      exchange: item.exchange,
      agent_key: item.agent_key || 'PII-16',
      status: item.status || 'FAILED',
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      claim_count: Number(item.claim_count || 0),
      insufficient_topics: insufficient,
      entry_timing_context: item.entry_timing_context || null,
      technical_context_score: item.technical_context_score,
      fill_in_suggestions: item.fill_in_suggestions || [],
      error_summary: item.error_summary || null,
    },
  },
];
`;

const technicalTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Technical Analyst Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'ticker', type: 'string' },
          { name: 'exchange', type: 'string' },
          { name: 'focus', type: 'string' },
        ],
      },
    },
  },
  output: [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD', exchange: 'NASDAQ' }],
});

const validateTechnicalRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Technical Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateTechnicalRequestCode,
    },
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

const loadCaseAndCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Company',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT rc.id AS case_id, rc.ticker, rc.exchange, rc.company_id, rc.as_of_date, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Technical Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const loadMarketBars = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Market Bars',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_object_agg(symbol, intervals), '{}'::jsonb) AS bars_json FROM (SELECT symbol, jsonb_object_agg(interval, bars) AS intervals FROM (SELECT symbol, interval, jsonb_agg(jsonb_build_object('bar_time', bar_time, 'open', open, 'high', high, 'low', low, 'close', close, 'volume', volume) ORDER BY bar_time) AS bars FROM market_bars WHERE symbol = $1 OR symbol IN ('SPY', 'XBI', 'XLV') GROUP BY symbol, interval) s GROUP BY symbol) t",
      options: {
        queryReplacement: expr('{{ $("Validate Technical Request").item.json.ticker }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const loadCatalystDates = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Catalyst Dates',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(expected_date ORDER BY expected_date), '[]'::jsonb) AS catalyst_dates FROM catalysts WHERE case_id = $1::uuid AND expected_date IS NOT NULL",
      options: {
        queryReplacement: expr('{{ $("Validate Technical Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
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
        'SELECT id AS configuration_version_id, gates_json, scores_json, eligibility_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
      options: { queryReplacement: '', replaceEmptyStrings: true },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const evaluateTechnicalMarket = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Technical Market',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateTechnicalMarketCode,
    },
  },
});

const insertTechnicalIndicators = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Technical Indicators',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO technical_indicator_values (case_id, symbol, interval, as_of, indicator_key, params_hash, metric_value, calculation_notes, source_evidence_id) SELECT $1::uuid, r.symbol, r.interval, NULLIF(r.as_of, '')::date, r.indicator_key, r.params_hash, r.metric_value, r.calculation_notes, NULLIF(r.source_evidence_id, '')::uuid FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS r(symbol text, interval text, as_of text, indicator_key text, params_hash text, metric_value numeric, calculation_notes text, source_evidence_id text) ON CONFLICT (case_id, symbol, interval, indicator_key, params_hash) DO UPDATE SET metric_value = EXCLUDED.metric_value, calculation_notes = EXCLUDED.calculation_notes RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Technical Market").first().json.case_id }},{{ $("Evaluate Technical Market").first().json.indicators_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const deleteEventClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Delete Prior Event Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "DELETE FROM claims WHERE case_id = $1::uuid AND claim_category = 'technical_market' AND (claim_text LIKE 'Latest dated catalyst window:%' OR claim_text LIKE 'INSUFFICIENT_EVIDENCE: Event-window%') RETURNING id",
      options: {
        queryReplacement: expr('{{ $("Evaluate Technical Market").first().json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const insertTechnicalClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Technical Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH src AS (SELECT * FROM jsonb_to_recordset(convert_from(decode($2, 'base64'), 'UTF8')::jsonb) AS r(claim_index int, claim_text text, claim_category text, claim_kind text, confidence numeric, materiality text, extraction_method text, evidence_ids jsonb)), ins AS (INSERT INTO claims (case_id, claim_text, claim_category, claim_kind, confidence, materiality, extraction_method, model_version, is_active) SELECT $1::uuid, src.claim_text, src.claim_category, src.claim_kind, src.confidence, src.materiality, src.extraction_method, 'pii-16-v1', TRUE FROM src RETURNING id, claim_text) INSERT INTO claim_evidence_links (claim_id, evidence_id, link_role) SELECT ins.id, eid::uuid, 'SUPPORTS' FROM ins JOIN src ON src.claim_text = ins.claim_text CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(src.evidence_ids, '[]'::jsonb)) AS eid WHERE eid ~ '^[0-9a-f-]{36}$' ON CONFLICT (claim_id, evidence_id, link_role) DO NOTHING RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Technical Market").first().json.case_id }},{{ $("Evaluate Technical Market").first().json.claims_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-16 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, status, metadata_json) VALUES ($1::uuid, 'PII-16', $2, 'SUCCEEDED', convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Technical Market").first().json.case_id }},{{ $("Evaluate Technical Market").first().json.n8n_execution_id }},{{ $("Evaluate Technical Market").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: { postgres: newCredential('Postgres account') },
  },
});

const buildTechnicalResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Technical Result',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildTechnicalResultCode },
  },
});

const note = sticky(
  '## PII-16 Technical analyst\nIndicators are computed from stored bars. No buy or sell language. technical_context_score is not part of research priority.',
  [technicalTrigger, evaluateTechnicalMarket],
  { color: 5 },
);

export default workflow('pii-16-technical', 'PII-16 Technical and Market Behavior Analyst')
  .add(technicalTrigger)
  .to(validateTechnicalRequest)
  .to(
    validationPassed
      .onFalse(buildTechnicalResult)
      .onTrue(
        loadCaseAndCompany
          .to(loadMarketBars)
          .to(loadCatalystDates)
          .to(loadAnalysisConfig)
          .to(evaluateTechnicalMarket)
          .to(deleteEventClaims)
          .to(insertTechnicalIndicators)
          .to(insertTechnicalClaims)
          .to(logWorkflowRun)
          .to(buildTechnicalResult),
      ),
  )
  .add(note);
