// Prepare zero OpenFDA count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare OpenFDA Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const fda = $('Normalize OpenFDA Evidence').first().json;
  caseId = caseId || fda.case_id;
  companyId = companyId || fda.company_id;
  skipped = skipped || fda.skipped === true;
  ok = fda.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const ct = $('Count CT.gov Upserts').first().json;
    caseId = ct.case_id;
    companyId = ct.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare CT.gov Zero Count').first().json;
      caseId = zero.case_id;
      companyId = zero.company_id;
    }
  } catch {
    // continue
  }
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      fda_stored_count: 0,
      fda_ok: ok,
      fda_skipped: skipped,
    },
  },
];
