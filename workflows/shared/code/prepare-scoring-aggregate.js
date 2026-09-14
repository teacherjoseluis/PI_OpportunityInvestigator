// Prepare aggregate after score upsert (+ optional components).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Scoring Quality') || $input.first().json || {};
let scoreId = null;
try {
  scoreId = $('Upsert Scores').first().json.score_id || null;
} catch {
  scoreId = evaluated.score_id || null;
}

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name,
      configuration_version_id: evaluated.configuration_version_id,
      outcome: evaluated.outcome || 'FAILED',
      next_state: evaluated.next_state || 'INCOMPLETE',
      reason: evaluated.reason || null,
      outcome_class: evaluated.outcome_class || null,
      hard_stop: evaluated.hard_stop === true,
      score_id: scoreId,
      scores: evaluated.scores || {},
      components: evaluated.components || [],
      gate_results: evaluated.gate_results || [],
      gates_failed: evaluated.gates_failed || [],
      claim_count: Number(evaluated.claim_count || 0),
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
      n8n_execution_id: evaluated.n8n_execution_id || null,
    },
  },
];
