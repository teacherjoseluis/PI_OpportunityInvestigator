// Canonical source for PII-15 "Evaluate Slack Notify" Code node.
// Decides send vs skip; builds Slack DM text; no LLM.

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

function humanGate(key) {
  const map = {
    cash_debt_from_filing: 'cash & debt from filings',
    schema_valid_report: 'report schema validation',
    publication_ready: 'publication readiness',
  };
  return map[key] || String(key || '').replace(/_/g, ' ');
}

function humanEarlyExitReason(key) {
  const map = {
    market_cap_range: 'Market cap is outside the configured eligibility range.',
    duplicate_recent_case: 'A recent investigation already exists for this ticker.',
    profile_unavailable: 'Company profile data was unavailable from market-data providers.',
    market_cap_unavailable: 'Market-cap data was unavailable from market-data providers.',
    adv_unavailable: 'Average daily volume data was unavailable.',
    industry_not_allowed: 'Industry is outside the configured eligibility allowlist.',
    no_evidence_collected: 'No usable evidence documents were collected.',
    sec_failed_partial: 'SEC collection failed or returned only partial coverage.',
    ctgov_failed_partial: 'ClinicalTrials.gov collection failed or returned only partial coverage.',
    coverage_insufficient: 'Evidence coverage did not meet the minimum gate.',
    human_review: 'Eligibility requires human review before collection can continue.',
    fail: 'Eligibility failed; investigation stopped.',
  };
  const k = String(key || '').trim();
  if (!k) return null;
  return map[k] || String(k).replace(/_/g, ' ');
}

function scoreLine(label, value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return null;
  return `• ${label}: ${Math.round(Number(value))}`;
}

const request = nodeJson('Validate Slack Notify Request') || {};
const configRow = nodeJson('Load Slack Notify Config') || {};
const caseRow = nodeJson('Load Case And Latest Report') || {};
const priorRow = nodeJson('Load Prior Slack Deliveries') || {};

const gatesRoot = parseJson(configRow.gates_json, {});
const cfg = gatesRoot.slack_notify || {};
const enabled = cfg.enabled !== false;
const notifyOnDraft = cfg.notify_on_report_draft !== false;
const notifyOnEarlyExit = cfg.notify_on_early_exit !== false;
const maxChars = Number(cfg.max_message_chars) || 3500;
const includeScores = cfg.include_scores !== false;
const includeGates = cfg.include_gates !== false;

const modeRaw = String(request.mode || 'COMPLETION')
  .trim()
  .toUpperCase();
const isEarlyExit = modeRaw === 'EARLY_EXIT';
const deliveryType = isEarlyExit
  ? 'EARLY_EXIT'
  : String(cfg.delivery_type || 'COMPLETION').trim() || 'COMPLETION';

const requestStage = request.stage ? String(request.stage).trim() : '';
const requestReason = request.reason ? String(request.reason).trim() : '';
const requestOutcome = request.outcome ? String(request.outcome).trim() : '';
const requestNextState = request.next_state ? String(request.next_state).trim() : '';
const requestDetail = request.detail ? String(request.detail).trim() : '';

const requestContext = parseJson(caseRow.request_context_json, {});
const slackCtx =
  requestContext && typeof requestContext.slack === 'object' && requestContext.slack
    ? requestContext.slack
    : {};
const slackUserId = String(slackCtx.user_id || '').trim();
const originChannelId = String(slackCtx.channel_id || '').trim() || null;

const prior = parseJsonArray(priorRow.deliveries_json);
const reportId = caseRow.report_id || null;
const reportVersion =
  caseRow.version_number == null || caseRow.version_number === ''
    ? null
    : Number(caseRow.version_number);
const publicationReady = asBool(caseRow.publication_ready);
const schemaValid = asBool(caseRow.schema_valid);
const ticker = caseRow.ticker || request.ticker || 'UNKNOWN';
const exchange = caseRow.exchange || request.exchange || null;
const caseState = caseRow.case_state || null;
const outcomeClass = caseRow.outcome_class || null;
const legalName = caseRow.legal_name || null;
const caseId = request.case_id || caseRow.case_id;

const outcomeJson = parseJson(caseRow.outcome_json, {});
const scoresJson = parseJson(caseRow.scores_json, {});
const gatesBlocking = parseJsonArray(
  outcomeJson.gates_blocking || outcomeJson.blocking_gates || [],
);

const stageKey = requestStage || 'unknown';
const dedupeKey = isEarlyExit
  ? ['slack', 'EARLY_EXIT', caseId, stageKey].join(':')
  : [
      'slack',
      deliveryType,
      caseId,
      reportVersion == null ? 'noreport' : `v${reportVersion}`,
    ].join(':');

const alreadySent = prior.some(
  (d) =>
    d &&
    String(d.dedupe_key) === dedupeKey &&
    String(d.status || '').toUpperCase() === 'SENT',
);

let shouldSend = false;
let outcome = 'SKIPPED';
let reason = null;
let deliveryStatus = 'SKIPPED';
let errorSummary = null;

if (!enabled) {
  reason = 'disabled';
} else if (!slackUserId) {
  reason = 'no_slack_context';
} else if (isEarlyExit) {
  if (!notifyOnEarlyExit) {
    reason = 'early_exit_not_notified';
  } else if (alreadySent) {
    outcome = 'SKIPPED_DUPLICATE';
    reason = 'duplicate';
    deliveryStatus = 'SKIPPED_DUPLICATE';
  } else {
    shouldSend = true;
    outcome = 'SENT';
    reason = requestReason || 'early_exit';
    deliveryStatus = 'SENT';
  }
} else if (!reportId) {
  reason = 'missing_report';
} else if (!notifyOnDraft && !publicationReady) {
  reason = 'draft_not_notified';
} else if (alreadySent) {
  outcome = 'SKIPPED_DUPLICATE';
  reason = 'duplicate';
  deliveryStatus = 'SKIPPED_DUPLICATE';
} else {
  shouldSend = true;
  outcome = 'SENT';
  reason = publicationReady ? 'publication_ready' : 'report_draft';
  deliveryStatus = 'SENT';
}

const lines = [];

if (isEarlyExit) {
  lines.push(
    `*PII investigation stopped — no full analysis — ${ticker}*${exchange ? ` (${exchange})` : ''}`,
  );
  if (legalName) lines.push(String(legalName));
  lines.push('');
  lines.push(`• case_id: \`${caseId}\``);
  if (requestStage) lines.push(`• stage: \`${requestStage}\``);
  if (requestOutcome) lines.push(`• outcome: \`${requestOutcome}\``);
  if (requestNextState) lines.push(`• next_state: \`${requestNextState}\``);
  if (requestReason) lines.push(`• reason: \`${requestReason}\``);

  const humanized = humanEarlyExitReason(requestReason);
  if (humanized) {
    lines.push('');
    lines.push(`*Why:* ${humanized}`);
  }
  if (requestDetail && requestDetail !== requestReason) {
    lines.push(`*Detail:* ${requestDetail}`);
  }

  lines.push('');
  lines.push('_No research email or report was generated for this run._');
} else {
  lines.push(`*PII investigation complete — ${ticker}*${exchange ? ` (${exchange})` : ''}`);
  if (legalName) lines.push(String(legalName));
  lines.push('');
  lines.push(`• case_id: \`${caseId}\``);
  if (caseState) lines.push(`• state: \`${caseState}\``);
  if (outcomeClass) lines.push(`• outcome: \`${outcomeClass}\``);
  lines.push(`• report: v${reportVersion == null ? '?' : reportVersion}`);
  lines.push(`• publication_ready: ${publicationReady ? 'yes' : 'no'}`);
  lines.push(`• schema_valid: ${schemaValid ? 'yes' : 'no'}`);

  if (includeScores && scoresJson && typeof scoresJson === 'object') {
    const scoreLines = [
      scoreLine('business quality', scoresJson.business_quality_score ?? scoresJson.business),
      scoreLine('growth', scoresJson.growth_score ?? scoresJson.growth),
      scoreLine('pipeline', scoresJson.pipeline_score ?? scoresJson.pipeline),
      scoreLine('risk', scoresJson.risk_score ?? scoresJson.risk),
    ].filter(Boolean);
    if (scoreLines.length > 0) {
      lines.push('');
      lines.push('*Scores*');
      lines.push(...scoreLines);
    }
  }

  if (includeGates && gatesBlocking.length > 0) {
    lines.push('');
    lines.push('*Blocking gates*');
    for (const g of gatesBlocking.slice(0, 6)) {
      lines.push(`• ${humanGate(g)}`);
    }
  }

  lines.push('');
  lines.push(
    '_Full research memo remains available via email (PII-14). This DM is a completion summary only._',
  );
}

const messageText = truncate(lines.join('\n'), maxChars);
const subject = isEarlyExit
  ? `PII ${ticker} EARLY_EXIT ${requestStage || 'stopped'}`
  : `PII ${ticker} ${publicationReady ? 'REPORT' : 'DRAFT'} v${reportVersion == null ? '?' : reportVersion}`;

const deliveryRow = {
  case_id: caseId,
  report_id: isEarlyExit ? null : reportId,
  delivery_type: deliveryType,
  recipient: slackUserId || 'unknown',
  channel_id: originChannelId,
  subject,
  text_preview: messageText.slice(0, 500),
  status: shouldSend
    ? 'SENT'
    : deliveryStatus === 'SKIPPED_DUPLICATE'
      ? 'SKIPPED_DUPLICATE'
      : 'SKIPPED',
  dedupe_key: dedupeKey,
  error_summary: errorSummary,
};

const metadata = {
  outcome,
  reason,
  should_send: shouldSend,
  delivery_type: deliveryType,
  mode: isEarlyExit ? 'EARLY_EXIT' : 'COMPLETION',
  stage: requestStage || null,
  request_reason: requestReason || null,
  request_outcome: requestOutcome || null,
  next_state: requestNextState || null,
  detail: requestDetail || null,
  dedupe_key: dedupeKey,
  report_id: isEarlyExit ? null : reportId,
  report_version: isEarlyExit ? null : reportVersion,
  publication_ready: publicationReady,
  schema_valid: schemaValid,
  gates_blocking: gatesBlocking,
  slack_user_id: slackUserId || null,
  origin_channel_id: originChannelId,
};

return [
  {
    json: {
      case_id: caseId,
      company_id: caseRow.company_id || null,
      ticker,
      exchange,
      legal_name: legalName,
      n8n_execution_id: request.n8n_execution_id || $execution.id,
      outcome,
      reason,
      should_send: shouldSend,
      delivery_type: deliveryType,
      delivery_status: deliveryStatus,
      mode: isEarlyExit ? 'EARLY_EXIT' : 'COMPLETION',
      stage: requestStage || null,
      report_id: isEarlyExit ? null : reportId,
      report_version: isEarlyExit ? null : reportVersion,
      recipient: slackUserId || null,
      origin_channel_id: originChannelId,
      subject,
      message_text: messageText,
      schema_valid: schemaValid,
      publication_ready: publicationReady,
      gates_blocking: gatesBlocking,
      dedupe_key: dedupeKey,
      counts: {
        prior_deliveries: prior.length,
      },
      delivery_json_b64: toB64(JSON.stringify([deliveryRow])),
      metadata_b64: toB64(JSON.stringify(metadata)),
    },
  },
];
