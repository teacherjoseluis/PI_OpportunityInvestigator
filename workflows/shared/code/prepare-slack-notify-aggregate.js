// Slim payload after Slack send / delivery insert.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Slack Notify') || {};
const slackSend = nodeJson('Send Slack Completion DM') || {};

let providerTs = null;
if (slackSend && typeof slackSend === 'object') {
  providerTs =
    slackSend.ts ||
    slackSend.message_ts ||
    (slackSend.message && slackSend.message.ts) ||
    null;
}

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id || null,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name || null,
      n8n_execution_id: evaluated.n8n_execution_id,
      outcome: evaluated.should_send === true ? 'SENT' : evaluated.outcome,
      reason: evaluated.reason,
      should_send: evaluated.should_send === true,
      delivery_type: evaluated.delivery_type,
      delivery_status: evaluated.should_send === true ? 'SENT' : evaluated.delivery_status,
      report_id: evaluated.report_id || null,
      report_version: evaluated.report_version,
      recipient: evaluated.recipient,
      origin_channel_id: evaluated.origin_channel_id || null,
      subject: evaluated.subject,
      message_text: evaluated.message_text,
      provider_message_ts: providerTs,
      schema_valid: evaluated.schema_valid === true,
      publication_ready: evaluated.publication_ready === true,
      gates_blocking: evaluated.gates_blocking || [],
      dedupe_key: evaluated.dedupe_key,
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
      delivery_json_b64: evaluated.delivery_json_b64 || '',
    },
  },
];
