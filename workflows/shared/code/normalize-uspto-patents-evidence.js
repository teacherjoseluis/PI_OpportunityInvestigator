// Canonical source for PII-03 "Normalize USPTO Patents Evidence" Code node.
// Compact ODP Patent File Wrapper facts (Slice E6) — no PDF/HTML bodies.

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
  if (Array.isArray(payload.patentFileWrapperDataBag)) return payload.patentFileWrapperDataBag;
  if (Array.isArray(payload.patentFileWrapperDataBagBag)) {
    return payload.patentFileWrapperDataBagBag;
  }
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare USPTO Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const usptoCfg = collectors.uspto_patents || {};
const enabled = usptoCfg.enabled === true;
const limit = Number(
  prepareRow.uspto_patents_limit ?? collection.uspto_patents_limit ?? usptoCfg.limit ?? 25,
);

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || prepareRow.legal_name || item.legal_name || null;
const ticker = String(
  validated.ticker || caseRow.ticker || prepareRow.ticker || item.ticker || '',
)
  .trim()
  .toUpperCase();
const searchToken = prepareRow.search_token || null;

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'uspto_patents',
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
        collector: 'uspto_patents',
        ok: false,
        skipped: false,
        error: 'uspto_fetch_failed',
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
  const metaApp = row.applicationMetaData || row.application_meta_data || {};
  const appNumber = firstName(row, ['applicationNumberText', 'application_number_text']) ||
    firstName(metaApp, ['applicationNumberText', 'applicationNumber']);
  const patentNumber = firstName(metaApp, ['patentNumber', 'patentNumberText', 'patent_number']);
  const title = firstName(metaApp, ['inventionTitle', 'invention_title', 'title']) || '';
  if (!appNumber && !patentNumber && !title) continue;

  const stable =
    'uspto-app-' +
    (appNumber || patentNumber || sha256Hex(title).slice(0, 16)).replace(/[^A-Za-z0-9-]/g, '');
  if (seen.has(stable)) continue;
  seen.add(stable);

  const filingDate = toSqlDate(
    firstName(metaApp, ['filingDate', 'filing_date', 'applicationFilingDate']),
  );
  const grantDate = toSqlDate(firstName(metaApp, ['grantDate', 'grant_date', 'patentGrantDate']));
  const statusText = firstName(metaApp, [
    'applicationStatusDescriptionText',
    'applicationStatusDescription',
    'status',
  ]);
  const pubDate = grantDate || filingDate;
  const displayTitle = truncate(
    (patentNumber ? 'US' + patentNumber + ' — ' : '') + (title || appNumber || stable),
    200,
  );

  const body = {
    kind: 'uspto_patent_file_wrapper',
    application_number: appNumber,
    patent_number: patentNumber,
    invention_title: title,
    filing_date: filingDate || null,
    grant_date: grantDate || null,
  };
  const meta = {
    collector: 'uspto_patents',
    mode: 'patent_file_wrapper_compact',
    search_token: searchToken,
    application_number: appNumber,
    patent_number: patentNumber,
    invention_title: title,
    filing_date: filingDate || null,
    grant_date: grantDate || null,
    publication_date: pubDate || null,
    application_status: statusText,
  };
  const chunkText = safeText(
    'USPTO ' +
      (patentNumber ? 'patent ' + patentNumber : 'application ' + (appNumber || 'unknown')) +
      (pubDate ? ' ' + pubDate : '') +
      ': ' +
      (title || 'untitled') +
      (statusText ? ' [' + statusText + ']' : ''),
  );

  documents.push({
    source_type: 'uspto_patent',
    publisher: 'USPTO',
    stable_source_id: stable,
    canonical_url: appNumber
      ? 'https://data.uspto.gov/patent-file-wrapper/search?q=' + encodeURIComponent(appNumber)
      : 'https://data.uspto.gov/apis/patent-file-wrapper/search',
    title: displayTitle,
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
      collector: 'uspto_patents',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      search_token: searchToken,
      api_count: Number(payload.count || payload.total || rows.length || 0),
    },
  },
];
