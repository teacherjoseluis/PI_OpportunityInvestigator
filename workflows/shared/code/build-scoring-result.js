// Canonical source for PII-10 "Build Scoring Result" Code node.

const item = $input.first().json || {};

let gates_failed = item.gates_failed;
if (typeof gates_failed === 'string') {
  try {
    gates_failed = JSON.parse(gates_failed);
  } catch {
    gates_failed = [];
  }
}
if (!Array.isArray(gates_failed)) gates_failed = [];

const scores = item.scores && typeof item.scores === 'object' ? item.scores : {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      outcome_class: item.outcome_class || null,
      hard_stop: item.hard_stop === true || item.hard_stop === 'true',
      score_id: item.score_id || null,
      scores,
      gates_failed,
      claim_count: Number(item.claim_count || counts.claim_count || 0),
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
