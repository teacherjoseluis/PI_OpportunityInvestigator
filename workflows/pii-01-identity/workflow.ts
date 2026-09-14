import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateIdentityRequestCode = `// Canonical source for PII-01 "Validate Identity Request" Code node.
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
      force_refresh: Boolean(body.force_refresh ?? body.forceRefresh ?? false),
      min_identity_confidence: Number(body.min_identity_confidence ?? 80),
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const prepareCachedIdentityCode = `// Canonical source for PII-01 "Prepare Cached Identity" Code node.
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
`;
const resolveEdgarIdentityCode = `// Canonical source for PII-01 "Resolve Edgar Identity" Code node.
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
    .replace(/\\s+/g, ' ');
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
  const digits = String(cik == null ? '' : cik).replace(/\\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

function rowFromFields(fields, values) {
  if (!Array.isArray(fields) || !Array.isArray(values)) return null;
  const row = {};
  for (let i = 0; i < fields.length; i += 1) {
    row[fields[i]] = values[i];
  }
  if (row.cik != null && row.cik_str == null) row.cik_str = row.cik;
  if (row.name && !row.title) row.title = row.name;
  return row.ticker ? row : null;
}

function extractRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload
      .map((row) => (Array.isArray(row) ? null : row))
      .filter((row) => row && row.ticker);
  }
  if (typeof payload === 'object') {
    // Current SEC format: { fields: ["cik","name","ticker","exchange"], data: [[...], ...] }
    if (Array.isArray(payload.fields) && Array.isArray(payload.data)) {
      return payload.data.map((values) => rowFromFields(payload.fields, values)).filter(Boolean);
    }
    const root =
      payload.data && typeof payload.data === 'object' && !payload.ticker ? payload.data : payload;
    if (Array.isArray(root?.fields) && Array.isArray(root?.data)) {
      return root.data.map((values) => rowFromFields(root.fields, values)).filter(Boolean);
    }
    if (Array.isArray(root)) {
      if (Array.isArray(root[0])) return [];
      return root.filter((row) => row && typeof row === 'object' && row.ticker);
    }
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
`;
const buildIdentityResultCode = `// Canonical source for PII-01 "Build Identity Result" Code node.

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
`;

const identityTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Identity Resolve Trigger',
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
      case_id: '70883370-8893-4534-a148-2aa4172f497b',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateIdentityRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Identity Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateIdentityRequestCode,
    },
  },
  output: [
    {
      valid: true,
      case_id: '70883370-8893-4534-a148-2aa4172f497b',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
      force_refresh: false,
      min_identity_confidence: 80,
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
            value: 'NEEDS_HUMAN_REVIEW',
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
            id: 'confidence',
            name: 'identity_confidence',
            value: 0,
            type: 'number',
          },
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $json.case_id }}'),
            type: 'string',
          },
        ],
      },
    },
  },
});

const lookupExistingSecurity = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Lookup Existing Security',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT s.id AS security_id, s.ticker, s.exchange, c.id AS company_id, c.legal_name, c.cik, c.identity_confidence FROM securities s JOIN companies c ON c.id = s.company_id WHERE s.ticker = $1 AND s.exchange = $2 LIMIT 1',
      options: {
        queryReplacement: expr(
          '{{ $("Validate Identity Request").item.json.ticker }},{{ $("Validate Identity Request").item.json.exchange }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
  output: [],
});

const securityAlreadyExists = ifElse({
  version: 2.3,
  config: {
    name: 'Security Already Exists?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.security_id }}'),
            operator: { type: 'string', operation: 'exists' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareCachedIdentity = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Cached Identity',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareCachedIdentityCode,
    },
  },
});

const fetchEdgarTickers = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Edgar Company Tickers',
    // SEC requires a descriptive User-Agent; retry helps with transient 429/5xx.
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: 'https://www.sec.gov/files/company_tickers_exchange.json',
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
          {
            name: 'Accept-Encoding',
            value: 'gzip, deflate',
          },
          {
            name: 'Host',
            value: 'www.sec.gov',
          },
          {
            name: 'Accept',
            value: 'application/json',
          },
        ],
      },
      options: {
        timeout: 60000,
        lowercaseHeaders: false,
        response: {
          response: {
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const resolveEdgarIdentity = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolve Edgar Identity',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: resolveEdgarIdentityCode,
    },
  },
});

const edgarResolved = ifElse({
  version: 2.3,
  config: {
    name: 'Edgar Resolved?',
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
            leftValue: expr('{{ $json.resolved }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const upsertCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Company',
    parameters: {
      operation: 'executeQuery',
      query:
        "WITH upsert AS (INSERT INTO companies (legal_name, cik, identity_confidence, notes) VALUES ($1, $2, $3::numeric, 'sec.gov/files/company_tickers_exchange.json') ON CONFLICT (cik) WHERE cik IS NOT NULL DO UPDATE SET legal_name = EXCLUDED.legal_name, identity_confidence = EXCLUDED.identity_confidence, notes = EXCLUDED.notes, updated_at = NOW() RETURNING id AS company_id) SELECT company_id FROM upsert",
      options: {
        queryReplacement: expr(
          '{{ $json.legal_name.replaceAll(",", " ") }},{{ $json.cik }},{{ $json.identity_confidence }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertSecurity = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Security',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO securities (company_id, ticker, exchange, listing_status, is_primary) VALUES ($1::uuid, $2, $3, 'ACTIVE', true) ON CONFLICT (ticker, exchange) DO UPDATE SET company_id = EXCLUDED.company_id, listing_status = 'ACTIVE', updated_at = NOW() RETURNING id AS security_id, company_id",
      options: {
        queryReplacement: expr(
          '{{ $json.company_id }},{{ $("Resolve Edgar Identity").item.json.ticker }},{{ $("Resolve Edgar Identity").item.json.exchange }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertTickerAlias = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Ticker Alias',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO company_aliases (company_id, alias_type, alias_value, confidence, provenance, requires_human_approval) VALUES ($1::uuid, 'ticker', $2, $3::numeric, 'sec.gov/files/company_tickers_exchange.json', ($4 = 'NEEDS_HUMAN_REVIEW')) ON CONFLICT (company_id, alias_type, alias_value) DO UPDATE SET confidence = EXCLUDED.confidence, provenance = EXCLUDED.provenance, requires_human_approval = EXCLUDED.requires_human_approval, updated_at = NOW() RETURNING id AS alias_id",
      options: {
        queryReplacement: expr(
          '{{ $("Upsert Company").item.json.company_id }},{{ $("Resolve Edgar Identity").item.json.ticker }},{{ $("Resolve Edgar Identity").item.json.identity_confidence }},{{ $("Resolve Edgar Identity").item.json.outcome }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const upsertLegalNameAlias = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Legal Name Alias',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO company_aliases (company_id, alias_type, alias_value, confidence, provenance, requires_human_approval) VALUES ($1::uuid, 'legal_name', $2, $3::numeric, 'sec.gov/files/company_tickers_exchange.json', ($4 = 'NEEDS_HUMAN_REVIEW')) ON CONFLICT (company_id, alias_type, alias_value) DO UPDATE SET confidence = EXCLUDED.confidence, provenance = EXCLUDED.provenance, requires_human_approval = EXCLUDED.requires_human_approval, updated_at = NOW() RETURNING id AS alias_id",
      options: {
        queryReplacement: expr(
          '{{ $("Upsert Company").item.json.company_id }},{{ $("Resolve Edgar Identity").item.json.legal_name.replaceAll(",", " ") }},{{ $("Resolve Edgar Identity").item.json.identity_confidence }},{{ $("Resolve Edgar Identity").item.json.outcome }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const preparePersistedIdentity = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Persisted Identity',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Resolve Edgar Identity").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Upsert Company").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Upsert Security").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Resolve Edgar Identity").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Resolve Edgar Identity").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Resolve Edgar Identity").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Resolve Edgar Identity").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: expr('{{ $("Resolve Edgar Identity").item.json.identity_confidence }}'),
            type: 'number',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Resolve Edgar Identity").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Resolve Edgar Identity").item.json.next_state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Resolve Edgar Identity").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Resolve Edgar Identity").item.json.provenance }}'),
            type: 'string',
          },
          {
            id: 'reused',
            name: 'reused_existing',
            value: false,
            type: 'boolean',
          },
        ],
      },
    },
  },
});

const linkCaseAndAdvance = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Link Case And Advance',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE research_cases SET company_id = NULLIF($2, '')::uuid, security_id = NULLIF($3, '')::uuid, state = $4, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, company_id, security_id, state, ticker, exchange",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.security_id }},{{ $json.next_state }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logIdentityState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Identity State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'IDENTITY_REVIEW', $2, $3, 'pii-01', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Link Case And Advance").item.json.case_id }},{{ $json.state }},{{ $("Build Identity Fields").item.json.reason }},{{ $("Validate Identity Request").item.json.n8n_execution_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

// Helper Set so both cache and edgar paths expose a stable "Build Identity Fields" node name.
const buildIdentityFieldsFromCache = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Build Identity Fields',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'marker',
            name: 'identity_path',
            value: 'cache_or_edgar',
            type: 'string',
          },
        ],
      },
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-01 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-01', $2, $3, 'SUCCEEDED', $4::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Link Case And Advance").item.json.case_id }},{{ $("Validate Identity Request").item.json.n8n_execution_id }},{{ $("Validate Identity Request").item.json.case_id }},{{ JSON.stringify({ outcome: $("Build Identity Fields").item.json.outcome, identity_confidence: $("Build Identity Fields").item.json.identity_confidence, cik: $("Build Identity Fields").item.json.cik }) }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeAfterLink = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Identity Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Link Case And Advance").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Link Case And Advance").item.json.company_id }}'),
            type: 'string',
          },
          {
            id: 'security-id',
            name: 'security_id',
            value: expr('{{ $("Link Case And Advance").item.json.security_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Build Identity Fields").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Build Identity Fields").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'cik',
            name: 'cik',
            value: expr('{{ $("Build Identity Fields").item.json.cik }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Build Identity Fields").item.json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: expr('{{ $("Build Identity Fields").item.json.identity_confidence }}'),
            type: 'number',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Build Identity Fields").item.json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Link Case And Advance").item.json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Build Identity Fields").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Build Identity Fields").item.json.provenance }}'),
            type: 'string',
          },
          {
            id: 'reused',
            name: 'reused_existing',
            value: expr('{{ $("Build Identity Fields").item.json.reused_existing }}'),
            type: 'boolean',
          },
        ],
      },
    },
  },
});

const buildIdentityResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Identity Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildIdentityResultCode,
    },
  },
});

const unresolvedAdvance = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Advance Unresolved Case',
    parameters: {
      operation: 'executeQuery',
      query:
        "UPDATE research_cases SET state = 'AWAITING_HUMAN_REVIEW', updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, company_id, security_id, state, ticker, exchange",
      options: {
        queryReplacement: expr('{{ $("Resolve Edgar Identity").item.json.case_id }}'),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logUnresolvedState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Unresolved State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'IDENTITY_REVIEW', 'AWAITING_HUMAN_REVIEW', $2, 'pii-01', $3)",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $("Resolve Edgar Identity").item.json.reason }},{{ $("Validate Identity Request").item.json.n8n_execution_id }}',
        ),
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareUnresolvedResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Unresolved Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Resolve Edgar Identity").item.json.case_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Resolve Edgar Identity").item.json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Resolve Edgar Identity").item.json.exchange }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: 'NEEDS_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: 'AWAITING_HUMAN_REVIEW',
            type: 'string',
          },
          {
            id: 'confidence',
            name: 'identity_confidence',
            value: 0,
            type: 'number',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Resolve Edgar Identity").item.json.reason }}'),
            type: 'string',
          },
          {
            id: 'provenance',
            name: 'provenance',
            value: expr('{{ $("Resolve Edgar Identity").item.json.provenance }}'),
            type: 'string',
          },
          {
            id: 'reused',
            name: 'reused_existing',
            value: false,
            type: 'boolean',
          },
        ],
      },
    },
  },
});

const intakeNote = sticky(
  '## PII-01 Identity Resolver\nSubworkflow input: case_id, ticker, exchange\nCache hit → reuse; else SEC company_tickers_exchange.json',
  [identityTrigger, validateIdentityRequest, lookupExistingSecurity],
  { color: 4 },
);

const edgarNote = sticky(
  '## EDGAR path\nRequires User-Agent. Upserts companies, securities, aliases.\nConfidence < 80 → AWAITING_HUMAN_REVIEW (still stores candidate).',
  [fetchEdgarTickers, resolveEdgarIdentity, upsertCompany],
  { color: 5 },
);

const gateNote = sticky(
  '## Gate\nmin_identity_confidence default 80 (config gates_json).\nSuccess → ELIGIBILITY_REVIEW for PII-02.',
  [linkCaseAndAdvance, buildIdentityResult],
  { color: 6 },
);

const finishPath = buildIdentityFieldsFromCache
  .to(linkCaseAndAdvance)
  .to(logIdentityState)
  .to(logWorkflowRun)
  .to(mergeAfterLink)
  .to(buildIdentityResult);

export default workflow('pii-01-identity', 'PII-01 Identity Resolver')
  .add(identityTrigger)
  .to(validateIdentityRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildIdentityResult))
      .onTrue(
        lookupExistingSecurity.to(
          securityAlreadyExists
            .onTrue(prepareCachedIdentity.to(finishPath))
            .onFalse(
              fetchEdgarTickers.to(
                resolveEdgarIdentity.to(
                  edgarResolved
                    .onTrue(
                      upsertCompany
                        .to(upsertSecurity)
                        .to(upsertTickerAlias)
                        .to(upsertLegalNameAlias)
                        .to(preparePersistedIdentity)
                        .to(finishPath),
                    )
                    .onFalse(
                      unresolvedAdvance
                        .to(logUnresolvedState)
                        .to(prepareUnresolvedResult)
                        .to(buildIdentityResult),
                    ),
                ),
              ),
            ),
        ),
      ),
  )
  .add(intakeNote)
  .add(edgarNote)
  .add(gateNote);
