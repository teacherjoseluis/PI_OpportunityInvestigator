// Canonical source for PII-08 "Evaluate Valuation Market" Code node.
// Deterministic valuation/market claims from SEC metadata only (no invented multiples).

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

const validated = nodeJson('Validate Valuation Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Analysis Config') || {};

const gates = configRow.gates_json || {};
const analysisRoot = (gates && gates.analysis) || {};
const valuation =
  analysisRoot.valuation ||
  validated.valuation_config ||
  $input.first().json.valuation_config ||
  {};

const watchedEventForms = Array.isArray(valuation.watched_event_forms)
  ? valuation.watched_event_forms
  : ['8-K', '6-K'];
const watchedOfferingForms = Array.isArray(valuation.watched_offering_forms)
  ? valuation.watched_offering_forms
  : ['S-3', '424B', '424B5', 'S-1'];
const minEvidence = Number(valuation.min_evidence_documents ?? 1);
const minStructural = Number(valuation.min_structural_claims ?? 1);
const claimCategory = valuation.claim_category || 'valuation_market';
const insufficientTopics = Array.isArray(valuation.insufficient_topics)
  ? valuation.insufficient_topics
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
const claims = [];

const periodic = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, ['10-K', '10-Q']),
);
if (periodic.length) {
  claims.push({
    topic_key: 'periodic_filings_valuation_anchor',
    claim_text:
      'Periodic SEC reports (' +
      periodic.length +
      ' recent 10-K/10-Q in index) can anchor later cash-adjusted EV and multiples once XBRL/full text and market prices are available.',
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

const offering = filings.filter((f) =>
  formMatches(parseMeta(f.metadata_json).form, watchedOfferingForms),
);
if (offering.length) {
  const forms = [
    ...new Set(offering.map((f) => parseMeta(f.metadata_json).form).filter(Boolean)),
  ];
  claims.push({
    topic_key: 'offering_forms_dilution_context',
    claim_text:
      'SEC index includes capital-markets forms (' +
      forms.join(' ') +
      ' x' +
      offering.length +
      '). Dilution and share-count impact remain unquantified without offering details and XBRL share counts.',
    claim_category: claimCategory,
    claim_kind: 'inference',
    confidence: 55,
    materiality: 'MEDIUM',
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
    topic_key: 'material_event_market_context',
    claim_text:
      'Recent material-event forms (' +
      forms.join(' ') +
      ' x' +
      eventFilings.length +
      ') may relate to market-moving disclosures; price reaction and valuation impact cannot be measured without market data evidence.',
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

const insufficient_topics = [];
for (const topic of insufficientTopics) {
  const key = topic.key || topic;
  const text =
    topic.text ||
    'INSUFFICIENT_EVIDENCE: ' + key + ' requires richer valuation/market evidence sources.';
  insufficient_topics.push(key);
  const linkIds = [...periodic, ...offering, ...eventFilings, ...filings]
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
  'periodic_filings_valuation_anchor',
  'offering_forms_dilution_context',
  'material_event_market_context',
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
  reason = 'valuation_metadata_claims_written';
} else {
  outcome = 'PARTIAL';
  next_state = 'ANALYZING';
  reason = 'partial_valuation_claims';
}

const summary = {
  outcome,
  next_state,
  reason,
  claim_count: claims.length,
  structural_claim_count: structuralCount,
  insufficient_topics,
  filings_count: filings.length,
  periodic_count: periodic.length,
  offering_count: offering.length,
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
        periodic_count: periodic.length,
        offering_count: offering.length,
        event_filings_count: eventFilings.length,
        claim_count: claims.length,
        structural_claim_count: structuralCount,
      },
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || null,
    },
  },
];
