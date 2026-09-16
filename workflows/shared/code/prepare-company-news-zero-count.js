// Prepare zero company-news count when collector skipped or no matches.

let caseId = null;
let companyId = null;
let skipped = false;
let ok = true;

try {
  const prep = $('Prepare Company News Query').first().json;
  caseId = prep.case_id;
  companyId = prep.company_id;
  skipped = prep.skip_fetch === true || prep.enabled === false;
} catch {
  // continue
}

try {
  const news = $('Normalize Company News Evidence').first().json;
  caseId = caseId || news.case_id;
  companyId = companyId || news.company_id;
  skipped = skipped || news.skipped === true;
  ok = news.ok !== false;
} catch {
  // continue
}

try {
  if (!caseId) {
    const fda = $('Count FDA Upserts').first().json;
    caseId = fda.case_id;
    companyId = fda.company_id;
  }
} catch {
  try {
    if (!caseId) {
      const zero = $('Prepare FDA Zero Count').first().json;
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
      news_stored_count: 0,
      news_ok: ok,
      news_skipped: skipped,
    },
  },
];
