// Canonical source for PII-11 "Build Report Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      outcome_class: item.outcome_class || null,
      schema_valid: item.schema_valid === true || item.schema_valid === 'true',
      publication_ready:
        item.publication_ready === true || item.publication_ready === 'true',
      report_id: item.report_id || null,
      report_version: item.report_version == null ? null : Number(item.report_version),
      claim_count: Number(item.claim_count || counts.claim_count || 0),
      counts,
      as_of: item.as_of || new Date().toISOString(),
    },
  },
];
