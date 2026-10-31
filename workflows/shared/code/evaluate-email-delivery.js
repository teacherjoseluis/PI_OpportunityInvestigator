// Canonical source for PII-14 "Evaluate Email Delivery" Code node.
// Decides send vs skip; builds the chart research memo (table HTML + CID PNG).
// chart-memo.js is prepended at bundle time and in unit tests.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseJsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function toB64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function asBool(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function truncate(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 20)) + '\n\n[…truncated…]';
}

const validated = nodeJson('Validate Email Request') || $input.first().json || {};
const configRow = nodeJson('Load Email Config') || {};
const caseReport = nodeJson('Load Case And Latest Report') || {};
const priorPack = nodeJson('Load Prior Deliveries') || {};
const chartPack = nodeJson('Load Chart Memo Inputs') || {};

const gates = configRow.gates_json || {};
const emailCfg =
  gates.email_delivery ||
  validated.email_delivery_config ||
  $input.first().json.email_delivery_config ||
  {};

const mode = String(
  validated.mode || emailCfg.default_mode || 'INVESTIGATION_REPORT',
)
  .trim()
  .toUpperCase();
const isTest = mode === 'TEST_DELIVERY';

const recipient = String(
  validated.recipient || emailCfg.default_recipient || 'teacherjoseluis@gmail.com',
)
  .trim()
  .toLowerCase();
const fromEmail = String(emailCfg.from_email || recipient).trim();
const maxBody = Number(emailCfg.max_body_chars ?? 120000);
const maxMd = Number(emailCfg.max_markdown_chars ?? 20000);

const caseId = validated.case_id || caseReport.case_id;
const reportId = caseReport.report_id || null;
const ticker = caseReport.ticker || 'UNKNOWN';
const exchange = caseReport.exchange || '';
const legalName = caseReport.legal_name || null;
const outcomeClass = caseReport.outcome_class || null;
const schemaValid = asBool(caseReport.schema_valid);
const publicationReady = asBool(caseReport.publication_ready);
const reportVersion =
  caseReport.version_number == null ? null : Number(caseReport.version_number);
const asOfRaw = caseReport.as_of || null;

const scores = parseJson(caseReport.scores_json, {}) || {};
const outcomeBlock = parseJson(caseReport.outcome_json, {}) || {};

const gatesBlocking = [];
const outcomeRules = Array.isArray(outcomeBlock.rules) ? outcomeBlock.rules : [];
for (const rule of outcomeRules) {
  const s = String(rule || '');
  if (s.startsWith('publication_blocked:')) {
    gatesBlocking.push(s.slice('publication_blocked:'.length));
  }
}
if (!publicationReady && !gatesBlocking.length) {
  gatesBlocking.push('publication_ready');
}

const prior = parseJsonArray(priorPack.deliveries_json);
const dedupeKey =
  'report:' +
  caseId +
  ':' +
  (reportId || 'none') +
  ':' +
  mode +
  ':' +
  recipient;

const alreadySent = prior.some(
  (d) =>
    String(d.dedupe_key || '') === dedupeKey &&
    String(d.status || '').toUpperCase() === 'SENT',
);

let outcome = 'FAILED';
let reason = 'unknown';
let shouldSend = false;
let deliveryStatus = 'PENDING';
const deliveryType = isTest ? 'TEST_DELIVERY' : 'INVESTIGATION_REPORT';

if (!caseId) {
  outcome = 'FAILED';
  reason = 'missing_case';
  deliveryStatus = 'FAILED';
} else if (!reportId) {
  outcome = 'FAILED';
  reason = 'no_report';
  deliveryStatus = 'FAILED';
} else if (alreadySent) {
  outcome = 'SKIPPED_DUPLICATE';
  reason = 'already_sent_dedupe';
  deliveryStatus = 'SKIPPED_DUPLICATE';
  shouldSend = false;
} else if (isTest) {
  if (emailCfg.allow_draft_test_delivery === false) {
    outcome = 'SKIPPED_GATES';
    reason = 'test_delivery_disabled';
    deliveryStatus = 'SKIPPED_GATES';
  } else {
    shouldSend = true;
    outcome = 'SENT';
    reason = 'test_draft_delivery';
    deliveryStatus = 'SENT';
  }
} else {
  const needReady = emailCfg.production_requires_publication_ready !== false;
  const needSchema = emailCfg.production_requires_schema_valid !== false;
  const blockers = [];
  if (needSchema && !schemaValid) blockers.push('schema_valid_report');
  if (needReady && !publicationReady) blockers.push('publication_ready');
  if (blockers.length) {
    outcome = 'SKIPPED_GATES';
    reason = 'publication_gates_failed:' + blockers.join(',');
    deliveryStatus = 'SKIPPED_GATES';
  } else {
    shouldSend = true;
    outcome = 'SENT';
    reason = 'investigation_report_delivery';
    deliveryStatus = 'SENT';
  }
}

const memo = buildChartMemo({
  ticker,
  exchange,
  legalName,
  outcomeClass,
  asOf: asOfRaw,
  caseId,
  scores,
  indicators: chartPack.indicators_json,
  weeklyBars: chartPack.weekly_bars_json,
  dailyHighs: chartPack.daily_highs_json,
  weeklyBarCount: chartPack.weekly_bar_count,
  evidenceCounts: chartPack.evidence_counts_json,
  cashMetricCount: chartPack.cash_metric_count,
  timingClaimText: chartPack.timing_claim_text,
});

const prefix = isTest ? emailCfg.subject_prefix_test || '[PII DRAFT — NOT PUBLICATION READY]' : '';
const subject = (prefix ? prefix + ' ' : '') + memo.subjectCore;

const textBody = truncate(memo.text, maxBody);
const htmlBody = truncate(memo.html, maxBody);
const mdPreview = truncate(caseReport.report_markdown_preview || '', maxMd);

const metadata = {
  outcome,
  reason,
  mode,
  delivery_type: deliveryType,
  delivery_status: deliveryStatus,
  should_send: shouldSend,
  case_id: caseId,
  report_id: reportId,
  report_version: reportVersion,
  recipient,
  dedupe_key: dedupeKey,
  schema_valid: schemaValid,
  publication_ready: publicationReady,
  gates_blocking: gatesBlocking,
  email_layout: 'chart_memo_v1',
  timing_label: memo.timingDisplay,
  has_price_chart: memo.hasPriceChart,
};

const deliveryRow = {
  case_id: caseId,
  report_id: reportId,
  delivery_type: deliveryType,
  recipient,
  subject,
  status: deliveryStatus,
  dedupe_key: dedupeKey,
  error_summary: shouldSend ? null : reason,
};

const payload = {
  json: {
    valid: true,
    case_id: caseId,
    company_id: caseReport.company_id || null,
    ticker,
    exchange,
    legal_name: legalName,
    n8n_execution_id: validated.n8n_execution_id || null,
    mode,
    outcome,
    reason,
    should_send: shouldSend,
    delivery_type: deliveryType,
    delivery_status: deliveryStatus,
    report_id: reportId,
    report_version: reportVersion,
    recipient,
    from_email: fromEmail,
    subject,
    text_body: textBody,
    html_body: htmlBody,
    markdown_preview: mdPreview,
    dedupe_key: dedupeKey,
    schema_valid: schemaValid,
    publication_ready: publicationReady,
    gates_blocking: gatesBlocking,
    has_price_chart: memo.hasPriceChart,
    email_layout: 'chart_memo_v1',
    timing_label: memo.timingDisplay,
    counts: {
      prior_deliveries: prior.length,
    },
    delivery_json_b64: toB64(JSON.stringify([deliveryRow])),
    metadata_b64: toB64(JSON.stringify(metadata)),
  },
};

if (memo.png) {
  payload.binary = {
    priceChart: {
      data: Buffer.from(memo.png).toString('base64'),
      mimeType: 'image/png',
      fileName: 'weekly-price.png',
    },
  };
}

return [payload];
