// Prepare zero CT.gov count while preserving SEC stored count.

let secStored = 0;
let caseId = null;
let companyId = null;

try {
  const sec = $('Count SEC Upserts').first().json;
  secStored = Number(sec.sec_stored_count || 0);
  caseId = sec.case_id;
  companyId = sec.company_id;
} catch {
  // continue
}

try {
  if (!caseId) {
    const zero = $('Prepare SEC Zero Count').first().json;
    secStored = Number(zero.sec_stored_count || 0);
    caseId = zero.case_id;
    companyId = zero.company_id;
  }
} catch {
  // continue
}

try {
  const ct = $('Normalize CT.gov Evidence').first().json;
  caseId = caseId || ct.case_id;
  companyId = companyId || ct.company_id;
} catch {
  // continue
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      sec_stored_count: secStored,
      ct_stored_count: 0,
      ct_ok: true,
    },
  },
];
