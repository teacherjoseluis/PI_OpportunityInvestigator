// Canonical source for PII-15 "Validate Slack Notify Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const exchange = String(body.exchange || '')
    .trim()
    .toUpperCase();

  const modeRaw = String(body.mode || 'COMPLETION')
    .trim()
    .toUpperCase();
  const mode = modeRaw === 'EARLY_EXIT' ? 'EARLY_EXIT' : 'COMPLETION';

  const asOptionalString = (value) => {
    if (value == null) return null;
    const s = String(value).trim();
    return s === '' || s.toLowerCase() === 'null' ? null : s;
  };

  const stage = asOptionalString(body.stage);
  const reason = asOptionalString(body.reason);
  const outcome = asOptionalString(body.outcome);
  const nextState = asOptionalString(body.next_state);
  const detail = asOptionalString(body.detail);

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        reason: 'validation_failed',
      },
    });
    continue;
  }

  results.push({
    json: {
      valid: true,
      case_id: caseId,
      ticker: ticker || null,
      exchange: exchange || null,
      mode,
      stage,
      reason,
      outcome,
      next_state: nextState,
      detail,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
