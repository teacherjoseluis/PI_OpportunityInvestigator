// Canonical source for PII-00 "Validate Investigation Request" Code node.
// Bundled into workflow.ts via workflows/scripts/bundle-workflow.mjs

const ALLOWED_MODES = ['FULL', 'EVENT_REASSESSMENT', 'REFRESH', 'COMPARE'];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pickBody(raw) {
  if (raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)) {
    return raw.body;
  }
  return raw;
}

const results = [];

for (const item of $input.all()) {
  const body = pickBody(item.json);
  const errors = [];

  const ticker = String(body.ticker || '')
    .trim()
    .toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    errors.push('ticker is required and must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  const mode = String(body.mode || 'FULL')
    .trim()
    .toUpperCase();
  if (!ALLOWED_MODES.includes(mode)) {
    errors.push('mode must be one of: ' + ALLOWED_MODES.join(', '));
  }

  let requestId = body.request_id || body.requestId || null;
  if (requestId != null) {
    requestId = String(requestId).trim();
    if (!UUID_RE.test(requestId)) {
      errors.push('request_id must be a UUID when provided');
    }
  } else {
    requestId = uuidv4();
  }

  const exchange = String(body.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();
  const researchQuestion = body.research_question ?? body.researchQuestion ?? null;
  const requestedBy = String(body.requested_by ?? body.requestedBy ?? 'user').trim();
  const asOfDate = body.as_of_date ?? body.asOfDate ?? null;
  const configurationVersion = String(
    body.configuration_version ?? body.configurationVersion ?? 'v1',
  ).trim();
  const forceRefresh = Boolean(body.force_refresh ?? body.forceRefresh ?? false);

  if (asOfDate != null && asOfDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate))) {
      errors.push('as_of_date must be YYYY-MM-DD when provided');
    }
  }

  let requestContext = body.request_context ?? body.requestContext ?? {};
  if (requestContext == null || typeof requestContext !== 'object' || Array.isArray(requestContext)) {
    requestContext = {};
  } else {
    const sanitized = {};
    if (requestContext.source != null) {
      sanitized.source = String(requestContext.source).trim().slice(0, 64);
    }
    const slackIn = requestContext.slack;
    if (slackIn && typeof slackIn === 'object' && !Array.isArray(slackIn)) {
      const slack = {};
      if (slackIn.user_id || slackIn.userId) {
        slack.user_id = String(slackIn.user_id || slackIn.userId).trim().slice(0, 64);
      }
      if (slackIn.channel_id || slackIn.channelId) {
        slack.channel_id = String(slackIn.channel_id || slackIn.channelId).trim().slice(0, 64);
      }
      if (slackIn.team_id || slackIn.teamId) {
        slack.team_id = String(slackIn.team_id || slackIn.teamId).trim().slice(0, 64);
      }
      if (slackIn.user_name || slackIn.userName) {
        slack.user_name = String(slackIn.user_name || slackIn.userName).trim().slice(0, 128);
      }
      if (Object.keys(slack).length > 0) {
        sanitized.slack = slack;
        if (!sanitized.source) sanitized.source = 'slack';
      }
    }
    requestContext = sanitized;
  }

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        statusCode: 400,
      },
    });
    continue;
  }

  const requestContextJson = JSON.stringify(requestContext);
  const requestContextB64 = Buffer.from(requestContextJson, 'utf8').toString('base64');

  results.push({
    json: {
      valid: true,
      request_id: requestId,
      ticker,
      exchange,
      research_question: researchQuestion,
      mode,
      requested_by: requestedBy,
      as_of_date: asOfDate || null,
      configuration_version: configurationVersion,
      force_refresh: forceRefresh,
      request_context: requestContext,
      request_context_b64: requestContextB64,
      correlation_id: requestId,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
