// Canonical source for PII-14 "Evaluate Email Delivery" Code node.
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
  return s.slice(0, Math.max(0, maxChars - 20)) + '\n\n[…truncated…]';
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
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function displayCompanyName(legalName, ticker) {
  if (!legalName) return ticker || 'Unknown';
  return titleCaseWords(String(legalName).replace(/,?\s*inc\.?$/i, '').trim()) || ticker;
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
      text: String(c.text || '').replace(/^INSUFFICIENT_EVIDENCE[:\s]*/i, '').trim(),
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
      .replace(/^INSUFFICIENT_EVIDENCE[:\s]*/i, '')
      .trim();
    if (text) gaps.push(text.slice(0, 160));
  }
  for (const lim of sectionLimits.slice(0, 4)) {
    const text = String(lim || '')
      .replace(/^INSUFFICIENT_EVIDENCE[:\s]*/i, '')
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
  return lines.join('\n');
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
