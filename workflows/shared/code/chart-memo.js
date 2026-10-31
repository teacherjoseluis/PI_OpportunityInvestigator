// Chart research memo helpers for PII-14.
// Table HTML + one CID PNG. No flexbox, no SVG, no trade language.
// Standalone tests pass chart_memo_action; the email evaluator is prepended after this file.

const RELATIVE_STRENGTH_INDICATOR_KEYS = [
  'rs_xbi_1m_ppt',
  'rs_xlv_1m_ppt',
  'rs_spy_1m_ppt',
  'rs_xbi_3m_ppt',
  'rs_xlv_3m_ppt',
  'rs_spy_3m_ppt',
  'rs_xbi_6m_ppt',
  'rs_xlv_6m_ppt',
  'rs_spy_6m_ppt',
  'rs_xbi_12m_ppt',
  'rs_xlv_12m_ppt',
  'rs_spy_12m_ppt',
];

const EMAIL_RS_KEYS = [
  { key: 'rs_xbi_3m_ppt', bench: 'XBI', window: '3m' },
  { key: 'rs_xlv_3m_ppt', bench: 'XLV', window: '3m' },
  { key: 'rs_spy_3m_ppt', bench: 'SPY', window: '3m' },
  { key: 'rs_xbi_12m_ppt', bench: 'XBI', window: '12m' },
  { key: 'rs_xlv_12m_ppt', bench: 'XLV', window: '12m' },
  { key: 'rs_spy_12m_ppt', bench: 'SPY', window: '12m' },
];

const CASH_METRIC_KEYS = [
  'cash_and_equivalents',
  'short_term_debt',
  'long_term_debt',
  'total_debt',
  'net_cash',
  'liquid_assets',
];

const ON_FILE_SOURCE_TYPES = {
  SEC: ['sec_edgar_submissions', 'sec_edgar_filing'],
  Trials: ['clinicaltrials_gov'],
  FDA: ['fda_drugsfda'],
  News: ['finnhub_company_news'],
  Patents: ['uspto_patent'],
  Courts: ['courtlistener_docket'],
};

const WATCH_CHIPS = [
  { title: 'Next 10-K / 10-Q', subtitle: 'Filing' },
  { title: 'Late-stage readout', subtitle: 'Trials' },
  { title: 'Runway or offering', subtitle: 'Financing' },
  { title: '40-week cross', subtitle: 'or XBI \u221210 ppt' },
];

const SCORE_ROWS = [
  { key: 'business_quality_score', label: 'Business', fill: '#1D4ED8' },
  { key: 'growth_score', label: 'Growth', fill: '#1D4ED8' },
  { key: 'pipeline_score', label: 'Pipeline', fill: '#1D4ED8' },
  { key: 'valuation_context_score', label: 'Valuation', fill: '#0F766E' },
  { key: 'risk_score', label: 'Risk', fill: '#B91C1C' },
  { key: 'technical_context_score', label: 'Technical', fill: '#C2410C', note: 'context only' },
];

const MEMO_FORBIDDEN = [
  { re: /\bbuy\b/i, label: 'buy' },
  { re: /\bsell\b/i, label: 'sell' },
  { re: /\badd\b/i, label: 'add' },
  { re: /\btrim\b/i, label: 'trim' },
  { re: /price target/i, label: 'price target' },
  { re: /\baccumulate\b/i, label: 'accumulate' },
  { re: /\bdistribute\b/i, label: 'distribute' },
  { re: /go long/i, label: 'go long' },
  { re: /short the stock/i, label: 'short the stock' },
];

const TIMING_LABELS = ['CONSTRUCTIVE', 'MIXED', 'UNFAVORABLE'];

function memoNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function memoRound(value, digits) {
  const n = memoNum(value);
  if (n == null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function memoParseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function memoEscape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function memoTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function memoDisplayName(legalName, ticker) {
  if (!legalName) return ticker || 'Unknown';
  return memoTitleCase(String(legalName).replace(/,?\s*inc\.?$/i, '').trim()) || ticker;
}

function formatMemoAsOf(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function memoForbiddenHits(text) {
  const hits = [];
  const value = String(text || '');
  for (const rule of MEMO_FORBIDDEN) {
    if (rule.re.test(value)) hits.push(rule.label);
  }
  return hits;
}

function indicatorMap(raw) {
  const parsed = memoParseJson(raw, {}) || {};
  if (Array.isArray(parsed)) {
    const out = {};
    for (const row of parsed) {
      if (!row || !row.indicator_key) continue;
      out[row.indicator_key] = row;
    }
    return out;
  }
  return parsed;
}

function indicatorValue(map, key) {
  const row = map && map[key];
  if (row == null || row === '') return null;
  if (typeof row === 'object') return memoNum(row.metric_value);
  return memoNum(row);
}

function indicatorNotes(map, key) {
  const row = map && map[key];
  if (!row || typeof row !== 'object') return '';
  return String(row.calculation_notes || '');
}

function resolveTimingLabel(indicators, timingClaimText) {
  const notes = String(indicatorNotes(indicators, 'timing_label') || '')
    .trim()
    .toUpperCase();
  if (TIMING_LABELS.includes(notes)) return notes;
  const text = String(timingClaimText || '');
  const match = text.match(/\b(CONSTRUCTIVE|MIXED|UNFAVORABLE)\b/i);
  return match ? String(match[1]).toUpperCase() : null;
}

function stanceColor(outcomeClass) {
  const key = String(outcomeClass || '').toUpperCase();
  if (key === 'MONITOR' || key === 'ACTIVE_WATCHLIST') return '#0F766E';
  if (key === 'HIGH_CONVICTION_RESEARCH') return '#0B1F33';
  if (key === 'REASSESS_OR_EXCLUDE') return '#B91C1C';
  return '#0B1F33';
}

function timingColor(label) {
  if (label === 'CONSTRUCTIVE') return '#0F766E';
  if (label === 'MIXED') return '#C2410C';
  if (label === 'UNFAVORABLE') return '#B91C1C';
  return '#6B7280';
}

function scoreDisplay(value) {
  const n = memoNum(value);
  if (n == null) {
    return { text: '\u2014', display: '\u2014', color: '#6B7280', widthPct: 0, empty: true };
  }
  const text = String(Math.round(n));
  return {
    text,
    display: text,
    color: '#0B1F33',
    widthPct: Math.max(0, Math.min(100, n)),
    empty: false,
  };
}

function countSourceTypes(counts, types) {
  let n = 0;
  for (const type of types) n += Number((counts && counts[type]) || 0);
  return n;
}

function onFileTiles(input) {
  const counts = memoParseJson(input.evidenceCounts || input.evidence_counts, {}) || {};
  const cashCount = Number(input.cashMetricCount ?? input.cash_metric_count ?? 0);
  const weeklyCount = Number(input.weeklyBarCount ?? input.weekly_bar_count ?? 0);
  const hasShort = input.hasShortInterest === true || input.has_short_interest === true;
  const hasPeers = input.hasPeerSet === true || input.has_peer_set === true;
  return [
    { key: 'SEC', on: countSourceTypes(counts, ON_FILE_SOURCE_TYPES.SEC) > 0 },
    { key: 'Trials', on: countSourceTypes(counts, ON_FILE_SOURCE_TYPES.Trials) > 0 },
    { key: 'FDA', on: countSourceTypes(counts, ON_FILE_SOURCE_TYPES.FDA) > 0 },
    { key: 'News', on: countSourceTypes(counts, ON_FILE_SOURCE_TYPES.News) > 0 },
    { key: 'Cash', on: cashCount > 0 },
    { key: 'Patents', on: countSourceTypes(counts, ON_FILE_SOURCE_TYPES.Patents) > 0 },
    { key: 'Courts', on: countSourceTypes(counts, ON_FILE_SOURCE_TYPES.Courts) > 0 },
    { key: 'Prices', on: weeklyCount >= 40 },
    { key: 'Short', on: hasShort },
    { key: 'Peers', on: hasPeers },
  ];
}

function drawdownPlacement(raw) {
  const n = memoNum(raw);
  if (n == null) {
    return {
      value: null,
      magnitude: null,
      display: '\u2014',
      band: null,
      caption: '\u2014',
      markerPct: null,
      clamped: false,
    };
  }
  const magnitude = Math.abs(n);
  const band = magnitude <= 15 ? 'inside 15%' : magnitude <= 25 ? 'mixed band' : 'beyond 25';
  const clamped = magnitude > 40;
  const markerPct = Math.max(0, Math.min(100, (Math.min(magnitude, 40) / 40) * 100));
  const display = magnitude === 0 ? '0%' : '\u2212' + memoRound(magnitude, 0) + '%';
  return {
    value: n,
    magnitude,
    display,
    band,
    caption: display + ' \u00b7 ' + band,
    markerPct,
    clamped,
  };
}

function rsiPlacement(raw) {
  const n = memoNum(raw);
  if (n == null) {
    return { value: null, display: '\u2014', word: null, markerPct: null, caption: '' };
  }
  const word = n < 30 ? 'Weak' : n > 70 ? 'Strong' : 'Neutral';
  return {
    value: n,
    display: String(Math.round(n)),
    word,
    markerPct: Math.max(0, Math.min(100, n)),
    caption: word + ' momentum. Timing band is the amber slice.',
  };
}

function excessReturnCells(indicators) {
  const cells = [];
  for (const spec of EMAIL_RS_KEYS) {
    const value = indicatorValue(indicators, spec.key);
    cells.push({
      key: spec.key,
      bench: spec.bench,
      window: spec.window,
      value,
      display:
        value == null || value === 0
          ? '\u2014'
          : (value > 0 ? '+' : '\u2212') + Math.abs(memoRound(value, 1)).toFixed(1),
      sign: value == null || value === 0 ? 0 : value > 0 ? 1 : -1,
      color: value == null || value === 0 ? '#6B7280' : value > 0 ? '#0F766E' : '#B91C1C',
    });
  }
  return cells;
}

function excessBarLayout(cells) {
  const magnitudes = cells.map((cell) => (cell.value == null ? 0 : Math.abs(cell.value)));
  const scale = Math.max(1, ...magnitudes);
  return cells.map((cell) => {
    const empty = cell.value == null || cell.value === 0;
    return Object.assign({}, cell, {
      scale,
      empty,
      widthPct: empty ? 0 : (Math.abs(cell.value) / scale) * 100,
    });
  });
}

function sortBars(bars) {
  return (Array.isArray(bars) ? bars.slice() : []).sort((a, b) =>
    String(a.bar_time || '').localeCompare(String(b.bar_time || '')),
  );
}

function smaAt(closes, index, period) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) {
    const n = memoNum(closes[i]);
    if (n == null) return null;
    sum += n;
  }
  return sum / period;
}

function findHighTime(dailyHighs, notes) {
  const fromNotes = String(notes || '').match(/high_time=([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  if (fromNotes) return fromNotes[1];
  const window = sortBars(dailyHighs).slice(-252);
  let high = null;
  let highTime = null;
  for (const bar of window) {
    const h = memoNum(bar.high);
    if (h != null && (high == null || h > high)) {
      high = h;
      highTime = String(bar.bar_time || '').slice(0, 10);
    }
  }
  return highTime;
}

function weekIndexForDate(weekly, date) {
  if (!date) return -1;
  const day = String(date).slice(0, 10);
  for (let i = 0; i < weekly.length; i += 1) {
    const start = i === 0 ? '0000-01-01' : String(weekly[i - 1].bar_time || '').slice(0, 10);
    const end = String(weekly[i].bar_time || '').slice(0, 10);
    if (day > start && day <= end) return i;
  }
  return -1;
}

function prepareWeeklySeries(weeklyBars, dailyHighs, drawdownNotes) {
  const all = sortBars(weeklyBars).filter((bar) => memoNum(bar.close) != null);
  if (!all.length) return { window: [], sma40: [], highIndex: -1 };
  const window = all.slice(-52);
  const offset = all.length - window.length;
  const closes = all.map((bar) => memoNum(bar.close));
  const sma40 = window.map((_, i) => smaAt(closes, offset + i, 40));
  const highTime = findHighTime(dailyHighs, drawdownNotes);
  let highIndex = weekIndexForDate(window, highTime);
  if (highIndex < 0) {
    let high = null;
    for (let i = 0; i < window.length; i += 1) {
      const h = memoNum(window[i].high);
      if (h != null && (high == null || h > high)) {
        high = h;
        highIndex = i;
      }
    }
  }
  return { window, sma40, highIndex, allCount: all.length };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  const table = crc32.table || (crc32.table = (function build() {
    const out = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      out[i] = c >>> 0;
    }
    return out;
  })());
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function zlibStore(data) {
  const chunks = [];
  chunks.push(0x78, 0x01);
  let offset = 0;
  while (offset < data.length) {
    const size = Math.min(65535, data.length - offset);
    const last = offset + size >= data.length ? 1 : 0;
    chunks.push(last);
    chunks.push(size & 0xff, (size >>> 8) & 0xff, (~size) & 0xff, ((~size) >>> 8) & 0xff);
    for (let i = 0; i < size; i += 1) chunks.push(data[offset + i]);
    offset += size;
  }
  const sum = adler32(data);
  chunks.push(...u32(sum));
  return Uint8Array.from(chunks);
}

function deflateBytes(data) {
  try {
    if (typeof require === 'function') {
      return Uint8Array.from(require('zlib').deflateSync(Buffer.from(data)));
    }
  } catch {
    // n8n Code nodes may not expose zlib.
  }
  return zlibStore(data);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = new Uint8Array(4 + data.length);
  payload.set(typeBytes, 0);
  payload.set(data, 4);
  const crc = crc32(payload);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(payload, 4);
  out.set(u32(crc), 8 + data.length);
  return out;
}

function encodePngRgb(width, height, pixels) {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    raw.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), row + 1);
  }
  const ihdr = Uint8Array.from([
    ...u32(width),
    ...u32(height),
    8,
    2,
    0,
    0,
    0,
  ]);
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateBytes(raw)), pngChunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const part of chunks) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return Buffer.from(out);
}

const FONT5 = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '%': [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  w: [0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0a],
  h: [0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11],
  i: [0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e],
  g: [0x00, 0x0e, 0x11, 0x0f, 0x01, 0x11, 0x0e],
  '-': [0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x04],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

function hexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function createCanvas(width, height, background) {
  const pixels = new Uint8Array(width * height * 3);
  const [r, g, b] = hexRgb(background || '#FFFFFF');
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
  return { width, height, pixels };
}

function setPixel(canvas, x, y, rgb) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= canvas.width || yi >= canvas.height) return;
  const i = (yi * canvas.width + xi) * 3;
  canvas.pixels[i] = rgb[0];
  canvas.pixels[i + 1] = rgb[1];
  canvas.pixels[i + 2] = rgb[2];
}

function fillRect(canvas, x, y, w, h, hex) {
  const rgb = hexRgb(hex);
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) setPixel(canvas, xx, yy, rgb);
  }
}

function fillCircle(canvas, cx, cy, radius, hex) {
  const rgb = hexRgb(hex);
  const r2 = radius * radius;
  const x0 = Math.floor(cx - radius);
  const y0 = Math.floor(cy - radius);
  const x1 = Math.ceil(cx + radius);
  const y1 = Math.ceil(cy + radius);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(canvas, x, y, rgb);
    }
  }
}

function drawLine(canvas, x0, y0, x1, y1, hex, width) {
  const rgb = hexRgb(hex);
  const thick = Math.max(1, Math.round(width || 1));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i += 1) {
    const x = x0 + (dx * i) / steps;
    const y = y0 + (dy * i) / steps;
    for (let oy = -Math.floor(thick / 2); oy <= Math.floor(thick / 2); oy += 1) {
      for (let ox = -Math.floor(thick / 2); ox <= Math.floor(thick / 2); ox += 1) {
        setPixel(canvas, x + ox, y + oy, rgb);
      }
    }
  }
}

function drawDashedLine(canvas, points, hex, width, dash, gap) {
  if (points.length < 2) return;
  const dashLen = dash || 8;
  const gapLen = gap || 6;
  let phase = 0;
  let drawing = true;
  for (let i = 1; i < points.length; i += 1) {
    const x0 = points[i - 1][0];
    const y0 = points[i - 1][1];
    const x1 = points[i][0];
    const y1 = points[i][1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (drawing) drawLine(canvas, x, y, x, y, hex, width);
      phase += len / steps;
      const limit = drawing ? dashLen : gapLen;
      if (phase >= limit) {
        phase = 0;
        drawing = !drawing;
      }
    }
  }
}

function drawPoly(canvas, points, hex, width) {
  for (let i = 1; i < points.length; i += 1) {
    drawLine(canvas, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], hex, width);
  }
}

function drawText(canvas, text, x, y, hex, scale) {
  const s = scale || 2;
  let cx = x;
  for (const ch of String(text)) {
    const glyph = FONT5[ch] || FONT5[ch.toLowerCase()] || FONT5[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row] & (1 << (4 - col))) {
          fillRect(canvas, cx + col * s, y + row * s, s, s, hex);
        }
      }
    }
    cx += 6 * s;
  }
  return cx;
}

function renderWeeklyPricePng(weeklyBars, options) {
  const opts = options || {};
  const series = prepareWeeklySeries(weeklyBars, opts.dailyHighs || [], opts.drawdownNotes || '');
  if (!series.window.length) return null;
  const width = 1360;
  const height = 376;
  const canvas = createCanvas(width, height, '#FFFFFF');
  const left = 72;
  const right = width - 32;
  const top = 40;
  const priceBottom = 264;
  const volTop = 280;
  const volBottom = 352;
  const plot = series.window;
  let minP = null;
  let maxP = null;
  let maxVol = 0;
  for (const bar of plot) {
    const hi = memoNum(bar.high);
    const lo = memoNum(bar.low);
    const cl = memoNum(bar.close);
    const vol = memoNum(bar.volume) || 0;
    if (hi != null) maxP = maxP == null ? hi : Math.max(maxP, hi);
    if (lo != null) minP = minP == null ? lo : Math.min(minP, lo);
    if (cl != null) {
      maxP = maxP == null ? cl : Math.max(maxP, cl);
      minP = minP == null ? cl : Math.min(minP, cl);
    }
    if (vol > maxVol) maxVol = vol;
  }
  for (const sma of series.sma40) {
    if (sma != null) {
      maxP = maxP == null ? sma : Math.max(maxP, sma);
      minP = minP == null ? sma : Math.min(minP, sma);
    }
  }
  if (minP == null || maxP == null) return null;
  const pad = Math.max((maxP - minP) * 0.04, Math.abs(maxP) * 0.002, 0.01);
  minP -= pad;
  maxP += pad;
  const xAt = (i) => left + (plot.length === 1 ? 0 : (i / (plot.length - 1)) * (right - left));
  const yAt = (value) => top + ((maxP - value) / (maxP - minP)) * (priceBottom - top);

  fillRect(canvas, left, 48 * 2 - 56, right - left, 1, '#F3F4F6');
  fillRect(canvas, left, 90 * 2 - 56, right - left, 1, '#F3F4F6');
  fillRect(canvas, left, top, 1, priceBottom - top, '#E5E7EB');
  fillRect(canvas, left, priceBottom, right - left, 1, '#E5E7EB');

  const volH = volBottom - volTop;
  for (let i = 0; i < plot.length; i += 1) {
    const vol = memoNum(plot[i].volume) || 0;
    const h = maxVol > 0 ? (vol / maxVol) * volH : 0;
    const barW = Math.max(4, ((right - left) / Math.max(plot.length, 1)) * 0.62);
    fillRect(canvas, xAt(i) - barW / 2, volBottom - h, barW, h, '#E5E7EB');
  }

  const smaPts = [];
  for (let i = 0; i < plot.length; i += 1) {
    if (series.sma40[i] != null) smaPts.push([xAt(i), yAt(series.sma40[i])]);
  }
  if (series.allCount >= 40 && smaPts.length >= 2) {
    drawDashedLine(canvas, smaPts, '#0F766E', 4, 8, 6);
  }

  const closePts = [];
  for (let i = 0; i < plot.length; i += 1) {
    closePts.push([xAt(i), yAt(memoNum(plot[i].close))]);
  }
  drawPoly(canvas, closePts, '#0B1F33', 4);

  if (series.highIndex >= 0 && series.highIndex < plot.length) {
    const hx = xAt(series.highIndex);
    const hy = yAt(memoNum(plot[series.highIndex].high) ?? memoNum(plot[series.highIndex].close));
    fillCircle(canvas, hx, hy, 6, '#B91C1C');
    drawText(canvas, '52w high', hx - 86, hy - 22, '#B91C1C', 2);
  }

  const last = plot[plot.length - 1];
  const lx = xAt(plot.length - 1);
  const ly = yAt(memoNum(last.close));
  fillCircle(canvas, lx, ly, 7, '#0B1F33');
  const dd = drawdownPlacement(opts.drawdownPct);
  if (dd.value != null) {
    drawText(canvas, dd.display, Math.max(left, lx - 70), ly - 24, '#0B1F33', 2);
  }

  return encodePngRgb(width, height, canvas.pixels);
}

function buildPriceLegend(rsi, volRatio) {
  const parts = ['Weekly close', '40-week average', 'Volume'];
  if (rsi != null) parts.push('RSI ' + Math.round(rsi));
  if (volRatio != null) {
    parts.push('last week ' + Number(volRatio).toFixed(1) + '\u00d7 average volume');
  }
  return parts.join(' \u00b7 ');
}

function sectionLabel(text) {
  return (
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.05em;color:#374151;text-transform:uppercase;margin:0 0 6px 0">' +
    memoEscape(text) +
    '</div>'
  );
}

function kpiCell(value, caption, color) {
  return (
    '<td width="25%" style="padding:4px;vertical-align:top">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:4px"><tr><td style="padding:8px 10px 7px 10px">' +
    '<div style="font-size:18px;font-weight:700;line-height:1.1;color:' +
    color +
    '">' +
    memoEscape(value) +
    '</div>' +
    '<div style="font-size:10px;color:#6B7280;margin-top:2px;font-weight:600">' +
    memoEscape(caption) +
    '</div></td></tr></table></td>'
  );
}

function excessGroupHtml(title, rows) {
  const body = rows
    .map((row) => {
      const bar =
        row.empty || row.widthPct <= 0
          ? '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>'
          : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="' +
            Math.max(1, Math.round(row.widthPct)) +
            '%" style="background:' +
            row.color +
            ';height:12px;font-size:0;line-height:0">&nbsp;</td><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr></table>';
      return (
        '<tr><td width="32" style="padding:5px 6px 5px 0;font-size:12px;color:#111827">' +
        memoEscape(row.bench) +
        '</td><td style="padding:5px 6px 5px 0">' +
        bar +
        '</td><td width="44" style="padding:5px 0;font-size:11px;color:' +
        row.color +
        ';white-space:nowrap">' +
        memoEscape(row.display) +
        '</td></tr>'
      );
    })
    .join('');
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td colspan="3" style="padding:0 0 6px 0;font-size:10px;color:#6B7280">' +
    memoEscape(title) +
    '</td></tr>' +
    body +
    '</table>'
  );
}

function markerRow(pct, color) {
  if (pct == null) return '';
  const width = Math.max(1, Math.min(100, Math.round(pct)));
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="' +
    width +
    '%" style="text-align:right;font-size:10px;line-height:10px;color:' +
    color +
    '">&#9660;</td>' +
    (width < 100 ? '<td style="font-size:10px;line-height:10px">&nbsp;</td>' : '') +
    '</tr></table>'
  );
}

function buildChartMemoHtml(ctx) {
  const draftNote = '';
  const kpiRow =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    kpiCell(ctx.outcomeClass || '\u2014', 'Research stance', stanceColor(ctx.outcomeClass)) +
    kpiCell(ctx.timingDisplay, 'Timing context', ctx.timingColor) +
    kpiCell(ctx.priority.display, 'Priority score', ctx.priority.empty ? '#6B7280' : '#0B1F33') +
    kpiCell(ctx.confidence.display, 'Evidence confidence', ctx.confidence.empty ? '#6B7280' : '#0B1F33') +
    '</tr></table>';

  const priceInner = ctx.hasPriceChart
    ? '<img src="cid:priceChart" width="680" height="188" alt="Weekly price" style="display:block;border:0;width:680px;height:188px" />' +
      '<div style="font-size:11px;color:#6B7280;margin-top:6px">' +
      memoEscape(ctx.legend) +
      '</div>'
    : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6"><tr><td style="padding:36px 16px;text-align:center;color:#6B7280;font-size:13px">Price history is not on file.</td></tr></table>';

  const three = ctx.excess.filter((row) => row.window === '3m');
  const twelve = ctx.excess.filter((row) => row.window === '12m');
  const excessHtml =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="50%" style="vertical-align:top;padding-right:8px">' +
    excessGroupHtml('3 month', three) +
    '</td>' +
    '<td width="50%" style="vertical-align:top;padding-left:8px">' +
    excessGroupHtml('12 month', twelve) +
    '</td></tr>' +
    '<tr><td style="padding-top:8px;font-size:10px;color:#9CA3AF">weaker</td>' +
    '<td style="padding-top:8px;font-size:10px;color:#9CA3AF;text-align:right">stronger</td></tr></table>' +
    '<div style="font-size:11px;color:#6B7280;margin-top:4px">Percentage points versus XBI, XLV, and SPY.</div>';

  const dd = ctx.drawdown;
  const drawdownHtml =
    markerRow(dd.markerPct, '#C2410C') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="38%" style="background:#D1FAE5;height:18px;font-size:0;line-height:0">&nbsp;</td>' +
    '<td width="25%" style="background:#FFEDD5;height:18px;font-size:0;line-height:0">&nbsp;</td>' +
    '<td width="37%" style="background:#FEE2E2;height:18px;font-size:0;line-height:0">&nbsp;</td>' +
    '</tr></table>' +
    '<div style="font-size:12px;font-weight:700;color:#C2410C;margin-top:6px">' +
    memoEscape(dd.caption) +
    '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:10px;color:#065F46">inside 15%</td>' +
    '<td style="font-size:10px;color:#9A3412;text-align:center">15\u201325</td>' +
    '<td style="font-size:10px;color:#991B1B;text-align:right">beyond 25</td>' +
    '</tr></table>';

  const rsi = ctx.rsi;
  const rsiHtml =
    markerRow(rsi.markerPct, '#0B1F33') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="30%" style="background:#FEE2E2;height:10px;font-size:0;line-height:0">&nbsp;</td>' +
    '<td width="40%" style="background:#E5E7EB;height:10px;font-size:0;line-height:0">&nbsp;</td>' +
    '<td width="30%" style="background:#D1FAE5;height:10px;font-size:0;line-height:0">&nbsp;</td>' +
    '</tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:10px;color:#6B7280">30</td>' +
    '<td style="font-size:11px;font-weight:700;color:#111827;text-align:center">' +
    memoEscape(rsi.display) +
    '</td>' +
    '<td style="font-size:10px;color:#6B7280;text-align:right">70</td>' +
    '</tr></table>' +
    (rsi.caption
      ? '<div style="font-size:11px;color:#6B7280;margin-top:4px">' + memoEscape(rsi.caption) + '</div>'
      : '');

  const scoreHtml = ctx.scores
    .map((row) => {
      const fill =
        row.empty || row.widthPct <= 0
          ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6"><tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr></table>'
          : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6"><tr><td width="' +
            Math.max(1, Math.round(row.widthPct)) +
            '%" style="background:' +
            row.fill +
            ';height:12px;font-size:0;line-height:0">&nbsp;</td><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr></table>';
      return (
        '<tr>' +
        '<td width="78" style="padding:4px 8px 4px 0;font-size:11px;color:#374151">' +
        memoEscape(row.label) +
        '</td>' +
        '<td style="padding:4px 8px 4px 0">' +
        fill +
        '</td>' +
        '<td width="36" style="padding:4px 0;font-size:11px;color:#111827;text-align:right">' +
        memoEscape(row.display) +
        '</td>' +
        '<td width="72" style="padding:4px 0 4px 6px;font-size:10px;color:#9CA3AF">' +
        memoEscape(row.note || '') +
        '</td></tr>'
      );
    })
    .join('');

  const tiles = ctx.onFile
    .map((tile) => {
      const mark = tile.on
        ? '<div style="height:28px;border-radius:4px;background:#0F766E">&nbsp;</div>'
        : '<div style="height:28px;border-radius:4px;background:#ffffff;border:1.5px dashed #9CA3AF">&nbsp;</div>';
      return (
        '<td width="10%" align="center" style="padding:0 3px;vertical-align:top">' +
        mark +
        '<div style="font-size:10px;font-weight:650;color:#374151;margin-top:4px">' +
        memoEscape(tile.key) +
        '</div></td>'
      );
    })
    .join('');

  const chips = WATCH_CHIPS.map((chip) => {
    return (
      '<td width="25%" style="padding:0 4px;vertical-align:top">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;background:#F8FAFC;border-radius:4px"><tr><td style="padding:7px 8px">' +
      '<div style="font-size:11px;font-weight:650;color:#1F2937">' +
      memoEscape(chip.title) +
      '</div>' +
      '<div style="font-size:10px;color:#6B7280;margin-top:1px">' +
      memoEscape(chip.subtitle) +
      '</div></td></tr></table></td>'
    );
  }).join('');

  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#E8ECF0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E8ECF0;padding:24px 12px">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:720px;max-width:720px;background:#FFFFFF;border-radius:4px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">' +
    '<tr><td style="background:#0B1F33;padding:16px 22px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:top">' +
    '<div style="color:#D7E0EA;font-size:11px;letter-spacing:0.08em;font-weight:600">PHARMA OPPORTUNITY INVESTIGATOR</div>' +
    '<div style="color:#FFFFFF;font-size:34px;font-weight:700;line-height:1.1;margin-top:4px">' +
    memoEscape(ctx.ticker) +
    '</div>' +
    '<div style="color:#C9D5E3;font-size:12px;margin-top:4px">' +
    memoEscape(ctx.companyDisplay) +
    ' \u00b7 ' +
    memoEscape(ctx.exchange || '') +
    ' \u00b7 ' +
    memoEscape(ctx.asOfDisplay || '') +
    '</div></td>' +
    '<td style="vertical-align:top;text-align:right;width:140px">' +
    '<span style="display:inline-block;padding:5px 12px;border:1px solid #5EEAD4;border-radius:999px;color:#5EEAD4;font-size:12px;font-weight:700;letter-spacing:0.04em">' +
    memoEscape(ctx.outcomeClass || 'UNKNOWN') +
    '</span></td></tr></table></td></tr>' +
    draftNote +
    '<tr><td style="background:#F8EDE3;padding:7px 22px;color:#8A5A2B;font-size:12px">Research memo \u00b7 timing context is not a trade instruction.</td></tr>' +
    '<tr><td style="padding:12px 18px 4px 18px">' +
    kpiRow +
    '</td></tr>' +
    '<tr><td style="padding:8px 22px 2px 22px">' +
    sectionLabel('Weekly price') +
    priceInner +
    '</td></tr>' +
    '<tr><td style="padding:8px 22px 2px 22px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="50%" style="vertical-align:top;padding-right:10px">' +
    sectionLabel('Excess return') +
    excessHtml +
    '</td>' +
    '<td width="50%" style="vertical-align:top;padding-left:10px">' +
    sectionLabel('Drawdown from 52-week high') +
    drawdownHtml +
    '<div style="height:8px;font-size:0;line-height:0">&nbsp;</div>' +
    sectionLabel('RSI (14)') +
    rsiHtml +
    '</td></tr></table></td></tr>' +
    '<tr><td style="padding:8px 22px 6px 22px">' +
    sectionLabel('Scores') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    scoreHtml +
    '</table></td></tr>' +
    '<tr><td style="padding:8px 22px 8px 22px">' +
    sectionLabel('On file') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    tiles +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:2px 22px 4px 22px">' +
    sectionLabel('What would change the read') +
    '</td></tr>' +
    '<tr><td style="padding:0 18px 12px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    chips +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:10px 22px 12px 22px;border-top:1px solid #E5E7EB">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:10px;color:#9CA3AF">Case ' +
    memoEscape(ctx.caseId) +
    ' \u00b7 As of ' +
    memoEscape(ctx.asOfDisplay || 'n/a') +
    '</td>' +
    '<td style="font-size:10px;color:#9CA3AF;text-align:right">Research assistance only. Not investment advice.</td>' +
    '</tr></table></td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

function buildChartMemoText(ctx) {
  const lines = [];
  lines.push('PHARMA OPPORTUNITY INVESTIGATOR');
  lines.push(ctx.ticker + '  [' + (ctx.outcomeClass || 'UNKNOWN') + ']');
  lines.push(
    ctx.companyDisplay +
      ' \u00b7 ' +
      (ctx.exchange || '') +
      ' \u00b7 ' +
      (ctx.asOfDisplay || ''),
  );
  lines.push('');
  lines.push('Research memo \u00b7 timing context is not a trade instruction.');
  lines.push('');
  lines.push('Research stance: ' + (ctx.outcomeClass || '\u2014'));
  lines.push('Timing context: ' + ctx.timingDisplay);
  lines.push('Priority score: ' + ctx.priority.text);
  lines.push('Evidence confidence: ' + ctx.confidence.text);
  lines.push('');
  if (!ctx.hasPriceChart) lines.push('Price history is not on file.');
  else lines.push(ctx.legend);
  lines.push('');
  lines.push('Excess return (ppt)');
  const three = ctx.excess.filter((row) => row.window === '3m');
  const twelve = ctx.excess.filter((row) => row.window === '12m');
  lines.push(
    '3 month  ' + three.map((row) => row.bench + ' ' + row.display).join('  '),
  );
  lines.push(
    '12 month ' + twelve.map((row) => row.bench + ' ' + row.display).join('  '),
  );
  lines.push('');
  lines.push('Drawdown from 52-week high: ' + ctx.drawdown.caption);
  lines.push('RSI (14): ' + ctx.rsi.display + (ctx.rsi.word ? ' \u00b7 ' + ctx.rsi.word + ' momentum' : ''));
  lines.push('');
  lines.push('Scores');
  for (const row of ctx.scores) {
    lines.push('- ' + row.label + ': ' + row.display + (row.note ? ' (' + row.note + ')' : ''));
  }
  lines.push('');
  const present = ctx.onFile.filter((tile) => tile.on).map((tile) => tile.key);
  const missing = ctx.onFile.filter((tile) => !tile.on).map((tile) => tile.key);
  lines.push('On file: ' + (present.length ? present.join(', ') : '(none)'));
  lines.push('Not on file: ' + (missing.length ? missing.join(', ') : '(none)'));
  lines.push('');
  lines.push('What would change the read');
  for (const chip of WATCH_CHIPS) lines.push('- ' + chip.title);
  lines.push('');
  lines.push(
    'Case ' +
      ctx.caseId +
      ' \u00b7 As of ' +
      (ctx.asOfDisplay || 'n/a'),
  );
  lines.push('Research assistance only. Not investment advice.');
  return lines.join('\n');
}

function buildChartMemo(input) {
  const indicators = indicatorMap(input.indicators);
  const scores = memoParseJson(input.scores, {}) || {};
  const weeklyBars = memoParseJson(input.weeklyBars || input.weekly_bars, []) || [];
  const dailyHighs = memoParseJson(input.dailyHighs || input.daily_highs, []) || [];
  const timingLabel = resolveTimingLabel(indicators, input.timingClaimText || input.timing_claim_text);
  const timingDisplay = timingLabel || 'UNAVAILABLE';
  const drawdownPct = indicatorValue(indicators, 'drawdown_52w_pct');
  const rsiValue = indicatorValue(indicators, 'weekly_rsi_14');
  const volRatio = indicatorValue(indicators, 'weekly_volume_ratio');
  const weeklyCount = Number(input.weeklyBarCount ?? input.weekly_bar_count ?? weeklyBars.length ?? 0);
  const onFile = onFileTiles({
    evidenceCounts: input.evidenceCounts || input.evidence_counts,
    cashMetricCount: input.cashMetricCount ?? input.cash_metric_count,
    weeklyBarCount: weeklyCount,
    hasShortInterest: input.hasShortInterest,
    hasPeerSet: input.hasPeerSet,
  });
  const excess = excessBarLayout(excessReturnCells(indicators));
  const drawdown = drawdownPlacement(drawdownPct);
  const rsi = rsiPlacement(rsiValue);
  const png =
    weeklyBars.length > 0
      ? renderWeeklyPricePng(weeklyBars, {
          dailyHighs,
          drawdownNotes: indicatorNotes(indicators, 'drawdown_52w_pct'),
          drawdownPct,
        })
      : null;
  if (!png) {
    const prices = onFile.find((tile) => tile.key === 'Prices');
    if (prices && weeklyCount < 40) prices.on = false;
  }
  const ctx = {
    ticker: String(input.ticker || 'UNKNOWN').toUpperCase(),
    exchange: input.exchange || '',
    companyDisplay: memoDisplayName(input.legalName || input.legal_name, input.ticker),
    outcomeClass: input.outcomeClass || input.outcome_class || null,
    asOfDisplay: formatMemoAsOf(input.asOf || input.as_of),
    caseId: input.caseId || input.case_id || '',
    timingLabel,
    timingDisplay,
    timingColor: timingColor(timingLabel),
    priority: scoreDisplay(scores.research_priority_score),
    confidence: scoreDisplay(scores.evidence_confidence_score),
    excess,
    drawdown,
    rsi,
    scores: SCORE_ROWS.map((row) =>
      Object.assign({ label: row.label, fill: row.fill, note: row.note || '' }, scoreDisplay(scores[row.key])),
    ),
    onFile,
    legend: buildPriceLegend(rsiValue, volRatio),
    hasPriceChart: Boolean(png),
  };
  ctx.priority.display = ctx.priority.text;
  ctx.confidence.display = ctx.confidence.text;
  return {
    html: buildChartMemoHtml(ctx),
    text: buildChartMemoText(ctx),
    timingLabel,
    timingDisplay,
    subjectCore:
      '[PII] ' +
      ctx.ticker +
      ' \u00b7 ' +
      (ctx.outcomeClass || 'UNKNOWN') +
      ' \u00b7 Timing ' +
      timingDisplay,
    onFile,
    excess,
    drawdown,
    rsi,
    hasPriceChart: Boolean(png),
    png,
    legend: ctx.legend,
    companyDisplay: ctx.companyDisplay,
    asOfDisplay: ctx.asOfDisplay,
  };
}

function dispatchChartMemo(input) {
  const action = String(input.chart_memo_action || '');
  if (action === 'rs_keys') {
    return { keys: RELATIVE_STRENGTH_INDICATOR_KEYS.slice() };
  }
  if (action === 'on_file') {
    return { tiles: onFileTiles(input) };
  }
  if (action === 'drawdown') {
    return drawdownPlacement(input.value);
  }
  if (action === 'excess') {
    return { rows: excessBarLayout(excessReturnCells(indicatorMap(input.indicators))) };
  }
  if (action === 'timing') {
    return {
      label: resolveTimingLabel(indicatorMap(input.indicators), input.timing_claim_text),
    };
  }
  if (action === 'rsi') {
    return rsiPlacement(input.value);
  }
  if (action === 'render_png') {
    const png = renderWeeklyPricePng(input.weekly_bars || [], {
      dailyHighs: input.daily_highs || [],
      drawdownPct: input.drawdown_pct,
      drawdownNotes: input.drawdown_notes,
    });
    return {
      has_png: Boolean(png),
      byte_length: png ? png.length : 0,
      png_magic: png ? png.slice(0, 8).toString('hex') : null,
    };
  }
  if (action === 'build') {
    const memo = buildChartMemo(input);
    return {
      html: memo.html,
      text: memo.text,
      timing_label: memo.timingLabel,
      timing_display: memo.timingDisplay,
      subject_core: memo.subjectCore,
      on_file: memo.onFile,
      has_price_chart: memo.hasPriceChart,
      legend: memo.legend,
      forbidden: memoForbiddenHits(memo.html + '\n' + memo.text),
      has_flexbox: /display\s*:\s*flex/i.test(memo.html),
      has_svg: /<svg\b/i.test(memo.html),
    };
  }
  return { error: 'unknown_chart_memo_action', action };
}

if (typeof $input !== 'undefined' && $input.first) {
  const first = $input.first();
  if (first && first.json && first.json.chart_memo_action) {
    return [{ json: dispatchChartMemo(first.json) }];
  }
}
