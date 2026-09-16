// Count Finnhub company-news upsert results for PII-03 coverage.

let items = [];
try {
  items = $('Upsert Company News Evidence')
    .all()
    .filter((row) => row.json && row.json.evidence_id);
} catch {
  items = $input.all().filter((row) => row.json && row.json.evidence_id);
}
let caseId = null;
let companyId = null;

try {
  const news = $('Normalize Company News Evidence').first().json;
  caseId = news.case_id;
  companyId = news.company_id;
} catch {
  caseId = items[0] && items[0].json.case_id;
  companyId = items[0] && items[0].json.company_id;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      news_stored_count: items.length,
      news_ok: true,
    },
  },
];
