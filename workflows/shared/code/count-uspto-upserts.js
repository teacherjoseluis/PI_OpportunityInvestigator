// Count USPTO patent upsert results for PII-03 coverage.

const items = $input.all().filter((row) => row.json && row.json.evidence_id);
let caseId = null;
let companyId = null;

try {
  const patents = $('Normalize USPTO Patents Evidence').first().json;
  caseId = patents.case_id;
  companyId = patents.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      patents_stored_count: items.length,
      patents_ok: true,
    },
  },
];
