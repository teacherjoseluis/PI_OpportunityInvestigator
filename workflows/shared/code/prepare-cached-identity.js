// Canonical source for PII-01 "Prepare Cached Identity" Code node.
// Runs when securities+companies already exist for ticker/exchange.

const item = $input.first().json || {};

let caseCtx = {};
try {
  caseCtx = $('Validate Identity Request').first().json || {};
} catch (_err) {
  caseCtx = item;
}

const minConfidence = Number(caseCtx.min_identity_confidence ?? item.min_identity_confidence ?? 80);
const identityConfidence = Number(item.identity_confidence ?? 90);
const hasCik = Boolean(item.cik);
const resolved = Boolean(item.company_id && item.security_id && hasCik);
const confidence = resolved ? Math.max(identityConfidence, 90) : Number(item.identity_confidence ?? 0);
const passesGate = resolved && confidence >= minConfidence;

return [
  {
    json: {
      case_id: caseCtx.case_id || item.case_id,
      company_id: item.company_id || null,
      security_id: item.security_id || null,
      ticker: item.ticker || caseCtx.ticker,
      exchange: item.exchange || caseCtx.exchange,
      cik: item.cik || null,
      legal_name: item.legal_name || null,
      resolved,
      outcome: passesGate ? 'RESOLVED' : 'NEEDS_HUMAN_REVIEW',
      next_state: passesGate ? 'ELIGIBILITY_REVIEW' : 'AWAITING_HUMAN_REVIEW',
      identity_confidence: confidence,
      reason: resolved ? 'reused_existing_security' : 'incomplete_cached_identity',
      provenance: 'postgres.securities+companies',
      reused_existing: true,
      min_identity_confidence: minConfidence,
      aliases: [],
    },
  },
];
