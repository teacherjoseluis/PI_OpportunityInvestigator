// Canonical source for PII-13 "Validate Ops Request" Code node.
// Global health scan — case_id/ticker not required.

const crypto = require('crypto');

function toPositiveInt(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const lookbackHoursRaw = body.lookback_hours ?? body.lookbackHours;
  if (
    lookbackHoursRaw != null &&
    lookbackHoursRaw !== '' &&
    (!Number.isFinite(Number(lookbackHoursRaw)) || Number(lookbackHoursRaw) <= 0)
  ) {
    errors.push('lookback_hours must be a positive number when provided');
  }

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
      lookback_hours:
        lookbackHoursRaw == null || lookbackHoursRaw === ''
          ? null
          : toPositiveInt(lookbackHoursRaw, null),
      n8n_execution_id: $execution.id,
      ops_run_id: crypto.randomUUID(),
    },
  });
}

return results;
