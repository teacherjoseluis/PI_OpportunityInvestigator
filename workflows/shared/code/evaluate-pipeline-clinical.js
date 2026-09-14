// Canonical source for PII-06 "Evaluate Pipeline Clinical" Code node.
// Deterministic pipeline/clinical claims from CT.gov (+ light SEC) metadata only.

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

const validated = nodeJson('Validate Pipeline Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const pipeline =
  analysisRoot.pipeline ||
  validated.pipeline_config ||
  $input.first().json.pipeline_config ||
  {};

const minEvidence = Number(pipeline.min_evidence_documents ?? 1);
const minStructural = Number(pipeline.min_structural_claims ?? 1);
const claimCategory = pipeline.claim_category || 'pipeline_clinical';
const insufficientTopics = Array.isArray(pipeline.insufficient_topics)
  ? pipeline.insufficient_topics
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

let phase2 = 0;
let phase3 = 0;
let recruiting = 0;
let completed = 0;
let otherStatus = 0;
const nctSample = [];
const sponsors = new Set();

for (const trial of trials) {
  const meta = parseMeta(trial.metadata_json);
  const phases = (meta.phases || []).map((p) => String(p).toUpperCase());
  if (phases.some((p) => p.includes('PHASE2') || p === '2')) phase2 += 1;
  if (phases.some((p) => p.includes('PHASE3') || p === '3')) phase3 += 1;
  const status = String(meta.overallStatus || '').toUpperCase();
  if (status === 'RECRUITING') recruiting += 1;
  else if (status === 'COMPLETED') completed += 1;
  else otherStatus += 1;
  if (meta.nctId && nctSample.length < 5) nctSample.push(String(meta.nctId));
  if (meta.leadSponsor) sponsors.add(String(meta.leadSponsor));
}

if (trials.length) {
  const sponsorNote = sponsors.size
    ? ' Lead sponsors seen: ' + [...sponsors].slice(0, 3).join('; ') + '.'
    : ' Lead sponsor not present on stored metadata.';
  claims.push({
    topic_key: 'pipeline_study_inventory',
    claim_text:
      'ClinicalTrials.gov evidence includes ' +
      trials.length +
      ' studies (NCT sample: ' +
      (nctSample.length ? nctSample.join(' ') : 'none') +
      ').' +
      sponsorNote,
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 80,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_ctgov_metadata',
    evidence_ids: trials
      .map((t) => t.id)
      .filter(Boolean)
      .slice(0, 5),
  });

  claims.push({
    topic_key: 'pipeline_phase_status_mix',
    claim_text:
      'Pipeline registry mix: Phase2=' +
      phase2 +
      ' Phase3=' +
      phase3 +
      ' recruiting=' +
      recruiting +
      ' completed=' +
      completed +
      ' other_status=' +
      otherStatus +
      '. This is inventory only not efficacy or trial-quality scoring.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 75,
    materiality: 'HIGH',
    extraction_method: 'deterministic_ctgov_metadata',
    evidence_ids: trials
      .map((t) => t.id)
      .filter(Boolean)
      .slice(0, 5),
  });

  const lateStage = phase2 + phase3;
  if (lateStage > 0 || trials.length <= 5) {
    claims.push({
      topic_key: 'late_stage_concentration',
      claim_text:
        'Late-stage or narrow registry footprint (Phase2+Phase3=' +
        lateStage +
        ' of ' +
        trials.length +
        ' studies). Thesis may concentrate on few clinical assets; ownership and endpoints remain unconfirmed.',
      claim_category: claimCategory,
      claim_kind: 'inference',
      confidence: 55,
      materiality: 'HIGH',
      extraction_method: 'deterministic_ctgov_metadata',
      evidence_ids: trials
        .map((t) => t.id)
        .filter(Boolean)
        .slice(0, 5),
    });
  }
}

const periodic = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']),
);
if (periodic.length) {
  claims.push({
    topic_key: 'sec_pipeline_context_anchor',
    claim_text:
      'Periodic SEC reports (' +
      periodic.length +
      ' recent 10-K/10-Q in index) can anchor later pipeline narrative extraction once filing bodies are collected.',
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

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires richer pipeline/clinical evidence sources.';
  insufficient_topics.push(key);
  const linkIds = [...trials, ...filings]
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
  'pipeline_study_inventory',
  'pipeline_phase_status_mix',
  'late_stage_concentration',
  'sec_pipeline_context_anchor',
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
  reason = 'pipeline_metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_pipeline_claims';
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
  phase2_count: phase2,
  phase3_count: phase3,
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
        phase2_count: phase2,
        phase3_count: phase3,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
