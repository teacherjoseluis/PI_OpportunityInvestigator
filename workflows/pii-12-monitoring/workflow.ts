import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateMonitoringRequestCode = `// Canonical source for PII-12 "Validate Monitoring Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const caseId = String(body.case_id || body.caseId || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) {
    errors.push('case_id is required and must be a UUID');
  }

  const ticker = String(body.ticker || '')
    .trim()
    .toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    errors.push('ticker is required and must be a valid symbol (1-10 chars, A-Z0-9.-)');
  }

  const exchange = String(body.exchange || 'NASDAQ')
    .trim()
    .toUpperCase();

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        next_state: 'INCOMPLETE',
        reason: 'validation_failed',
      },
    });
    continue;
  }

  results.push({
    json: {
      valid: true,
      case_id: caseId,
      ticker,
      exchange,
      company_id: body.company_id || body.companyId || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const evaluateMonitoringSignalsCode = `// Canonical source for PII-12 "Evaluate Monitoring Signals" Code node.
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
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\\d{4}-\\d{2}$/.test(s)) return s + '-01';
  if (/^\\d{4}$/.test(s)) return s + '-01-01';
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
const changeMemo = changeMemoLines.join('\\n');

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
`;
const prepareMonitoringAggregateCode = `// Slim payload after detected_events insert — drop events array from stream.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Monitoring Signals') || {};

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id || null,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name || null,
      n8n_execution_id: evaluated.n8n_execution_id,
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      next_state: evaluated.next_state,
      outcome_class: evaluated.outcome_class || null,
      as_of_baseline: evaluated.as_of_baseline,
      report_version: evaluated.report_version,
      event_count: evaluated.event_count || 0,
      material_event_count: evaluated.material_event_count || 0,
      matched_rule_types: evaluated.matched_rule_types || [],
      change_memo: evaluated.change_memo || null,
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
    },
  },
];
`;
const buildMonitoringResultCode = `// Canonical source for PII-12 "Build Monitoring Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

let matched = item.matched_rule_types;
if (typeof matched === 'string') {
  try {
    matched = JSON.parse(matched);
  } catch {
    matched = [];
  }
}
if (!Array.isArray(matched)) matched = [];

return [
  {
    json: {
      case_id: item.case_id,
      company_id: item.company_id || null,
      ticker: item.ticker,
      exchange: item.exchange,
      legal_name: item.legal_name || null,
      outcome: item.outcome || 'FAILED',
      next_state: item.next_state || 'AWAITING_HUMAN_REVIEW',
      reason: item.reason || null,
      outcome_class: item.outcome_class || null,
      as_of_baseline: item.as_of_baseline || null,
      event_count: Number(item.event_count || counts.event_count || 0),
      material_event_count: Number(
        item.material_event_count || counts.material_event_count || 0,
      ),
      matched_rule_types: matched,
      change_memo: item.change_memo || null,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
`;

const monitoringTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Monitoring Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'ticker', type: 'string' },
          { name: 'exchange', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
});

const validateMonitoringRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Monitoring Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateMonitoringRequestCode,
    },
  },
});

const validationPassed = ifElse({
  version: 2.3,
  config: {
    name: 'Validation Passed?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.valid }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareValidationError = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Prepare Validation Error',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'outcome', name: 'outcome', value: 'FAILED', type: 'string' },
          {
            id: 'next-state',
            name: 'next_state',
            value: 'INCOMPLETE',
            type: 'string',
          },
          { id: 'reason', name: 'reason', value: 'validation_failed', type: 'string' },
          { id: 'event-count', name: 'event_count', value: 0, type: 'number' },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
      },
    },
  },
});

const loadCaseAndCompany = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Company',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT rc.id AS case_id, rc.state AS case_state, rc.ticker, rc.exchange, rc.company_id, rc.security_id, rc.outcome_class, rc.configuration_version_id, c.cik, c.legal_name FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id WHERE rc.id = $1::uuid LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadMonitoringRules = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Monitoring Rules',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'rule_type', rule_type, 'description', LEFT(COALESCE(description, ''), 240), 'is_active', is_active, 'expected_date', expected_date, 'refresh_sections_json', refresh_sections_json) ORDER BY created_at ASC), '[]'::jsonb) AS rules_json FROM monitoring_rules WHERE case_id = $1::uuid AND is_active = TRUE",
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadLatestReport = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Latest Report',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS report_id, version_number, as_of, schema_valid, publication_ready FROM research_reports WHERE case_id = $1::uuid ORDER BY version_number DESC LIMIT 1',
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadEvidenceFingerprints = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Evidence Fingerprints',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'source_type', source_type, 'stable_source_id', stable_source_id, 'publication_date', publication_date, 'metadata_json', metadata_json) ORDER BY created_at ASC), '[]'::jsonb) AS evidence_json FROM (SELECT id, source_type, stable_source_id, publication_date, metadata_json, created_at FROM evidence_documents WHERE case_id = $1::uuid ORDER BY created_at DESC LIMIT 80) e",
      options: {
        queryReplacement: expr('{{ $("Validate Monitoring Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadMonitoringConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Monitoring Config',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        'SELECT id AS configuration_version_id, version_label, gates_json FROM configuration_versions WHERE is_active = TRUE LIMIT 1',
      options: {
        queryReplacement: '',
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const fetchSecSubmissions = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch SEC Submissions',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    parameters: {
      method: 'GET',
      url: expr(
        '=https://data.sec.gov/submissions/CIK{{ $("Load Case And Company").item.json.cik }}.json',
      ),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          {
            name: 'User-Agent',
            value: 'PI Opportunity Investigator teacherjoseluis@gmail.com',
          },
          { name: 'Accept', value: 'application/json' },
          { name: 'Accept-Encoding', value: 'gzip, deflate' },
        ],
      },
      options: {
        timeout: 60000,
        lowercaseHeaders: false,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const fetchCtgovStudies = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch CT.gov Studies',
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 1000,
    parameters: {
      method: 'GET',
      url: 'https://clinicaltrials.gov/api/v2/studies',
      authentication: 'none',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          {
            name: 'query.spons',
            value: expr('{{ $("Load Case And Company").item.json.legal_name }}'),
          },
          {
            name: 'pageSize',
            value: expr(
              '{{ $("Load Monitoring Config").item.json.gates_json.monitoring.ctgov_page_size || 20 }}',
            ),
          },
          { name: 'format', value: 'json' },
        ],
      },
      options: {
        timeout: 60000,
        response: {
          response: {
            neverError: true,
            responseFormat: 'json',
          },
        },
      },
    },
  },
});

const evaluateMonitoringSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Monitoring Signals',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateMonitoringSignalsCode,
    },
  },
});

const hasEvents = ifElse({
  version: 2.3,
  config: {
    name: 'Has Events?',
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            leftValue: expr('{{ $json.has_events }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertDetectedEvents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Detected Events',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO detected_events (case_id, company_id, event_type, event_date, materiality, dedupe_key, verified, source_evidence_ids, change_memo) SELECT $1::uuid, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, x.event_type, NULLIF(NULLIF(TRIM(x.event_date), ''), 'null')::date, x.materiality, x.dedupe_key, COALESCE(x.verified, false), COALESCE(x.source_evidence_ids, '[]'::jsonb), x.change_memo FROM jsonb_to_recordset(convert_from(decode($3, 'base64'), 'UTF8')::jsonb) AS x(event_type text, event_date text, materiality text, dedupe_key text, verified boolean, source_evidence_ids jsonb, change_memo text) WHERE NOT EXISTS (SELECT 1 FROM detected_events de WHERE de.dedupe_key = x.dedupe_key) RETURNING id AS detected_event_id",
      options: {
        queryReplacement: expr(
          '{{ $json.case_id }},{{ $json.company_id }},{{ $json.events_json_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareMonitoringAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Monitoring Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareMonitoringAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-12 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, metadata_json) VALUES ($1::uuid, 'PII-12', $2, $3::uuid, 'SUCCEEDED', convert_from(decode($4, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Monitoring Aggregate").first().json.case_id }},{{ $("Prepare Monitoring Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Monitoring Aggregate").first().json.case_id }},{{ $("Prepare Monitoring Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeMonitoringOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Monitoring Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'company-id',
            name: 'company_id',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.company_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'legal-name',
            name: 'legal_name',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.legal_name }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'next-state',
            name: 'next_state',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.next_state }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'outcome-class',
            name: 'outcome_class',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.outcome_class }}'),
            type: 'string',
          },
          {
            id: 'as-of-baseline',
            name: 'as_of_baseline',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.as_of_baseline }}'),
            type: 'string',
          },
          {
            id: 'event-count',
            name: 'event_count',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.event_count }}'),
            type: 'number',
          },
          {
            id: 'material-event-count',
            name: 'material_event_count',
            value: expr(
              '{{ $("Prepare Monitoring Aggregate").first().json.material_event_count }}',
            ),
            type: 'number',
          },
          {
            id: 'matched-rule-types',
            name: 'matched_rule_types',
            value: expr(
              '{{ $("Prepare Monitoring Aggregate").first().json.matched_rule_types }}',
            ),
            type: 'array',
          },
          {
            id: 'change-memo',
            name: 'change_memo',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.change_memo }}'),
            type: 'string',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Monitoring Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildMonitoringResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Monitoring Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildMonitoringResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-12 Monitoring\nPoll SEC + CT.gov vs last report as_of.\nPersist detected_events + change memo.\nPhase 1: no auto re-analysis.',
  [monitoringTrigger, validateMonitoringRequest, evaluateMonitoringSignals],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\ndetected_events upsert-by-dedupe,\nworkflow_runs PII-12. Case state unchanged.',
  [insertDetectedEvents, logWorkflowRun, buildMonitoringResult],
  { color: 5 },
);

export default workflow('pii-12-monitoring', 'PII-12 Monitoring and Reassessment')
  .add(monitoringTrigger)
  .to(validateMonitoringRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildMonitoringResult))
      .onTrue(
        loadCaseAndCompany
          .to(loadMonitoringRules)
          .to(loadLatestReport)
          .to(loadEvidenceFingerprints)
          .to(loadMonitoringConfig)
          .to(fetchSecSubmissions)
          .to(fetchCtgovStudies)
          .to(evaluateMonitoringSignals)
          .to(
            hasEvents
              .onTrue(
                insertDetectedEvents
                  .to(prepareMonitoringAggregate)
                  .to(logWorkflowRun)
                  .to(mergeMonitoringOutput)
                  .to(buildMonitoringResult),
              )
              .onFalse(
                prepareMonitoringAggregate
                  .to(logWorkflowRun)
                  .to(mergeMonitoringOutput)
                  .to(buildMonitoringResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
