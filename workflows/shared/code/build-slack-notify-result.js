// Canonical source for PII-15 "Build Slack Notify Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

let gates = item.gates_blocking;
if (typeof gates === 'string') {
  try {
    gates = JSON.parse(gates);
  } catch {
    gates = [];
  }
}
if (!Array.isArray(gates)) gates = [];

return [
  {
    json: {
      case_id: item.case_id,
      ticker: item.ticker,
      exchange: item.exchange,
      outcome: item.outcome || 'FAILED',
      reason: item.reason || null,
      delivery_type: item.delivery_type || null,
      delivery_status: item.delivery_status || null,
      report_id: item.report_id || null,
      report_version:
        item.report_version == null ? null : Number(item.report_version),
      recipient: item.recipient || null,
      subject: item.subject || null,
      provider_message_ts: item.provider_message_ts || null,
      schema_valid: item.schema_valid === true || item.schema_valid === 'true',
      publication_ready:
        item.publication_ready === true || item.publication_ready === 'true',
      gates_blocking: gates,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
