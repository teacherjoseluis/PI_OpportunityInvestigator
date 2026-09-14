// Slim payload right after research_reports insert — drop report base64 bodies.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const built = nodeJson('Build Research Report') || {};
const inserted = nodeJson('Insert Research Report') || {};

return [
  {
    json: {
      case_id: built.case_id,
      company_id: built.company_id || null,
      ticker: built.ticker,
      exchange: built.exchange,
      legal_name: built.legal_name || null,
      n8n_execution_id: built.n8n_execution_id,
      outcome: built.outcome,
      next_state: built.next_state,
      reason: built.reason,
      outcome_class: built.outcome_class,
      schema_valid: built.schema_valid,
      publication_ready: built.publication_ready,
      report_id: inserted.report_id || null,
      report_version: inserted.version_number || built.report_version,
      as_of: built.as_of,
      claim_count: built.claim_count || 0,
      counts: built.counts || {},
      metadata_b64: built.metadata_b64 || '',
      monitoring_rules_json_b64: built.monitoring_rules_json_b64 || '',
      seed_monitoring_rules: built.seed_monitoring_rules === true,
    },
  },
];
