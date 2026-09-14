// Canonical source for PII-02 "Evaluate Eligibility" Code node.
// Deterministic rules from configuration_versions.eligibility_json + market data.
// Primary: TwelveData profile/statistics/quote.
// Fallback: Finnhub /stock/profile2 when TwelveData returns plan/availability errors.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

function normalizeText(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') return '';
  return raw.toUpperCase().replace(/\s+/g, ' ');
}

function normalizeIndustry(value) {
  return normalizeText(value).replace(/[—–]/g, '-');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rule(key, status, detail, measured_value) {
  return {
    key,
    status,
    detail,
    measured_value: measured_value == null ? null : measured_value,
  };
}

function aggregateOutcome(rules) {
  if (rules.some((r) => r.status === 'FAIL')) return 'FAIL';
  if (rules.some((r) => r.status === 'HUMAN_REVIEW')) return 'HUMAN_REVIEW';
  if (rules.some((r) => r.status === 'PASS_WITH_EXCEPTION')) return 'PASS_WITH_EXCEPTION';
  return 'PASS';
}

function nextStateFor(outcome) {
  if (outcome === 'PASS' || outcome === 'PASS_WITH_EXCEPTION') return 'COLLECTING';
  if (outcome === 'FAIL') return 'INCOMPLETE';
  return 'AWAITING_HUMAN_REVIEW';
}

function isUsablePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.error || payload.status === 'error') return false;
  if (payload.code != null && Number(payload.code) >= 400) return false;
  return true;
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Eligibility Request') || item;
const caseRow = nodeJson('Load Case And Company') || item.case || item;
const configRow = nodeJson('Load Active Config') || item.config || {};
const dupRow = nodeJson('Count Duplicate Cases') || item.duplicate || {};
const profile = nodeJson('Fetch TwelveData Profile') || item.profile || {};
const statistics = nodeJson('Fetch TwelveData Statistics') || item.statistics || {};
const quote = nodeJson('Fetch TwelveData Quote') || item.quote || {};
const finnhub = nodeJson('Fetch Finnhub Profile') || item.finnhub || {};

const eligibility = asObject(
  configRow.eligibility_json || configRow.eligibility || item.eligibility_json || {},
);

const ticker = String(validated.ticker || caseRow.ticker || item.ticker || '')
  .trim()
  .toUpperCase();
const exchange = normalizeText(validated.exchange || caseRow.exchange || item.exchange || '');
const caseId = validated.case_id || caseRow.case_id || item.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const cik = caseRow.cik || validated.cik || null;

const allowedExchanges = (eligibility.allowed_exchanges || ['NYSE', 'NASDAQ', 'AMEX']).map(
  normalizeText,
);
const allowedSectors = (eligibility.sectors || []).map(normalizeText);
const allowedIndustries = (eligibility.industries || []).map(normalizeIndustry);
const industryKeywords = (eligibility.industry_keywords || []).map(normalizeText);
const disallowedTypes = (eligibility.disallowed_security_types || []).map(normalizeText);
const shellPatterns = (eligibility.shell_name_patterns || []).map(normalizeText);
const industryMismatchOutcome = eligibility.industry_mismatch_outcome || 'PASS_WITH_EXCEPTION';
const shellMatchOutcome = eligibility.shell_match_outcome || 'FAIL';

const profileOk = isUsablePayload(profile) && Boolean(profile.symbol);
const statsOk =
  isUsablePayload(statistics) &&
  statistics.statistics &&
  typeof statistics.statistics === 'object';
const quoteOk = isUsablePayload(quote) && (Boolean(quote.symbol) || quote.close != null);
const finnhubOk =
  isUsablePayload(finnhub) &&
  (Boolean(finnhub.ticker) ||
    finnhub.marketCapitalization != null ||
    Boolean(finnhub.finnhubIndustry) ||
    Boolean(finnhub.name));

const provenance = [];
if (profileOk) provenance.push('twelvedata.profile');
if (statsOk) provenance.push('twelvedata.statistics');
if (quoteOk) provenance.push('twelvedata.quote');
if (finnhubOk) provenance.push('finnhub.profile2');

let securityType = profileOk ? String(profile.type || '') : '';
let sector = profileOk ? String(profile.sector || '') : String(caseRow.sector || '');
let industry = profileOk ? String(profile.industry || '') : String(caseRow.industry || '');
let profileName = profileOk
  ? String(profile.name || '')
  : String(caseRow.legal_name || quote.name || '');
let description = profileOk ? String(profile.description || '') : '';
let website = profileOk ? String(profile.website || '') : String(caseRow.website_url || '');

let marketCap = statsOk
  ? toNumber(statistics.statistics?.valuations_metrics?.market_capitalization)
  : null;

if ((!profileOk || marketCap == null) && finnhubOk) {
  if (!securityType) securityType = 'Common Stock';
  if (!sector) {
    const fhIndustry = String(finnhub.finnhubIndustry || '');
    const fhNorm = normalizeText(fhIndustry);
    if (
      fhNorm.includes('BIOTECH') ||
      fhNorm.includes('PHARMA') ||
      fhNorm.includes('HEALTH') ||
      fhNorm.includes('DRUG')
    ) {
      sector = 'Healthcare';
    } else if (fhIndustry) {
      sector = fhIndustry;
    }
  }
  if (!industry && finnhub.finnhubIndustry) industry = String(finnhub.finnhubIndustry);
  if (finnhub.name) profileName = String(finnhub.name);
  if (!website && finnhub.weburl) website = String(finnhub.weburl);
  if (marketCap == null) {
    const mCapMillions = toNumber(finnhub.marketCapitalization);
    if (mCapMillions != null) marketCap = mCapMillions * 1_000_000;
  }
}

// SEC-linked equities without a type source: treat as common stock (not ETF/fund).
if (!securityType && companyId && cik) {
  securityType = 'Common Stock';
}

const typeSourceOk = profileOk || finnhubOk || Boolean(companyId && cik && securityType);

const closePrice = quoteOk ? toNumber(quote.close ?? quote.previous_close) : null;
const avgVolume = quoteOk
  ? toNumber(quote.average_volume ?? quote.avg_volume ?? quote.volume)
  : null;
const advDollar =
  closePrice != null && avgVolume != null ? closePrice * avgVolume : null;

const duplicateCount = toNumber(dupRow.duplicate_count ?? item.duplicate_count) || 0;

const rules = [];

// 1) Allowed exchange
if (!exchange) {
  rules.push(rule('allowed_exchange', 'HUMAN_REVIEW', 'exchange_missing', null));
} else if (!allowedExchanges.includes(exchange)) {
  rules.push(rule('allowed_exchange', 'FAIL', 'exchange_not_allowed', exchange));
} else {
  rules.push(rule('allowed_exchange', 'PASS', 'exchange_allowed', exchange));
}

// 2) SEC identity present
if (!companyId || !cik) {
  rules.push(
    rule('sec_identity_present', 'HUMAN_REVIEW', 'company_or_cik_missing', {
      company_id: companyId,
      cik,
    }),
  );
} else {
  rules.push(rule('sec_identity_present', 'PASS', 'identity_linked', { company_id: companyId, cik }));
}

// 3) Security type
if (!typeSourceOk) {
  rules.push(rule('security_type', 'HUMAN_REVIEW', 'profile_unavailable', null));
} else {
  const typeNorm = normalizeText(securityType);
  if (disallowedTypes.includes(typeNorm)) {
    rules.push(rule('security_type', 'FAIL', 'disallowed_security_type', securityType));
  } else {
    rules.push(
      rule(
        'security_type',
        'PASS',
        profileOk ? 'security_type_ok' : finnhubOk ? 'security_type_finnhub_equity' : 'security_type_sec_linked',
        securityType || null,
      ),
    );
  }
}

// 4) Industry / sector
{
  const sectorNorm = normalizeText(sector);
  const industryNorm = normalizeIndustry(industry);
  const nameNorm = normalizeText(profileName);
  const descNorm = normalizeText(description);
  const sectorMatch = sectorNorm && allowedSectors.includes(sectorNorm);
  const industryMatch = industryNorm && allowedIndustries.includes(industryNorm);
  const keywordMatch = industryKeywords.some(
    (kw) => nameNorm.includes(kw) || industryNorm.includes(kw) || descNorm.includes(kw),
  );

  if (!sector && !industry && !keywordMatch) {
    rules.push(rule('industry_or_sector', 'HUMAN_REVIEW', 'industry_unavailable', null));
  } else if (sectorMatch || industryMatch || keywordMatch) {
    rules.push(
      rule('industry_or_sector', 'PASS', 'industry_or_sector_matched', {
        sector,
        industry,
        matched_via: sectorMatch ? 'sector' : industryMatch ? 'industry' : 'keyword',
      }),
    );
  } else {
    rules.push(
      rule('industry_or_sector', industryMismatchOutcome, 'industry_not_in_allowlist', {
        sector,
        industry,
      }),
    );
  }
}

// 5) Shell / SPAC
{
  // Concatenate (not template literal) so bundle embed into workflow.ts does not
  // interpret ${...} as outer-template interpolations.
  const haystack = normalizeText(profileName) + ' ' + normalizeText(description);
  const hit = shellPatterns.find((p) => p && haystack.includes(p));
  if (hit) {
    rules.push(rule('not_shell_spac', shellMatchOutcome, 'shell_or_spac_pattern_matched', hit));
  } else {
    rules.push(rule('not_shell_spac', 'PASS', 'not_shell_or_spac', null));
  }
}

// 6) Market cap
if (eligibility.market_cap_enabled === false) {
  rules.push(rule('market_cap_range', 'PASS', 'market_cap_check_disabled', null));
} else if (marketCap == null) {
  rules.push(rule('market_cap_range', 'HUMAN_REVIEW', 'market_cap_unavailable', null));
} else {
  const minCap = toNumber(eligibility.market_cap_min_usd) ?? 0;
  const maxCap = toNumber(eligibility.market_cap_max_usd) ?? Number.MAX_SAFE_INTEGER;
  if (marketCap < minCap || marketCap > maxCap) {
    rules.push(
      rule('market_cap_range', 'FAIL', 'market_cap_out_of_range', {
        market_cap_usd: marketCap,
        min_usd: minCap,
        max_usd: maxCap,
      }),
    );
  } else {
    rules.push(rule('market_cap_range', 'PASS', 'market_cap_in_range', marketCap));
  }
}

// 7) Average daily dollar volume
if (eligibility.adv_enabled === false) {
  rules.push(rule('min_adv_dollar', 'PASS', 'adv_check_disabled', null));
} else if (advDollar == null) {
  rules.push(rule('min_adv_dollar', 'HUMAN_REVIEW', 'adv_unavailable', null));
} else {
  const minAdv = toNumber(eligibility.min_avg_daily_dollar_volume_usd) ?? 0;
  if (advDollar < minAdv) {
    rules.push(
      rule('min_adv_dollar', 'FAIL', 'adv_below_minimum', {
        adv_dollar: advDollar,
        min_usd: minAdv,
        close: closePrice,
        average_volume: avgVolume,
      }),
    );
  } else {
    rules.push(rule('min_adv_dollar', 'PASS', 'adv_meets_minimum', advDollar));
  }
}

// 8) Duplicate recent case
if (duplicateCount > 0) {
  rules.push(
    rule('duplicate_recent_case', 'HUMAN_REVIEW', 'recent_sibling_case_exists', duplicateCount),
  );
} else {
  rules.push(rule('duplicate_recent_case', 'PASS', 'no_recent_duplicate', 0));
}

const outcome = aggregateOutcome(rules);
const next_state = nextStateFor(outcome);
const failedOrReview = rules.filter((r) => r.status !== 'PASS').map((r) => r.key);

const rulesJson = JSON.stringify(rules);
// Base64 avoids n8n Postgres queryReplacement comma-splitting metadata JSON.
const rules_b64 =
  typeof Buffer !== 'undefined'
    ? Buffer.from(rulesJson, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(rulesJson)));

const sectorSafe = String(sector || '').replaceAll(',', ' ');
const industrySafe = String(industry || '').replaceAll(',', ' ');
const websiteSafe = String(website || '').replaceAll(',', ' ');

return [
  {
    json: {
      case_id: caseId,
      ticker,
      exchange,
      company_id: companyId,
      security_id: caseRow.security_id || null,
      cik,
      legal_name: caseRow.legal_name || profileName || null,
      configuration_version_id: configRow.configuration_version_id || configRow.id || null,
      configuration_version_label: configRow.version_label || null,
      sector: sector || null,
      industry: industry || null,
      website_url: website || null,
      security_type: securityType || null,
      market_cap_usd: marketCap,
      close_price: closePrice,
      average_volume: avgVolume,
      adv_dollar_usd: advDollar,
      duplicate_count: duplicateCount,
      outcome,
      next_state,
      reason: failedOrReview.length ? failedOrReview.join('|') : 'all_rules_passed',
      rules,
      rules_b64,
      sector_safe: sectorSafe,
      industry_safe: industrySafe,
      website_safe: websiteSafe,
      has_company: Boolean(companyId),
      provenance: provenance.length ? provenance.join('+') : 'api.twelvedata.com',
      n8n_execution_id: validated.n8n_execution_id || item.n8n_execution_id || null,
    },
  },
];
