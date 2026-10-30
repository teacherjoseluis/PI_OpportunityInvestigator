// Canonical source for PII-16 "Validate Technical Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];
  const caseId = String(body.case_id || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) errors.push('case_id is required and must be a UUID');
  const ticker = String(body.ticker || '').trim().toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) errors.push('ticker is required');
  const exchange = String(body.exchange || 'NASDAQ').trim().toUpperCase();
  if (errors.length) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        next_state: 'INCOMPLETE',
        reason: 'validation_failed',
        status: 'FAILED',
        agent_key: 'PII-16',
        claim_count: 0,
        insufficient_topics: [],
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
      task_id: body.task_id || null,
      focus: String(body.focus || 'full').trim().toLowerCase(),
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
