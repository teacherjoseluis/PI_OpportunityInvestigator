// Canonical source for PII-03 "Normalize SEC Evidence" Code node.
// Builds evidence_documents payloads from SEC company submissions JSON.

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
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64');
}

function safeText(value) {
  return String(value == null ? '' : value)
    .replaceAll(',', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function padCik(cik) {
  const digits = String(cik == null ? '' : cik).replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

function accessionToUrl(cik, accession) {
  const cikNum = String(cik).replace(/^0+/, '') || '0';
  const accNoDash = String(accession || '').replace(/-/g, '');
  if (!accNoDash) return null;
  return (
    'https://www.sec.gov/Archives/edgar/data/' +
    cikNum +
    '/' +
    accNoDash +
    '/' +
    accession +
    '.txt'
  );
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};

const gates = configRow.gates_json || {};
const collection =
  (gates && gates.collection) || item.collection || item.collection_config || {};
const filingLimit = Number(collection.sec_recent_filings_limit ?? 10);

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const cik = padCik(caseRow.cik || validated.cik || item.cik);
const legalName = caseRow.legal_name || item.legal_name || null;

const payload = item.submissions || item;
const hasError = Boolean(payload.error || payload.code || payload.statusCode >= 400);
const hasFilings = payload.filings && payload.filings.recent;

if (!cik || hasError || !hasFilings) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        cik,
        legal_name: legalName,
        collector: 'sec_edgar',
        ok: false,
        error: hasError ? 'sec_fetch_failed' : !cik ? 'cik_missing' : 'sec_submissions_invalid',
        documents: [],
        document_count: 0,
      },
    },
  ];
}

const recent = payload.filings.recent;
const forms = recent.form || [];
const accessions = recent.accessionNumber || [];
const filingDates = recent.filingDate || [];
const primaryDocs = recent.primaryDocument || [];
const count = Math.min(filingLimit, forms.length, accessions.length);

const documents = [];

const summaryMeta = {
  cik,
  name: payload.name || legalName,
  tickers: payload.tickers || [],
  exchanges: payload.exchanges || [],
  sic: payload.sic || null,
  sicDescription: payload.sicDescription || null,
  recent_filing_count: forms.length,
  collected_filing_count: count,
};
const summaryBody = JSON.stringify({
  kind: 'sec_edgar_submissions',
  cik,
  name: summaryMeta.name,
  recent_filing_count: forms.length,
});
documents.push({
  source_type: 'sec_edgar_submissions',
  publisher: 'SEC',
  stable_source_id: 'submissions:' + cik,
  canonical_url: 'https://data.sec.gov/submissions/CIK' + cik + '.json',
  title: safeText('SEC submissions ' + (summaryMeta.name || cik)),
  publication_date: '',
  content_sha256: sha256Hex(summaryBody),
  metadata_b64: toBase64(summaryMeta),
  chunk_text: safeText(
    'SEC submissions for ' +
      (summaryMeta.name || cik) +
      '. Recent filings indexed: ' +
      forms.length +
      '.',
  ),
});

for (let i = 0; i < count; i += 1) {
  const form = forms[i];
  const accession = accessions[i];
  const filingDate = filingDates[i] || '';
  const primaryDocument = primaryDocs[i] || '';
  const url = accessionToUrl(cik, accession);
  const meta = {
    cik,
    form,
    accessionNumber: accession,
    filingDate,
    primaryDocument,
  };
  const body = JSON.stringify({
    kind: 'sec_edgar_filing',
    cik,
    accession,
    form,
    filingDate,
  });
  documents.push({
    source_type: 'sec_edgar_filing',
    publisher: 'SEC',
    stable_source_id: accession,
    canonical_url: url || 'https://www.sec.gov/',
    title: safeText(form + ' ' + accession),
    publication_date: filingDate,
    content_sha256: sha256Hex(body),
    metadata_b64: toBase64(meta),
    chunk_text: safeText('SEC ' + form + ' filed ' + filingDate + ' accession ' + accession),
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      cik,
      legal_name: legalName,
      collector: 'sec_edgar',
      ok: true,
      error: null,
      documents,
      document_count: documents.length,
    },
  },
];
