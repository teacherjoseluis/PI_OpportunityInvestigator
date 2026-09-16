// Count OpenFDA / Drugs@FDA upsert results for PII-03 coverage.

let items = [];
try {
  items = $('Upsert FDA Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;

try {
  const fda = $('Normalize OpenFDA Evidence').first().json;
  caseId = fda.case_id;
  companyId = fda.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      fda_stored_count: items.length,
      fda_ok: true,
    },
  },
];
