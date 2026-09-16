// Count SEC upsert results for PII-03.

let items = [];
try {
  items = $('Upsert SEC Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;
try {
  const sec = $('Normalize SEC Evidence').first().json;
  caseId = sec.case_id;
  companyId = sec.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      sec_stored_count: items.length,
      sec_ok: items.length > 0,
    },
  },
];
