// Canonical source for PII-04 "Evaluate Financial Business" Code node.
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
const resolvedInsufficient = new Set();

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
  resolvedInsufficient.add('dilution');
}

function fmtUsd(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPct(n) {
  return (Number(n) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
}

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

const xbrlEvidenceIds = [
  ...companyfactsDocs.map((d) => d.id),
  metrics.cash_and_equivalents && metrics.cash_and_equivalents.source_evidence_id,
  metrics.revenue && metrics.revenue.source_evidence_id,
  metrics.operating_cash_flow && metrics.operating_cash_flow.source_evidence_id,
  metrics.shares_outstanding && metrics.shares_outstanding.source_evidence_id,
].filter(Boolean);
const uniqueXbrlEvidence = [...new Set(xbrlEvidenceIds)].slice(0, 5);

if (metrics.gross_margin || metrics.operating_margin || (metrics.revenue && metrics.gross_profit)) {
  const periodEnd =
    (metrics.gross_margin && metrics.gross_margin.period_end) ||
    (metrics.operating_margin && metrics.operating_margin.period_end) ||
    (metrics.revenue && metrics.revenue.period_end) ||
    null;
  const parts = [];
  if (metrics.revenue) parts.push('revenue ' + fmtUsd(metrics.revenue.value) + ' USD');
  if (metrics.gross_margin) parts.push('gross margin ' + fmtPct(metrics.gross_margin.value));
  if (metrics.operating_margin) {
    parts.push('operating margin ' + fmtPct(metrics.operating_margin.value));
  }
  claims.push({
    topic_key: 'margins',
    claim_text:
      'SEC XBRL companyfacts (period end ' +
      (periodEnd || 'unknown') +
      '): ' +
      parts.join('; ') +
      '.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 85,
    materiality: 'HIGH',
    extraction_method: 'deterministic_xbrl_metrics',
    evidence_ids: uniqueXbrlEvidence,
  });
  resolvedInsufficient.add('margins');
}

if (metrics.estimated_cash_runway_months || metrics.cash_burn || metrics.operating_cash_flow) {
  const periodEnd =
    (metrics.estimated_cash_runway_months && metrics.estimated_cash_runway_months.period_end) ||
    (metrics.cash_burn && metrics.cash_burn.period_end) ||
    (metrics.operating_cash_flow && metrics.operating_cash_flow.period_end) ||
    null;
  const parts = [];
  if (metrics.operating_cash_flow) {
    parts.push('operating cash flow ' + fmtUsd(metrics.operating_cash_flow.value) + ' USD');
  }
  if (metrics.cash_burn) parts.push('period cash burn ' + fmtUsd(metrics.cash_burn.value) + ' USD');
  if (metrics.estimated_cash_runway_months) {
    parts.push(
      'estimated cash runway ' +
        Number(metrics.estimated_cash_runway_months.value).toLocaleString('en-US', {
          maximumFractionDigits: 1,
        }) +
        ' months',
    );
  } else if (metrics.operating_cash_flow && metrics.operating_cash_flow.value >= 0) {
    parts.push('operating cash flow was not negative so cash-burn runway is not constrained in this period');
  }
  claims.push({
    topic_key: 'burn_runway',
    claim_text:
      'SEC XBRL companyfacts (period end ' +
      (periodEnd || 'unknown') +
      '): ' +
      parts.join('; ') +
      '.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 82,
    materiality: 'HIGH',
    extraction_method: 'deterministic_xbrl_metrics',
    evidence_ids: uniqueXbrlEvidence,
  });
  resolvedInsufficient.add('burn_runway');
}

if (metrics.shares_outstanding) {
  claims.push({
    topic_key: 'share_count',
    claim_text:
      'SEC XBRL companyfacts (period end ' +
      (metrics.shares_outstanding.period_end || 'unknown') +
      '): shares outstanding ' +
      fmtUsd(metrics.shares_outstanding.value) +
      '. Share-count inventory only; offering dilution impact still needs prospectus economics.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 86,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_xbrl_metrics',
    evidence_ids: uniqueXbrlEvidence,
  });
  resolvedInsufficient.add('dilution');
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
