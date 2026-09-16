// Canonical source for PII-03 "Normalize Company News Evidence" Code node.
// Compact Finnhub company-news headlines (Slice E5) — no article HTML/PDF archive.

const crypto = require('crypto');

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function toBase64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSqlDateFromUnix(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function truncate(text, max) {
  const s = safeText(text);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare Company News Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const irCfg = collectors.company_ir || {};
const enabled = irCfg.enabled === true;
const limit = Number(
  prepareRow.company_news_limit ?? collection.company_news_limit ?? irCfg.limit ?? 25,
);

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || prepareRow.legal_name || item.legal_name || null;
const ticker = String(
  validated.ticker || caseRow.ticker || prepareRow.ticker || item.ticker || '',
)
  .trim()
  .toUpperCase();

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'company_ir',
        ok: true,
        skipped: true,
        error: null,
        documents: [],
        document_count: 0,
      },
    },
  ];
}

// Finnhub returns a bare array on success (n8n → one item per article).
// Errors are a single object with error/message/statusCode.
let rows = [];
const allItems = $input.all().map((r) => r.json).filter(Boolean);
if (
  allItems.length &&
  allItems.every((r) => r && typeof r === 'object' && (r.headline != null || r.id != null))
) {
  rows = allItems;
} else if (Array.isArray(item)) {
  rows = item;
} else if (Array.isArray(item.news)) {
  rows = item.news;
} else if (Array.isArray(item.data)) {
  rows = item.data;
}

const payload = item && !Array.isArray(item) ? item : {};
const statusCode = Number(payload.statusCode || 0);
const errMsg =
  (typeof payload.error === 'string' && payload.error) ||
  (payload.error && payload.error.message) ||
  (statusCode >= 400 ? payload.message : null) ||
  null;
const hardFail = Boolean(errMsg) || (statusCode >= 400 && !rows.length);
if (hardFail && !rows.length) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'company_ir',
        ok: false,
        skipped: false,
        error: 'company_news_fetch_failed',
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const documents = [];
const seen = new Set();

for (const row of rows.slice(0, Math.max(1, limit))) {
  if (!row || typeof row !== 'object') continue;
  const headline = safeText(row.headline);
  const newsId = row.id != null ? String(row.id) : null;
  if (!headline && !newsId) continue;

  const stable =
    'finnhub-news-' + (newsId || sha256Hex(headline + '|' + (row.datetime || '')).slice(0, 16));
  if (seen.has(stable)) continue;
  seen.add(stable);

  const pubDate = toSqlDateFromUnix(row.datetime);
  const summary = truncate(row.summary || '', 400);
  const source = safeText(row.source || 'Finnhub');
  const url = String(row.url || '').trim();

  const body = {
    kind: 'finnhub_company_news',
    id: newsId,
    headline,
    datetime: row.datetime || null,
    source,
    related: row.related || ticker,
  };
  const meta = {
    collector: 'company_ir',
    mode: 'finnhub_company_news',
    news_id: newsId,
    headline,
    datetime: row.datetime || null,
    publication_date: pubDate,
    source,
    related: row.related || ticker,
    url,
    summary,
    category: row.category || null,
  };
  const chunkText = safeText(
    'Company news ' +
      (pubDate || 'undated') +
      ' ' +
      source +
      ': ' +
      headline +
      (summary ? ' — ' + summary : ''),
  );

  documents.push({
    source_type: 'finnhub_company_news',
    publisher: source || 'Finnhub',
    stable_source_id: stable,
    canonical_url: url || 'https://finnhub.io/api/v1/company-news',
    title: truncate(headline || stable, 200),
    publication_date: pubDate,
    content_sha256: sha256Hex(JSON.stringify(body)),
    metadata_b64: toBase64(meta),
    chunk_text: chunkText,
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'company_ir',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      from_date: prepareRow.from_date || null,
      to_date: prepareRow.to_date || null,
    },
  },
];
