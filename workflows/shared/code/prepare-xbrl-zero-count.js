// XBRL collector skipped or produced no documents.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const normalized = nodeJson('Normalize SEC XBRL Facts') || $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || {};

return [
  {
    json: {
      case_id: normalized.case_id || validated.case_id,
      company_id: normalized.company_id || null,
      xbrl_stored_count: 0,
      xbrl_metric_count: 0,
      skipped: normalized.skipped === true,
      error: normalized.error || null,
    },
  },
];
