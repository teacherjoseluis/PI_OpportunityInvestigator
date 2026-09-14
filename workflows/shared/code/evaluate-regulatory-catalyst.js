// Canonical source for PII-07 "Evaluate Regulatory Catalyst" Code node.
// Deterministic regulatory/catalyst claims from SEC (+ light CT.gov) metadata only.

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

const validated = nodeJson('Validate Regulatory Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const regulatory =
  analysisRoot.regulatory ||
  validated.regulatory_config ||
  $input.first().json.regulatory_config ||
  {};

const watchedEventForms = Array.isArray(regulatory.watched_event_forms)
  ? regulatory.watched_event_forms
  : ['8-K', '6-K'];
const minEvidence = Number(regulatory.min_evidence_documents ?? 1);
const minStructural = Number(regulatory.min_structural_claims ?? 1);
const claimCategory = regulatory.claim_category || 'regulatory_catalyst';
const insufficientTopics = Array.isArray(regulatory.insufficient_topics)
  ? regulatory.insufficient_topics
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
const trials = evidenceRows.filter((row) => row.source_type === 'clinicaltrials_gov');

const claims = [];
const eventFilings = [];

for (const filing of filings) {
  const meta = parseMeta(filing.metadata_json);
  if (!formMatches(meta.form || '', watchedEventForms)) continue;
  eventFilings.push(filing);
}

if (eventFilings.length) {
  const forms = [
    ...new Set(eventFilings.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'material_event_forms_present',
    claim_text:
      'Recent SEC index includes material-event forms (' +
      forms.join(' ') +
      ' x' +
      eventFilings.length +
      '). These may contain catalyst disclosures but filing bodies are not parsed in Phase 1.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 50,
    materiality: 'HIGH',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: eventFilings
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 3),
  });
}

const periodic = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']),
);
if (periodic.length) {
  claims.push({
    topic_key: 'periodic_regulatory_context_anchor',
    claim_text:
      'Periodic SEC reports (' +
      periodic.length +
      ' recent 10-K/10-Q in index) can anchor later regulatory risk-factor and catalyst narrative extraction once filing bodies are collected.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 85,
    materiality: 'LOW',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: periodic
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 2),
  });
}

if (trials.length) {
  let recruiting = 0;
  let completed = 0;
  let otherStatus = 0;
  for (const trial of trials) {
    const status = String(parseMeta(trial.metadata_json).overallStatus || '').toUpperCase();
    if (status === 'RECRUITING') recruiting += 1;
    else if (status === 'COMPLETED') completed += 1;
    else otherStatus += 1;
  }
  claims.push({
    topic_key: 'clinical_status_catalyst_signal',
    claim_text:
      'ClinicalTrials.gov status mix (recruiting=' +
      recruiting +
      ' completed=' +
      completed +
      ' other=' +
      otherStatus +
      ' of ' +
      trials.length +
      ') is a near-term clinical-milestone signal only; not a PDUFA AdCom or FDA decision date.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 55,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_ctgov_metadata',
    evidence_ids: trials
      .map((t) => t.id)
      .filter(Boolean)
      .slice(0, 5),
  });
}

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires richer regulatory/catalyst evidence sources.';
  insufficient_topics.push(key);
  const linkIds = [...eventFilings, ...trials, ...filings]
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
  'material_event_forms_present',
  'periodic_regulatory_context_anchor',
  'clinical_status_catalyst_signal',
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
  reason = 'regulatory_metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_regulatory_claims';
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
  event_filings_count: eventFilings.length,
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
        event_filings_count: eventFilings.length,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
