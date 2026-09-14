// Canonical source for PII-12 "Build Monitoring Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

let matched = item.matched_rule_types;
if (typeof matched === 'string') {
  try {
    matched = JSON.parse(matched);
  } catch {
    matched = [];
  }
}
if (!Array.isArray(matched)) matched = [];

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'AWAITING_HUMAN_REVIEW',
      reason: item.reason || null,
      outcome_class: item.outcome_class || null,
      as_of_baseline: item.as_of_baseline || null,
      event_count: Number(item.event_count || counts.event_count || 0),
      material_event_count: Number(
        item.material_event_count || counts.material_event_count || 0,
      ),
      matched_rule_types: matched,
      change_memo: item.change_memo || null,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
