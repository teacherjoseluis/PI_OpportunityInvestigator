// Slim payload after clearing monitoring rules — scalars only for bulk insert.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const restored = nodeJson('Restore Report Payload') || nodeJson('Build Research Report') || {};

return [
  {
    json: {
      case_id: restored.case_id,
      company_id: restored.company_id || null,
      ticker: restored.ticker,
      exchange: restored.exchange,
      legal_name: restored.legal_name || null,
      n8n_execution_id: restored.n8n_execution_id,
      outcome: restored.outcome,
      next_state: restored.next_state,
      reason: restored.reason,
      outcome_class: restored.outcome_class,
      schema_valid: restored.schema_valid,
      publication_ready: restored.publication_ready,
      report_id: restored.report_id || null,
      report_version: restored.report_version,
      as_of: restored.as_of,
      claim_count: restored.claim_count || 0,
      counts: restored.counts || {},
      metadata_b64: restored.metadata_b64 || '',
      monitoring_rules_json_b64: restored.monitoring_rules_json_b64 || '',
      seed_monitoring_rules: restored.seed_monitoring_rules === true,
    },
  },
];
