// Prepare zero CourtListener count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare CourtListener Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const docs = $('Normalize CourtListener Evidence').first().json;
  caseId = caseId || docs.case_id;
  companyId = companyId || docs.company_id;
  skipped = skipped || docs.skipped === true;
  ok = docs.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const patents = $('Count USPTO Upserts').first().json;
    caseId = patents.case_id;
    companyId = patents.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare USPTO Zero Count').first().json;
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
      courtlistener_stored_count: 0,
      courtlistener_ok: ok,
      courtlistener_skipped: skipped,
    },
  },
];
