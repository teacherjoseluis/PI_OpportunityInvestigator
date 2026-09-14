// Canonical source for PII-02 "Build Eligibility Result" Code node.

const item = $input.first().json || {};

let rules = item.rules;
if (typeof rules === 'string') {
  try {
    rules = JSON.parse(rules);
  } catch {
    rules = [];
  }
}
if (!Array.isArray(rules)) rules = [];

const payload = {
  case_id: item.case_id,
  company_id: item.company_id || null,
  security_id: item.security_id || null,
  ticker: item.ticker,
  exchange: item.exchange,
  cik: item.cik || null,
  legal_name: item.legal_name || null,
  configuration_version_id: item.configuration_version_id || null,
  outcome: item.outcome || 'HUMAN_REVIEW',
  next_state: item.next_state || 'AWAITING_HUMAN_REVIEW',
  reason: item.reason || null,
  sector: item.sector || null,
  industry: item.industry || null,
  market_cap_usd: item.market_cap_usd == null ? null : Number(item.market_cap_usd),
  adv_dollar_usd: item.adv_dollar_usd == null ? null : Number(item.adv_dollar_usd),
  rules,
  provenance: item.provenance || 'api.twelvedata.com',
  as_of: new Date().toISOString(),
};

return [{ json: payload }];
