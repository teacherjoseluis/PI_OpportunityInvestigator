// Canonical source for PII-03 "Normalize OpenFDA Evidence" Code node.
// Compact Drugs@FDA application facts (Slice E4) — no label/PDF blob archive.

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

/** Coerce YYYYMMDD / ISO / partial dates to Postgres-safe YYYY-MM-DD. */
function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d{8}$/.test(raw)) {
    return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw + '-01';
  if (/^\d{4}$/.test(raw)) return raw + '-01-01';
  return '';
}

/**
 * Derive a compact openFDA search token from a legal name.
 * Exported for unit tests via the Code-node script body.
 */
function searchTokenFromLegalName(legalName) {
  const stop = new Set([
    'INC',
    'INCORPORATED',
    'CORP',
    'CORPORATION',
    'LTD',
    'LIMITED',
    'LLC',
    'CO',
    'COMPANY',
    'PLC',
    'LP',
    'LLP',
    'THE',
    'AND',
    'OF',
    'PHARMACEUTICALS',
    'PHARMACEUTICAL',
    'PHARMA',
    'BIOTECH',
    'BIOTECHNOLOGY',
    'THERAPEUTICS',
    'BIOSCIENCES',
    'SCIENCES',
    'LABORATORIES',
    'LABS',
    'HOLDINGS',
    'GROUP',
    'USA',
    'US',
  ]);
  const tokens = String(legalName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
  return tokens[0] || null;
}

function compactApplication(row) {
  const products = Array.isArray(row.products) ? row.products : [];
  const submissions = Array.isArray(row.submissions) ? row.submissions : [];

  const brandNames = [
    ...new Set(
      products
        .map((p) => safeText(p && p.brand_name))
        .filter(Boolean),
    ),
  ];
  const marketingStatuses = [
    ...new Set(
      products
        .map((p) => safeText(p && p.marketing_status))
        .filter(Boolean),
    ),
  ];
  const dosageForms = [
    ...new Set(
      products
        .map((p) => safeText(p && p.dosage_form))
        .filter(Boolean),
    ),
  ];
  const routes = [
    ...new Set(products.map((p) => safeText(p && p.route)).filter(Boolean)),
  ];

  const origApproved = submissions
    .filter(
      (s) =>
        String(s.submission_type || '').toUpperCase() === 'ORIG' &&
        String(s.submission_status || '').toUpperCase() === 'AP',
    )
    .map((s) => ({
      submission_status_date: toSqlDate(s.submission_status_date),
      review_priority: s.review_priority || null,
      submission_class_code: s.submission_class_code || null,
      submission_class_code_description: s.submission_class_code_description || null,
    }))
    .filter((s) => s.submission_status_date)
    .sort((a, b) => (a.submission_status_date < b.submission_status_date ? -1 : 1));

  const latestSubmissionDate = submissions
    .map((s) => toSqlDate(s.submission_status_date))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  const origin = origApproved[0] || null;

  return {
    application_number: safeText(row.application_number),
    sponsor_name: safeText(row.sponsor_name),
    brand_names: brandNames,
    marketing_statuses: marketingStatuses,
    dosage_forms: dosageForms,
    routes,
    product_count: products.length,
    submission_count: submissions.length,
    original_approval_date: origin ? origin.submission_status_date : null,
    original_review_priority: origin ? origin.review_priority : null,
    original_submission_class: origin ? origin.submission_class_code_description || origin.submission_class_code : null,
    latest_submission_date: latestSubmissionDate,
  };
}

// --- Code node entry (n8n) ---
const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const prepareRow = nodeJson('Prepare OpenFDA Query') || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const collectors = collection.collectors || {};
const fdaCfg = collectors.fda_openfda || {};
const enabled = fdaCfg.enabled === true;

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || prepareRow.legal_name || item.legal_name || null;
const ticker = validated.ticker || caseRow.ticker || item.ticker;
const searchToken =
  prepareRow.search_token || searchTokenFromLegalName(legalName) || null;
const limit = Number(
  prepareRow.openfda_limit ?? collection.openfda_limit ?? fdaCfg.limit ?? 25,
);

if (!enabled) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'fda_openfda',
        ok: true,
        skipped: true,
        error: null,
        documents: [],
        document_count: 0,
        search_token: searchToken,
      },
    },
  ];
}

const payload = item.results != null || item.error != null || item.meta != null ? item : item.openfda || item;
const errorCode =
  (payload.error && (payload.error.code || payload.error.message)) ||
  payload.code ||
  null;
const statusCode = Number(payload.statusCode || 0);
const isNotFound =
  String(errorCode || '').toUpperCase().includes('NOT_FOUND') ||
  String((payload.error && payload.error.message) || '')
    .toLowerCase()
    .includes('no matches');
const hardFail =
  !isNotFound &&
  Boolean(payload.error || (statusCode >= 400 && statusCode !== 404));

if (hardFail) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        ticker,
        collector: 'fda_openfda',
        ok: false,
        skipped: false,
        error: 'openfda_fetch_failed',
        documents: [],
        document_count: 0,
        search_token: searchToken,
      },
    },
  ];
}

const results = Array.isArray(payload.results) ? payload.results : [];
const documents = [];

for (const row of results.slice(0, Math.max(1, limit))) {
  const compact = compactApplication(row);
  if (!compact.application_number) continue;

  const body = {
    kind: 'fda_drugsfda',
    application_number: compact.application_number,
    sponsor_name: compact.sponsor_name,
    brand_names: compact.brand_names,
    original_approval_date: compact.original_approval_date,
    product_count: compact.product_count,
    submission_count: compact.submission_count,
  };
  const meta = {
    collector: 'fda_openfda',
    mode: 'drugsfda_compact',
    search_token: searchToken,
    ...compact,
  };
  const brandsLabel = compact.brand_names.length
    ? compact.brand_names.join('/')
    : compact.application_number;
  const chunkText = safeText(
    'FDA Drugs@FDA ' +
      compact.application_number +
      ' ' +
      brandsLabel +
      ' sponsor ' +
      (compact.sponsor_name || 'UNKNOWN') +
      (compact.original_approval_date
        ? ' ORIG-AP ' + compact.original_approval_date
        : '') +
      ' products ' +
      compact.product_count +
      ' submissions ' +
      compact.submission_count,
  );

  documents.push({
    source_type: 'fda_drugsfda',
    publisher: 'openFDA',
    stable_source_id: 'fda-drugsfda-' + compact.application_number,
    canonical_url:
      'https://api.fda.gov/drug/drugsfda.json?search=application_number:%22' +
      encodeURIComponent(compact.application_number) +
      '%22',
    title: safeText('Drugs@FDA ' + brandsLabel + ' (' + compact.application_number + ')'),
    publication_date:
      compact.original_approval_date || compact.latest_submission_date || '',
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
      collector: 'fda_openfda',
      ok: true,
      skipped: false,
      error: null,
      documents,
      document_count: documents.length,
      search_token: searchToken,
      openfda_total:
        (payload.meta && payload.meta.results && payload.meta.results.total) ||
        documents.length,
    },
  },
];
