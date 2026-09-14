// Canonical source for PII-13 "Evaluate Ops Alerts" Code node.
// Deterministic health checks from packed SQL snapshot (no LLM, no external send).

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

function toB64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function hoursSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
}

function numOrNull(value) {
  if (value == null || value === '' || value === 'null') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const validated = nodeJson('Validate Ops Request') || $input.first().json || {};
const configRow = nodeJson('Load Ops Config') || {};
const healthRow = nodeJson('Load Health Snapshot') || {};

const gates = configRow.gates_json || {};
const operations =
  gates.operations ||
  validated.operations_config ||
  $input.first().json.operations_config ||
  {};

const stuckHours = Number(operations.stuck_case_hours ?? 48);
const staleReviewHours = Number(operations.stale_review_hours ?? 168);
const failedLookbackHours = Number(
  validated.lookback_hours || operations.failed_run_lookback_hours || 72,
);
const deadLetterHours = Number(operations.unresolved_dead_letter_hours ?? 1);
const budgetEnabled = operations.budget_overrun_enabled !== false;
const maxAlerts = Number(operations.max_alerts_per_run ?? 50);
const terminalStates = new Set(
  (operations.terminal_states || [
    'COMPLETE',
    'INCOMPLETE',
    'FAILED',
    'SUPERSEDED',
  ]).map((s) => String(s).toUpperCase()),
);
const reviewStates = new Set(
  (operations.review_states || ['AWAITING_HUMAN_REVIEW']).map((s) =>
    String(s).toUpperCase(),
  ),
);
const materialTypes = new Set(
  (operations.material_alert_types || [
    'failed_workflow_run',
    'unresolved_dead_letter',
    'budget_overrun',
    'stuck_case',
  ]).map(String),
);

const cases = parseJsonArray(healthRow.cases_json);
const failedRuns = parseJsonArray(healthRow.failed_runs_json);
const deadLetters = parseJsonArray(healthRow.dead_letters_json);

const alerts = [];
const alertTypes = new Set();

function addAlert(alert) {
  if (!alert || !alert.dedupe_key) return;
  if (alerts.some((a) => a.dedupe_key === alert.dedupe_key)) return;
  if (alerts.length >= maxAlerts) return;
  alerts.push(alert);
  alertTypes.add(alert.alert_type);
}

for (const row of cases) {
  const caseId = String(row.case_id || row.id || '').trim();
  const state = String(row.state || '').trim().toUpperCase();
  if (!caseId || !state) continue;
  if (terminalStates.has(state)) continue;

  const ageHours = hoursSince(row.updated_at);
  if (ageHours == null) continue;

  const ticker = row.ticker || null;
  const limit = numOrNull(row.budget_usd_limit);
  const actual = numOrNull(row.budget_usd_actual);

  if (
    budgetEnabled &&
    limit != null &&
    actual != null &&
    actual > limit
  ) {
    addAlert({
      case_id: caseId,
      workflow_key: null,
      alert_type: 'budget_overrun',
      severity: 'HIGH',
      dedupe_key: 'budget_overrun:' + caseId,
      title: 'Budget overrun for case ' + (ticker || caseId),
      detail:
        'budget_usd_actual ' +
        actual +
        ' exceeds budget_usd_limit ' +
        limit +
        '.',
      payload_json: {
        case_id: caseId,
        ticker,
        budget_usd_limit: limit,
        budget_usd_actual: actual,
      },
    });
  }

  if (reviewStates.has(state)) {
    if (ageHours >= staleReviewHours) {
      addAlert({
        case_id: caseId,
        workflow_key: null,
        alert_type: 'stale_review',
        severity: 'MEDIUM',
        dedupe_key: 'stale_review:' + caseId + ':' + state,
        title: 'Stale human-review case ' + (ticker || caseId),
        detail:
          'Case in ' +
          state +
          ' for ~' +
          Math.floor(ageHours) +
          'h (threshold ' +
          staleReviewHours +
          'h).',
        payload_json: {
          case_id: caseId,
          ticker,
          state,
          age_hours: Math.floor(ageHours),
          threshold_hours: staleReviewHours,
        },
      });
    }
    continue;
  }

  if (ageHours >= stuckHours) {
    addAlert({
      case_id: caseId,
      workflow_key: null,
      alert_type: 'stuck_case',
      severity: 'HIGH',
      dedupe_key: 'stuck_case:' + caseId + ':' + state,
      title: 'Stuck case ' + (ticker || caseId) + ' in ' + state,
      detail:
        'Non-terminal state ' +
        state +
        ' unchanged for ~' +
        Math.floor(ageHours) +
        'h (threshold ' +
        stuckHours +
        'h).',
      payload_json: {
        case_id: caseId,
        ticker,
        state,
        age_hours: Math.floor(ageHours),
        threshold_hours: stuckHours,
      },
    });
  }
}

for (const row of failedRuns) {
  const runId = String(row.workflow_run_id || row.id || '').trim();
  if (!runId) continue;
  const ageHours = hoursSince(row.created_at || row.started_at || row.finished_at);
  if (ageHours != null && ageHours > failedLookbackHours) continue;

  const workflowKey = row.workflow_key || null;
  addAlert({
    case_id: row.case_id || null,
    workflow_key: workflowKey,
    alert_type: 'failed_workflow_run',
    severity: 'HIGH',
    dedupe_key: 'failed_run:' + runId,
    title: 'Failed workflow run ' + (workflowKey || runId),
    detail: String(row.error_summary || 'workflow_run status FAILED').slice(0, 500),
    payload_json: {
      workflow_run_id: runId,
      case_id: row.case_id || null,
      workflow_key: workflowKey,
      status: row.status || 'FAILED',
    },
  });
}

for (const row of deadLetters) {
  const dlqId = String(row.dead_letter_id || row.id || '').trim();
  if (!dlqId) continue;
  const ageHours = hoursSince(row.created_at);
  if (ageHours != null && ageHours < deadLetterHours) continue;

  addAlert({
    case_id: row.case_id || null,
    workflow_key: row.workflow_key || null,
    alert_type: 'unresolved_dead_letter',
    severity: 'HIGH',
    dedupe_key: 'dead_letter:' + dlqId,
    title: 'Unresolved dead letter ' + dlqId,
    detail: String(row.error_summary || row.error_class || 'unresolved DLQ').slice(
      0,
      500,
    ),
    payload_json: {
      dead_letter_id: dlqId,
      case_id: row.case_id || null,
      workflow_key: row.workflow_key || null,
      error_class: row.error_class || null,
    },
  });
}

const materialCount = alerts.filter((a) => materialTypes.has(a.alert_type)).length;
let outcome = 'HEALTHY';
let reason = 'no_ops_alerts';
if (alerts.length > 0 && materialCount > 0) {
  outcome = 'MATERIAL_ALERTS';
  reason = 'material_ops_alerts_detected';
} else if (alerts.length > 0) {
  outcome = 'ALERTS_RECORDED';
  reason = 'non_material_ops_alerts_detected';
}

const summaryParts = [];
if (alertTypes.has('stuck_case')) summaryParts.push('stuck_case');
if (alertTypes.has('stale_review')) summaryParts.push('stale_review');
if (alertTypes.has('failed_workflow_run')) summaryParts.push('failed_workflow_run');
if (alertTypes.has('unresolved_dead_letter')) {
  summaryParts.push('unresolved_dead_letter');
}
if (alertTypes.has('budget_overrun')) summaryParts.push('budget_overrun');
const summary =
  alerts.length === 0
    ? 'No operational alerts.'
    : 'Detected ' +
      alerts.length +
      ' alert(s): ' +
      summaryParts.join(', ') +
      '.';

const alertsForSql = alerts.map((a) => ({
  case_id: a.case_id || null,
  workflow_key: a.workflow_key || null,
  alert_type: a.alert_type,
  severity: a.severity,
  dedupe_key: a.dedupe_key,
  title: a.title,
  detail: a.detail || null,
  payload_json: a.payload_json || {},
  status: 'OPEN',
}));

const metadata = {
  outcome,
  reason,
  alert_count: alerts.length,
  material_alert_count: materialCount,
  alert_types: Array.from(alertTypes),
  failed_run_lookback_hours: failedLookbackHours,
  stuck_case_hours: stuckHours,
  stale_review_hours: staleReviewHours,
  delivery: 'db_only',
};

return [
  {
    json: {
      valid: true,
      n8n_execution_id: validated.n8n_execution_id || null,
      ops_run_id: validated.ops_run_id || null,
      outcome,
      reason,
      summary,
      alert_count: alerts.length,
      material_alert_count: materialCount,
      alert_types: Array.from(alertTypes),
      has_alerts: alerts.length > 0,
      counts: {
        alert_count: alerts.length,
        material_alert_count: materialCount,
        cases_scanned: cases.length,
        failed_runs_scanned: failedRuns.length,
        dead_letters_scanned: deadLetters.length,
      },
      alerts_json_b64: toB64(JSON.stringify(alertsForSql)),
      metadata_b64: toB64(JSON.stringify(metadata)),
    },
  },
];
