// Canonical source for PII-01 "Resolve Edgar Identity" Code node.
// Expects prior context from Validate Identity Request + EDGAR company_tickers_exchange payload.
// Bundled into workflow.ts via workflows/scripts/bundle-workflow.mjs

const EXCHANGE_ALIASES = {
  NASDAQ: ['NASDAQ', 'NASDAQ/NGS', 'NASDAQ/NMS', 'NASDAQ/GSM', 'NASDAQ/SCM', 'NASDAQGM', 'NASDAQGS', 'NASDAQCM'],
  NYSE: ['NYSE', 'NEW YORK STOCK EXCHANGE'],
  AMEX: ['AMEX', 'NYSE AMERICAN', 'NYSE MKT', 'NYSEAMERICAN'],
};

function normalizeExchange(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function exchangesMatch(requested, candidate) {
  const req = normalizeExchange(requested);
  const cand = normalizeExchange(candidate);
  if (!req || !cand) return false;
  if (req === cand) return true;
  const aliases = EXCHANGE_ALIASES[req] || [req];
  // Exact alias match only — avoid substring false positives (e.g. AMEX alias
  // "NYSE AMERICAN" incorrectly matching candidate "NYSE").
  return aliases.some((alias) => cand === alias);
}

function padCik(cik) {
  const digits = String(cik == null ? '' : cik).replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

function extractRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'object') {
    // HTTP node may wrap as { data: {...} } or return the map directly.
    const root = payload.data && typeof payload.data === 'object' && !payload.ticker ? payload.data : payload;
    if (Array.isArray(root)) return root;
    return Object.values(root).filter((row) => row && typeof row === 'object' && row.ticker);
  }
  return [];
}

const results = [];

for (const item of $input.all()) {
  const json = item.json || {};

  // Prefer explicit case fields from Validate node; fall back to item fields.
  let caseCtx = json;
  try {
    const validated = $('Validate Identity Request').first().json;
    if (validated && validated.valid) caseCtx = validated;
  } catch (_err) {
    // Manual/unit tests may not have sibling nodes.
  }

  const ticker = String(caseCtx.ticker || json.ticker || '')
    .trim()
    .toUpperCase();
  const exchange = String(caseCtx.exchange || json.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();
  const caseId = caseCtx.case_id || json.case_id || null;
  const minConfidence = Number(caseCtx.min_identity_confidence ?? json.min_identity_confidence ?? 80);

  const rows = extractRows(json);
  const tickerMatches = rows.filter((row) => String(row.ticker || '').trim().toUpperCase() === ticker);

  if (tickerMatches.length === 0) {
    results.push({
      json: {
        case_id: caseId,
        ticker,
        exchange,
        resolved: false,
        outcome: 'NEEDS_HUMAN_REVIEW',
        next_state: 'AWAITING_HUMAN_REVIEW',
        identity_confidence: 0,
        reason: 'ticker_not_found_in_edgar',
        provenance: 'sec.gov/files/company_tickers_exchange.json',
        aliases: [],
      },
    });
    continue;
  }

  const exchangeMatches = tickerMatches.filter((row) => exchangesMatch(exchange, row.exchange));
  let chosen = null;
  let identityConfidence = 0;
  let reason = '';

  if (exchangeMatches.length === 1) {
    chosen = exchangeMatches[0];
    identityConfidence = 95;
    reason = 'exact_ticker_and_exchange';
  } else if (exchangeMatches.length > 1) {
    chosen = exchangeMatches[0];
    identityConfidence = 60;
    reason = 'ambiguous_exchange_matches';
  } else if (tickerMatches.length === 1) {
    chosen = tickerMatches[0];
    identityConfidence = 75;
    reason = 'ticker_only_exchange_mismatch';
  } else {
    chosen = tickerMatches[0];
    identityConfidence = 40;
    reason = 'ambiguous_ticker_matches';
  }

  const cik = padCik(chosen.cik_str ?? chosen.cik);
  const legalName = String(chosen.title || chosen.legal_name || '').trim();
  const resolvedExchange = normalizeExchange(chosen.exchange || exchange);
  const resolved = Boolean(cik && legalName);
  const passesGate = resolved && identityConfidence >= minConfidence;

  const aliases = [];
  if (ticker) {
    aliases.push({
      alias_type: 'ticker',
      alias_value: ticker,
      confidence: identityConfidence,
      provenance: 'sec.gov/files/company_tickers_exchange.json',
      requires_human_approval: identityConfidence < minConfidence,
    });
  }
  if (legalName) {
    aliases.push({
      alias_type: 'legal_name',
      alias_value: legalName,
      confidence: identityConfidence,
      provenance: 'sec.gov/files/company_tickers_exchange.json',
      requires_human_approval: identityConfidence < minConfidence,
    });
  }

  results.push({
    json: {
      case_id: caseId,
      ticker,
      exchange: resolvedExchange || exchange,
      requested_exchange: exchange,
      cik,
      legal_name: legalName,
      resolved,
      outcome: passesGate ? 'RESOLVED' : 'NEEDS_HUMAN_REVIEW',
      next_state: passesGate ? 'ELIGIBILITY_REVIEW' : 'AWAITING_HUMAN_REVIEW',
      identity_confidence: identityConfidence,
      reason,
      match_count: tickerMatches.length,
      exchange_match_count: exchangeMatches.length,
      provenance: 'sec.gov/files/company_tickers_exchange.json',
      aliases,
      min_identity_confidence: minConfidence,
    },
  });
}

return results;
