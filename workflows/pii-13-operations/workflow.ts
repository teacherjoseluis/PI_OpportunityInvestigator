import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  expr,
} from '@n8n/workflow-sdk';

const validateOpsRequestCode = `// Canonical source for PII-13 "Validate Ops Request" Code node.
// Global health scan — case_id/ticker not required.

const crypto = require('crypto');

function toPositiveInt(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const results = [];

for (const item of $input.all()) {
  const body = item.json || {};
  const errors = [];

  const lookbackHoursRaw = body.lookback_hours ?? body.lookbackHours;
  if (
    lookbackHoursRaw != null &&
    lookbackHoursRaw !== '' &&
    (!Number.isFinite(Number(lookbackHoursRaw)) || Number(lookbackHoursRaw) <= 0)
  ) {
    errors.push('lookback_hours must be a positive number when provided');
  }

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
      lookback_hours:
        lookbackHoursRaw == null || lookbackHoursRaw === ''
          ? null
          : toPositiveInt(lookbackHoursRaw, null),
      n8n_execution_id: $execution.id,
      ops_run_id: crypto.randomUUID(),
    },
  });
}

return results;
`;
const evaluateOpsAlertsCode = `// Canonical source for PII-13 "Evaluate Ops Alerts" Code node.
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
`;
const prepareOpsAggregateCode = `// Slim payload after ops_alerts insert — drop alerts array from stream.

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const evaluated = nodeJson('Evaluate Ops Alerts') || {};

return [
  {
    json: {
      n8n_execution_id: evaluated.n8n_execution_id,
      ops_run_id: evaluated.ops_run_id || null,
      outcome: evaluated.outcome,
      reason: evaluated.reason,
      summary: evaluated.summary || null,
      alert_count: evaluated.alert_count || 0,
      material_alert_count: evaluated.material_alert_count || 0,
      alert_types: evaluated.alert_types || [],
      counts: evaluated.counts || {},
      metadata_b64: evaluated.metadata_b64 || '',
    },
  },
];
`;
const buildOpsResultCode = `// Canonical source for PII-13 "Build Ops Result" Code node.

const item = $input.first().json || {};
const counts = item.counts && typeof item.counts === 'object' ? item.counts : {};

let alertTypes = item.alert_types;
if (typeof alertTypes === 'string') {
  try {
    alertTypes = JSON.parse(alertTypes);
  } catch {
    alertTypes = [];
  }
}
if (!Array.isArray(alertTypes)) alertTypes = [];

return [
  {
    json: {
      outcome: item.outcome || 'FAILED',
      reason: item.reason || null,
      summary: item.summary || null,
      alert_count: Number(item.alert_count || counts.alert_count || 0),
      material_alert_count: Number(
        item.material_alert_count || counts.material_alert_count || 0,
      ),
      alert_types: alertTypes,
      counts,
      delivery: 'db_only',
      as_of: new Date().toISOString(),
    },
  },
];
`;

const opsTrigger = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'Ops Trigger',
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: {
        values: [{ name: 'lookback_hours', type: 'number' }],
      },
    },
  },
  output: [{}],
});

const validateOpsRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Ops Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: validateOpsRequestCode,
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
            id: 'summary',
            name: 'summary',
            value: 'Ops request validation failed.',
            type: 'string',
          },
          { id: 'alert-count', name: 'alert_count', value: 0, type: 'number' },
          {
            id: 'material-alert-count',
            name: 'material_alert_count',
            value: 0,
            type: 'number',
          },
          {
            id: 'alert-types',
            name: 'alert_types',
            value: expr('{{ ([]) }}'),
            type: 'array',
          },
          { id: 'counts', name: 'counts', value: expr('{{ ({}) }}'), type: 'object' },
        ],
      },
    },
  },
});

const loadOpsConfig = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Ops Config',
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

const loadHealthSnapshot = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Health Snapshot',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('case_id', id, 'ticker', ticker, 'exchange', exchange, 'state', state, 'outcome_class', outcome_class, 'updated_at', updated_at, 'budget_usd_limit', budget_usd_limit, 'budget_usd_actual', budget_usd_actual) ORDER BY updated_at ASC) FROM (SELECT id, ticker, exchange, state, outcome_class, updated_at, budget_usd_limit, budget_usd_actual FROM research_cases WHERE state NOT IN ('COMPLETE', 'INCOMPLETE', 'FAILED', 'SUPERSEDED') ORDER BY updated_at ASC LIMIT 100) c), '[]'::jsonb) AS cases_json, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'case_id', case_id, 'workflow_key', workflow_key, 'status', status, 'error_summary', LEFT(COALESCE(error_summary, ''), 400), 'started_at', started_at, 'finished_at', finished_at, 'created_at', created_at) ORDER BY created_at DESC) FROM (SELECT id, case_id, workflow_key, status, error_summary, started_at, finished_at, created_at FROM workflow_runs WHERE UPPER(status) IN ('FAILED', 'ERROR') AND created_at > NOW() - INTERVAL '14 days' ORDER BY created_at DESC LIMIT 100) w), '[]'::jsonb) AS failed_runs_json, COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'case_id', case_id, 'workflow_key', workflow_key, 'error_class', error_class, 'error_summary', LEFT(COALESCE(error_summary, ''), 400), 'created_at', created_at) ORDER BY created_at ASC) FROM (SELECT id, case_id, workflow_key, error_class, error_summary, created_at FROM dead_letter_items WHERE resolved = FALSE ORDER BY created_at ASC LIMIT 100) d), '[]'::jsonb) AS dead_letters_json",
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

const evaluateOpsAlerts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Ops Alerts',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: evaluateOpsAlertsCode,
    },
  },
});

const hasAlerts = ifElse({
  version: 2.3,
  config: {
    name: 'Has Alerts?',
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
            leftValue: expr('{{ $json.has_alerts }}'),
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  },
});

const insertOpsAlerts = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Insert Ops Alerts',
    alwaysOutputData: true,
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO ops_alerts (case_id, workflow_key, alert_type, severity, dedupe_key, title, detail, payload_json, status) SELECT NULLIF(NULLIF(TRIM(x.case_id), ''), 'null')::uuid, NULLIF(NULLIF(TRIM(x.workflow_key), ''), 'null'), x.alert_type, x.severity, x.dedupe_key, x.title, x.detail, COALESCE(x.payload_json, '{}'::jsonb), COALESCE(NULLIF(TRIM(x.status), ''), 'OPEN') FROM jsonb_to_recordset(convert_from(decode($1, 'base64'), 'UTF8')::jsonb) AS x(case_id text, workflow_key text, alert_type text, severity text, dedupe_key text, title text, detail text, payload_json jsonb, status text) WHERE NOT EXISTS (SELECT 1 FROM ops_alerts oa WHERE oa.dedupe_key = x.dedupe_key) RETURNING id AS ops_alert_id",
      options: {
        queryReplacement: expr('{{ $json.alerts_json_b64 }}'),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const prepareOpsAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Ops Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: prepareOpsAggregateCode,
    },
  },
});

const logWorkflowRun = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Log PII-13 Workflow Run',
    parameters: {
      operation: 'executeQuery',
      query:
        "INSERT INTO workflow_runs (case_id, workflow_key, n8n_execution_id, correlation_id, status, finished_at, metadata_json) VALUES (NULL, 'PII-13', $1, NULLIF(NULLIF(TRIM($2), ''), 'null')::uuid, 'SUCCEEDED', NOW(), convert_from(decode($3, 'base64'), 'UTF8')::jsonb) RETURNING id AS workflow_run_id",
      options: {
        queryReplacement: expr(
          '{{ $("Prepare Ops Aggregate").first().json.n8n_execution_id }},{{ $("Prepare Ops Aggregate").first().json.ops_run_id }},{{ $("Prepare Ops Aggregate").first().json.metadata_b64 }}',
        ),
        replaceEmptyStrings: true,
      },
    },
    credentials: {
      postgres: newCredential('Postgres account'),
    },
  },
});

const mergeOpsOutput = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Merge Ops Output',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'outcome',
            name: 'outcome',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.outcome }}'),
            type: 'string',
          },
          {
            id: 'reason',
            name: 'reason',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.reason }}'),
            type: 'string',
          },
          {
            id: 'summary',
            name: 'summary',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.summary }}'),
            type: 'string',
          },
          {
            id: 'alert-count',
            name: 'alert_count',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.alert_count }}'),
            type: 'number',
          },
          {
            id: 'material-alert-count',
            name: 'material_alert_count',
            value: expr(
              '{{ $("Prepare Ops Aggregate").first().json.material_alert_count }}',
            ),
            type: 'number',
          },
          {
            id: 'alert-types',
            name: 'alert_types',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.alert_types }}'),
            type: 'array',
          },
          {
            id: 'counts',
            name: 'counts',
            value: expr('{{ $("Prepare Ops Aggregate").first().json.counts }}'),
            type: 'object',
          },
        ],
      },
    },
  },
});

const buildOpsResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Ops Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: buildOpsResultCode,
    },
  },
});

const flowNote = sticky(
  '## PII-13 Operations\nDB-only health scan: stuck/stale cases,\nfailed runs, DLQ, budget overruns.\nNo external delivery in Phase 1.',
  [opsTrigger, validateOpsRequest, evaluateOpsAlerts],
  { color: 4 },
);

const persistenceNote = sticky(
  '## Persistence\nops_alerts upsert-by-dedupe,\nworkflow_runs PII-13. Case state unchanged.',
  [insertOpsAlerts, logWorkflowRun, buildOpsResult],
  { color: 5 },
);

export default workflow('pii-13-operations', 'PII-13 Operations and Alerts')
  .add(opsTrigger)
  .to(validateOpsRequest)
  .to(
    validationPassed
      .onFalse(prepareValidationError.to(buildOpsResult))
      .onTrue(
        loadOpsConfig
          .to(loadHealthSnapshot)
          .to(evaluateOpsAlerts)
          .to(
            hasAlerts
              .onTrue(
                insertOpsAlerts
                  .to(prepareOpsAggregate)
                  .to(logWorkflowRun)
                  .to(mergeOpsOutput)
                  .to(buildOpsResult),
              )
              .onFalse(
                prepareOpsAggregate
                  .to(logWorkflowRun)
                  .to(mergeOpsOutput)
                  .to(buildOpsResult),
              ),
          ),
      ),
  )
  .add(flowNote)
  .add(persistenceNote);
