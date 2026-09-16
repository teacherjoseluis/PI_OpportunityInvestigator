// Canonical source for PII-03 "Prepare CourtListener Query" Code node.
// Builds CourtListener search v4 party query when courtlistener is enabled (Slice E8).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const validated = nodeJson('Validate Collection Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Collection Config') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || {};
const collectors = collection.collectors || {};
const clCfg = collectors.courtlistener || {};
const enabled = clCfg.enabled === true;
const limit = Number(collection.courtlistener_limit ?? clCfg.limit ?? 10);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const legalName = String(caseRow.legal_name || '').trim();
const ticker = String(validated.ticker || caseRow.ticker || '')
  .trim()
  .toUpperCase();

const partyName = legalName.replace(/"/g, '').trim();

let skip_fetch = true;
let skip_reason = null;
let query = '';

if (!enabled) {
  skip_reason = 'collector_disabled';
} else if (!partyName) {
  skip_reason = 'legal_name_missing';
} else {
  skip_fetch = false;
  query = 'party:"' + partyName + '"';
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      legal_name: legalName,
      ticker,
      collector: 'courtlistener',
      enabled,
      skip_fetch,
      skip_reason,
      courtlistener_limit: Math.max(1, Math.min(25, limit)),
      query,
    },
  },
];
