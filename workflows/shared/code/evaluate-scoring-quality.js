// Canonical source for PII-10 "Evaluate Scoring Quality" Code node.
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
  business_quality: 'business_financial',
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

function scoreDomainCategories(category) {
  if (category === 'business_financial' || category === 'financial_business') {
    return ['business_financial', 'financial_business'];
  }
  return [category];
}

function scoreDomain(category) {
  const cats = scoreDomainCategories(category);
  const domainClaims = claimRows.filter((c) => cats.includes(c.claim_category));
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

const cashDebtFact = claimRows.some(
  (c) =>
    (c.topic_key === 'cash_debt' || c.extraction_method === 'deterministic_xbrl_metrics') &&
    !isInsufficientClaim(c),
);
addGate(
  'cash_debt_from_filing',
  !requireCashDebt || cashDebtFact,
  cashDebtFact
    ? 'filing-backed cash/debt claim present'
    : requireCashDebt
      ? 'missing filing-backed cash/debt claim (XBRL/companyfacts)'
      : 'cash_debt gate disabled',
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
