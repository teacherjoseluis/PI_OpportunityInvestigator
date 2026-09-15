// Count XBRL evidence + metric upsert results for coverage.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const prepared = nodeJson('Prepare XBRL Financial Upserts') || $input.first().json || {};
const metricRows = (() => {
  try {
    return $('Upsert XBRL Financial Metrics').all().length;
  } catch {
    return Number(prepared.metric_count || 0);
  }
})();

return [
  {
    json: {
      case_id: prepared.case_id,
      company_id: prepared.company_id,
      xbrl_stored_count: Number(prepared.xbrl_stored_count || (prepared.evidence_id ? 1 : 0)),
      xbrl_metric_count: metricRows,
      evidence_id: prepared.evidence_id || null,
    },
  },
];
