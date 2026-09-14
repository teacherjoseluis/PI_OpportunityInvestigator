import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateEligibilityRequestCode = `// Canonical source for PII-02 "Validate Eligibility Request" Code node.
// Bundled into workflow.ts via workflows/scripts/bundle-workflow.mjs

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const caseId = String(body.case_id || body.caseId || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) {
    errors.push('case_id is required and must be a UUID');
  }

  const ticker = String(body.ticker || '')
    .trim()
    .toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    errors.push('ticker is required and must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  const exchange = String(body.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        statusCode: 400,
        outcome: 'HUMAN_REVIEW',
        next_state: 'AWAITING_HUMAN_REVIEW',
        reason: 'validation_failed',
      },
    });
    continue;
  }

  results.push({
    json: {
      valid: true,
      case_id: caseId,
      ticker,
      exchange,
      company_id: body.company_id || body.companyId || null,
      cik: body.cik || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const evaluateEligibilityCode = `// Canonical source for PII-02 "Evaluate Eligibility" Code node.
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
  return raw.toUpperCase().replace(/\\s+/g, ' ');
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
  // interpret \${...} as outer-template interpolations.
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
`;
const buildEligibilityResultCode = `// Canonical source for PII-02 "Build Eligibility Result" Code node.

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
`;

const eligibilityTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Eligibility Gate Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'ticker', type: 'string' },
          { name: 'exchange', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateEligibilityRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Eligibility Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateEligibilityRequestCode,
    },
  },
  output: [
    {
      valid: true,
      case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
      n8n_execution_id: '1',
    },
  ],
});

const validationPassed = ifElse({
  version: 2.3,
  config: {
    name: 'Validation Passed?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.valid }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareValidationError = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Validation Error',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'outcome',
            name: 'outcome',
            value: 'HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: 'AWAITING_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: 'validation_failed',
            type: 'string',
          },
          {
            id: 'rules',
            name: 'rules',
            value: expr('{{ [] }}'),
            type: 'array',
          },
        ],
      },
    },
  },
});

const loadCaseAndCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Company',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, c.cik, c.legal_name, c.sector, c.industry, c.website_url, s.listing_status, s.security_type FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id LEFT JOIN securities s ON s.id = rc.security_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Eligibility Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadActiveConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Active Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, eligibility_json, gates_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
      options: {
        queryReplacement: '',
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const countDuplicateCases = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Count Duplicate Cases',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COUNT(*)::int AS duplicate_count FROM research_cases WHERE ticker = $2 AND COALESCE(exchange, '') = COALESCE($3, '') AND id <> $1::uuid AND created_at >= NOW() - make_interval(days => $4::int) AND state NOT IN ('FAILED', 'SUPERSEDED')",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Eligibility Request").item.json.case_id }},{{ $("Validate Eligibility Request").item.json.ticker }},{{ $("Validate Eligibility Request").item.json.exchange }},{{ $("Load Active Config").item.json.eligibility_json.duplicate_lookback_days || 30 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const twelveDataAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

const fetchTwelveDataProfile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Profile',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/profile',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
          {
            name: 'exchange',
            value: expr('{{ $("Validate Eligibility Request").item.json.exchange }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('TwelveData API key'),
    },
  },
});

const fetchTwelveDataStatistics = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Statistics',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/statistics',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
          {
            name: 'exchange',
            value: expr('{{ $("Validate Eligibility Request").item.json.exchange }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('TwelveData API key'),
    },
  },
});

const fetchTwelveDataQuote = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch TwelveData Quote',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://api.twelvedata.com/quote',
      ...twelveDataAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
          {
            name: 'exchange',
            value: expr('{{ $("Validate Eligibility Request").item.json.exchange }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('TwelveData API key'),
    },
  },
});

const finnhubAuth = {
  authentication: 'genericCredentialType',
  genericAuthType: 'httpQueryAuth',
};

// Fallback when TwelveData /profile (Grow+) or /statistics (Pro+) return plan 403s.
const fetchFinnhubProfile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Finnhub Profile',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://finnhub.io/api/v1/stock/profile2',
      ...finnhubAuth,
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'symbol',
            value: expr('{{ $("Validate Eligibility Request").item.json.ticker }}'),
          },
        ],
      },
      options: {
        timeout: 30000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
    credentials: {
      httpQueryAuth: newCredential('Finnhub API key'),
    },
  },
});

const evaluateEligibility = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Eligibility',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateEligibilityCode,
    },
  },
});

const hasCompany = ifElse({
  version: 2.3,
  config: {
    name: 'Has Company?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.has_company }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const updateCompanyProfile = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Update Company Profile',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE companies SET sector = NULLIF($2, ''), industry = NULLIF($3, ''), website_url = NULLIF($4, ''), updated_at = NOW() WHERE id = $1::uuid RETURNING id AS company_id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Eligibility").item.json.company_id }},{{ $("Evaluate Eligibility").item.json.sector_safe }},{{ $("Evaluate Eligibility").item.json.industry_safe }},{{ $("Evaluate Eligibility").item.json.website_safe }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareAdvanceFields = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Advance Fields',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Evaluate Eligibility").item.json.next_state }}'),
            type: 'string',
          },
          {
            id: 'config-id',
            name: 'configuration_version_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.configuration_version_id }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Eligibility").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Evaluate Eligibility").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'rules-b64',
            name: 'rules_b64',
            value: expr('{{ $("Evaluate Eligibility").item.json.rules_b64 }}'),
            type: 'string',
          },
          {
            id: 'market-cap',
            name: 'market_cap_usd',
            value: expr('{{ $("Evaluate Eligibility").item.json.market_cap_usd }}'),
            type: 'number',
          },
          {
            id: 'adv',
            name: 'adv_dollar_usd',
            value: expr('{{ $("Evaluate Eligibility").item.json.adv_dollar_usd }}'),
            type: 'number',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Eligibility").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Eligibility").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Evaluate Eligibility").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Eligibility").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'sector',
            name: 'sector',
            value: expr('{{ $("Evaluate Eligibility").item.json.sector }}'),
            type: 'string',
          },
          {
            id: 'industry',
            name: 'industry',
            value: expr('{{ $("Evaluate Eligibility").item.json.industry }}'),
            type: 'string',
          },
          {
            id: 'exec-id',
            name: 'n8n_execution_id',
            value: expr('{{ $("Evaluate Eligibility").item.json.n8n_execution_id }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Evaluate Eligibility").item.json.provenance }}'),
            type: 'string',
          },
        ],
      },
    },
  },
});

const advanceCaseState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Advance Case State',
    parameters: {
      operation: 'executeQuery',
      query:
        'UPDATE research_cases SET state = $2, configuration_version_id = NULLIF($3, \'\')::uuid, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, configuration_version_id, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.next_state }},{{ $json.configuration_version_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logEligibilityState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Eligibility State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ELIGIBILITY_REVIEW', $2, $3, 'pii-02', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Advance Case State").item.json.state }},{{ $("Prepare Advance Fields").item.json.reason }},{{ $("Prepare Advance Fields").item.json.n8n_execution_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-02 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-02', $2, $3::uuid, 'SUCCEEDED', jsonb_build_object('outcome', $4, 'next_state', $5, 'market_cap_usd', NULLIF(NULLIF(TRIM($6), ''), 'null')::numeric, 'adv_dollar_usd', NULLIF(NULLIF(TRIM($7), ''), 'null')::numeric, 'rules', convert_from(decode($8, 'base64'), 'UTF8')::jsonb)) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").item.json.case_id }},{{ $("Prepare Advance Fields").item.json.n8n_execution_id }},{{ $("Advance Case State").item.json.case_id }},{{ $("Prepare Advance Fields").item.json.outcome }},{{ $("Advance Case State").item.json.state }},{{ $("Prepare Advance Fields").item.json.market_cap_usd }},{{ $("Prepare Advance Fields").item.json.adv_dollar_usd }},{{ $("Prepare Advance Fields").item.json.rules_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeEligibilityOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Eligibility Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Prepare Advance Fields").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Prepare Advance Fields").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Advance Fields").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Advance Fields").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Prepare Advance Fields").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Prepare Advance Fields").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'config-id',
            name: 'configuration_version_id',
            value: expr('{{ $("Advance Case State").item.json.configuration_version_id }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Advance Fields").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").item.json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Advance Fields").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'sector',
            name: 'sector',
            value: expr('{{ $("Prepare Advance Fields").item.json.sector }}'),
            type: 'string',
          },
          {
            id: 'industry',
            name: 'industry',
            value: expr('{{ $("Prepare Advance Fields").item.json.industry }}'),
            type: 'string',
          },
          {
            id: 'market-cap',
            name: 'market_cap_usd',
            value: expr('{{ $("Prepare Advance Fields").item.json.market_cap_usd }}'),
            type: 'number',
          },
          {
            id: 'adv',
            name: 'adv_dollar_usd',
            value: expr('{{ $("Prepare Advance Fields").item.json.adv_dollar_usd }}'),
            type: 'number',
          },
          {
            id: 'rules',
            name: 'rules',
            value: expr('{{ $("Evaluate Eligibility").item.json.rules }}'),
            type: 'array',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Evaluate Eligibility").item.json.provenance }}'),
            type: 'string',
          },
        ],
      },
    },
  },
});

const buildEligibilityResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Eligibility Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildEligibilityResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-02 Eligibility Gate\nSubworkflow input: case_id, ticker, exchange\nLoads case + active eligibility_json then TwelveData profile/statistics/quote.',
  [eligibilityTrigger, validateEligibilityRequest, loadCaseAndCompany],
  { color: 4 },
);

const marketNote = sticky(
  '## Market data\nTwelveData profile/statistics/quote + Finnhub profile2 fallback (plan 403s).\nonError continue → evaluate uses whichever sources succeed.',
  [fetchTwelveDataProfile, fetchTwelveDataStatistics, fetchTwelveDataQuote, fetchFinnhubProfile],
  { color: 5 },
);

const gateNote = sticky(
  '## Outcomes\nPASS / PASS_WITH_EXCEPTION → COLLECTING\nHUMAN_REVIEW → AWAITING_HUMAN_REVIEW\nFAIL → INCOMPLETE',
  [evaluateEligibility, advanceCaseState, buildEligibilityResult],
  { color: 6 },
);

const finishPath = prepareAdvanceFields
  .to(advanceCaseState)
  .to(logEligibilityState)
  .to(logWorkflowRun)
  .to(mergeEligibilityOutput)
  .to(buildEligibilityResult);

export default workflow('pii-02-eligibility', 'PII-02 Eligibility Gate')
  .add(eligibilityTrigger)
  .to(validateEligibilityRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildEligibilityResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadActiveConfig.to(
            countDuplicateCases.to(
              fetchTwelveDataProfile.to(
                fetchTwelveDataStatistics.to(
                  fetchTwelveDataQuote.to(
                    fetchFinnhubProfile.to(
                      evaluateEligibility.to(
                        hasCompany
                          .onTrue(updateCompanyProfile.to(finishPath))
                          .onFalse(finishPath),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
  )
  .add(intakeNote)
  .add(marketNote)
  .add(gateNote);
