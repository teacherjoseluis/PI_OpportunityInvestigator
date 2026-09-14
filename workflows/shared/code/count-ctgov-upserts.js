// Count CT.gov upsert results for PII-03.

const items = $input.all().filter((row) => row.json && row.json.evidence_id);
let caseId = null;
let companyId = null;
let secStored = 0;
try {
  const ct = $('Normalize CT.gov Evidence').first().json;
  caseId = ct.case_id;
  companyId = ct.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
}
try {
  secStored = Number($('Count SEC Upserts').first().json.sec_stored_count || 0);
} catch {
  try {
    secStored = Number($('Prepare SEC Zero Count').first().json.sec_stored_count || 0);
  } catch {
    secStored = 0;
  }
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      sec_stored_count: secStored,
      ct_stored_count: items.length,
      ct_ok: true,
    },
  },
];
