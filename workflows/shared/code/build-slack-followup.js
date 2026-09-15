// Canonical source for PII Slack Intake "Build Slack Follow-up" Code node.

function asBool(value) {
  return value === true || value === 'true';
}

const parse = $('Parse Slack Slash Command').first().json;
const ack = $input.first().json || {};

const caseId = ack.case_id || ack.caseId || null;
const requestId = ack.request_id || ack.requestId || null;
const state = ack.state || null;
const created = asBool(ack.created);
const ticker = ack.ticker || parse.ticker;
const message = ack.message || null;

let slackFollowup;
let outcome;

if (caseId) {
  outcome = 'ACKED';
  const createdLabel = created ? 'created' : 'reused (idempotent)';
  slackFollowup = {
    response_type: 'ephemeral',
    text: [
      `Investigation ${createdLabel} for *${ticker}*.`,
      `• case_id: \`${caseId}\``,
      requestId ? `• request_id: \`${requestId}\`` : null,
      state ? `• state: \`${state}\`` : null,
      message ? `• ${message}` : null,
      'Full analysis continues asynchronously. You will get a Slack DM when the report draft is ready.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
} else {
  outcome = 'FAILED';
  const detail =
    ack.error ||
    ack.message ||
    ack.description ||
    (typeof ack === 'object' ? JSON.stringify(ack).slice(0, 500) : String(ack));
  slackFollowup = {
    response_type: 'ephemeral',
    text: [
      `Failed to start investigation for *${parse.ticker || 'unknown'}*.`,
      'PII-00 may be inactive/unpublished, or the webhook rejected the request.',
      detail ? `Detail: ${detail}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

return [
  {
    json: {
      outcome,
      valid: parse.valid === true,
      ticker,
      exchange: parse.exchange,
      case_id: caseId,
      request_id: requestId,
      state,
      created,
      response_url: parse.response_url,
      user_name: parse.user_name,
      channel_id: parse.channel_id,
      slack_followup: slackFollowup,
      n8n_execution_id: $execution.id,
    },
  },
];
