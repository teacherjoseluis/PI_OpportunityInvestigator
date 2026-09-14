// Canonical source for PII-12 "Evaluate Monitoring Signals" Code node.
// Deterministic SEC + CT.gov change detection vs last report / evidence (no LLM).

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
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

function toSqlDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';
  if (/^\d{4}$/.test(s)) return s + '-01-01';
  return null;
}

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function upperForm(form) {
  return String(form || '')
    .trim()
    .toUpperCase();
}

function toB64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

const validated = nodeJson('Validate Monitoring Request') || $input.first().json || {};
const caseRow = nodeJson('Load Case And Company') || {};
const configRow = nodeJson('Load Monitoring Config') || {};
const reportRow = nodeJson('Load Latest Report') || {};
const rulesPack = nodeJson('Load Monitoring Rules') || {};
const evidencePack = nodeJson('Load Evidence Fingerprints') || {};
const secPayload = nodeJson('Fetch SEC Submissions') || {};
const ctPayload = nodeJson('Fetch CT.gov Studies') || {};

const gates = configRow.gates_json || {};
const monitoring =
  gates.monitoring ||
  validated.monitoring_config ||
  $input.first().json.monitoring_config ||
  {};

const filingLimit = Number(monitoring.sec_recent_filings_limit ?? 15);
const lookbackDays = Number(monitoring.lookback_days_if_no_report ?? 90);
const maxEvents = Number(monitoring.max_events_per_run ?? 20);
const materialForms = (monitoring.material_sec_forms || []).map(upperForm);
const financingForms = (monitoring.financing_sec_forms || []).map(upperForm);
const ruleEventMap = monitoring.rule_event_map || {
  sec_filings: ['sec_new_filing', 'sec_financing_signal'],
  clinical_trials: ['ctgov_status_change', 'ctgov_new_study'],
  financing: ['sec_financing_signal'],
};

const caseId = validated.case_id || caseRow.case_id;
const companyId = caseRow.company_id || null;
const ticker = validated.ticker || caseRow.ticker;
const exchange = validated.exchange || caseRow.exchange;
const legalName = caseRow.legal_name || null;

const asOf =
  toSqlDate(reportRow.as_of) ||
  toSqlDate(reportRow.as_of_date) ||
  daysAgoIso(lookbackDays);

const rules = parseJsonArray(rulesPack.rules_json);
const evidenceRows = parseJsonArray(evidencePack.evidence_json);
const knownIds = new Set(
  evidenceRows
    .map((e) => String(e.stable_source_id || '').trim())
    .filter(Boolean),
);
const evidenceByStable = new Map();
for (const row of evidenceRows) {
  const key = String(row.stable_source_id || '').trim();
  if (key) evidenceByStable.set(key, row);
}

const events = [];
const matchedRuleTypes = new Set();

function addEvent(evt) {
  if (!evt || !evt.dedupe_key) return;
  if (events.some((e) => e.dedupe_key === evt.dedupe_key)) return;
  if (events.length >= maxEvents) return;
  events.push(evt);
}

// --- SEC filings ---
const recent = (secPayload.filings && secPayload.filings.recent) || {};
const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
const forms = Array.isArray(recent.form) ? recent.form : [];
const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
const secOk = accessions.length > 0 && !secPayload.error && !(secPayload.statusCode >= 400);

const limit = Math.min(filingLimit, accessions.length);
for (let i = 0; i < limit; i++) {
  const accession = String(accessions[i] || '').trim();
  const form = upperForm(forms[i]);
  const filingDate = toSqlDate(filingDates[i]);
  if (!accession || !filingDate) continue;
  if (filingDate < asOf) continue;
  if (materialForms.length && !materialForms.includes(form)) continue;
  if (knownIds.has(accession)) continue;

  const isFinancing = financingForms.includes(form);
  const eventType = isFinancing ? 'sec_financing_signal' : 'sec_new_filing';
  const materiality = isFinancing || form === '8-K' ? 'HIGH' : 'MEDIUM';

  addEvent({
    event_type: eventType,
    event_date: filingDate,
    materiality,
    dedupe_key: caseId + ':' + eventType + ':' + accession + ':' + filingDate,
    verified: false,
    source_evidence_ids: [],
    change_memo:
      'New SEC ' + form + ' filing ' + accession + ' dated ' + filingDate + ' after as_of ' + asOf + '.',
    matched_rule_types: isFinancing
      ? ['sec_filings', 'financing']
      : ['sec_filings'],
  });
}

// --- CT.gov studies ---
const studies = Array.isArray(ctPayload.studies) ? ctPayload.studies : [];
const ctOk = studies.length > 0 && !ctPayload.error && !(ctPayload.statusCode >= 400);

for (const study of studies.slice(0, Number(monitoring.ctgov_page_size ?? 20))) {
  const proto = study.protocolSection || {};
  const idMod = proto.identificationModule || {};
  const statusMod = proto.statusModule || {};
  const nctId = String(idMod.nctId || '').trim();
  if (!nctId) continue;
  const status = String(statusMod.overallStatus || '').trim().toUpperCase();
  const statusDate =
    toSqlDate(statusMod.statusVerifiedDate) ||
    toSqlDate((statusMod.lastUpdatePostDateStruct || {}).date) ||
    toSqlDate((statusMod.startDateStruct || {}).date) ||
    null;

  const existing = evidenceByStable.get(nctId);
  if (!existing) {
    addEvent({
      event_type: 'ctgov_new_study',
      event_date: statusDate || asOf,
      materiality: 'MEDIUM',
      dedupe_key: caseId + ':ctgov_new_study:' + nctId,
      verified: false,
      source_evidence_ids: [],
      change_memo: 'New ClinicalTrials.gov study ' + nctId + ' (status ' + (status || 'UNKNOWN') + ').',
      matched_rule_types: ['clinical_trials'],
    });
    continue;
  }

  let priorStatus = '';
  const meta = existing.metadata_json;
  if (meta && typeof meta === 'object') {
    priorStatus = String(meta.overall_status || meta.overallStatus || '').trim().toUpperCase();
  } else if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      priorStatus = String(parsed.overall_status || parsed.overallStatus || '')
        .trim()
        .toUpperCase();
    } catch {
      priorStatus = '';
    }
  }
  if (status && priorStatus && status !== priorStatus) {
    addEvent({
      event_type: 'ctgov_status_change',
      event_date: statusDate || asOf,
      materiality: 'HIGH',
      dedupe_key: caseId + ':ctgov_status_change:' + nctId + ':' + status,
      verified: false,
      source_evidence_ids: existing.id ? [existing.id] : [],
      change_memo:
        'ClinicalTrials.gov ' + nctId + ' status changed ' + priorStatus + ' → ' + status + '.',
      matched_rule_types: ['clinical_trials'],
    });
  }
}

// Match active monitoring rules
const activeRuleTypes = new Set(rules.filter((r) => r.is_active !== false).map((r) => r.rule_type));
for (const evt of events) {
  const types = Array.isArray(evt.matched_rule_types) ? evt.matched_rule_types : [];
  for (const rt of types) {
    if (activeRuleTypes.has(rt)) matchedRuleTypes.add(rt);
  }
  // Also map via config
  for (const [ruleType, eventTypes] of Object.entries(ruleEventMap)) {
    if (!activeRuleTypes.has(ruleType)) continue;
    if ((eventTypes || []).includes(evt.event_type)) matchedRuleTypes.add(ruleType);
  }
}

const materialCount = events.filter((e) => e.materiality === 'HIGH').length;
let outcome = 'NO_EVENTS';
let reason = 'no_new_signals_since_as_of';
if (events.length > 0 && materialCount > 0) {
  outcome = 'MATERIAL_EVENTS';
  reason = 'material_monitoring_events_detected';
} else if (events.length > 0) {
  outcome = 'EVENTS_RECORDED';
  reason = 'non_material_monitoring_events_detected';
}

const changeMemoLines = [
  'Monitoring check for ' + ticker + ' as of baseline ' + asOf + '.',
  'Active rules: ' + (rules.map((r) => r.rule_type).join(', ') || 'none') + '.',
  'SEC poll ok=' + secOk + '; CT.gov poll ok=' + ctOk + '.',
  'Events detected: ' + events.length + ' (HIGH materiality: ' + materialCount + ').',
];
for (const evt of events.slice(0, 10)) {
  changeMemoLines.push('- [' + evt.materiality + '] ' + evt.event_type + ': ' + evt.change_memo);
}
const changeMemo = changeMemoLines.join('\n');

const nextState = caseRow.case_state || caseRow.state || 'AWAITING_HUMAN_REVIEW';

const eventsForSql = events.map((e) => ({
  event_type: e.event_type,
  event_date: e.event_date,
  materiality: e.materiality,
  dedupe_key: e.dedupe_key,
  verified: false,
  source_evidence_ids: e.source_evidence_ids || [],
  change_memo: e.change_memo,
}));

const metadata = {
  outcome,
  reason,
  next_state: nextState,
  as_of_baseline: asOf,
  event_count: events.length,
  material_event_count: materialCount,
  matched_rule_types: [...matchedRuleTypes],
  sec_ok: secOk,
  ctgov_ok: ctOk,
  auto_launch_reassessment: monitoring.auto_launch_reassessment === true,
};

return [
  {
    json: {
      case_id: caseId,
      company_id: companyId,
      ticker,
      exchange,
      legal_name: legalName,
      n8n_execution_id: validated.n8n_execution_id || $execution.id,
      outcome,
      reason,
      next_state: nextState,
      outcome_class: caseRow.outcome_class || null,
      as_of_baseline: asOf,
      report_version: reportRow.version_number == null ? null : Number(reportRow.version_number),
      event_count: events.length,
      material_event_count: materialCount,
      matched_rule_types: [...matchedRuleTypes],
      change_memo: changeMemo,
      events: eventsForSql,
      counts: {
        event_count: events.length,
        material_event_count: materialCount,
        rule_count: rules.length,
        evidence_fingerprint_count: evidenceRows.length,
      },
      has_events: events.length > 0,
      events_json_b64: toB64(JSON.stringify(eventsForSql)),
      metadata_b64: toB64(JSON.stringify(metadata)),
      change_memo_b64: toB64(changeMemo),
    },
  },
];
