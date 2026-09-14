// Canonical source for PII-03 "Build Collection Result" Code node.

const item = $input.first().json || {};

let collector_status = item.collector_status;
if (typeof collector_status === 'string') {
  try {
    collector_status = JSON.parse(collector_status);
  } catch {
    collector_status = [];
  }
}
if (!Array.isArray(collector_status)) collector_status = [];

const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      cik: item.cik || null,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'INCOMPLETE',
      reason: item.reason || null,
      collector_status,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
