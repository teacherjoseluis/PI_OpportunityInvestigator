// Slim payload after ops_alerts insert — drop alerts array from stream.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Ops Alerts') || {};

return [
  {
    json: {
      n8n_execution_id: evaluated.n8n_execution_id,
      ops_run_id: evaluated.ops_run_id || null,
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      summary: evaluated.summary || null,
      alert_count: evaluated.alert_count || 0,
      material_alert_count: evaluated.material_alert_count || 0,
      alert_types: evaluated.alert_types || [],
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
    },
  },
];
