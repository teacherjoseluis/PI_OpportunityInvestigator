// Canonical source for PII-03 "Evaluate Collection Coverage" Code node.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function countItems(name) {
  try {
    return $(name).all().filter((row) => row.json && row.json.skip_upsert !== true).length;
  } catch {
    return 0;
  }
}

const item = $input.first().json || {};
const validated = nodeJson('Validate Collection Request') || item;
const configRow = nodeJson('Load Collection Config') || item.config || {};
const secNorm = nodeJson('Normalize SEC Evidence') || item.sec || {};
const ctNorm = nodeJson('Normalize CT.gov Evidence') || item.ctgov || {};
const xbrlNorm = nodeJson('Normalize SEC XBRL Facts') || item.xbrl || {};
const fdaNorm = nodeJson('Normalize OpenFDA Evidence') || item.fda || {};
const fdaPrep = nodeJson('Prepare OpenFDA Query') || {};
const newsNorm = nodeJson('Normalize Company News Evidence') || item.news || {};
const newsPrep = nodeJson('Prepare Company News Query') || {};
const patentsNorm = nodeJson('Normalize USPTO Patents Evidence') || item.patents || {};
const patentsPrep = nodeJson('Prepare USPTO Query') || {};
const courtNorm = nodeJson('Normalize CourtListener Evidence') || item.courtlistener || {};
const courtPrep = nodeJson('Prepare CourtListener Query') || {};

const gates = configRow.gates_json || {};
const collection = (gates && gates.collection) || item.collection || {};
const minSec = Number(collection.min_sec_documents ?? 1);
const partialNeedsHuman = collection.partial_requires_human_review === true;
const xbrlEnabled =
  collection.collectors &&
  collection.collectors.sec_filing_bodies &&
  collection.collectors.sec_filing_bodies.enabled === true;
const fdaEnabled =
  (collection.collectors &&
    collection.collectors.fda_openfda &&
    collection.collectors.fda_openfda.enabled === true) ||
  fdaPrep.enabled === true;
const newsEnabled =
  (collection.collectors &&
    collection.collectors.company_ir &&
    collection.collectors.company_ir.enabled === true) ||
  newsPrep.enabled === true;
const patentsEnabled =
  (collection.collectors &&
    collection.collectors.uspto_patents &&
    collection.collectors.uspto_patents.enabled === true) ||
  patentsPrep.enabled === true;
const courtEnabled =
  (collection.collectors &&
    collection.collectors.courtlistener &&
    collection.collectors.courtlistener.enabled === true) ||
  courtPrep.enabled === true;

const secAttempted = countItems('Expand SEC Documents') || Number(secNorm.document_count || 0);
const ctAttempted = countItems('Expand CT.gov Documents') || Number(ctNorm.document_count || 0);

const secStored = Number(
  item.sec_stored_count ?? nodeJson('Count SEC Upserts')?.sec_stored_count ?? secAttempted,
);
const ctStored = Number(
  item.ct_stored_count ?? nodeJson('Count CT.gov Upserts')?.ct_stored_count ?? ctAttempted,
);
const xbrlStored = Number(
  item.xbrl_stored_count ??
    nodeJson('Count XBRL Upserts')?.xbrl_stored_count ??
    nodeJson('Prepare XBRL Zero Count')?.xbrl_stored_count ??
    0,
);
const xbrlMetrics = Number(
  item.xbrl_metric_count ?? nodeJson('Count XBRL Upserts')?.xbrl_metric_count ?? 0,
);
const fdaStored = Number(
  item.fda_stored_count ??
    nodeJson('Count FDA Upserts')?.fda_stored_count ??
    nodeJson('Prepare FDA Zero Count')?.fda_stored_count ??
    0,
);
const newsStored = Number(
  item.news_stored_count ??
    nodeJson('Count Company News Upserts')?.news_stored_count ??
    nodeJson('Prepare Company News Zero Count')?.news_stored_count ??
    0,
);
const patentsStored = Number(
  item.patents_stored_count ??
    nodeJson('Count USPTO Upserts')?.patents_stored_count ??
    nodeJson('Prepare USPTO Zero Count')?.patents_stored_count ??
    0,
);
const courtStored = Number(
  item.courtlistener_stored_count ??
    nodeJson('Count CourtListener Upserts')?.courtlistener_stored_count ??
    nodeJson('Prepare CourtListener Zero Count')?.courtlistener_stored_count ??
    0,
);

const secOk = secNorm.ok === true && secStored >= minSec;
const secFailed = secNorm.ok === false;
const ctFailed = ctNorm.ok === false;
const xbrlOk =
  !xbrlEnabled || xbrlNorm.skipped === true || xbrlNorm.ok === true || xbrlStored > 0;
const xbrlFailed = xbrlEnabled && xbrlNorm.skipped !== true && xbrlNorm.ok === false && xbrlStored < 1;
const fdaSkipped =
  !fdaEnabled ||
  fdaNorm.skipped === true ||
  fdaPrep.skip_fetch === true ||
  nodeJson('Prepare FDA Zero Count')?.fda_skipped === true;
const fdaOk =
  !fdaEnabled ||
  fdaSkipped ||
  fdaNorm.ok === true ||
  fdaStored > 0 ||
  nodeJson('Count FDA Upserts')?.fda_ok === true;
const fdaFailed = fdaEnabled && !fdaSkipped && fdaNorm.ok === false && fdaStored < 1;
const newsSkipped =
  !newsEnabled ||
  newsNorm.skipped === true ||
  newsPrep.skip_fetch === true ||
  nodeJson('Prepare Company News Zero Count')?.news_skipped === true;
const newsOk =
  !newsEnabled ||
  newsSkipped ||
  newsNorm.ok === true ||
  newsStored > 0 ||
  nodeJson('Count Company News Upserts')?.news_ok === true;
const newsFailed = newsEnabled && !newsSkipped && newsNorm.ok === false && newsStored < 1;
const patentsSkipped =
  !patentsEnabled ||
  patentsNorm.skipped === true ||
  patentsPrep.skip_fetch === true ||
  nodeJson('Prepare USPTO Zero Count')?.patents_skipped === true;
const patentsOk =
  !patentsEnabled ||
  patentsSkipped ||
  patentsNorm.ok === true ||
  patentsStored > 0 ||
  nodeJson('Count USPTO Upserts')?.patents_ok === true;
const patentsFailed =
  patentsEnabled && !patentsSkipped && patentsNorm.ok === false && patentsStored < 1;
const courtSkipped =
  !courtEnabled ||
  courtNorm.skipped === true ||
  courtPrep.skip_fetch === true ||
  nodeJson('Prepare CourtListener Zero Count')?.courtlistener_skipped === true;
const courtOk =
  !courtEnabled ||
  courtSkipped ||
  courtNorm.ok === true ||
  courtStored > 0 ||
  nodeJson('Count CourtListener Upserts')?.courtlistener_ok === true;
const courtFailed =
  courtEnabled && !courtSkipped && courtNorm.ok === false && courtStored < 1;

const totalStored =
  secStored +
  (ctFailed ? 0 : ctStored) +
  xbrlStored +
  fdaStored +
  newsStored +
  patentsStored +
  courtStored;
const collector_status = [
  {
    key: 'sec_edgar',
    ok: secNorm.ok === true,
    error: secNorm.error || null,
    document_count: secStored,
  },
  {
    key: 'clinicaltrials_gov',
    ok: ctNorm.ok === true,
    error: ctNorm.error || null,
    document_count: ctFailed ? 0 : ctStored,
  },
  {
    key: 'sec_filing_bodies',
    ok: xbrlOk,
    skipped: !xbrlEnabled || xbrlNorm.skipped === true,
    error: xbrlFailed ? xbrlNorm.error || 'xbrl_failed' : null,
    document_count: xbrlStored,
    metric_count: xbrlMetrics,
  },
  {
    key: 'fda_openfda',
    ok: fdaOk,
    skipped: !fdaEnabled || fdaSkipped,
    error: fdaFailed ? fdaNorm.error || 'fda_failed' : null,
    document_count: fdaStored,
  },
  {
    key: 'company_ir',
    ok: newsOk,
    skipped: !newsEnabled || newsSkipped,
    error: newsFailed ? newsNorm.error || 'company_news_failed' : null,
    document_count: newsStored,
  },
  {
    key: 'uspto_patents',
    ok: patentsOk,
    skipped: !patentsEnabled || patentsSkipped,
    error: patentsFailed ? patentsNorm.error || 'uspto_failed' : null,
    document_count: patentsStored,
  },
  {
    key: 'courtlistener',
    ok: courtOk,
    skipped: !courtEnabled || courtSkipped,
    error: courtFailed ? courtNorm.error || 'courtlistener_failed' : null,
    document_count: courtStored,
  },
];

let outcome;
let next_state;
let reason;

if (secOk && !ctFailed) {
  outcome = 'COLLECTED';
  next_state = 'ANALYZING';
  reason = xbrlFailed
    ? 'minimum_coverage_met_xbrl_partial'
    : fdaFailed
      ? 'minimum_coverage_met_fda_partial'
      : newsFailed
        ? 'minimum_coverage_met_news_partial'
        : patentsFailed
          ? 'minimum_coverage_met_patents_partial'
          : courtFailed
            ? 'minimum_coverage_met_courtlistener_partial'
            : 'minimum_coverage_met';
} else if (totalStored > 0 || secOk) {
  outcome = 'PARTIAL';
  next_state = partialNeedsHuman ? 'AWAITING_HUMAN_REVIEW' : 'ANALYZING';
  reason = secFailed
    ? 'sec_failed_partial'
    : ctFailed
      ? 'ctgov_failed_partial'
      : 'partial_coverage';
} else {
  outcome = 'FAILED';
  next_state = 'INCOMPLETE';
  reason = 'no_evidence_collected';
}

const summary = {
  sec_stored_count: secStored,
  ct_stored_count: ctFailed ? 0 : ctStored,
  xbrl_stored_count: xbrlStored,
  xbrl_metric_count: xbrlMetrics,
  fda_stored_count: fdaStored,
  news_stored_count: newsStored,
  patents_stored_count: patentsStored,
  courtlistener_stored_count: courtStored,
  total_stored_count: totalStored,
  min_sec_documents: minSec,
};

const summaryJson = JSON.stringify({
  outcome,
  next_state,
  reason,
  collector_status,
  counts: summary,
});
const metadata_b64 = Buffer.from(summaryJson, 'utf8').toString('base64');

return [
  {
    json: {
      case_id: validated.case_id || item.case_id,
      company_id:
        secNorm.company_id ||
        ctNorm.company_id ||
        fdaNorm.company_id ||
        newsNorm.company_id ||
        patentsNorm.company_id ||
        courtNorm.company_id ||
        validated.company_id ||
        null,
      ticker: validated.ticker || item.ticker,
      exchange: validated.exchange || item.exchange,
      cik: secNorm.cik || validated.cik || null,
      legal_name:
        secNorm.legal_name ||
        ctNorm.legal_name ||
        fdaNorm.legal_name ||
        newsNorm.legal_name ||
        patentsNorm.legal_name ||
        courtNorm.legal_name ||
        null,
      outcome,
      next_state,
      reason,
      collector_status,
      counts: summary,
      metadata_b64,
      n8n_execution_id: validated.n8n_execution_id || item.n8n_execution_id || null,
    },
  },
];
