// Canonical source for PII-01 "Build Identity Result" Code node.

const item = $input.first().json || {};

const payload = {
  case_id: item.case_id,
  company_id: item.company_id || null,
  security_id: item.security_id || null,
  ticker: item.ticker,
  exchange: item.exchange,
  cik: item.cik || null,
  legal_name: item.legal_name || null,
  identity_confidence: Number(item.identity_confidence ?? 0),
  outcome: item.outcome || 'NEEDS_HUMAN_REVIEW',
  next_state: item.next_state || 'AWAITING_HUMAN_REVIEW',
  reason: item.reason || null,
  provenance: item.provenance || null,
  reused_existing: item.reused_existing === true || item.reused_existing === 'true',
  as_of: new Date().toISOString(),
};

return [{ json: payload }];
