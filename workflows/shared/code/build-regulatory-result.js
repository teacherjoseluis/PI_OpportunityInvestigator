// Canonical source for PII-07 "Build Regulatory Result" Code node.

const item = $input.first().json || {};

let insufficient_topics = item.insufficient_topics;
if (typeof insufficient_topics === 'string') {
  try {
    insufficient_topics = JSON.parse(insufficient_topics);
  } catch {
    insufficient_topics = [];
  }
}
if (!Array.isArray(insufficient_topics)) insufficient_topics = [];

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
      claim_count: Number(item.claim_count || counts.claim_stored_count || 0),
      insufficient_topics,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
