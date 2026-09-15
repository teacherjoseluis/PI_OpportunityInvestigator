// After Upsert XBRL Evidence: bind returned evidence_id onto period/metrics/chunk fields.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const upserted = $input.first().json || {};
const normalized = nodeJson('Normalize SEC XBRL Facts') || {};
const evidenceId = upserted.evidence_id || upserted.id || null;

return [
  {
    json: {
      case_id: normalized.case_id || upserted.case_id,
      company_id: normalized.company_id || upserted.company_id,
      evidence_id: evidenceId,
      period_label: normalized.period_label,
      period_start: normalized.period_start,
      period_end: normalized.period_end,
      fiscal_year: normalized.fiscal_year,
      fiscal_quarter: normalized.fiscal_quarter,
      metrics_b64: normalized.metrics_b64,
      chunk_text: normalized.chunk_text,
      chunk_index: normalized.chunk_index == null ? 0 : normalized.chunk_index,
      chunk_token_estimate: normalized.chunk_token_estimate || null,
      chunk_metadata_b64: normalized.chunk_metadata_b64 || '',
      metric_count: normalized.metric_count || 0,
      xbrl_stored_count: evidenceId ? 1 : 0,
    },
  },
];
