// Canonical source for PII-03 "Normalize CourtListener Evidence" Code node.
// Compact CourtListener search hits (Slice E8) — no opinion/PDF bodies.

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

function toSqlDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';
  if (/^\d{4}$/.test(s)) return s + '-01-01';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function truncate(text, max) {
  const s = safeText(text);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function firstName(bag, keys) {
  if (!bag || typeof bag !== 'object') return null;
  for (const key of keys) {
    const v = bag[key];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return safeText(v);
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function pickRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload)) return payload;
  return [];
}

function canonicalUrl(row) {
  const absolute = firstName(row, ['absolute_url', 'absoluteUrl']);
  if (absolute) {
    return absolute.startsWith('http')
      ? absolute
      : 'https://www.courtlistener.com' + (absolute.startsWith('/') ? absolute : '/' + absolute);
  }
  const cluster = firstName(row, ['cluster_id', 'id']);
  if (cluster) return 'https://www.courtlistener.com/opinion/' + cluster + '/';
  return 'https://www.courtlistener.com/';
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare CourtListener Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const clCfg = collectors.courtlistener || {};
const enabled = clCfg.enabled === true;
const limit = Number(
  prepareRow.courtlistener_limit ?? collection.courtlistener_limit ?? clCfg.limit ?? 10,
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
        collector: 'courtlistener',
        ok: true,
        skipped: true,
        error: null,
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const payload = item && !Array.isArray(item) ? item : {};
const rows = pickRows(payload);
const statusCode = Number(payload.statusCode || 0);
const errMsg =
  (typeof payload.error === 'string' && payload.error) ||
  (payload.error && payload.error.message) ||
  (statusCode >= 400 ? payload.detail || payload.message : null) ||
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
        collector: 'courtlistener',
        ok: false,
        skipped: false,
        error: 'courtlistener_fetch_failed',
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
  const caseName =
    firstName(row, ['caseName', 'case_name', 'caseNameFull']) || legalName || ticker;
  const clusterId = firstName(row, ['cluster_id', 'id', 'docket_id']);
  const docket = firstName(row, ['docketNumber', 'docket_number']);
  if (!clusterId && !caseName) continue;

  const stable =
    'courtlistener-' +
    String(clusterId || sha256Hex(caseName + (docket || '')).slice(0, 16)).replace(
      /[^A-Za-z0-9-]/g,
      '',
    );
  if (seen.has(stable)) continue;
  seen.add(stable);

  const court = firstName(row, ['court', 'court_id', 'court_citation_string']);
  const filed = toSqlDate(firstName(row, ['dateFiled', 'date_filed', 'dateArgued']));
  const snippet = truncate(firstName(row, ['snippet', 'text', 'plain_text']) || '', 400);
  const url = canonicalUrl(row);
  const displayTitle = truncate(
    (docket ? docket + ' — ' : '') + (caseName || stable),
    200,
  );

  const body = {
    kind: 'courtlistener_search',
    cluster_id: clusterId,
    case_name: caseName,
    docket_number: docket,
    court,
    date_filed: filed || null,
  };
  const meta = {
    collector: 'courtlistener',
    mode: 'search_v4_compact',
    cluster_id: clusterId,
    case_name: caseName,
    docket_number: docket,
    court,
    date_filed: filed || null,
    snippet,
  };
  const chunkText = safeText(
    'CourtListener ' +
      (caseName || 'matter') +
      (docket ? ' docket ' + docket : '') +
      (court ? ' ' + court : '') +
      (filed ? ' filed ' + filed : '') +
      (snippet ? ': ' + snippet : ''),
  );

  documents.push({
    source_type: 'courtlistener_docket',
    publisher: 'CourtListener',
    stable_source_id: stable,
    canonical_url: url,
    title: displayTitle,
    publication_date: filed,
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
      collector: 'courtlistener',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      api_count: Number(payload.count || rows.length || 0),
    },
  },
];
