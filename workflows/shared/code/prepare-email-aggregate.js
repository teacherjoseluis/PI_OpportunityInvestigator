// Slim payload after email send / delivery insert.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Email Delivery') || {};

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id || null,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name || null,
      n8n_execution_id: evaluated.n8n_execution_id,
      mode: evaluated.mode,
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      should_send: evaluated.should_send === true,
      delivery_type: evaluated.delivery_type,
      delivery_status: evaluated.delivery_status,
      report_id: evaluated.report_id || null,
      report_version: evaluated.report_version,
      recipient: evaluated.recipient,
      subject: evaluated.subject,
      dedupe_key: evaluated.dedupe_key,
      schema_valid: evaluated.schema_valid === true,
      publication_ready: evaluated.publication_ready === true,
      gates_blocking: evaluated.gates_blocking || [],
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
      delivery_json_b64: evaluated.delivery_json_b64 || '',
    },
  },
];
