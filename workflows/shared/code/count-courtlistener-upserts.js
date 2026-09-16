// Count CourtListener upsert results for PII-03 coverage.

let items = [];
try {
  items = $('Upsert CourtListener Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;

try {
  const docs = $('Normalize CourtListener Evidence').first().json;
  caseId = docs.case_id;
  companyId = docs.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      courtlistener_stored_count: items.length,
      courtlistener_ok: true,
    },
  },
];
