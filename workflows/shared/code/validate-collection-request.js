// Canonical source for PII-03 "Validate Collection Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const caseId = String(body.case_id || body.caseId || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) {
    errors.push('case_id is required and must be a UUID');
  }

  const ticker = String(body.ticker || '')
    .trim()
    .toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    errors.push('ticker is required and must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  const exchange = String(body.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();

  const knownKeys = new Set([
    'ALL',
    'PII-03',
    'PII-03-SEC',
    'PII-03-XBRL',
    'PII-03-CT',
    'PII-03-FDA',
    'PII-03-NEWS',
    'PII-03-USPTO',
    'PII-03-CL',
    'PII-03-COVER',
  ]);
  const requestedKey = String(body.collector_key || body.collectorKey || 'ALL')
    .trim()
    .toUpperCase();
  if (!knownKeys.has(requestedKey)) {
    errors.push('collector_key is not a known collector worker');
  }
  const collectorKey = requestedKey === 'PII-03' ? 'ALL' : requestedKey;

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        next_state: 'INCOMPLETE',
        reason: 'validation_failed',
      },
    });
    continue;
  }

  results.push({
    json: {
      valid: true,
      case_id: caseId,
      ticker,
      exchange,
      company_id: body.company_id || body.companyId || null,
      cik: body.cik || null,
      n8n_execution_id: $execution.id,
      collector_key: collectorKey || 'ALL',
      continue_chain: (collectorKey || 'ALL') === 'ALL',
    },
  });
}

return results;
