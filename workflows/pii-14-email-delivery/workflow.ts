import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateEmailRequestCode = `// Canonical source for PII-14 "Validate Email Request" Code node.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MODES = new Set(['TEST_DELIVERY', 'INVESTIGATION_REPORT']);

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const caseId = String(body.case_id || body.caseId || '').trim();
  if (!caseId || !UUID_RE.test(caseId)) {
    errors.push('case_id is required and must be a UUID');
  }

  let mode = String(body.mode || body.delivery_mode || '')
    .trim()
    .toUpperCase();
  if (!mode) mode = null;
  if (mode && !ALLOWED_MODES.has(mode)) {
    errors.push('mode must be TEST_DELIVERY or INVESTIGATION_REPORT when provided');
  }

  const recipient = String(body.recipient || body.to || '')
    .trim()
    .toLowerCase();

  if (errors.length > 0) {
    results.push({
      json: {
        valid: false,
        errors,
        outcome: 'FAILED',
        reason: 'validation_failed',
      },
    });
    continue;
  }

  results.push({
    json: {
      valid: true,
      case_id: caseId,
      mode,
      recipient: recipient || null,
      n8n_execution_id: $execution.id,
    },
  });
}

return results;
`;
const evaluateEmailDeliveryCode = `// Canonical source for PII-14 "Evaluate Email Delivery" Code node.
// Decides send vs skip; builds subject/text/html (mockup research-memo layout); no LLM.

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
  return s.slice(0, Math.max(0, maxChars - 20)) + '\\n\\n[…truncated…]';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleCaseWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\\b[a-z]/g, (c) => c.toUpperCase());
}

function displayCompanyName(legalName, ticker) {
  if (!legalName) return ticker || 'Unknown';
  return titleCaseWords(String(legalName).replace(/,?\\s*inc\\.?$/i, '').trim()) || ticker;
}

function humanGate(key) {
  const map = {
    cash_debt_from_filing: 'cash & debt from filings',
    schema_valid_report: 'report schema validation',
    publication_ready: 'publication readiness',
  };
  return map[key] || String(key || '').replace(/_/g, ' ');
}

function sourceChip(text) {
  const t = String(text || '').toUpperCase();
  if (t.includes('CT.GOV') || t.includes('CLINICALTRIALS') || t.includes('NCT')) return 'CT.gov';
  if (
    t.includes('10-K') ||
    t.includes('10-Q') ||
    t.includes('8-K') ||
    t.includes('SEC') ||
    t.includes('EDGAR') ||
    t.includes('FILING')
  ) {
    return 'SEC';
  }
  if (t.includes('INSUFFICIENT')) return 'Gap';
  return 'Metadata';
}

function claimLines(sectionObj, limit) {
  const claims = Array.isArray(sectionObj && sectionObj.claims) ? sectionObj.claims : [];
  return claims
    .filter((c) => c && !c.insufficient)
    .slice(0, limit)
    .map((c) => ({
      text: String(c.text || '').replace(/^INSUFFICIENT_EVIDENCE[:\\s]*/i, '').trim(),
      chip: sourceChip(c.text),
    }))
    .filter((c) => c.text);
}

function splitBriefLine(text, chipHint) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (/insufficient cited/i.test(raw)) return [];
  return [{ text: raw, chip: chipHint || sourceChip(raw) }];
}

function scoreLabel(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  const n = Math.round(Number(value));
  return String(n);
}

function scoreColor(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '#6B7280';
  const n = Number(value);
  if (n >= 60) return '#1D4ED8';
  if (n >= 45) return '#0F766E';
  return '#B91C1C';
}

function scoreHint(key, value) {
  if (value == null || value === '') return 'insufficient';
  const n = Number(value);
  if (key === 'business') return n >= 60 ? 'franchise signal' : 'coverage limited';
  if (key === 'growth') return n >= 55 ? 'growth signals' : 'pipeline dependent';
  if (key === 'pipeline') return n >= 60 ? 'clinical activity' : 'thin endpoints';
  if (key === 'regulatory') return 'catalyst calendar';
  if (key === 'risk') return n >= 60 ? 'elevated risk flags' : 'watch financing';
  if (key === 'confidence') return 'limited evidence set';
  return '';
}

function watchRows(monitoringPlan, monitorNext) {
  const plan = Array.isArray(monitoringPlan) ? monitoringPlan : [];
  if (plan.length) {
    return plan.slice(0, 4).map((item) => {
      const rule = String(item.rule_type || 'watch');
      const tag =
        /sec|filing/i.test(rule)
          ? 'SEC filings'
          : /clinic|trial|ctgov/i.test(rule)
            ? 'Clinical trials'
            : /financ|dilut|cash/i.test(rule)
              ? 'Financing'
              : 'Monitor';
      const title =
        /sec_filing/i.test(rule)
          ? 'Next 10-K / 10-Q'
          : /clinical/i.test(rule)
            ? 'Late-stage / readout updates'
            : /financ/i.test(rule)
              ? 'Cash runway & dilution'
              : titleCaseWords(rule.replace(/_/g, ' '));
      return {
        title,
        detail: String(item.description || item.rule_type || ''),
        tag,
      };
    });
  }
  const keys = String(monitorNext || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return keys.slice(0, 4).map((key) => ({
    title: titleCaseWords(key.replace(/_/g, ' ')),
    detail: 'Configured monitoring topic from Phase 1 report brief.',
    tag: /sec|filing/i.test(key)
      ? 'SEC filings'
      : /clinic|trial/i.test(key)
        ? 'Clinical trials'
        : /financ/i.test(key)
          ? 'Financing'
          : 'Monitor',
  }));
}

function evidenceGaps(unresolved, thesisChangers, sectionLimits) {
  const gaps = [];
  const questions = Array.isArray(unresolved && unresolved.questions) ? unresolved.questions : [];
  for (const q of questions.slice(0, 4)) {
    const text = String(q || '')
      .replace(/^INSUFFICIENT_EVIDENCE[:\\s]*/i, '')
      .trim();
    if (text) gaps.push(text.slice(0, 160));
  }
  for (const lim of sectionLimits.slice(0, 4)) {
    const text = String(lim || '')
      .replace(/^INSUFFICIENT_EVIDENCE[:\\s]*/i, '')
      .trim();
    if (text && !gaps.includes(text)) gaps.push(text.slice(0, 160));
  }
  if (!gaps.length && thesisChangers) {
    for (const part of String(thesisChangers)
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)) {
      gaps.push(part);
    }
  }
  return gaps.slice(0, 5);
}

function buildTextEmail(ctx) {
  const lines = [];
  lines.push('PHARMA OPPORTUNITY INVESTIGATOR');
  lines.push(ctx.ticker + '  [' + (ctx.outcomeClass || 'UNKNOWN') + ']');
  lines.push(
    ctx.companyDisplay +
      ' · ' +
      (ctx.exchange || '') +
      ' · Report v' +
      (ctx.reportVersion || '?'),
  );
  lines.push('');
  if (ctx.isTest || !ctx.publicationReady) {
    lines.push(
      'Draft — not publication ready' +
        (ctx.blockingHuman ? ' · blocked: ' + ctx.blockingHuman : ''),
    );
    lines.push('');
  }
  lines.push(ctx.lead || '');
  lines.push('');
  lines.push('Supporting');
  for (const item of ctx.supporting) {
    lines.push('- ' + item.text + ' [' + item.chip + ']');
  }
  if (!ctx.supporting.length) lines.push('- (none yet)');
  lines.push('');
  lines.push('Challenging');
  for (const item of ctx.challenging) {
    lines.push('- ' + item.text + ' [' + item.chip + ']');
  }
  if (!ctx.challenging.length) lines.push('- (none yet)');
  lines.push('');
  lines.push('Scores');
  for (const s of ctx.scoreStrip) {
    lines.push('- ' + s.label + ': ' + s.display + (s.hint ? ' (' + s.hint + ')' : ''));
  }
  lines.push('');
  lines.push('Watch next');
  for (const w of ctx.watch) {
    lines.push('- ' + w.title + ': ' + w.detail + ' [' + w.tag + ']');
  }
  if (!ctx.watch.length) lines.push('- (none configured)');
  lines.push('');
  lines.push('Evidence gaps');
  for (const g of ctx.gaps) {
    lines.push('- ' + g);
  }
  if (!ctx.gaps.length) lines.push('- (none listed)');
  lines.push('');
  lines.push(
    'Case ID: ' +
      ctx.caseId +
      ' · As of: ' +
      (ctx.asOfDisplay || 'n/a') +
      ' · Research assistance only — not investment advice.',
  );
  return lines.join('\\n');
}

function chipHtml(label) {
  return (
    '<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:4px;background:#EEF2F6;color:#4B5563;font-size:11px;line-height:16px;vertical-align:middle">' +
    escapeHtml(label) +
    '</span>'
  );
}

function bulletHtml(item, color) {
  return (
    '<tr><td style="padding:0 0 10px 0;font-size:13px;line-height:1.45;color:#111827;vertical-align:top">' +
    '<span style="color:' +
    color +
    ';font-weight:700;margin-right:6px">•</span>' +
    escapeHtml(item.text) +
    chipHtml(item.chip) +
    '</td></tr>'
  );
}

function buildHtmlEmail(ctx) {
  const draftBanner =
    ctx.isTest || !ctx.publicationReady
      ? '<tr><td style="background:#F8EDE3;border-top:1px solid #E7C8A8;border-bottom:1px solid #E7C8A8;padding:10px 22px;color:#8A5A2B;font-size:12px;line-height:1.4">Draft — not publication ready' +
        (ctx.blockingHuman ? ' · blocked: ' + escapeHtml(ctx.blockingHuman) : '') +
        '</td></tr>'
      : '';

  const supportingRows = ctx.supporting.length
    ? ctx.supporting.map((i) => bulletHtml(i, '#1D4ED8')).join('')
    : bulletHtml({ text: 'No cited supporting claim in Phase 1 evidence set yet.', chip: 'Gap' }, '#1D4ED8');
  const challengingRows = ctx.challenging.length
    ? ctx.challenging.map((i) => bulletHtml(i, '#B91C1C')).join('')
    : bulletHtml({ text: 'No cited challenging claim in Phase 1 evidence set yet.', chip: 'Gap' }, '#B91C1C');

  const scoreCells = ctx.scoreStrip
    .map((s, idx) => {
      const border =
        idx === 0
          ? ''
          : 'border-left:1px solid #E5E7EB;';
      return (
        '<td style="padding:4px 10px;text-align:center;' +
        border +
        '">' +
        '<div style="font-size:20px;font-weight:700;color:' +
        s.color +
        ';line-height:1.1">' +
        escapeHtml(s.display) +
        '</div>' +
        '<div style="font-size:11px;color:#374151;margin-top:4px;font-weight:600">' +
        escapeHtml(s.label) +
        '</div>' +
        '<div style="font-size:10px;color:#6B7280;margin-top:2px">' +
        escapeHtml(s.hint || '') +
        '</div></td>'
      );
    })
    .join('');

  const watchHtml = ctx.watch.length
    ? ctx.watch
        .map((w) => {
          return (
            '<tr><td style="padding:12px 0;border-bottom:1px solid #E5E7EB">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
            '<td style="font-size:13px;color:#111827;padding-right:12px">' +
            '<div style="font-weight:700;margin-bottom:2px">' +
            escapeHtml(w.title) +
            '</div>' +
            '<div style="color:#4B5563;line-height:1.4">' +
            escapeHtml(w.detail) +
            '</div></td>' +
            '<td style="width:110px;text-align:right;vertical-align:top">' +
            chipHtml(w.tag) +
            '</td></tr></table></td></tr>'
          );
        })
        .join('')
    : '<tr><td style="padding:8px 0;color:#6B7280;font-size:13px">No monitoring rules seeded yet.</td></tr>';

  const gapsHtml = ctx.gaps.length
    ? '<ul style="margin:8px 0 0 18px;padding:0;color:#374151;font-size:13px;line-height:1.5">' +
      ctx.gaps.map((g) => '<li style="margin:0 0 6px 0">' + escapeHtml(g) + '</li>').join('') +
      '</ul>'
    : '<p style="margin:8px 0 0 0;color:#6B7280;font-size:13px">No explicit gaps listed.</p>';

  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#E8ECF0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E8ECF0;padding:24px 12px">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#FFFFFF;border-radius:4px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif">' +
    '<tr><td style="background:#0B1F33;padding:22px 24px 20px 24px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:top">' +
    '<div style="color:#D7E0EA;font-size:11px;letter-spacing:0.08em;font-weight:600">PHARMA OPPORTUNITY INVESTIGATOR</div>' +
    '<div style="color:#FFFFFF;font-size:34px;font-weight:700;line-height:1.1;margin-top:8px">' +
    escapeHtml(ctx.ticker) +
    '</div>' +
    '<div style="color:#C9D5E3;font-size:13px;margin-top:6px">' +
    escapeHtml(ctx.companyDisplay) +
    ' · ' +
    escapeHtml(ctx.exchange || '') +
    ' · Report v' +
    escapeHtml(String(ctx.reportVersion || '?')) +
    '</div></td>' +
    '<td style="vertical-align:top;text-align:right;width:120px">' +
    '<span style="display:inline-block;padding:6px 12px;border:1px solid #5EEAD4;border-radius:999px;color:#5EEAD4;font-size:12px;font-weight:700;letter-spacing:0.04em">' +
    escapeHtml(ctx.outcomeClass || 'UNKNOWN') +
    '</span></td></tr></table></td></tr>' +
    draftBanner +
    '<tr><td style="padding:22px 24px 8px 24px;color:#1F2937;font-size:14px;line-height:1.55">' +
    escapeHtml(ctx.lead || '') +
    '</td></tr>' +
    '<tr><td style="padding:8px 24px 4px 24px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="50%" style="vertical-align:top;padding-right:12px">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#1D4ED8;margin-bottom:10px">SUPPORTING</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    supportingRows +
    '</table></td>' +
    '<td width="50%" style="vertical-align:top;padding-left:12px;border-left:1px solid #E5E7EB">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#B91C1C;margin-bottom:10px">CHALLENGING</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    challengingRows +
    '</table></td></tr></table></td></tr>' +
    '<tr><td style="padding:18px 24px 8px 24px">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#374151;margin-bottom:10px">SCORES</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:4px"><tr>' +
    scoreCells +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:18px 24px 8px 24px">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#374151;margin-bottom:4px">WATCH NEXT</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    watchHtml +
    '</table></td></tr>' +
    '<tr><td style="padding:14px 24px 8px 24px">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:#374151">EVIDENCE GAPS</div>' +
    gapsHtml +
    '</td></tr>' +
    '<tr><td style="padding:18px 24px 22px 24px;border-top:1px solid #E5E7EB">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:11px;color:#9CA3AF">Case ID: ' +
    escapeHtml(ctx.caseId) +
    ' · As of: ' +
    escapeHtml(ctx.asOfDisplay || 'n/a') +
    '</td>' +
    '<td style="font-size:11px;color:#9CA3AF;text-align:right">Research assistance only — not investment advice.</td>' +
    '</tr></table></td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

const validated = nodeJson('Validate Email Request') || $input.first().json || {};
const configRow = nodeJson('Load Email Config') || {};
const caseReport = nodeJson('Load Case And Latest Report') || {};
const priorPack = nodeJson('Load Prior Deliveries') || {};

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
let asOfDisplay = '';
if (asOfRaw) {
  const d = new Date(asOfRaw);
  asOfDisplay = Number.isNaN(d.getTime())
    ? String(asOfRaw).slice(0, 10)
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const brief = parseJson(caseReport.executive_brief, {}) || {};
const outcomeBlock = parseJson(caseReport.outcome_json, {}) || {};
const scores = parseJson(caseReport.scores_json, {}) || {};
const monitoringPlan = parseJsonArray(caseReport.monitoring_plan);
const unresolved = parseJson(caseReport.unresolved_json, {}) || {};
const business = parseJson(caseReport.business_json, {}) || {};
const growth = parseJson(caseReport.growth_json, {}) || {};
const pipeline = parseJson(caseReport.pipeline_json, {}) || {};
const risks = parseJson(caseReport.risks_json, {}) || {};

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
const blockingHuman = gatesBlocking.map(humanGate).join(', ');

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
let deliveryType = isTest ? 'TEST_DELIVERY' : 'INVESTIGATION_REPORT';

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

const prefix = isTest
  ? emailCfg.subject_prefix_test || '[PII DRAFT — NOT PUBLICATION READY]'
  : emailCfg.subject_prefix_prod || '[PII Report]';
const subject =
  prefix +
  ' ' +
  ticker +
  (exchange ? ' (' + exchange + ')' : '') +
  ' — ' +
  (outcomeClass || 'UNKNOWN');

const supporting = []
  .concat(claimLines(business, 2))
  .concat(claimLines(growth, 1))
  .concat(claimLines(pipeline, 1))
  .concat(splitBriefLine(brief.strongest_for, 'SEC'))
  .slice(0, 3);
const challenging = []
  .concat(claimLines(risks, 3))
  .concat(splitBriefLine(brief.strongest_against, 'Risk'))
  .slice(0, 3);

// Dedupe identical brief/claim text
function uniqueItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item.text || '')
      .toLowerCase()
      .slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const supportingUnique = uniqueItems(supporting).slice(0, 3);
const challengingUnique = uniqueItems(challenging).slice(0, 3);

const sectionLimits = []
  .concat(business.limitations || [])
  .concat(growth.limitations || [])
  .concat(pipeline.limitations || [])
  .concat(risks.limitations || []);

const scoreStrip = [
  {
    key: 'business',
    label: 'Business',
    value: scores.business_quality_score,
  },
  { key: 'growth', label: 'Growth', value: scores.growth_score },
  { key: 'pipeline', label: 'Pipeline', value: scores.pipeline_score },
  // Phase 1 has no dedicated regulatory score column yet.
  { key: 'regulatory', label: 'Regulatory', value: null },
  { key: 'risk', label: 'Risk', value: scores.risk_score },
  {
    key: 'confidence',
    label: 'Confidence',
    value: scores.evidence_confidence_score,
  },
].map((s) => ({
  label: s.label,
  display: scoreLabel(s.value),
  color: scoreColor(s.value),
  hint: scoreHint(s.key, s.value),
}));

const companyDisplay = displayCompanyName(legalName, ticker);
const lead =
  String(brief.why_now || '').trim() ||
  'Phase 1 investigation using SEC and ClinicalTrials.gov metadata with deterministic analyst claims.';

const emailCtx = {
  isTest,
  publicationReady,
  ticker,
  exchange,
  companyDisplay,
  outcomeClass,
  reportVersion,
  caseId,
  asOfDisplay,
  blockingHuman,
  lead,
  supporting: supportingUnique,
  challenging: challengingUnique,
  scoreStrip,
  watch: watchRows(monitoringPlan, brief.monitor_next),
  gaps: evidenceGaps(unresolved, brief.thesis_changers, sectionLimits),
};

const textBody = truncate(buildTextEmail(emailCtx), maxBody);
const htmlBody = truncate(buildHtmlEmail(emailCtx), maxBody);
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
  email_layout: 'research_memo_v1',
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

return [
  {
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
      counts: {
        prior_deliveries: prior.length,
      },
      delivery_json_b64: toB64(JSON.stringify([deliveryRow])),
      metadata_b64: toB64(JSON.stringify(metadata)),
    },
  },
];
`;
const prepareEmailAggregateCode = `// Slim payload after email send / delivery insert.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Email Delivery') || {};

return [
  {
    json: {
      case_id: evaluated.case_id,
      company_id: evaluated.company_id || null,
      ticker: evaluated.ticker,
      exchange: evaluated.exchange,
      legal_name: evaluated.legal_name || null,
      n8n_execution_id: evaluated.n8n_execution_id,
      mode: evaluated.mode,
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      should_send: evaluated.should_send === true,
      delivery_type: evaluated.delivery_type,
      delivery_status: evaluated.delivery_status,
      report_id: evaluated.report_id || null,
      report_version: evaluated.report_version,
      recipient: evaluated.recipient,
      subject: evaluated.subject,
      dedupe_key: evaluated.dedupe_key,
      schema_valid: evaluated.schema_valid === true,
      publication_ready: evaluated.publication_ready === true,
      gates_blocking: evaluated.gates_blocking || [],
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
      delivery_json_b64: evaluated.delivery_json_b64 || '',
    },
  },
];
`;
const buildEmailResultCode = `// Canonical source for PII-14 "Build Email Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

let gates = item.gates_blocking;
if (typeof gates === 'string') {
  try {
    gates = JSON.parse(gates);
  } catch {
    gates = [];
  }
}
if (!Array.isArray(gates)) gates = [];

return [
  {
    json: {
      case_id: item.case_id,
      ticker: item.ticker,
      exchange: item.exchange,
      mode: item.mode || null,
      outcome: item.outcome || 'FAILED',
      reason: item.reason || null,
      delivery_type: item.delivery_type || null,
      delivery_status: item.delivery_status || null,
      report_id: item.report_id || null,
      report_version:
        item.report_version == null ? null : Number(item.report_version),
      recipient: item.recipient || null,
      subject: item.subject || null,
      schema_valid: item.schema_valid === true || item.schema_valid === 'true',
      publication_ready:
        item.publication_ready === true || item.publication_ready === 'true',
      gates_blocking: gates,
      counts,
      as_of: new Date().toISOString(),
    },
  },
];
`;

const emailTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Email Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [
          { name: 'case_id', type: 'string' },
          { name: 'mode', type: 'string' },
          { name: 'recipient', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      mode: 'TEST_DELIVERY',
    },
  ],
});

const validateEmailRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Email Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateEmailRequestCode,
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
            id: 'reason',
            name: 'reason',
            value: 'validation_failed',
            type: 'string',
          },
          {
            id: 'delivery-status',
            name: 'delivery_status',
            value: 'FAILED',
            type: 'string',
          },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
      },
    },
  },
});

const loadEmailConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Email Config',
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

const loadCaseAndLatestReport = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Case And Latest Report',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT rc.id AS case_id, rc.ticker, rc.exchange, rc.state AS case_state, rc.outcome_class, rc.company_id, c.legal_name, rr.id AS report_id, rr.version_number, rr.schema_valid, rr.publication_ready, rr.as_of, rr.report_json->'executive_brief' AS executive_brief, rr.report_json->'outcome' AS outcome_json, rr.report_json->'scores' AS scores_json, rr.report_json->'monitoring_plan' AS monitoring_plan, rr.report_json->'contradictions_unresolved' AS unresolved_json, rr.report_json->'business_financial' AS business_json, rr.report_json->'growth' AS growth_json, rr.report_json->'pipeline' AS pipeline_json, rr.report_json->'risks' AS risks_json, LEFT(COALESCE(rr.report_markdown, ''), 20000) AS report_markdown_preview FROM research_cases rc LEFT JOIN companies c ON c.id = rc.company_id LEFT JOIN LATERAL (SELECT id, version_number, schema_valid, publication_ready, as_of, report_json, report_markdown FROM research_reports r WHERE r.case_id = rc.id ORDER BY version_number DESC LIMIT 1) rr ON TRUE WHERE rc.id = $1::uuid LIMIT 1",
      options: {
        queryReplacement: expr('{{ $("Validate Email Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const loadPriorDeliveries = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Prior Deliveries',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'dedupe_key', dedupe_key, 'status', status, 'delivery_type', delivery_type, 'sent_at', sent_at) ORDER BY created_at DESC), '[]'::jsonb) AS deliveries_json FROM (SELECT id, dedupe_key, status, delivery_type, sent_at, created_at FROM email_deliveries WHERE case_id = $1::uuid ORDER BY created_at DESC LIMIT 20) e",
      options: {
        queryReplacement: expr('{{ $("Validate Email Request").item.json.case_id }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const evaluateEmailDelivery = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Email Delivery',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateEmailDeliveryCode,
    },
  },
});

const shouldSend = ifElse({
  version: 2.3,
  config: {
    name: 'Should Send?',
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
            leftValue: expr('{{ $json.should_send }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const sendInvestigationEmail = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Send Investigation Email',
    parameters: {
      fromEmail: expr('{{ $json.from_email }}'),
      toEmail: expr('{{ $json.recipient }}'),
      subject: expr('{{ $json.subject }}'),
      emailFormat: 'both',
      text: expr('{{ $json.text_body }}'),
      html: expr('{{ $json.html_body }}'),
      options: {
        appendAttribution: false,
      },
    },
    credentials: {
      smtp: newCredential('SMTP account'),
    },
  },
});

const insertEmailDelivery = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Email Delivery',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO email_deliveries (case_id, report_id, delivery_type, recipient, subject, status, dedupe_key, sent_at, error_summary) SELECT NULLIF(NULLIF(TRIM(x.case_id), ''), 'null')::uuid, NULLIF(NULLIF(TRIM(x.report_id), ''), 'null')::uuid, x.delivery_type, x.recipient, x.subject, x.status, x.dedupe_key, CASE WHEN UPPER(x.status) = 'SENT' THEN NOW() ELSE NULL END, x.error_summary FROM jsonb_to_recordset(convert_from(decode($1, 'base64'), 'UTF8')::jsonb) AS x(case_id text, report_id text, delivery_type text, recipient text, subject text, status text, dedupe_key text, error_summary text) WHERE NOT EXISTS (SELECT 1 FROM email_deliveries ed WHERE ed.dedupe_key = x.dedupe_key AND UPPER(ed.status) = 'SENT') RETURNING id AS email_delivery_id",
      options: {
        queryReplacement: expr(
          '{{ $("Evaluate Email Delivery").first().json.delivery_json_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareEmailAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Email Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareEmailAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-14 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, finished_at, metadata_json) VALUES (NULLIF(NULLIF(TRIM($1), ''), 'null')::uuid, 'PII-14', $2, NULLIF(NULLIF(TRIM($1), ''), 'null')::uuid, 'SUCCEEDED', NOW(), convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Email Aggregate").first().json.case_id }},{{ $("Prepare Email Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Email Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeEmailOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Email Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'case-id',
            name: 'case_id',
            value: expr('{{ $("Prepare Email Aggregate").first().json.case_id }}'),
            type: 'string',
          },
          {
            id: 'ticker',
            name: 'ticker',
            value: expr('{{ $("Prepare Email Aggregate").first().json.ticker }}'),
            type: 'string',
          },
          {
            id: 'exchange',
            name: 'exchange',
            value: expr('{{ $("Prepare Email Aggregate").first().json.exchange }}'),
            type: 'string',
          },
          {
            id: 'mode',
            name: 'mode',
            value: expr('{{ $("Prepare Email Aggregate").first().json.mode }}'),
            type: 'string',
          },
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Email Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Email Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'delivery-type',
            name: 'delivery_type',
            value: expr('{{ $("Prepare Email Aggregate").first().json.delivery_type }}'),
            type: 'string',
          },
          {
            id: 'delivery-status',
            name: 'delivery_status',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.delivery_status }}',
            ),
            type: 'string',
          },
          {
            id: 'report-id',
            name: 'report_id',
            value: expr('{{ $("Prepare Email Aggregate").first().json.report_id }}'),
            type: 'string',
          },
          {
            id: 'report-version',
            name: 'report_version',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.report_version }}',
            ),
            type: 'number',
          },
          {
            id: 'recipient',
            name: 'recipient',
            value: expr('{{ $("Prepare Email Aggregate").first().json.recipient }}'),
            type: 'string',
          },
          {
            id: 'subject',
            name: 'subject',
            value: expr('{{ $("Prepare Email Aggregate").first().json.subject }}'),
            type: 'string',
          },
          {
            id: 'schema-valid',
            name: 'schema_valid',
            value: expr('{{ $("Prepare Email Aggregate").first().json.schema_valid }}'),
            type: 'boolean',
          },
          {
            id: 'publication-ready',
            name: 'publication_ready',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.publication_ready }}',
            ),
            type: 'boolean',
          },
          {
            id: 'gates-blocking',
            name: 'gates_blocking',
            value: expr(
              '{{ $("Prepare Email Aggregate").first().json.gates_blocking }}',
            ),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Email Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildEmailResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Email Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildEmailResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-14 Email Delivery\nTEST_DELIVERY drafts + gated production sends.\nSMTP account → teacherjoseluis@gmail.com.\nWeekly digest deferred.',
  [emailTrigger, validateEmailRequest, evaluateEmailDelivery],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nemail_deliveries + workflow_runs PII-14.\nCase state unchanged.',
  [sendInvestigationEmail, insertEmailDelivery, logWorkflowRun],
  { color: 5 },
);

export default workflow('pii-14-email-delivery', 'PII-14 Email Digest and Report Delivery')
  .add(emailTrigger)
  .to(validateEmailRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildEmailResult))
      .onTrue(
        loadEmailConfig
          .to(loadCaseAndLatestReport)
          .to(loadPriorDeliveries)
          .to(evaluateEmailDelivery)
          .to(
            shouldSend
              .onTrue(
                sendInvestigationEmail
                  .to(insertEmailDelivery)
                  .to(prepareEmailAggregate)
                  .to(logWorkflowRun)
                  .to(mergeEmailOutput)
                  .to(buildEmailResult),
              )
              .onFalse(
                insertEmailDelivery
                  .to(prepareEmailAggregate)
                  .to(logWorkflowRun)
                  .to(mergeEmailOutput)
                  .to(buildEmailResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
