// Slim payload after detected_events insert — drop events array from stream.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Monitoring Signals') || {};

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id || null,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name || null,
      n8n_execution_id: evaluated.n8n_execution_id,
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      next_state: evaluated.next_state,
      outcome_class: evaluated.outcome_class || null,
      as_of_baseline: evaluated.as_of_baseline,
      report_version: evaluated.report_version,
      event_count: evaluated.event_count || 0,
      material_event_count: evaluated.material_event_count || 0,
      matched_rule_types: evaluated.matched_rule_types || [],
      change_memo: evaluated.change_memo || null,
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
    },
  },
];
