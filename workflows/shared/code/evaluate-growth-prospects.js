// Canonical source for PII-05 "Evaluate Growth Prospects" Code node.
// Deterministic growth claims from SEC/CT.gov metadata only (distinct from pipeline quality).

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

const validated = nodeJson('Validate Growth Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const growth =
  analysisRoot.growth ||
  validated.growth_config ||
  $input.first().json.growth_config ||
  {};

const watchedEventForms = Array.isArray(growth.watched_event_forms)
  ? growth.watched_event_forms
  : ['8-K', '6-K'];
const minEvidence = Number(growth.min_evidence_documents ?? 1);
const minStructural = Number(growth.min_structural_claims ?? 1);
const claimCategory = growth.claim_category || 'growth_prospects';
const insufficientTopics = Array.isArray(growth.insufficient_topics)
  ? growth.insufficient_topics
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
const newsRows = evidenceRows.filter((row) => row.source_type === 'finnhub_company_news');

const partnershipRe =
  /\b(partnership|partner(ed|s|ing)?|licen[cs](e|ing|es)|collaboration|collaborat\w*|alliance|royalt(y|ies)|co-develop)\b/i;

const claims = [];
const eventFilings = [];

for (const filing of filings) {
  const meta = parseMeta(filing.metadata_json);
  const form = meta.form || '';
  if (!formMatches(form, watchedEventForms)) continue;
  eventFilings.push(filing);
}

if (eventFilings.length) {
  const forms = [
    ...new Set(eventFilings.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'material_event_filings_present',
    claim_text:
      'Recent SEC index includes material-event forms (' +
      forms.join(', ') +
      ' x' +
      eventFilings.length +
      '). Partnership or commercial updates may exist but cannot be confirmed without filing body text.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 50,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_sec_metadata',
    evidence_ids: eventFilings
      .map((f) => f.id)
      .filter(Boolean)
      .slice(0, 3),
  });
}

if (trials.length) {
  let phase2 = 0;
  let phase3 = 0;
  let recruiting = 0;
  let completed = 0;
  for (const trial of trials) {
    const meta = parseMeta(trial.metadata_json);
    const phases = (meta.phases || []).map((p) => String(p).toUpperCase());
    if (phases.some((p) => p.includes('PHASE2') || p === '2')) phase2 += 1;
    if (phases.some((p) => p.includes('PHASE3') || p === '3')) phase3 += 1;
    const status = String(meta.overallStatus || '').toUpperCase();
    if (status === 'RECRUITING') recruiting += 1;
    if (status === 'COMPLETED') completed += 1;
  }
  claims.push({
    topic_key: 'clinical_activity_growth_dependence',
    claim_text:
      'ClinicalTrials.gov metadata shows ' +
      trials.length +
      ' studies (Phase2=' +
      phase2 +
      ', Phase3=' +
      phase3 +
      ', recruiting=' +
      recruiting +
      ', completed=' +
      completed +
      '). Near-term commercial growth may depend on clinical/label-expansion outcomes; this is not a pipeline quality score.',
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

if (filings.some((f) => formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']))) {
  const periodic = filings.filter((f) =>
    formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']),
  );
  claims.push({
    topic_key: 'periodic_filings_for_growth_context',
    claim_text:
      'Periodic reports (' +
      periodic.length +
      ' recent 10-K/10-Q in index) are available as anchors for later product-growth extraction once XBRL/full text is collected.',
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

if (newsRows.length) {
  const headlines = newsRows
    .map((r) => parseMeta(r.metadata_json).headline || r.title)
    .filter(Boolean)
    .slice(0, 5);
  claims.push({
    topic_key: 'recent_company_news_inventory',
    claim_text:
      'Finnhub company-news returned ' +
      newsRows.length +
      ' recent headline(s)' +
      (headlines.length ? ': ' + headlines.join(' | ') : '') +
      '. Compact headlines only — article bodies not archived.',
    claim_category: claimCategory,
    claim_kind: 'fact',
    confidence: 80,
    materiality: 'MEDIUM',
    extraction_method: 'deterministic_finnhub_company_news',
    evidence_ids: newsRows
      .map((r) => r.id)
      .filter(Boolean)
      .slice(0, 8),
  });

  const partnerHits = newsRows.filter((r) => {
    const meta = parseMeta(r.metadata_json);
    const blob = String(meta.headline || '') + ' ' + String(meta.summary || '');
    return partnershipRe.test(blob);
  });
  if (partnerHits.length) {
    const samples = partnerHits
      .map((r) => parseMeta(r.metadata_json).headline)
      .filter(Boolean)
      .slice(0, 3);
    claims.push({
      topic_key: 'partnerships_licensing_headline_signal',
      claim_text:
        'Company-news headlines mention partnership/licensing themes (x' +
        partnerHits.length +
        ')' +
        (samples.length ? ': ' + samples.join(' | ') : '') +
        '. Terms, economics, and confirmation still need filing-body evidence.',
      claim_category: claimCategory,
      claim_kind: 'inference',
      confidence: 60,
      materiality: 'MEDIUM',
      extraction_method: 'deterministic_finnhub_company_news',
      evidence_ids: partnerHits
        .map((r) => r.id)
        .filter(Boolean)
        .slice(0, 5),
    });
  }
}

const satisfiedInsufficient = new Set();
if (newsRows.some((r) => {
  const meta = parseMeta(r.metadata_json);
  return partnershipRe.test(String(meta.headline || '') + ' ' + String(meta.summary || ''));
})) {
  // Headline signal replaces pure "no IR source" insufficiency; economics remain caveated in claim text.
  satisfiedInsufficient.add('partnerships_licensing');
}

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  if (satisfiedInsufficient.has(key)) continue;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires richer growth evidence sources.';
  insufficient_topics.push(key);
  const linkIds = [...eventFilings, ...trials, ...filings, ...newsRows]
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

const structuralCount = claims.filter(
  (c) =>
    c.topic_key === 'clinical_activity_growth_dependence' ||
    c.topic_key === 'material_event_filings_present' ||
    c.topic_key === 'periodic_filings_for_growth_context' ||
    c.topic_key === 'recent_company_news_inventory' ||
    c.topic_key === 'partnerships_licensing_headline_signal',
).length;
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
  reason = 'growth_metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_growth_claims';
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
  news_count: newsRows.length,
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
        news_count: newsRows.length,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
