// Prepare zero USPTO patents count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare USPTO Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const patents = $('Normalize USPTO Patents Evidence').first().json;
  caseId = caseId || patents.case_id;
  companyId = companyId || patents.company_id;
  skipped = skipped || patents.skipped === true;
  ok = patents.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const news = $('Count Company News Upserts').first().json;
    caseId = news.case_id;
    companyId = news.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare Company News Zero Count').first().json;
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
      patents_stored_count: 0,
      patents_ok: ok,
      patents_skipped: skipped,
    },
  },
];
