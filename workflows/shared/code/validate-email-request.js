// Canonical source for PII-14 "Validate Email Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MODES = new Set(['TEST_DELIVERY', 'INVESTIGATION_REPORT']);

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const caseId = String(body.case_id || body.caseId || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) {
    errors.push('case_id is required and must be a UUID');
  }

  let mode = String(body.mode || body.delivery_mode || '')
    .trim()
    .toUpperCase();
  if (!mode) mode = null;
  if (mode && !ALLOWED_MODES.has(mode)) {
    errors.push('mode must be TEST_DELIVERY or INVESTIGATION_REPORT when provided');
  }

  const recipient = String(body.recipient || body.to || '')
    .trim()
    .toLowerCase();

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
      mode,
      recipient: recipient || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
