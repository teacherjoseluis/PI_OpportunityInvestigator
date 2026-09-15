// Canonical source for PII Slack Intake "Parse Slack Slash Command" Code node.

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const KNOWN_EXCHANGES = new Set([
  'NASDAQ',
  'NYSE',
  'AMEX',
  'NYSEARCA',
  'ARCA',
  'BATS',
  'OTC',
  'OTCQX',
  'OTCQB',
  'PINK',
]);

function pickPayload(raw) {
  if (raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)) {
    return raw.body;
  }
  return raw;
}

function usageText() {
  return [
    'Usage: `/pii TICKER [EXCHANGE] [research question]`',
    'Examples:',
    '• `/pii REGN`',
    '• `/pii REGN NASDAQ`',
    '• `/pii REGN NASDAQ Does the current evidence justify deeper research?`',
    'Default exchange is NASDAQ.',
  ].join('\n');
}

const results = [];

for (const item of $input.all()) {
  const payload = pickPayload(item.json);
  const text = String(payload.text || '').trim();
  const command = String(payload.command || '/pii').trim() || '/pii';
  const userName = String(payload.user_name || payload.user_id || 'slack').trim();
  const userId = String(payload.user_id || '').trim();
  const channelId = String(payload.channel_id || '').trim();
  const teamId = String(payload.team_id || '').trim();
  const responseUrl = String(payload.response_url || '').trim();
  const triggerId = String(payload.trigger_id || '').trim();

  const requestContext = {
    source: 'slack',
    slack: {
      user_id: userId || null,
      channel_id: channelId || null,
      team_id: teamId || null,
      user_name: userName || null,
    },
  };

  const tokens = text.length > 0 ? text.split(/\s+/) : [];
  const errors = [];

  if (tokens.length === 0) {
    errors.push('ticker is required');
  }

  const ticker = tokens.length > 0 ? tokens[0].toUpperCase() : '';
  if (ticker && !TICKER_RE.test(ticker)) {
    errors.push('ticker must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  let exchange = 'NASDAQ';
  let questionStart = 1;
  if (tokens.length >= 2) {
    const maybeExchange = tokens[1].toUpperCase();
    if (KNOWN_EXCHANGES.has(maybeExchange)) {
      exchange = maybeExchange;
      questionStart = 2;
    }
  }

  const researchQuestion =
    tokens.length > questionStart
      ? tokens.slice(questionStart).join(' ').trim()
      : 'Does the current evidence justify deeper research?';

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        command,
        raw_text: text,
        user_name: userName,
        user_id: userId,
        channel_id: channelId,
        team_id: teamId || null,
        request_context: requestContext,
        response_url: responseUrl || null,
        trigger_id: triggerId || null,
        slack_immediate: {
          response_type: 'ephemeral',
          text: `Could not start investigation.\n${errors.join('\n')}\n\n${usageText()}`,
        },
      },
    });
    continue;
  }

  const immediateText = `Starting investigation for *${ticker}* on *${exchange}*…`;

  results.push({
    json: {
      valid: true,
      ticker,
      exchange,
      research_question: researchQuestion,
      mode: 'FULL',
      requested_by: `slack:${userName}`,
      configuration_version: 'v1',
      force_refresh: false,
      request_context: requestContext,
      command,
      raw_text: text,
      user_name: userName,
      user_id: userId,
      channel_id: channelId,
      team_id: teamId || null,
      response_url: responseUrl || null,
      trigger_id: triggerId || null,
      slack_immediate: {
        response_type: 'ephemeral',
        text: immediateText,
      },
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
