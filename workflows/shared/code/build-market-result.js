// Shape the PII-03-MKT subworkflow result.
// Upsert nodes return only a row id, so read the normalized evidence directly.

function normalizedItem() {
  try {
    const row = $('Normalize Market Evidence').first();
    if (row && row.json && row.json.case_id) return row.json;
  } catch {
    // Validation failed before normalization.
  }
  return $input.first().json || {};
}

const item = normalizedItem();

return [
  {
    json: {
      case_id: item.case_id,
      ticker: item.ticker,
      exchange: item.exchange,
      agent_key: 'PII-03-MKT',
      status: item.status || 'INSUFFICIENT',
      outcome: item.outcome || 'INSUFFICIENT',
      next_state: 'ANALYZING',
      reason: item.reason || null,
      bar_count: Number(item.bar_count || 0),
      access_status: item.access_status || 'empty',
      insufficient_topics: item.insufficient_topics || [],
      error_summary: item.error_summary || null,
      provider_plan_note: item.provider_plan_note || null,
    },
  },
];
