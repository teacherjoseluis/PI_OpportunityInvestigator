// Canonical source for PII-03 "Prepare Company News Query" Code node.
// Builds Finnhub /company-news date window when company_ir is enabled (Slice E5).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const validated = nodeJson('Validate Collection Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Collection Config') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || {};
const collectors = collection.collectors || {};
const irCfg = collectors.company_ir || {};
const enabled = irCfg.enabled === true;
const lookbackDays = Number(
  collection.company_news_lookback_days ?? irCfg.lookback_days ?? 90,
);
const limit = Number(collection.company_news_limit ?? irCfg.limit ?? 25);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || null;
const ticker = String(validated.ticker || caseRow.ticker || '')
  .trim()
  .toUpperCase();

const to = new Date();
const from = new Date(to.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);
const fromDate = isoDate(from);
const toDate = isoDate(to);

let skip_fetch = true;
let skip_reason = null;

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!ticker) {
  skip_reason = 'ticker_missing';
} else {
  skip_fetch = false;
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'company_ir',
      enabled,
      skip_fetch,
      skip_reason,
      lookback_days: lookbackDays,
      company_news_limit: limit,
      from_date: fromDate,
      to_date: toDate,
    },
  },
];
