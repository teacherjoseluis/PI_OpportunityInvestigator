// Prepare aggregate after claim/link upserts for coverage advance.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Financial Business') || $input.first().json || {};
let claimStored = 0;
try {
  claimStored = $('Insert Financial Claims')
    .all()
    .filter((row) => row.json && row.json.claim_id).length;
} catch {
  claimStored = Number(evaluated.claim_count || 0);
}

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name,
      outcome: evaluated.outcome || 'FAILED',
      next_state: evaluated.next_state || 'INCOMPLETE',
      reason: evaluated.reason || null,
      claim_count: claimStored || Number(evaluated.claim_count || 0),
      insufficient_topics: evaluated.insufficient_topics || [],
      counts: {
        ...(evaluated.counts || {}),
        claim_stored_count: claimStored,
      },
      metadata_b64: evaluated.metadata_b64 || '',
      n8n_execution_id: evaluated.n8n_execution_id || null,
    },
  },
];
