// Canonical source for PII-03 "Normalize CT.gov Evidence" Code node.

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

/** Coerce CT.gov partial dates (YYYY-MM / YYYY) to a Postgres-safe date, else ''. */
function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw + '-01';
  if (/^\d{4}$/.test(raw)) return raw + '-01-01';
  return '';
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const secNorm = nodeJson('Normalize SEC Evidence') || {};

const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || secNorm.company_id || null;
const legalName = caseRow.legal_name || secNorm.legal_name || item.legal_name || null;

const payload = item.studies != null ? item : item.ctgov || item;
const hasError = Boolean(payload.error || payload.code || payload.statusCode >= 400);
const studies = Array.isArray(payload.studies) ? payload.studies : [];

if (hasError) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        legal_name: legalName,
        collector: 'clinicaltrials_gov',
        ok: false,
        error: 'ctgov_fetch_failed',
        documents: [],
        document_count: 0,
        sec_document_count: Number(secNorm.document_count || 0),
        sec_ok: secNorm.ok === true,
      },
    },
  ];
}

const documents = [];

for (const study of studies) {
  const proto = study.protocolSection || {};
  const ident = proto.identificationModule || {};
  const status = proto.statusModule || {};
  const sponsor = proto.sponsorCollaboratorsModule || {};
  const design = proto.designModule || {};
  const nctId = ident.nctId;
  if (!nctId) continue;

  const briefTitle = ident.briefTitle || ident.officialTitle || nctId;
  const overallStatus = status.overallStatus || null;
  const leadSponsor = (sponsor.leadSponsor && sponsor.leadSponsor.name) || null;
  const phases = (design.phases || []).join('|');
  const startDate =
    (status.startDateStruct && status.startDateStruct.date) ||
    (status.studyFirstSubmitDate) ||
    '';

  const meta = {
    nctId,
    briefTitle,
    overallStatus,
    leadSponsor,
    phases: design.phases || [],
    startDate,
  };
  const body = JSON.stringify({
    kind: 'clinicaltrials_gov',
    nctId,
    overallStatus,
    briefTitle,
  });

  documents.push({
    source_type: 'clinicaltrials_gov',
    publisher: 'ClinicalTrials.gov',
    stable_source_id: nctId,
    canonical_url: 'https://clinicaltrials.gov/study/' + nctId,
    title: safeText(briefTitle),
    publication_date: toSqlDate(startDate),
    content_sha256: sha256Hex(body),
    metadata_b64: toBase64(meta),
    chunk_text: safeText(
      nctId + ' ' + briefTitle + ' status ' + (overallStatus || 'UNKNOWN') + ' phase ' + (phases || 'NA'),
    ),
  });
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      collector: 'clinicaltrials_gov',
      ok: true,
      error: null,
      documents,
      document_count: documents.length,
      sec_document_count: Number(secNorm.document_count || 0),
      sec_ok: secNorm.ok === true,
    },
  },
];
