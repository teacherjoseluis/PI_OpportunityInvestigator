// Expand monitoring_plan into one item per monitoring_rules insert.

const item = $input.first().json || {};
const plan = Array.isArray(item.monitoring_plan) ? item.monitoring_plan : [];
const seed = item.seed_monitoring_rules === true || item.seed_monitoring_rules === 'true';

if (!seed || !plan.length) {
  return [
    {
      json: {
        skip_rule: true,
        case_id: item.case_id,
        rule_count: 0,
      },
    },
  ];
}

return plan.map((rule, index) => ({
  json: {
    skip_rule: false,
    case_id: item.case_id,
    rule_index: index,
    rule_type: String(rule.rule_type || 'custom').replaceAll(',', ' '),
    description: String(rule.description || '').replaceAll(',', ' '),
  },
}));
