// Expand Evaluate Scoring Quality components[] into one item per score_component upsert.

const item = $input.first().json || {};
const components = Array.isArray(item.components) ? item.components : [];
const scoreId = item.score_id;

if (!scoreId || !components.length) {
  return [
    {
      json: {
        skip_component: true,
        score_id: scoreId || null,
        case_id: item.case_id,
        component_count: 0,
      },
    },
  ];
}

return components.map((comp, index) => ({
  json: {
    skip_component: false,
    score_id: scoreId,
    case_id: item.case_id,
    component_index: index,
    component_key: String(comp.component_key || 'component_' + index).replaceAll(',', ' '),
    parent_score_key: String(comp.parent_score_key || 'unknown').replaceAll(',', ' '),
    raw_value: comp.raw_value == null ? '' : String(comp.raw_value),
    normalized_value: comp.normalized_value == null ? '' : String(comp.normalized_value),
    weight: comp.weight == null ? '' : String(comp.weight),
    contribution: comp.contribution == null ? '' : String(comp.contribution),
    missing_sql: comp.missing ? 'true' : 'false',
    notes: String(comp.notes || '').replaceAll(',', ' '),
  },
}));
