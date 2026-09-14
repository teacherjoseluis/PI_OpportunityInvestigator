// Expand Evaluate Regulatory Catalyst claims[] into one item per claim upsert.

const item = $input.first().json || {};
const claims = Array.isArray(item.claims) ? item.claims : [];
const caseId = item.case_id;

if (!claims.length) {
  return [
    {
      json: {
        case_id: caseId,
        skip_upsert: true,
        claim_count: 0,
      },
    },
  ];
}

return claims.map((claim, index) => ({
  json: {
    case_id: caseId,
    skip_upsert: false,
    claim_index: index,
    topic_key: claim.topic_key || 'claim_' + index,
    claim_text: String(claim.claim_text || '').replaceAll(',', ' '),
    claim_category: claim.claim_category || 'regulatory_catalyst',
    claim_kind: claim.claim_kind || 'inference',
    confidence: Number(claim.confidence ?? 50),
    materiality: claim.materiality || 'MEDIUM',
    extraction_method: claim.extraction_method || 'deterministic',
    evidence_ids: Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [],
    evidence_ids_csv: (Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [])
      .filter(Boolean)
      .join('|'),
    parent_outcome: item.outcome,
    parent_next_state: item.next_state,
    parent_reason: item.reason,
    parent_claim_count: claims.length,
    insufficient_topics: item.insufficient_topics || [],
    counts: item.counts || {},
    metadata_b64: item.metadata_b64 || '',
    ticker: item.ticker,
    exchange: item.exchange,
    company_id: item.company_id,
    n8n_execution_id: item.n8n_execution_id,
  },
}));
