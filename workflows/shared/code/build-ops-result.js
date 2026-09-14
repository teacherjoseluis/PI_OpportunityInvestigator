// Canonical source for PII-13 "Build Ops Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

let alertTypes = item.alert_types;
if (typeof alertTypes === 'string') {
  try {
    alertTypes = JSON.parse(alertTypes);
  } catch {
    alertTypes = [];
  }
}
if (!Array.isArray(alertTypes)) alertTypes = [];

return [
  {
    json: {
      outcome: item.outcome || 'FAILED',
      reason: item.reason || null,
      summary: item.summary || null,
      alert_count: Number(item.alert_count || counts.alert_count || 0),
      material_alert_count: Number(
        item.material_alert_count || counts.material_alert_count || 0,
      ),
      alert_types: alertTypes,
      counts,
      delivery: 'db_only',
      as_of: new Date().toISOString(),
    },
  },
];
