// Canonical source for PII-03 "Evaluate Collection Coverage" Code node.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function countItems(name) {
  try {
    return $(name).all().filter((row) => row.json && row.json.skip_upsert !== true).length;
  } catch {
    return 0;
  }
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const secNorm = nodeJson('Normalize SEC Evidence') || item.sec || {};
const ctNorm = nodeJson('Normalize CT.gov Evidence') || item.ctgov || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || item.collection || {};
const minSec = Number(collection.min_sec_documents ?? 1);
const partialNeedsHuman = collection.partial_requires_human_review === true;

const secAttempted = countItems('Expand SEC Documents') || Number(secNorm.document_count || 0);
const ctAttempted = countItems('Expand CT.gov Documents') || Number(ctNorm.document_count || 0);

// Prefer upserted evidence_id counts when available from prior aggregate nodes.
const secStored = Number(
  item.sec_stored_count ?? nodeJson('Count SEC Upserts')?.sec_stored_count ?? secAttempted,
);
const ctStored = Number(
  item.ct_stored_count ?? nodeJson('Count CT.gov Upserts')?.ct_stored_count ?? ctAttempted,
);

const secOk = secNorm.ok === true && secStored >= minSec;
const ctOk = ctNorm.ok === true; // zero studies can still be a successful empty search
const secFailed = secNorm.ok === false;
const ctFailed = ctNorm.ok === false;

const totalStored = secStored + (ctFailed ? 0 : ctStored);
const collector_status = [
  {
    key: 'sec_edgar',
    ok: secNorm.ok === true,
    error: secNorm.error || null,
    document_count: secStored,
  },
  {
    key: 'clinicaltrials_gov',
    ok: ctNorm.ok === true,
    error: ctNorm.error || null,
    document_count: ctFailed ? 0 : ctStored,
  },
];

let outcome;
let next_state;
let reason;

if (secOk && !ctFailed) {
  outcome = ctStored > 0 || ctOk ? 'COLLECTED' : 'COLLECTED';
  next_state = 'ANALYZING';
  reason = 'minimum_coverage_met';
} else if (totalStored > 0 || secOk) {
  outcome = 'PARTIAL';
  next_state = partialNeedsHuman ? 'AWAITING_HUMAN_REVIEW' : 'ANALYZING';
  reason = secFailed
    ? 'sec_failed_partial'
    : ctFailed
      ? 'ctgov_failed_partial'
      : 'partial_coverage';
} else {
  outcome = 'FAILED';
  next_state = 'INCOMPLETE';
  reason = 'no_evidence_collected';
}

const summary = {
  sec_stored_count: secStored,
  ct_stored_count: ctFailed ? 0 : ctStored,
  total_stored_count: totalStored,
  min_sec_documents: minSec,
};

const summaryJson = JSON.stringify({
  outcome,
  next_state,
  reason,
  collector_status,
  counts: summary,
});
const metadata_b64 = Buffer.from(summaryJson, 'utf8').toString('base64');

return [
  {
    json: {
      case_id: validated.case_id || item.case_id,
      company_id: secNorm.company_id || ctNorm.company_id || validated.company_id || null,
      ticker: validated.ticker || item.ticker,
      exchange: validated.exchange || item.exchange,
      cik: secNorm.cik || validated.cik || null,
      legal_name: secNorm.legal_name || ctNorm.legal_name || null,
      outcome,
      next_state,
      reason,
      collector_status,
      counts: summary,
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || item.n8n_execution_id || null,
    },
  },
];
