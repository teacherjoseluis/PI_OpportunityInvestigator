// Canonical source for PII-03 "Expand Evidence Documents" Code node.
// Turns a normalize node's documents[] into one item per upsert row.

function toSqlDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw + '-01';
  if (/^\d{4}$/.test(raw)) return raw + '-01-01';
  return '';
}

const item = $input.first().json || {};
const docs = Array.isArray(item.documents) ? item.documents : [];
const caseId = item.case_id;
const companyId = item.company_id || '';

if (!docs.length) {
  return [
    {
      json: {
        case_id: caseId,
        company_id: companyId,
        skip_upsert: true,
        collector: item.collector || null,
        parent_ok: item.ok === true,
        parent_error: item.error || null,
        parent_document_count: 0,
      },
    },
  ];
}

return docs.map((doc) => ({
  json: {
    case_id: caseId,
    company_id: companyId || '',
    skip_upsert: false,
    collector: item.collector || null,
    source_type: doc.source_type,
    publisher: String(doc.publisher || '').replaceAll(',', ' '),
    stable_source_id: String(doc.stable_source_id || '').replaceAll(',', ' '),
    canonical_url: String(doc.canonical_url || '').replaceAll(',', '%2C'),
    title_safe: String(doc.title || doc.title_safe || '').replaceAll(',', ' '),
    publication_date: toSqlDate(doc.publication_date),
    content_sha256: doc.content_sha256,
    metadata_b64: doc.metadata_b64,
    chunk_text: doc.chunk_text || '',
    parent_ok: item.ok === true,
    parent_document_count: docs.length,
  },
}));
