// Canonical source for PII-03 "Prepare OpenFDA Query" Code node.
// Builds Drugs@FDA search URL from legal_name when fda_openfda is enabled.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function searchTokenFromLegalName(legalName) {
  const stop = new Set([
    'INC',
    'INCORPORATED',
    'CORP',
    'CORPORATION',
    'LTD',
    'LIMITED',
    'LLC',
    'CO',
    'COMPANY',
    'PLC',
    'LP',
    'LLP',
    'THE',
    'AND',
    'OF',
    'PHARMACEUTICALS',
    'PHARMACEUTICAL',
    'PHARMA',
    'BIOTECH',
    'BIOTECHNOLOGY',
    'THERAPEUTICS',
    'BIOSCIENCES',
    'SCIENCES',
    'LABORATORIES',
    'LABS',
    'HOLDINGS',
    'GROUP',
    'USA',
    'US',
  ]);
  const tokens = String(legalName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
  return tokens[0] || null;
}

const validated = nodeJson('Validate Collection Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Collection Config') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || {};
const collectors = collection.collectors || {};
const fdaCfg = collectors.fda_openfda || {};
const enabled = fdaCfg.enabled === true;
const limit = Number(collection.openfda_limit ?? fdaCfg.limit ?? 25);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || null;
const ticker = validated.ticker || caseRow.ticker || null;
const searchToken = searchTokenFromLegalName(legalName);

let openfda_url = '';
let skip_fetch = true;
let skip_reason = null;

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!searchToken) {
  skip_reason = 'search_token_missing';
} else {
  skip_fetch = false;
  const quoted = encodeURIComponent('"' + searchToken + '"');
  const search =
    'openfda.manufacturer_name:' +
    quoted +
    '+OR+sponsor_name:' +
    quoted;
  openfda_url =
    'https://api.fda.gov/drug/drugsfda.json?search=' +
    search +
    '&limit=' +
    Math.max(1, Math.min(100, limit));
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'fda_openfda',
      enabled,
      skip_fetch,
      skip_reason,
      search_token: searchToken,
      openfda_limit: limit,
      openfda_url,
    },
  },
];
