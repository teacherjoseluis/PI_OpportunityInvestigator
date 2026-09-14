import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateScoringRequestCode = `// Canonical source for PII-10 "Validate Scoring Request" Code node.

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
const evaluateScoringQualityCode = `// Canonical source for PII-10 "Evaluate Scoring Quality" Code node.
// Deterministic coverage-aware scores + quality gates from claims/evidence (no LLM).

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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(Number(n) * 100) / 100;
}

function isInsufficientClaim(claim) {
  const method = String(claim.extraction_method || '');
  const text = String(claim.claim_text || '');
  return (
    method === 'deterministic_insufficient_gate' ||
    text.startsWith('INSUFFICIENT_EVIDENCE')
  );
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr));
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

const validated = nodeJson('Validate Scoring Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const scoring =
  analysisRoot.scoring ||
  validated.scoring_config ||
  $input.first().json.scoring_config ||
  {};
const scoresCfg = configRow.scores_json || {};
const freshnessCfg = configRow.freshness_json || {};

const categoryMap = scoring.category_map || {
  business_quality: 'financial_business',
  growth: 'growth_prospects',
  pipeline: 'pipeline_clinical',
  valuation: 'valuation_market',
  risk: 'risk_red_team',
};
const insufficientPenalty = Number(scoring.insufficient_topic_penalty ?? 5);
const maxInsufficientPenalty = Number(scoring.max_insufficient_penalty ?? 40);
const minEvidence = Number(scoring.min_evidence_documents ?? 1);
const weights = scoresCfg.weights || {
  business_quality: 0.4,
  growth: 0.3,
  pipeline: 0.3,
};
const riskPenaltyFactor = Number(scoresCfg.risk_penalty_factor ?? 0.25);
const outcomeThresholds = scoresCfg.outcome_thresholds || {};
const minConfWatchlist = Number(
  scoring.min_evidence_confidence_for_watchlist ??
    outcomeThresholds.min_evidence_confidence_for_watchlist ??
    70,
);
const minPriWatchlist = Number(
  scoring.min_research_priority_for_watchlist ??
    outcomeThresholds.min_research_priority_for_watchlist ??
    60,
);
const minPriHigh = Number(
  scoring.min_research_priority_for_high_conviction ??
    outcomeThresholds.min_research_priority_for_high_conviction ??
    75,
);

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || validated.company_id || null;
const ticker = validated.ticker || caseRow.ticker;
const exchange = validated.exchange || caseRow.exchange;
const legalName = caseRow.legal_name || null;
const configurationVersionId =
  configRow.configuration_version_id || caseRow.configuration_version_id || null;

let evidenceRows = nodeAll('Load Evidence Documents');
if (!evidenceRows.length) {
  const bundled = $input.first().json.evidence_documents;
  if (Array.isArray(bundled)) evidenceRows = bundled;
}

let claimRows = nodeAll('Load Claims');
if (!claimRows.length) {
  const bundled = $input.first().json.claims;
  if (Array.isArray(bundled)) claimRows = bundled;
}

const filings = evidenceRows.filter((row) => row.source_type === 'sec_edgar_filing');
const trials = evidenceRows.filter((row) => row.source_type === 'clinicaltrials_gov');

function scoreDomain(category) {
  const domainClaims = claimRows.filter((c) => c.claim_category === category);
  if (!domainClaims.length) {
    return {
      score: null,
      missing: true,
      structural_count: 0,
      insufficient_count: 0,
      avg_confidence: null,
      notes: 'No active claims in category ' + category,
    };
  }
  const insufficient = domainClaims.filter(isInsufficientClaim);
  const structural = domainClaims.filter((c) => !isInsufficientClaim(c));
  const penalty = Math.min(
    maxInsufficientPenalty,
    insufficient.length * insufficientPenalty,
  );
  let score;
  let avgConfidence = null;
  if (structural.length) {
    const sum = structural.reduce((acc, c) => acc + Number(c.confidence || 0), 0);
    avgConfidence = sum / structural.length;
    score = clamp(avgConfidence - penalty, 0, 100);
  } else {
    score = clamp(25 - penalty * 0.5, 0, 100);
    avgConfidence = null;
  }
  return {
    score: round2(score),
    missing: false,
    structural_count: structural.length,
    insufficient_count: insufficient.length,
    avg_confidence: round2(avgConfidence),
    notes:
      'structural=' +
      structural.length +
      ' insufficient=' +
      insufficient.length +
      ' penalty=' +
      penalty,
  };
}

function scoreRisk(category) {
  const domainClaims = claimRows.filter((c) => c.claim_category === category);
  if (!domainClaims.length) {
    return {
      score: null,
      missing: true,
      structural_count: 0,
      insufficient_count: 0,
      avg_confidence: null,
      notes: 'No risk_red_team claims',
    };
  }
  const insufficient = domainClaims.filter(isInsufficientClaim);
  const structural = domainClaims.filter((c) => !isInsufficientClaim(c));
  let base = 35 + insufficient.length * insufficientPenalty;
  if (structural.length) {
    const sum = structural.reduce((acc, c) => acc + Number(c.confidence || 0), 0);
    const avg = sum / structural.length;
    base += avg * 0.25;
  }
  return {
    score: round2(clamp(base, 0, 100)),
    missing: false,
    structural_count: structural.length,
    insufficient_count: insufficient.length,
    avg_confidence: structural.length
      ? round2(
          structural.reduce((acc, c) => acc + Number(c.confidence || 0), 0) /
            structural.length,
        )
      : null,
    notes:
      'risk structural=' +
      structural.length +
      ' insufficient=' +
      insufficient.length,
  };
}

const bq = scoreDomain(categoryMap.business_quality || 'financial_business');
const growth = scoreDomain(categoryMap.growth || 'growth_prospects');
const pipeline = scoreDomain(categoryMap.pipeline || 'pipeline_clinical');
const valuation = scoreDomain(categoryMap.valuation || 'valuation_market');
const risk = scoreRisk(categoryMap.risk || 'risk_red_team');

const claimsWithLinks = claimRows.filter(
  (c) => Number(c.evidence_link_count || 0) > 0,
).length;
const evidenceConfidence = claimRows.length
  ? round2(
      clamp(
        (claimsWithLinks / claimRows.length) * 70 +
          Math.min(30, evidenceRows.length * 3),
        0,
        100,
      ),
    )
  : evidenceRows.length
    ? 20
    : null;

const dated = evidenceRows
  .map((r) => r.publication_date || (r.metadata_json && r.metadata_json.filingDate))
  .filter(Boolean);
let freshnessScore = null;
if (dated.length) {
  const ages = dated.map(daysSince).filter((n) => n != null);
  if (ages.length) {
    const newestAge = Math.min(...ages);
    const secDays = Number(freshnessCfg.sec_days ?? 120);
    freshnessScore = round2(clamp(100 - (newestAge / secDays) * 50, 0, 100));
  }
}

const bqVal = bq.missing ? 0 : Number(bq.score);
const growthVal = growth.missing ? 0 : Number(growth.score);
const pipelineVal = pipeline.missing ? 0 : Number(pipeline.score);
const riskVal = risk.missing ? 50 : Number(risk.score);
const researchPriority = round2(
  clamp(
    Number(weights.business_quality ?? 0.4) * bqVal +
      Number(weights.growth ?? 0.3) * growthVal +
      Number(weights.pipeline ?? 0.3) * pipelineVal -
      riskPenaltyFactor * riskVal,
    0,
    100,
  ),
);

const components = [
  {
    component_key: 'business_quality_coverage',
    parent_score_key: 'business_quality_score',
    raw_value: bq.avg_confidence,
    normalized_value: bq.score,
    weight: Number(weights.business_quality ?? 0.4),
    contribution: round2(Number(weights.business_quality ?? 0.4) * bqVal),
    missing: bq.missing,
    notes: bq.notes,
  },
  {
    component_key: 'growth_coverage',
    parent_score_key: 'growth_score',
    raw_value: growth.avg_confidence,
    normalized_value: growth.score,
    weight: Number(weights.growth ?? 0.3),
    contribution: round2(Number(weights.growth ?? 0.3) * growthVal),
    missing: growth.missing,
    notes: growth.notes,
  },
  {
    component_key: 'pipeline_coverage',
    parent_score_key: 'pipeline_score',
    raw_value: pipeline.avg_confidence,
    normalized_value: pipeline.score,
    weight: Number(weights.pipeline ?? 0.3),
    contribution: round2(Number(weights.pipeline ?? 0.3) * pipelineVal),
    missing: pipeline.missing,
    notes: pipeline.notes,
  },
  {
    component_key: 'valuation_coverage',
    parent_score_key: 'valuation_context_score',
    raw_value: valuation.avg_confidence,
    normalized_value: valuation.score,
    weight: 0,
    contribution: 0,
    missing: valuation.missing,
    notes: valuation.notes,
  },
  {
    component_key: 'risk_coverage',
    parent_score_key: 'risk_score',
    raw_value: risk.avg_confidence,
    normalized_value: risk.score,
    weight: riskPenaltyFactor,
    contribution: round2(-riskPenaltyFactor * riskVal),
    missing: risk.missing,
    notes: risk.notes,
  },
  {
    component_key: 'evidence_link_coverage',
    parent_score_key: 'evidence_confidence_score',
    raw_value: claimRows.length ? claimsWithLinks / claimRows.length : null,
    normalized_value: evidenceConfidence,
    weight: 1,
    contribution: evidenceConfidence,
    missing: evidenceConfidence == null,
    notes: 'linked_claims=' + claimsWithLinks + '/' + claimRows.length,
  },
  {
    component_key: 'data_freshness',
    parent_score_key: 'data_freshness_score',
    raw_value: dated.length,
    normalized_value: freshnessScore,
    weight: 1,
    contribution: freshnessScore,
    missing: freshnessScore == null,
    notes: 'dated_evidence=' + dated.length,
  },
];

const gateResults = [];
function addGate(key, passed, detail) {
  gateResults.push({ key, passed: Boolean(passed), detail });
}

addGate('identity_company_linked', Boolean(companyId), companyId ? 'company_id present' : 'missing company_id');
addGate(
  'sec_filing_present',
  filings.length > 0,
  'sec_edgar_filing count=' + filings.length,
);

const requireCashDebt =
  scoring.require_cash_debt_from_filing !== false &&
  (gates.require_cash_debt_from_filing !== false);
addGate(
  'cash_debt_from_filing',
  false,
  'Phase 1: XBRL/filing-body cash and debt not collected (PII-03 backlog)',
);

const pipelineClaims = claimRows.filter(
  (c) => c.claim_category === (categoryMap.pipeline || 'pipeline_clinical'),
);
addGate(
  'pipeline_ctgov_reconciled',
  pipelineClaims.length === 0 || trials.length > 0,
  pipelineClaims.length
    ? 'pipeline claims=' + pipelineClaims.length + ' ctgov=' + trials.length
    : 'no pipeline claims',
);

const highClaims = claimRows.filter(
  (c) => String(c.materiality || '').toUpperCase() === 'HIGH',
);
const highUncited = highClaims.filter((c) => Number(c.evidence_link_count || 0) < 1);
addGate(
  'high_materiality_cited',
  highUncited.length === 0,
  'high_claims=' + highClaims.length + ' uncited=' + highUncited.length,
);

const riskClaims = claimRows.filter(
  (c) => c.claim_category === (categoryMap.risk || 'risk_red_team'),
);
const requireRedTeam =
  scoring.require_red_team !== false && gates.require_red_team !== false;
addGate(
  'red_team_completed',
  !requireRedTeam || riskClaims.length > 0,
  'risk_red_team claims=' + riskClaims.length,
);

addGate(
  'schema_valid_report',
  false,
  'Phase 1: report schema validation deferred to PII-11',
);

const requiredFailed = gateResults.filter((g) => !g.passed);
const hardStopZero =
  scoring.hard_stop_zero_evidence !== false && evidenceRows.length < minEvidence;

let hard_stop = false;
let outcome_class;
let next_state;
let reason;
let outcome;

if (hardStopZero) {
  hard_stop = true;
  outcome = 'HARD_STOP';
  outcome_class = 'REASSESS_OR_EXCLUDE';
  next_state = 'AWAITING_HUMAN_REVIEW';
  reason = 'hard_stop_zero_evidence';
} else if (requiredFailed.length) {
  outcome = 'GATES_FAILED';
  outcome_class = 'MONITOR';
  next_state = 'AWAITING_HUMAN_REVIEW';
  reason = 'quality_gates_failed';
} else if (
  Number(evidenceConfidence || 0) >= minConfWatchlist &&
  Number(researchPriority || 0) >= minPriHigh
) {
  outcome = 'SCORED';
  outcome_class = 'HIGH_CONVICTION_RESEARCH';
  next_state = 'COMPLETE';
  reason = 'gates_passed_high_conviction';
} else if (
  Number(evidenceConfidence || 0) >= minConfWatchlist &&
  Number(researchPriority || 0) >= minPriWatchlist
) {
  outcome = 'SCORED';
  outcome_class = 'ACTIVE_WATCHLIST';
  next_state = 'COMPLETE';
  reason = 'gates_passed_watchlist';
} else {
  outcome = 'SCORED';
  outcome_class = 'MONITOR';
  next_state = 'AWAITING_HUMAN_REVIEW';
  reason = 'gates_passed_low_priority';
}

const scores = {
  business_quality_score: bq.score,
  growth_score: growth.score,
  pipeline_score: pipeline.score,
  valuation_context_score: valuation.score,
  risk_score: risk.score,
  evidence_confidence_score: evidenceConfidence,
  data_freshness_score: freshnessScore,
  research_priority_score: researchPriority,
  outcome_class,
  hard_stop,
};

const summary = {
  outcome,
  next_state,
  reason,
  outcome_class,
  hard_stop,
  scores,
  gates_failed: requiredFailed.map((g) => g.key),
  gate_count: gateResults.length,
  claim_count: claimRows.length,
  evidence_count: evidenceRows.length,
};
const metadata_b64 = Buffer.from(JSON.stringify(summary), 'utf8').toString('base64');

// SQL-safe scalar strings (avoid commas breaking n8n queryReplacement)
function sqlNum(n) {
  if (n == null || n === '' || n === 'null' || Number.isNaN(n)) return '';
  return String(n);
}

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      ticker,
      exchange,
      legal_name: legalName,
      configuration_version_id: configurationVersionId || '',
      outcome,
      next_state,
      reason,
      outcome_class,
      hard_stop,
      scores,
      components,
      gate_results: gateResults,
      gates_failed: requiredFailed.map((g) => g.key),
      claim_count: claimRows.length,
      counts: {
        evidence_count: evidenceRows.length,
        filings_count: filings.length,
        trials_count: trials.length,
        claim_count: claimRows.length,
        component_count: components.length,
        gates_failed_count: requiredFailed.length,
      },
      // Flattened for Postgres upsert queryReplacement
      business_quality_score: sqlNum(scores.business_quality_score),
      growth_score: sqlNum(scores.growth_score),
      pipeline_score: sqlNum(scores.pipeline_score),
      valuation_context_score: sqlNum(scores.valuation_context_score),
      risk_score: sqlNum(scores.risk_score),
      evidence_confidence_score: sqlNum(scores.evidence_confidence_score),
      data_freshness_score: sqlNum(scores.data_freshness_score),
      research_priority_score: sqlNum(scores.research_priority_score),
      hard_stop_sql: hard_stop ? 'true' : 'false',
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
`;
const attachScoreIdCode = `// Attach score_id from Upsert Scores onto Evaluate Scoring Quality payload for component expand.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Scoring Quality') || {};
const upserted = $input.first().json || {};

return [
  {
    json: {
      ...evaluated,
      score_id: upserted.score_id || evaluated.score_id || null,
    },
  },
];
`;
const expandScoreComponentsCode = `// Expand Evaluate Scoring Quality components[] into one item per score_component upsert.

const item = $input.first().json || {};
const components = Array.isArray(item.components) ? item.components : [];
const scoreId = item.score_id;

if (!scoreId || !components.length) {
  return [
    {
      json: {
        skip_component: true,
        score_id: scoreId || null,
        case_id: item.case_id,
        component_count: 0,
      },
    },
  ];
}

return components.map((comp, index) => ({
  json: {
    skip_component: false,
    score_id: scoreId,
    case_id: item.case_id,
    component_index: index,
    component_key: String(comp.component_key || 'component_' + index).replaceAll(',', ' '),
    parent_score_key: String(comp.parent_score_key || 'unknown').replaceAll(',', ' '),
    raw_value: comp.raw_value == null ? '' : String(comp.raw_value),
    normalized_value: comp.normalized_value == null ? '' : String(comp.normalized_value),
    weight: comp.weight == null ? '' : String(comp.weight),
    contribution: comp.contribution == null ? '' : String(comp.contribution),
    missing_sql: comp.missing ? 'true' : 'false',
    notes: String(comp.notes || '').replaceAll(',', ' '),
  },
}));
`;
const prepareScoringAggregateCode = `// Prepare aggregate after score upsert (+ optional components).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Scoring Quality') || $input.first().json || {};
let scoreId = null;
try {
  scoreId = $('Upsert Scores').first().json.score_id || null;
} catch {
  scoreId = evaluated.score_id || null;
}

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name,
      configuration_version_id: evaluated.configuration_version_id,
      outcome: evaluated.outcome || 'FAILED',
      next_state: evaluated.next_state || 'INCOMPLETE',
      reason: evaluated.reason || null,
      outcome_class: evaluated.outcome_class || null,
      hard_stop: evaluated.hard_stop === true,
      score_id: scoreId,
      scores: evaluated.scores || {},
      components: evaluated.components || [],
      gate_results: evaluated.gate_results || [],
      gates_failed: evaluated.gates_failed || [],
      claim_count: Number(evaluated.claim_count || 0),
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
      n8n_execution_id: evaluated.n8n_execution_id || null,
    },
  },
];
`;
const buildScoringResultCode = `// Canonical source for PII-10 "Build Scoring Result" Code node.

const item = $input.first().json || {};

let gates_failed = item.gates_failed;
if (typeof gates_failed === 'string') {
  try {
    gates_failed = JSON.parse(gates_failed);
  } catch {
    gates_failed = [];
  }
}
if (!Array.isArray(gates_failed)) gates_failed = [];

const scores = item.scores && typeof item.scores === 'object' ? item.scores : {};
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
      outcome_class: item.outcome_class || null,
      hard_stop: item.hard_stop === true || item.hard_stop === 'true',
      score_id: item.score_id || null,
      scores,
      gates_failed,
      claim_count: Number(item.claim_count || counts.claim_count || 0),
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
`;

const scoringTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Scoring Gate Trigger',
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

const validateScoringRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Scoring Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateScoringRequestCode,
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
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: 'REASSESS_OR_EXCLUDE',
            type: 'string',
          },
          { id: 'claim-count', name: 'claim_count', value: 0, type: 'number' },
          {
            id: 'gates-failed',
            name: 'gates_failed',
            value: expr('{{ [] }}'),
            type: 'array',
          },
          { id: 'scores', name: 'scores', value: expr('{{ ({}) }}'), type: 'object' },
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
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, rc.configuration_version_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Scoring Request").item.json.case_id }}'),
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
        queryReplacement: expr('{{ $("Validate Scoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadClaims = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Claims',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT c.id, c.claim_category, c.claim_text, c.claim_kind, c.confidence, c.materiality, c.extraction_method, c.model_version, COALESCE((SELECT COUNT(*)::int FROM claim_evidence_links cel WHERE cel.claim_id = c.id), 0) AS evidence_link_count FROM claims c WHERE c.case_id = $1::uuid AND c.is_active = TRUE ORDER BY c.created_at ASC",
      options: {
        queryReplacement: expr('{{ $("Validate Scoring Request").item.json.case_id }}'),
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
        'SELECT id AS configuration_version_id, version_label, gates_json, scores_json, freshness_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
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

const evaluateScoringQuality = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Scoring Quality',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateScoringQualityCode,
    },
  },
});

const upsertScores = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Scores',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO scores (case_id, configuration_version_id, business_quality_score, growth_score, pipeline_score, valuation_context_score, risk_score, evidence_confidence_score, data_freshness_score, research_priority_score, outcome_class, hard_stop) VALUES ($1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, NULLIF(NULLIF(TRIM($3), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($4), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($5), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($6), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($7), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($8), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($9), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($10), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($11), ''), 'null'), (NULLIF(TRIM($12), '') = 'true')) ON CONFLICT (case_id) DO UPDATE SET configuration_version_id = EXCLUDED.configuration_version_id, business_quality_score = EXCLUDED.business_quality_score, growth_score = EXCLUDED.growth_score, pipeline_score = EXCLUDED.pipeline_score, valuation_context_score = EXCLUDED.valuation_context_score, risk_score = EXCLUDED.risk_score, evidence_confidence_score = EXCLUDED.evidence_confidence_score, data_freshness_score = EXCLUDED.data_freshness_score, research_priority_score = EXCLUDED.research_priority_score, outcome_class = EXCLUDED.outcome_class, hard_stop = EXCLUDED.hard_stop, updated_at = NOW() RETURNING id AS score_id, case_id",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.configuration_version_id }},{{ $json.business_quality_score }},{{ $json.growth_score }},{{ $json.pipeline_score }},{{ $json.valuation_context_score }},{{ $json.risk_score }},{{ $json.evidence_confidence_score }},{{ $json.data_freshness_score }},{{ $json.research_priority_score }},{{ $json.outcome_class }},{{ $json.hard_stop_sql }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const attachScoreId = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Attach Score Id',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: attachScoreIdCode,
    },
  },
});

const deleteScoreComponents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Delete Score Components',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query: 'DELETE FROM score_components WHERE score_id = $1::uuid',
      options: {
        queryReplacement: expr('{{ $json.score_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const reattachAfterDelete = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore Scoring Payload',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}
const attached = nodeJson('Attach Score Id') || {};
return [{ json: attached }];
`,
    },
  },
});

const expandScoreComponents = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Expand Score Components',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: expandScoreComponentsCode,
    },
  },
});

const hasComponents = ifElse({
  version: 2.3,
  config: {
    name: 'Has Score Components?',
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
            leftValue: expr('{{ $json.skip_component }}'),
            operator: { type: 'boolean', operation: 'false', singleValue: true },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertScoreComponents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Score Components',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO score_components (score_id, component_key, parent_score_key, raw_value, normalized_value, weight, contribution, missing, notes) VALUES ($1::uuid, $2, $3, NULLIF(NULLIF(TRIM($4), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($5), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($6), ''), 'null')::numeric, NULLIF(NULLIF(TRIM($7), ''), 'null')::numeric, (NULLIF(TRIM($8), '') = 'true'), NULLIF(NULLIF(TRIM($9), ''), 'null')) ON CONFLICT (score_id, component_key) DO UPDATE SET raw_value = EXCLUDED.raw_value, normalized_value = EXCLUDED.normalized_value, weight = EXCLUDED.weight, contribution = EXCLUDED.contribution, missing = EXCLUDED.missing, notes = EXCLUDED.notes RETURNING id AS component_id",
      options: {
        queryReplacement: expr(
          '{{ $json.score_id }},{{ $json.component_key }},{{ $json.parent_score_key }},{{ $json.raw_value }},{{ $json.normalized_value }},{{ $json.weight }},{{ $json.contribution }},{{ $json.missing_sql }},{{ $json.notes }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareScoringAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Scoring Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareScoringAggregateCode,
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
        'UPDATE research_cases SET state = $2, outcome_class = $3, updated_at = NOW() WHERE id = $1::uuid RETURNING id AS case_id, state, outcome_class, company_id, security_id, ticker, exchange',
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.next_state }},{{ $json.outcome_class }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const logScoringState = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log Scoring State',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO case_state_history (case_id, from_state, to_state, reason, actor, workflow_execution_id) VALUES ($1::uuid, 'ANALYZING', $2, $3, 'pii-10', $4)",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Advance Case State").first().json.state }},{{ $("Evaluate Scoring Quality").first().json.reason }},{{ $("Evaluate Scoring Quality").first().json.n8n_execution_id }}',
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
    name: 'Log PII-10 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-10', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Scoring Quality").first().json.n8n_execution_id }},{{ $("Advance Case State").first().json.case_id }},{{ $("Evaluate Scoring Quality").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeScoringOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Scoring Output',
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
            value: expr('{{ $("Evaluate Scoring Quality").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.outcome }}'),
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
            value: expr('{{ $("Evaluate Scoring Quality").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: expr('{{ $("Advance Case State").first().json.outcome_class }}'),
            type: 'string',
          },
          {
            id: 'hard-stop',
            name: 'hard_stop',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.hard_stop }}'),
            type: 'boolean',
          },
          {
            id: 'score-id',
            name: 'score_id',
            value: expr('{{ $("Upsert Scores").first().json.score_id }}'),
            type: 'string',
          },
          {
            id: 'scores',
            name: 'scores',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.scores }}'),
            type: 'object',
          },
          {
            id: 'gates-failed',
            name: 'gates_failed',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.gates_failed }}'),
            type: 'array',
          },
          {
            id: 'claim-count',
            name: 'claim_count',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.claim_count }}'),
            type: 'number',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Evaluate Scoring Quality").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildScoringResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Scoring Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildScoringResultCode,
    },
  },
});

const intakeNote = sticky(
  '## PII-10 Scoring Gate\nPhase 1: coverage-aware scores from claims/evidence.\nNo LLM arithmetic. Quality gates fail honestly without XBRL/report.',
  [scoringTrigger, validateScoringRequest, loadClaims],
  { color: 4 },
);

const scoresNote = sticky(
  '## Persistence\nUpsert scores + score_components.\nSet research_cases.outcome_class.',
  [evaluateScoringQuality, upsertScores, insertScoreComponents],
  { color: 5 },
);

const stateNote = sticky(
  '## State\nExpected Phase 1: AWAITING_HUMAN_REVIEW + MONITOR.\nCOMPLETE only if all gates pass (rare until PII-03/PII-11).',
  [advanceCaseState, buildScoringResult],
  { color: 6 },
);

const finishPath = advanceCaseState
  .to(logScoringState)
  .to(logWorkflowRun)
  .to(mergeScoringOutput)
  .to(buildScoringResult);

const afterComponentsPath = hasComponents
  .onTrue(insertScoreComponents.to(prepareScoringAggregate.to(finishPath)))
  .onFalse(prepareScoringAggregate.to(finishPath));

export default workflow('pii-10-scoring', 'PII-10 Scoring and Quality Gate')
  .add(scoringTrigger)
  .to(validateScoringRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildScoringResult))
      .onTrue(
        loadCaseAndCompany.to(
          loadEvidenceDocuments.to(
            loadClaims.to(
              loadAnalysisConfig.to(
                evaluateScoringQuality.to(
                  upsertScores.to(
                    attachScoreId.to(
                      deleteScoreComponents.to(
                        reattachAfterDelete.to(
                          expandScoreComponents.to(afterComponentsPath),
                        ),
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
  .add(scoresNote)
  .add(stateNote);
