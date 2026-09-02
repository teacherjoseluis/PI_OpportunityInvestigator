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
      correlation_id: requestId,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
