// Canonical source for PII-03 "Prepare USPTO Query" Code node.
// Builds ODP Patent File Wrapper assignee/applicant search when uspto_patents is enabled (Slice E6).

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
const usptoCfg = collectors.uspto_patents || {};
const enabled = usptoCfg.enabled === true;
const limit = Number(collection.uspto_patents_limit ?? usptoCfg.limit ?? 25);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = caseRow.legal_name || null;
const ticker = String(validated.ticker || caseRow.ticker || '')
  .trim()
  .toUpperCase();
const searchToken = searchTokenFromLegalName(legalName);

let skip_fetch = true;
let skip_reason = null;
let query = '';

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!searchToken) {
  skip_reason = 'search_token_missing';
} else {
  skip_fetch = false;
  const quoted = '"' + searchToken + '"';
  query =
    '(assignmentBag.assigneeBag.assigneeNameText:' +
    quoted +
    ' OR applicationMetaData.applicantBag.applicantNameText:' +
    quoted +
    ')';
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'uspto_patents',
      enabled,
      skip_fetch,
      skip_reason,
      search_token: searchToken,
      uspto_patents_limit: limit,
      query,
    },
  },
];
