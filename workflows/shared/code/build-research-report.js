// Canonical source for PII-11 "Build Research Report" Code node.
// Deterministic JSON + Markdown assembly from claims/scores/evidence (no LLM).

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

function isInsufficientClaim(claim) {
  const method = String(claim.extraction_method || '');
  const text = String(claim.claim_text || '');
  return (
    method === 'deterministic_insufficient_gate' ||
    text.startsWith('INSUFFICIENT_EVIDENCE')
  );
}

function sortClaims(claims) {
  return [...claims].sort((a, b) => {
    const ma = Number(a.materiality || 0);
    const mb = Number(b.materiality || 0);
    if (mb !== ma) return mb - ma;
    const ca = Number(a.confidence || 0);
    const cb = Number(b.confidence || 0);
    return cb - ca;
  });
}

function pickClaims(claims, limit) {
  const sorted = sortClaims(claims);
  const sufficient = sorted.filter((c) => !isInsufficientClaim(c));
  const insufficient = sorted.filter((c) => isInsufficientClaim(c));
  const picked = sufficient.slice(0, limit);
  const remaining = Math.max(0, limit - picked.length);
  return {
    claims: picked.concat(insufficient.slice(0, remaining)).map(summarizeClaim),
    insufficient_topics: insufficient.map((c) => String(c.claim_text || '').slice(0, 200)),
    total: claims.length,
    shown: Math.min(claims.length, limit),
  };
}

function summarizeClaim(claim) {
  return {
    claim_id: claim.id || null,
    text: String(claim.claim_text || '').slice(0, 500),
    kind: claim.claim_kind || null,
    confidence: claim.confidence == null ? null : Number(claim.confidence),
    materiality: claim.materiality == null ? null : Number(claim.materiality),
    evidence_link_count: Number(claim.evidence_link_count || 0),
    insufficient: isInsufficientClaim(claim),
  };
}

function sectionClaims(claimRows, category, limit) {
  const rows = claimRows.filter((c) => c.claim_category === category);
  return pickClaims(rows, limit);
}

function strongestClaim(claimRows, predicate) {
  const sorted = sortClaims(claimRows.filter(predicate));
  return sorted.length ? summarizeClaim(sorted[0]) : null;
}

function escapeMd(text) {
  return String(text || '').replace(/\r/g, '');
}

function renderMarkdown(report) {
  const lines = [];
  const meta = report.case_metadata || {};
  const outcome = report.outcome || {};
  const brief = report.executive_brief || {};
  const scores = report.scores || {};
  const method = report.methodology_limitations_disclaimer || {};

  lines.push(`# Pharma Investment Opportunity Investigator — ${meta.ticker || 'UNKNOWN'}`);
  lines.push('');
  lines.push(`**As of:** ${meta.as_of || 'UNKNOWN'}`);
  lines.push(`**Case ID:** ${meta.case_id || ''}`);
  lines.push(`**Company:** ${meta.legal_name || meta.ticker || ''}`);
  lines.push(`**Exchange:** ${meta.exchange || ''}`);
  lines.push(`**Outcome:** ${outcome.class || 'UNKNOWN'}`);
  lines.push(`**Publication ready:** ${report.publication_ready ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Executive research brief');
  lines.push('');
  lines.push(`- **Why now:** ${brief.why_now || 'n/a'}`);
  lines.push(`- **Strongest supporting evidence:** ${brief.strongest_for || 'n/a'}`);
  lines.push(`- **Strongest opposing evidence:** ${brief.strongest_against || 'n/a'}`);
  lines.push(`- **What would change the conclusion:** ${brief.thesis_changers || 'n/a'}`);
  lines.push(`- **Monitor next:** ${brief.monitor_next || 'n/a'}`);
  lines.push('');
  lines.push('## Research outcome');
  lines.push('');
  lines.push(escapeMd(outcome.explanation || ''));
  if (Array.isArray(outcome.rules) && outcome.rules.length) {
    lines.push('');
    lines.push('Rules:');
    for (const rule of outcome.rules) {
      lines.push(`- ${rule}`);
    }
  }
  lines.push('');
  lines.push('## What changed since prior case');
  lines.push('');
  lines.push(escapeMd((report.what_changed && report.what_changed.summary) || 'No prior report.'));
  lines.push('');
  lines.push('## Identity');
  lines.push('');
  const identity = report.identity || {};
  lines.push(`- Legal name: ${identity.legal_name || 'n/a'}`);
  lines.push(`- CIK: ${identity.cik || 'n/a'}`);
  lines.push(`- Ticker / exchange: ${identity.ticker || ''} / ${identity.exchange || ''}`);
  lines.push('');

  const sectionOrder = [
    ['business_financial', 'Business and financial quality'],
    ['growth', 'Growth prospects'],
    ['pipeline', 'Pipeline and clinical evidence'],
    ['regulatory_catalysts', 'Regulatory status and catalyst calendar'],
    ['valuation_market', 'Valuation and market context'],
    ['risks', 'Material risks and thesis-breaking conditions'],
  ];
  for (const [key, title] of sectionOrder) {
    const section = report[key] || {};
    lines.push(`## ${title}`);
    lines.push('');
    const claims = Array.isArray(section.claims) ? section.claims : [];
    if (!claims.length) {
      lines.push('_No claims available for this section._');
    } else {
      for (const claim of claims) {
        const tag = claim.insufficient ? 'INSUFFICIENT' : 'CLAIM';
        lines.push(
          `- [${tag}] ${escapeMd(claim.text)} (evidence links: ${claim.evidence_link_count || 0})`,
        );
      }
    }
    const limits = Array.isArray(section.limitations) ? section.limitations : [];
    if (limits.length) {
      lines.push('');
      lines.push('Limitations:');
      for (const lim of limits.slice(0, 12)) {
        lines.push(`- ${escapeMd(lim)}`);
      }
    }
    lines.push('');
  }

  lines.push('## Bull / base / bear scenarios');
  lines.push('');
  const scenarios = report.scenarios || {};
  lines.push(`- **Bull:** ${scenarios.bull || 'n/a'}`);
  lines.push(`- **Base:** ${scenarios.base || 'n/a'}`);
  lines.push(`- **Bear:** ${scenarios.bear || 'n/a'}`);
  lines.push('');
  lines.push('## Scores');
  lines.push('');
  lines.push(`- Outcome class: ${scores.outcome_class || outcome.class || 'n/a'}`);
  lines.push(`- Hard stop: ${scores.hard_stop ? 'yes' : 'no'}`);
  lines.push(`- Business quality: ${scores.business_quality_score ?? 'n/a'}`);
  lines.push(`- Growth: ${scores.growth_score ?? 'n/a'}`);
  lines.push(`- Pipeline: ${scores.pipeline_score ?? 'n/a'}`);
  lines.push(`- Valuation context: ${scores.valuation_context_score ?? 'n/a'}`);
  lines.push(`- Risk: ${scores.risk_score ?? 'n/a'}`);
  lines.push(`- Evidence confidence: ${scores.evidence_confidence_score ?? 'n/a'}`);
  lines.push(`- Data freshness: ${scores.data_freshness_score ?? 'n/a'}`);
  lines.push(`- Research priority: ${scores.research_priority_score ?? 'n/a'}`);
  lines.push('');
  lines.push('## Contradictions and unresolved questions');
  lines.push('');
  const unresolved = report.contradictions_unresolved || {};
  const questions = Array.isArray(unresolved.questions) ? unresolved.questions : [];
  if (!questions.length) {
    lines.push('_None explicitly recorded beyond insufficient-evidence topics._');
  } else {
    for (const q of questions) {
      lines.push(`- ${escapeMd(q)}`);
    }
  }
  lines.push('');
  lines.push('## Monitoring plan');
  lines.push('');
  const plan = Array.isArray(report.monitoring_plan) ? report.monitoring_plan : [];
  for (const item of plan) {
    lines.push(`- **${item.rule_type}:** ${escapeMd(item.description)}`);
  }
  lines.push('');
  lines.push('## Sources and citations');
  lines.push('');
  const sources = Array.isArray(report.sources) ? report.sources : [];
  for (const src of sources) {
    lines.push(
      `- [${src.source_type || 'source'}] ${escapeMd(src.title || src.stable_source_id || src.id)} (${src.publication_date || 'n/a'})`,
    );
  }
  lines.push('');
  lines.push('## Methodology, limitations, and disclaimer');
  lines.push('');
  lines.push(escapeMd(method.methodology || ''));
  lines.push('');
  lines.push(escapeMd(method.limitations || ''));
  lines.push('');
  lines.push(escapeMd(method.disclaimer || ''));
  lines.push('');
  return lines.join('\n');
}

function requiredSectionsPresent(report) {
  const required = [
    'schema_version',
    'case_metadata',
    'executive_brief',
    'outcome',
    'what_changed',
    'identity',
    'business_financial',
    'growth',
    'pipeline',
    'regulatory_catalysts',
    'valuation_market',
    'risks',
    'scenarios',
    'scores',
    'contradictions_unresolved',
    'monitoring_plan',
    'sources',
    'methodology_limitations_disclaimer',
  ];
  const missing = required.filter((key) => report[key] == null);
  return { ok: missing.length === 0, missing };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function loadPackedRows(nodeName, jsonKey, totalKey) {
  const packed = nodeJson(nodeName);
  if (packed && packed[jsonKey] != null) {
    return {
      rows: parseJsonArray(packed[jsonKey]),
      total: Number(packed[totalKey] || 0),
    };
  }
  const rows = nodeAll(nodeName);
  return { rows, total: rows.length };
}

const validated = nodeJson('Validate Report Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};
const scoreRow = nodeJson('Load Scores') || {};
const versionRow = nodeJson('Load Report Version') || {};
const evidencePack = loadPackedRows('Load Evidence Documents', 'evidence_json', 'evidence_total');
const claimPack = loadPackedRows('Load Claims', 'claims_json', 'claim_total');
const evidenceRows = evidencePack.rows;
const claimRows = claimPack.rows;
const claimTotal = claimPack.total || claimRows.length;
const evidenceTotal = evidencePack.total || evidenceRows.length;
const componentRows = nodeAll('Load Score Components');

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const reportCfg =
  analysisRoot.report ||
  validated.report_config ||
  $input.first().json.report_config ||
  {};

const maxClaims = Number(reportCfg.max_claims_per_section ?? 8);
const maxSources = Number(reportCfg.max_sources ?? 40);
const categoryMap = reportCfg.category_map || {
  business_financial: 'financial_business',
  growth: 'growth_prospects',
  pipeline: 'pipeline_clinical',
  regulatory: 'regulatory_catalyst',
  valuation: 'valuation_market',
  risk: 'risk_red_team',
};
const disclaimer =
  reportCfg.disclaimer ||
  'This report is an automated research aid based on public information as of the stated as-of timestamp. It may contain errors or omissions. It is not personalized investment, legal, tax, or accounting advice. Independently verify material facts before making an investment decision.';

const asOf = new Date().toISOString();
const caseId = validated.case_id || caseRow.case_id;
const ticker = validated.ticker || caseRow.ticker;
const exchange = validated.exchange || caseRow.exchange;
const legalName = caseRow.legal_name || null;
const outcomeClass = scoreRow.outcome_class || caseRow.outcome_class || 'MONITOR';
const hardStop = scoreRow.hard_stop === true || scoreRow.hard_stop === 't';

const business = sectionClaims(
  claimRows,
  categoryMap.business_financial || 'financial_business',
  maxClaims,
);
const growth = sectionClaims(claimRows, categoryMap.growth || 'growth_prospects', maxClaims);
const pipeline = sectionClaims(
  claimRows,
  categoryMap.pipeline || 'pipeline_clinical',
  maxClaims,
);
const regulatory = sectionClaims(
  claimRows,
  categoryMap.regulatory || 'regulatory_catalyst',
  maxClaims,
);
const valuation = sectionClaims(
  claimRows,
  categoryMap.valuation || 'valuation_market',
  maxClaims,
);
const risks = sectionClaims(claimRows, categoryMap.risk || 'risk_red_team', maxClaims);

const supporting = strongestClaim(
  claimRows,
  (c) => !isInsufficientClaim(c) && Number(c.evidence_link_count || 0) > 0,
);
const opposing = strongestClaim(
  claimRows,
  (c) =>
    c.claim_category === (categoryMap.risk || 'risk_red_team') && !isInsufficientClaim(c),
);
const insufficientAny = claimRows.filter(isInsufficientClaim);

const cashDebtResolved = claimRows.some(
  (c) =>
    (c.topic_key === 'cash_debt' || c.extraction_method === 'deterministic_xbrl_metrics') &&
    !isInsufficientClaim(c),
);
const cashDebtMissing =
  !cashDebtResolved &&
  (business.insufficient_topics.some((t) => /cash|debt|runway/i.test(t)) ||
    insufficientAny.some((c) => /cash|debt|runway/i.test(String(c.claim_text || ''))));

const priorVersion = Number(versionRow.max_version || 0);
const nextVersion = priorVersion + 1;

const monitoringPlan = [
  {
    rule_type: 'sec_filings',
    description: 'Watch for new 10-K/10-Q/8-K filings that update cash, debt, dilution, or material events.',
  },
  {
    rule_type: 'clinical_trials',
    description: 'Watch ClinicalTrials.gov status/phase changes for company-sponsored studies.',
  },
  {
    rule_type: 'financing',
    description: 'Watch for financing, ATM, or share-issuance disclosures that change runway assumptions.',
  },
];

const sources = evidenceRows.slice(0, maxSources).map((doc) => ({
  id: doc.id,
  source_type: doc.source_type,
  publisher: doc.publisher,
  stable_source_id: doc.stable_source_id,
  title: doc.title,
  publication_date: doc.publication_date,
}));

const report = {
  schema_version: reportCfg.schema_version || 'report.v1',
  case_metadata: {
    case_id: caseId,
    ticker,
    exchange,
    legal_name: legalName,
    cik: caseRow.cik || null,
    as_of: asOf,
    research_question: caseRow.research_question || null,
    report_version: nextVersion,
  },
  executive_brief: {
    why_now: `Automated Phase 1 investigation of ${ticker} on ${exchange} using SEC and ClinicalTrials.gov metadata plus deterministic analyst claims.`,
    strongest_for: supporting
      ? supporting.text
      : 'Insufficient cited supporting claim available in Phase 1 evidence set.',
    strongest_against: opposing
      ? opposing.text
      : 'Insufficient cited opposing/risk claim available in Phase 1 evidence set.',
    thesis_changers:
      'Verified current cash and debt from filings; material trial readouts; regulatory decisions; dilutive financing.',
    monitor_next: monitoringPlan.map((m) => m.rule_type).join(', '),
  },
  outcome: {
    class: outcomeClass,
    explanation: hardStop
      ? 'Hard-stop scoring conditions were triggered; continued research is not justified without remediation.'
      : `Outcome class ${outcomeClass} was inherited from PII-10 scoring rules using coverage-aware scores and quality gates.`,
    rules: [
      `scores.outcome_class=${outcomeClass}`,
      `scores.hard_stop=${hardStop}`,
      cashDebtMissing
        ? 'publication_blocked:cash_debt_from_filing'
        : 'cash_debt_gate:pass_or_not_required',
    ],
  },
  what_changed: {
    summary:
      priorVersion > 0
        ? `Prior report version ${priorVersion} exists; this run creates version ${nextVersion}. Claim-level diff is not computed in Phase 1.`
        : 'No prior report for this case; this is the first report version.',
    prior_version: priorVersion || null,
  },
  identity: {
    legal_name: legalName,
    cik: caseRow.cik || null,
    company_id: caseRow.company_id || null,
    security_id: caseRow.security_id || null,
    ticker,
    exchange,
  },
  business_financial: {
    claims: business.claims,
    limitations: business.insufficient_topics,
    claim_total: business.total,
  },
  growth: {
    claims: growth.claims,
    limitations: growth.insufficient_topics,
    claim_total: growth.total,
  },
  pipeline: {
    claims: pipeline.claims,
    limitations: pipeline.insufficient_topics,
    claim_total: pipeline.total,
  },
  regulatory_catalysts: {
    claims: regulatory.claims,
    limitations: regulatory.insufficient_topics,
    claim_total: regulatory.total,
  },
  valuation_market: {
    claims: valuation.claims,
    limitations: valuation.insufficient_topics,
    claim_total: valuation.total,
  },
  risks: {
    claims: risks.claims,
    limitations: risks.insufficient_topics,
    claim_total: risks.total,
  },
  scenarios: {
    bull: 'Favorable catalysts resolve positively and financing pressure remains manageable; Phase 1 lacks valuation inputs for quantified upside.',
    base: `Continue monitoring under outcome ${outcomeClass} until cash/debt and remaining evidence gaps are remediated.`,
    bear: 'Financing stress, adverse trial/regulatory developments, or unresolved thesis-breakers reduce research priority.',
  },
  scores: {
    outcome_class: outcomeClass,
    hard_stop: hardStop,
    business_quality_score:
      scoreRow.business_quality_score == null ? null : Number(scoreRow.business_quality_score),
    growth_score: scoreRow.growth_score == null ? null : Number(scoreRow.growth_score),
    pipeline_score: scoreRow.pipeline_score == null ? null : Number(scoreRow.pipeline_score),
    valuation_context_score:
      scoreRow.valuation_context_score == null
        ? null
        : Number(scoreRow.valuation_context_score),
    risk_score: scoreRow.risk_score == null ? null : Number(scoreRow.risk_score),
    evidence_confidence_score:
      scoreRow.evidence_confidence_score == null
        ? null
        : Number(scoreRow.evidence_confidence_score),
    data_freshness_score:
      scoreRow.data_freshness_score == null ? null : Number(scoreRow.data_freshness_score),
    research_priority_score:
      scoreRow.research_priority_score == null
        ? null
        : Number(scoreRow.research_priority_score),
    components: componentRows.map((c) => ({
      component_key: c.component_key,
      parent_score_key: c.parent_score_key,
      normalized_value: c.normalized_value == null ? null : Number(c.normalized_value),
      missing: c.missing === true || c.missing === 't',
    })),
  },
  contradictions_unresolved: {
    questions: insufficientAny.slice(0, 20).map((c) => String(c.claim_text || '').slice(0, 240)),
  },
  monitoring_plan: monitoringPlan,
  sources,
  methodology_limitations_disclaimer: {
    methodology:
      'Phase 1 report is deterministically assembled from persisted claims, scores, and evidence metadata. No LLM language generation was used.',
    limitations:
      'Filing bodies/XBRL, FDA, IR, patents, and market-quote enrichment are incomplete. Precise financial figures beyond metadata-backed claims are not asserted. Claim inventory may include duplicates from repeated analyst runs.',
    disclaimer,
  },
  publication_ready: false,
};

const schemaCheck = requiredSectionsPresent(report);
const schemaValid = schemaCheck.ok;
const requireCashDebt = reportCfg.publication_requires_cash_debt !== false;
const requireSchema = reportCfg.publication_requires_schema_valid !== false;
const publicationReady =
  (!requireSchema || schemaValid) &&
  (!requireCashDebt || !cashDebtMissing) &&
  !hardStop;

report.publication_ready = publicationReady;
report.schema_valid = schemaValid;
report.schema_missing_sections = schemaCheck.missing;

const markdown = renderMarkdown(report);
const seedMonitoring = reportCfg.seed_monitoring_rules !== false;

let nextState = 'AWAITING_HUMAN_REVIEW';
let outcome = 'REPORT_DRAFT';
let reason = 'report_generated_awaiting_review';
if (!schemaValid) {
  nextState = 'INCOMPLETE';
  outcome = 'FAILED';
  reason = 'report_schema_invalid';
} else if (publicationReady) {
  nextState = 'COMPLETE';
  outcome = 'REPORT_PUBLISHABLE';
  reason = 'report_publication_ready';
}

const metadata = {
  outcome,
  next_state: nextState,
  reason,
  outcome_class: outcomeClass,
  schema_valid: schemaValid,
  publication_ready: publicationReady,
  report_version: nextVersion,
  claim_count: claimTotal,
  claim_sample_count: claimRows.length,
  evidence_count: evidenceTotal,
  source_count: sources.length,
  gates_blocking: [
    ...(cashDebtMissing ? ['cash_debt_from_filing'] : []),
    ...(!schemaValid ? ['schema_valid_report'] : []),
    ...(hardStop ? ['hard_stop'] : []),
  ],
};

function toB64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

return [
  {
    json: {
      case_id: caseId,
      company_id: caseRow.company_id || null,
      ticker,
      exchange,
      legal_name: legalName,
      n8n_execution_id: validated.n8n_execution_id || $execution.id,
      outcome,
      next_state: nextState,
      reason,
      outcome_class: outcomeClass,
      schema_valid: schemaValid,
      publication_ready: publicationReady,
      report_version: nextVersion,
      as_of: asOf,
      // Keep large report bodies only as base64 for the insert node — do not
      // retain raw objects/markdown in the item stream (n8n Cloud OOM risk).
      report_html: '',
      seed_monitoring_rules: seedMonitoring,
      claim_count: claimTotal,
      counts: {
        claim_count: claimTotal,
        claim_sample_count: claimRows.length,
        evidence_count: evidenceTotal,
        source_count: sources.length,
        component_count: componentRows.length,
        prior_report_version: priorVersion,
      },
      report_json_b64: toB64(JSON.stringify(report)),
      report_markdown_b64: toB64(markdown),
      schema_valid_sql: schemaValid ? 'true' : 'false',
      publication_ready_sql: publicationReady ? 'true' : 'false',
      metadata_b64: toB64(JSON.stringify(metadata)),
      monitoring_rules_json_b64: toB64(JSON.stringify(monitoringPlan)),
    },
  },
];
