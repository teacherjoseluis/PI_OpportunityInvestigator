import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateFinancialRequestCode = `// Canonical source for PII-04 "Validate Financial Request" Code node.

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
        outcome: 'FAILED',
        next_state: 'INCOMPLETE',
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
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const evaluateFinancialBusinessCode = `// Canonical source for PII-04 "Evaluate Financial Business" Code node.
// Builds deterministic claims from SEC/CT.gov evidence metadata only.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function nodeAll(name) {
  try {
    return $(name).all().map((row) => row.json);
  } catch {
    return [];
  }
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function formMatches(form, watched) {
  const f = String(form || '').toUpperCase();
  return watched.some((w) => f === String(w).toUpperCase() || f.startsWith(String(w).toUpperCase()));
}

const validated = nodeJson('Validate Financial Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const financial =
  analysisRoot.financial ||
  validated.financial_config ||
  $input.first().json.financial_config ||
  {};

const watchedForms = Array.isArray(financial.watched_forms)
  ? financial.watched_forms
  : ['10-K', '10-Q', '8-K', 'S-3', '424B'];
const minSecFilings = Number(financial.min_sec_filings ?? 1);
const minStructural = Number(financial.min_structural_claims ?? 1);
const claimCategory = financial.claim_category || 'business_financial';
const insufficientTopics = Array.isArray(financial.insufficient_topics)
  ? financial.insufficient_topics
  : [];

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const ticker = validated.ticker || caseRow.ticker;
const exchange = validated.exchange || caseRow.exchange;
const legalName = caseRow.legal_name || null;

let evidenceRows = nodeAll('Load Evidence Documents');
if (!evidenceRows.length) {
  const bundled = $input.first().json.evidence_documents;
  if (Array.isArray(bundled)) evidenceRows = bundled;
}

const filings = evidenceRows.filter((row) => row.source_type === 'sec_edgar_filing');
const submissions = evidenceRows.filter((row) => row.source_type === 'sec_edgar_submissions');
const trials = evidenceRows.filter((row) => row.source_type === 'clinicaltrials_gov');
const companyfactsDocs = evidenceRows.filter((row) => row.source_type === 'sec_companyfacts');

let metricRows = nodeAll('Load Financial Metrics');
if (!metricRows.length) {
  const bundledMetrics = $input.first().json.financial_metrics;
  if (Array.isArray(bundledMetrics)) metricRows = bundledMetrics;
}

function metricMap(rows) {
  const map = {};
  for (const row of rows) {
    const key = String(row.metric_key || '');
    if (!key) continue;
    const val = row.metric_value == null || row.metric_value === '' ? null : Number(row.metric_value);
    if (val == null || Number.isNaN(val)) continue;
    map[key] = {
      value: val,
      currency: row.currency || 'USD',
      period_label: row.period_label || null,
      period_end: row.period_end || null,
      source_evidence_id: row.source_evidence_id || null,
    };
  }
  return map;
}

const metrics = metricMap(metricRows);
const hasCashDebtMetrics = Boolean(
  metrics.cash_and_equivalents ||
    metrics.marketable_securities_current ||
    metrics.liquid_assets ||
    metrics.total_debt ||
    metrics.net_cash ||
    metrics.short_term_debt ||
    metrics.long_term_debt,
);

const claims = [];
const formSeen = new Map();

for (const filing of filings) {
  const meta = parseMeta(filing.metadata_json);
  const form = meta.form || '';
  if (!formMatches(form, watchedForms)) continue;
  const key = String(form).toUpperCase();
  if (formSeen.has(key)) continue;
  formSeen.set(key, filing.id);
  claims.push({
    topic_key: 'filing_form_' + key.replace(/[^A-Z0-9]/g, '_'),
    claim_text:
      'Recent SEC filing index includes form ' +
      form +
      (meta.filingDate ? ' dated ' + meta.filingDate : '') +
      (meta.accessionNumber ? ' (accession ' + meta.accessionNumber + ')' : '') +
      '.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 90,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: [filing.id].filter(Boolean),
  });
}

if (submissions.length) {
  const sub = submissions[0];
  const meta = parseMeta(sub.metadata_json);
  claims.push({
    topic_key: 'sec_submissions_summary',
    claim_text:
      'SEC submissions index available for ' +
      (meta.name || legalName || ticker) +
      ' with ' +
      Number(meta.recent_filing_count || filings.length) +
      ' recent filings indexed (metadata only).',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 85,
    materiality: 'LOW',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: [sub.id].filter(Boolean),
  });
}

if (trials.length) {
  let phase3 = 0;
  let recruiting = 0;
  for (const trial of trials) {
    const meta = parseMeta(trial.metadata_json);
    const phases = meta.phases || [];
    if (phases.some((p) => String(p).toUpperCase().includes('PHASE3') || String(p) === '3')) {
      phase3 += 1;
    }
    if (String(meta.overallStatus || '').toUpperCase() === 'RECRUITING') recruiting += 1;
  }
  claims.push({
    topic_key: 'pipeline_presence_inference',
    claim_text:
      'ClinicalTrials.gov metadata shows ' +
      trials.length +
      ' linked studies (' +
      phase3 +
      ' Phase 3 tagged; ' +
      recruiting +
      ' recruiting). Suggests pipeline activity; commercial revenue status remains unproven without financial statements.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 55,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_ctgov_metadata',
    evidence_ids: trials.map((t) => t.id).filter(Boolean).slice(0, 5),
  });
}

const offeringForms = [...formSeen.keys()].filter(
  (f) => f.includes('S-3') || f.includes('424B') || f.includes('S-1'),
);
if (offeringForms.length) {
  const evidenceIds = offeringForms.map((f) => formSeen.get(f)).filter(Boolean);
  claims.push({
    topic_key: 'offering_forms_present',
    claim_text:
      'Recent filing mix includes capital-markets forms (' +
      offeringForms.join(', ') +
      '); dilution risk should be reviewed when full prospectus/XBRL data is available.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 60,
    materiality: 'HIGH',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: evidenceIds,
  });
}

const resolvedInsufficient = new Set();
if (hasCashDebtMetrics) {
  const cash = metrics.cash_and_equivalents;
  const mkt = metrics.marketable_securities_current;
  const liquid = metrics.liquid_assets;
  const debt = metrics.total_debt;
  const net = metrics.net_cash;
  const periodEnd =
    (cash && cash.period_end) ||
    (liquid && liquid.period_end) ||
    (debt && debt.period_end) ||
    (net && net.period_end) ||
    null;
  const evidenceIds = [
    ...companyfactsDocs.map((d) => d.id),
    cash && cash.source_evidence_id,
    debt && debt.source_evidence_id,
    net && net.source_evidence_id,
  ].filter(Boolean);
  const uniqueEvidence = [...new Set(evidenceIds)].slice(0, 5);

  function fmtUsd(n) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  const parts = [];
  if (cash) parts.push('cash and equivalents ' + fmtUsd(cash.value) + ' USD');
  if (mkt) parts.push('current marketable securities ' + fmtUsd(mkt.value) + ' USD');
  if (liquid && !cash) parts.push('liquid assets ' + fmtUsd(liquid.value) + ' USD');
  if (debt) parts.push('total debt ' + fmtUsd(debt.value) + ' USD');
  if (net) parts.push('net cash ' + fmtUsd(net.value) + ' USD');

  claims.push({
    topic_key: 'cash_debt',
    claim_text:
      'SEC XBRL companyfacts (period end ' +
      (periodEnd || 'unknown') +
      '): ' +
      parts.join('; ') +
      '.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 88,
    materiality: 'HIGH',
    extraction_method: 'deterministic_xbrl_metrics',
    evidence_ids: uniqueEvidence,
  });
  resolvedInsufficient.add('cash_debt');
}

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  if (resolvedInsufficient.has(key)) continue;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires full SEC body/XBRL (PII-03 circle-back).';
  insufficient_topics.push(key);
  const linkIds = filings
    .slice(0, 2)
    .map((f) => f.id)
    .filter(Boolean);
  claims.push({
    topic_key: 'insufficient_' + key,
    claim_text: text,
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 95,
    materiality: 'HIGH',
    extraction_method: 'deterministic_insufficient_gate',
    evidence_ids: linkIds,
  });
}

const structuralCount = claims.filter(
  (c) => c.claim_kind === 'fact' || c.topic_key === 'pipeline_presence_inference',
).length;

let outcome;
let next_state;
let reason;

if (!evidenceRows.length || filings.length < minSecFilings) {
  outcome = 'INSUFFICIENT';
  next_state = 'ANALYZING';
  reason = 'insufficient_evidence_base';
} else if (structuralCount >= minStructural) {
  outcome = 'ANALYZED';
  next_state = 'ANALYZING';
  reason = 'metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_structural_claims';
}

const summary = {
  outcome,
  next_state,
  reason,
  claim_count: claims.length,
  structural_claim_count: structuralCount,
  insufficient_topics,
  filings_count: filings.length,
  trials_count: trials.length,
};
const metadata_b64 = Buffer.from(JSON.stringify(summary), 'utf8').toString('base64');

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      ticker,
      exchange,
      legal_name: legalName,
      outcome,
      next_state,
      reason,
      claims,
      claim_count: claims.length,
      insufficient_topics,
      counts: {
        filings_count: filings.length,
        trials_count: trials.length,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
`;
const expandFinancialClaimsCode = `// Expand Evaluate Financial Business claims[] into one item per claim upsert.

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
    claim_category: claim.claim_category || 'business_financial',
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
`;
const expandClaimEvidenceLinksCode = `// After claim inserts, expand claim_evidence_links rows.

function nodeAll(name) {
  try {
    return $(name).all();
  } catch {
    return [];
  }
}

const inserted = $input.all().filter((row) => row.json && row.json.claim_id);
const expanded = nodeAll('Expand Financial Claims').filter(
  (row) => row.json && row.json.skip_upsert !== true,
);

const links = [];

for (let i = 0; i < inserted.length; i += 1) {
  const claimId = inserted[i].json.claim_id;
  const source =
    expanded.find((row) => row.json.claim_text === inserted[i].json.claim_text) ||
    expanded[i] ||
    null;
  const evidenceIds = source
    ? Array.isArray(source.json.evidence_ids)
      ? source.json.evidence_ids
      : String(source.json.evidence_ids_csv || '')
          .split('|')
          .filter(Boolean)
    : [];

  for (const evidenceId of evidenceIds) {
    links.push({
      json: {
        claim_id: claimId,
        evidence_id: evidenceId,
        link_role: 'SUPPORTS',
        skip_link: false,
      },
    });
  }
}

if (!links.length) {
  const evalRow = (() => {
    try {
      return $('Evaluate Financial Business').first().json;
    } catch {
      return $input.first().json || {};
    }
  })();
  return [
    {
      json: {
        skip_link: true,
        case_id: evalRow.case_id,
        claim_count: Number(evalRow.claim_count || inserted.length || 0),
        outcome: evalRow.outcome,
        next_state: evalRow.next_state,
        reason: evalRow.reason,
        insufficient_topics: evalRow.insufficient_topics || [],
        counts: evalRow.counts || {},
        metadata_b64: evalRow.metadata_b64 || '',
        ticker: evalRow.ticker,
        exchange: evalRow.exchange,
        company_id: evalRow.company_id,
        n8n_execution_id: evalRow.n8n_execution_id,
      },
    },
  ];
}

return links;
`;
const prepareFinancialAggregateCode = `// Prepare aggregate after claim/link upserts for coverage advance.

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
`;
const buildFinancialResultCode = `// Canonical source for PII-04 "Build Financial Result" Code node.

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
`;

const financialTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Financial Analyst Trigger',
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
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateFinancialRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Financial Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateFinancialRequestCode,
    },
  },
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
          { id: 'outcome', name: 'outcome', value: 'FAILED', type: 'string' },
          { id: 'next-state', name: 'next_state', value: 'INCOMPLETE', type: 'string' },
          { id: 'reason', name: 'reason', value: 'validation_failed', type: 'string' },
          { id: 'claim-count', name: 'claim_count', value: 0, type: 'number' },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ [] }}'),
            type: 'array',
          },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Financial Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadEvidenceDocuments = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Evidence Documents',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id, source_type, publisher, stable_source_id, title, publication_date, metadata_json FROM evidence_documents WHERE case_id = $1::uuid ORDER BY created_at ASC',
      options: {
        queryReplacement: expr('{{ $("Validate Financial Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadFinancialMetrics = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Financial Metrics',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT fm.metric_key, fm.metric_value, fm.currency, fm.unit, fm.assumption_set, fm.source_evidence_id, fm.calculation_notes, fp.period_label, fp.period_end, fp.period_start, fp.fiscal_year, fp.fiscal_quarter FROM financial_metrics fm JOIN financial_periods fp ON fp.id = fm.financial_period_id WHERE fp.case_id = $1::uuid OR fp.company_id = NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid ORDER BY fp.period_end DESC NULLS LAST, fm.metric_key ASC",
      options: {
        queryReplacement: expr(
          '{{ $("Validate Financial Request").item.json.case_id }},{{ $("Load Case And Company").item.json.company_id }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadAnalysisConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Analysis Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, gates_json, scores_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const evaluateFinancialBusiness = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Financial Business',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateFinancialBusinessCode,
    },
  },
});

const expandFinancialClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Financial Claims',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandFinancialClaimsCode,
    },
  },
});

const hasClaims = ifElse({
  version: 2.3,
  config: {
    name: 'Has Claims?',
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
            leftValue: expr('{{ $json.skip_upsert }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertFinancialClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Financial Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claims (case_id, claim_text, claim_category, claim_kind, confidence, materiality, extraction_method, model_version, is_active) VALUES ($1::uuid, $2, $3, $4, $5::numeric, $6, $7, 'pii-04-v1', TRUE) RETURNING id AS claim_id, case_id, claim_text",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.claim_text }},{{ $json.claim_category }},{{ $json.claim_kind }},{{ $json.confidence }},{{ $json.materiality }},{{ $json.extraction_method }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const expandClaimEvidenceLinks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Claim Evidence Links',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandClaimEvidenceLinksCode,
    },
  },
});

const hasLinks = ifElse({
  version: 2.3,
  config: {
    name: 'Has Claim Links?',
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
            leftValue: expr('{{ $json.skip_link }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertClaimEvidenceLinks = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Claim Evidence Links',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO claim_evidence_links (claim_id, evidence_id, link_role) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (claim_id, evidence_id, link_role) DO NOTHING RETURNING id AS link_id",
      options: {
        queryReplacement: expr(
          '{{ $json.claim_id }},{{ $json.evidence_id }},{{ $json.link_role }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareFinancialAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Financial Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareFinancialAggregateCode,
    },
  },
});

const prepareZeroClaims = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Zero Claims Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareFinancialAggregateCode,
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
        'UPDATE research_cases SET state = $2, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr('{{ $json.case_id }},{{ $json.next_state }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logFinancialState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Financial State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ANALYZING', $2, $3, 'pii-04', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Evaluate Financial Business").first().json.reason }},{{ $("Evaluate Financial Business").first().json.n8n_execution_id }}',
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
    name: 'Log PII-04 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-04', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Financial Business").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Financial Business").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeFinancialOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Financial Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Advance Case State").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Evaluate Financial Business").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Financial Business").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Financial Business").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Financial Business").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Financial Business").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Advance Case State").first().json.state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Evaluate Financial Business").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Evaluate Financial Business").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'topics',
            name: 'insufficient_topics',
            value: expr('{{ $("Evaluate Financial Business").first().json.insufficient_topics }}'),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Financial Business").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildFinancialResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Financial Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildFinancialResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-04 Financial Analyst\nDeterministic claims from SEC/CT.gov metadata + Slice E1 XBRL cash/debt metrics.\nNo LLM. No invented cash/runway numbers.',
  [financialTrigger, validateFinancialRequest, loadEvidenceDocuments],
  { color: 4 },
);

const claimsNote = sticky(
  '## Claims\nPersist claims + claim_evidence_links.\nCash/debt facts when financial_metrics present; else INSUFFICIENT_EVIDENCE.',
  [evaluateFinancialBusiness, insertFinancialClaims, insertClaimEvidenceLinks],
  { color: 5 },
);

const stateNote = sticky(
  '## State\nStay in ANALYZING for later analysts.\nHard failure only → INCOMPLETE.',
  [advanceCaseState, buildFinancialResult],
  { color: 6 },
);

const finishPath = advanceCaseState
  .to(logFinancialState)
  .to(logWorkflowRun)
  .to(mergeFinancialOutput)
  .to(buildFinancialResult);

const afterClaimsPath = expandClaimEvidenceLinks.to(
  hasLinks
    .onTrue(insertClaimEvidenceLinks.to(prepareFinancialAggregate.to(finishPath)))
    .onFalse(prepareFinancialAggregate.to(finishPath)),
);

export default workflow('pii-04-financial', 'PII-04 Financial and Business Analyst')
  .add(financialTrigger)
  .to(validateFinancialRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildFinancialResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadEvidenceDocuments.to(
            loadFinancialMetrics.to(
              loadAnalysisConfig.to(
                evaluateFinancialBusiness.to(
                  expandFinancialClaims.to(
                    hasClaims
                      .onTrue(insertFinancialClaims.to(afterClaimsPath))
                      .onFalse(prepareZeroClaims.to(finishPath)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
  )
  .add(intakeNote)
  .add(claimsNote)
  .add(stateNote);
