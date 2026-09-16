// Canonical source for PII-09 "Evaluate Risk Red Team" Code node.
// Deterministic risk/red-team signals from SEC + CT.gov metadata only (no invented risk scores).

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

const validated = nodeJson('Validate Risk Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const risk =
  analysisRoot.risk ||
  validated.risk_config ||
  $input.first().json.risk_config ||
  {};

const watchedEventForms = Array.isArray(risk.watched_event_forms)
  ? risk.watched_event_forms
  : ['8-K', '6-K'];
const watchedOfferingForms = Array.isArray(risk.watched_offering_forms)
  ? risk.watched_offering_forms
  : ['S-3', '424B', '424B5', 'S-1'];
const adverseTrialStatuses = Array.isArray(risk.adverse_trial_statuses)
  ? risk.adverse_trial_statuses.map((s) => String(s).toUpperCase())
  : ['TERMINATED', 'WITHDRAWN', 'SUSPENDED'];
const minEvidence = Number(risk.min_evidence_documents ?? 1);
const minStructural = Number(risk.min_structural_claims ?? 1);
const claimCategory = risk.claim_category || 'risk_red_team';
const insufficientTopics = Array.isArray(risk.insufficient_topics)
  ? risk.insufficient_topics
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

const filings = evidenceRows.filter((row) => row.source_type === 'sec_edgar_filing');
const trials = evidenceRows.filter((row) => row.source_type === 'clinicaltrials_gov');
const patents = evidenceRows.filter((row) => row.source_type === 'uspto_patent');
const companyfactsDocs = evidenceRows.filter((row) => row.source_type === 'sec_companyfacts');
const claims = [];
const satisfiedInsufficient = new Set();

const periodic = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']),
);
if (periodic.length) {
  claims.push({
    topic_key: 'periodic_risk_factor_anchor',
    claim_text:
      'Periodic SEC reports (' +
      periodic.length +
      ' recent 10-K/10-Q in index) can anchor later Item 1A risk-factor and going-concern extraction once filing bodies are collected.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 85,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: periodic
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 2),
  });
}

const offering = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, watchedOfferingForms),
);
if (offering.length) {
  const forms = [
    ...new Set(offering.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'financing_dilution_risk_signal',
    claim_text:
      'SEC index includes capital-markets forms (' +
      forms.join(' ') +
      ' x' +
      offering.length +
      '). Financing need and dilution magnitude are not quantified without offering details and share-count facts.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 60,
    materiality: 'HIGH',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: offering
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 3),
  });
}

const eventFilings = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, watchedEventForms),
);
if (eventFilings.length) {
  const forms = [
    ...new Set(eventFilings.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'material_event_risk_signal',
    claim_text:
      'Recent material-event forms (' +
      forms.join(' ') +
      ' x' +
      eventFilings.length +
      ') may contain adverse disclosures (financing, litigation, clinical, regulatory); bodies are not parsed in Phase 1.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 55,
    materiality: 'HIGH',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: eventFilings
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 3),
  });
}

if (trials.length) {
  let adverse = 0;
  let recruiting = 0;
  let completed = 0;
  let otherStatus = 0;
  const adverseRows = [];
  for (const trial of trials) {
    const status = String(parseMeta(trial.metadata_json).overallStatus || '').toUpperCase();
    if (adverseTrialStatuses.includes(status)) {
      adverse += 1;
      adverseRows.push(trial);
    } else if (status === 'RECRUITING') recruiting += 1;
    else if (status === 'COMPLETED') completed += 1;
    else otherStatus += 1;
  }
  claims.push({
    topic_key: 'clinical_execution_risk_signal',
    claim_text:
      'ClinicalTrials.gov status mix (adverse=' +
      adverse +
      ' recruiting=' +
      recruiting +
      ' completed=' +
      completed +
      ' other=' +
      otherStatus +
      ' of ' +
      trials.length +
      ') is an execution-risk signal only; efficacy safety and protocol weaknesses need full study records.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: adverse > 0 ? 65 : 50,
    materiality: adverse > 0 ? 'HIGH' : 'MEDIUM',
    extraction_method: 'deterministic_ctgov_metadata',
    evidence_ids: (adverseRows.length ? adverseRows : trials)
      .map((t) => t.id)
      .filter(Boolean)
      .slice(0, 5),
  });
}

if (patents.length) {
  const granted = patents.filter((p) => Boolean(parseMeta(p.metadata_json).patent_number));
  const sampleTitles = patents
    .map((p) => {
      const m = parseMeta(p.metadata_json);
      const num = m.patent_number || m.application_number || '';
      const title = m.invention_title || p.title || '';
      return safeJoin(num, title);
    })
    .filter(Boolean)
    .slice(0, 5);
  claims.push({
    topic_key: 'patent_portfolio_inventory',
    claim_text:
      'USPTO Patent File Wrapper returned ' +
      patents.length +
      ' compact application/patent rows for this assignee/applicant search (' +
      granted.length +
      ' with patent numbers)' +
      (sampleTitles.length ? ': ' + sampleTitles.join('; ') : '') +
      '. Portfolio inventory only — Orange Book exclusivity, claim scope, and litigation status are not assessed.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 80,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_uspto_patent_file_wrapper',
    evidence_ids: patents
      .map((p) => p.id)
      .filter(Boolean)
      .slice(0, 5),
  });
  satisfiedInsufficient.add('patent_exclusivity');
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
    topic_key: 'liquidity_balance_sheet_inventory',
    claim_text:
      'SEC XBRL companyfacts liquidity inventory (period end ' +
      (periodEnd || 'unknown') +
      '): ' +
      parts.join('; ') +
      '. Inventory only — runway, covenants, and financing-need depth remain unassessed.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 88,
    materiality: 'HIGH',
    extraction_method: 'deterministic_xbrl_metrics',
    evidence_ids: uniqueEvidence,
  });
  satisfiedInsufficient.add('financial_financing_depth');
}

function safeJoin(num, title) {
  const n = String(num || '').trim();
  const t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (n && t) return n + ' — ' + t;
  return n || t || '';
}

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  if (satisfiedInsufficient.has(key)) continue;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires richer risk/red-team evidence sources.';
  insufficient_topics.push(key);
  const linkIds = [...periodic, ...offering, ...eventFilings, ...trials, ...patents, ...filings]
    .map((r) => r.id)
    .filter(Boolean)
    .slice(0, 2);
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

const structuralKeys = new Set([
  'periodic_risk_factor_anchor',
  'financing_dilution_risk_signal',
  'material_event_risk_signal',
  'clinical_execution_risk_signal',
  'patent_portfolio_inventory',
  'liquidity_balance_sheet_inventory',
]);
const structuralCount = claims.filter((c) => structuralKeys.has(c.topic_key)).length;

let outcome;
let next_state;
let reason;

if (evidenceRows.length < minEvidence) {
  outcome = 'INSUFFICIENT';
  next_state = 'ANALYZING';
  reason = 'insufficient_evidence_base';
} else if (structuralCount >= minStructural) {
  outcome = 'ANALYZED';
  next_state = 'ANALYZING';
  reason = 'risk_metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_risk_claims';
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
  patents_count: patents.length,
  periodic_count: periodic.length,
  offering_count: offering.length,
  event_filings_count: eventFilings.length,
  metrics_count: metricRows.length,
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
        patents_count: patents.length,
        periodic_count: periodic.length,
        offering_count: offering.length,
        event_filings_count: eventFilings.length,
        metrics_count: metricRows.length,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
