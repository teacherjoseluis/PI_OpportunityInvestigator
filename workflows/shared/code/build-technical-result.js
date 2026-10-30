// Shape the PII-16 subworkflow result. Same envelope as other analysts.
// The insert/log nodes return only a row id, so read the evaluation directly.

function evaluatedItem() {
  try {
    const row = $('Evaluate Technical Market').first();
    if (row && row.json && row.json.case_id) return row.json;
  } catch {
    // Validation failed before evaluation.
  }
  return $input.first().json || {};
}

const item = evaluatedItem();
let insufficient = item.insufficient_topics;
if (typeof insufficient === 'string') {
  try {
    insufficient = JSON.parse(insufficient);
  } catch {
    insufficient = [];
  }
}
if (!Array.isArray(insufficient)) insufficient = [];

return [
  {
    json: {
      case_id: item.case_id,
      ticker: item.ticker,
      exchange: item.exchange,
      agent_key: item.agent_key || 'PII-16',
      status: item.status || 'FAILED',
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      claim_count: Number(item.claim_count || 0),
      insufficient_topics: insufficient,
      entry_timing_context: item.entry_timing_context || null,
      technical_context_score: item.technical_context_score,
      fill_in_suggestions: item.fill_in_suggestions || [],
      error_summary: item.error_summary || null,
    },
  },
];
