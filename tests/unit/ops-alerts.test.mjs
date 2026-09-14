import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import opsConfig from '../fixtures/ops-alerts-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-ops-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-ops-alerts.js');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-ops-aggregate.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-ops-result.js');

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

describe('validate-ops-request', () => {
  it('accepts an empty payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{}],
      executionId: 'exec-ops-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.lookback_hours, null);
    assert.equal(result.json.n8n_execution_id, 'exec-ops-1');
    assert.match(
      result.json.ops_run_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('accepts optional lookback_hours', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ lookback_hours: 24 }],
      executionId: 'exec-ops-2',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.lookback_hours, 24);
  });

  it('rejects non-positive lookback_hours', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ lookback_hours: 0 }],
      executionId: 'exec-ops-3',
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });
});

describe('evaluate-ops-alerts', () => {
  it('returns HEALTHY when snapshot is empty', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ operations_config: opsConfig }],
      nodes: {
        'Validate Ops Request': [{ valid: true, n8n_execution_id: 'e1', ops_run_id: 'e1-ops' }],
        'Load Ops Config': [{ gates_json: { operations: opsConfig } }],
        'Load Health Snapshot': [
          {
            cases_json: [],
            failed_runs_json: [],
            dead_letters_json: [],
          },
        ],
      },
    });
    assert.equal(result.json.outcome, 'HEALTHY');
    assert.equal(result.json.alert_count, 0);
    assert.equal(result.json.has_alerts, false);
  });

  it('detects stuck cases, stale review, failed runs, DLQ, and budget overrun', () => {
    const caseStuck = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const caseReview = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const caseBudget = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const runId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const dlqId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Ops Request': [{ valid: true, n8n_execution_id: 'e2', ops_run_id: 'e2-ops' }],
        'Load Ops Config': [{ gates_json: { operations: opsConfig } }],
        'Load Health Snapshot': [
          {
            cases_json: [
              {
                case_id: caseStuck,
                ticker: 'STUK',
                state: 'ANALYZING',
                updated_at: hoursAgoIso(72),
              },
              {
                case_id: caseReview,
                ticker: 'ACAD',
                state: 'AWAITING_HUMAN_REVIEW',
                updated_at: hoursAgoIso(200),
              },
              {
                case_id: caseBudget,
                ticker: 'BUDG',
                state: 'COLLECTING',
                updated_at: hoursAgoIso(1),
                budget_usd_limit: 5,
                budget_usd_actual: 9.5,
              },
            ],
            failed_runs_json: [
              {
                id: runId,
                case_id: caseStuck,
                workflow_key: 'PII-03',
                status: 'FAILED',
                error_summary: 'timeout',
                created_at: hoursAgoIso(2),
              },
            ],
            dead_letters_json: [
              {
                id: dlqId,
                case_id: caseStuck,
                workflow_key: 'PII-03',
                error_class: 'HTTP_ERROR',
                error_summary: 'collector failed',
                created_at: hoursAgoIso(3),
              },
            ],
          },
        ],
      },
    });

    assert.equal(result.json.outcome, 'MATERIAL_ALERTS');
    assert.ok(result.json.alert_count >= 5);
    assert.ok(result.json.material_alert_count >= 4);
    assert.ok(result.json.alert_types.includes('stuck_case'));
    assert.ok(result.json.alert_types.includes('stale_review'));
    assert.ok(result.json.alert_types.includes('failed_workflow_run'));
    assert.ok(result.json.alert_types.includes('unresolved_dead_letter'));
    assert.ok(result.json.alert_types.includes('budget_overrun'));
    assert.ok(result.json.alerts_json_b64);
    assert.ok(result.json.metadata_b64);

    const decoded = JSON.parse(
      Buffer.from(result.json.alerts_json_b64, 'base64').toString('utf8'),
    );
    assert.ok(decoded.some((a) => a.dedupe_key === 'stuck_case:' + caseStuck + ':ANALYZING'));
    assert.ok(decoded.some((a) => a.dedupe_key === 'stale_review:' + caseReview + ':AWAITING_HUMAN_REVIEW'));
    assert.ok(decoded.some((a) => a.dedupe_key === 'failed_run:' + runId));
    assert.ok(decoded.some((a) => a.dedupe_key === 'dead_letter:' + dlqId));
    assert.ok(decoded.some((a) => a.dedupe_key === 'budget_overrun:' + caseBudget));
  });

  it('returns ALERTS_RECORDED when only non-material stale_review exists', () => {
    const caseReview = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Ops Request': [{ valid: true, n8n_execution_id: 'e3' }],
        'Load Ops Config': [{ gates_json: { operations: opsConfig } }],
        'Load Health Snapshot': [
          {
            cases_json: [
              {
                case_id: caseReview,
                ticker: 'ACAD',
                state: 'AWAITING_HUMAN_REVIEW',
                updated_at: hoursAgoIso(200),
              },
            ],
            failed_runs_json: [],
            dead_letters_json: [],
          },
        ],
      },
    });
    assert.equal(result.json.outcome, 'ALERTS_RECORDED');
    assert.equal(result.json.material_alert_count, 0);
    assert.deepEqual(result.json.alert_types, ['stale_review']);
  });
});

describe('prepare-ops-aggregate and build-ops-result', () => {
  it('slims evaluate output and builds final result', () => {
    const [prepared] = runCodeNode(PREPARE, {
      items: [{}],
      nodes: {
        'Evaluate Ops Alerts': [
          {
            n8n_execution_id: 'e4',
            ops_run_id: 'e4-ops',
            outcome: 'MATERIAL_ALERTS',
            reason: 'material_ops_alerts_detected',
            summary: 'Detected 2 alert(s): stuck_case.',
            alert_count: 2,
            material_alert_count: 1,
            alert_types: ['stuck_case', 'stale_review'],
            counts: { alert_count: 2 },
            metadata_b64: 'e30=',
            alerts_json_b64: 'should-be-dropped',
          },
        ],
      },
    });
    assert.equal(prepared.json.outcome, 'MATERIAL_ALERTS');
    assert.equal(prepared.json.alert_count, 2);
    assert.equal(prepared.json.alerts_json_b64, undefined);

    const [built] = runCodeNode(BUILD, {
      items: [prepared.json],
    });
    assert.equal(built.json.outcome, 'MATERIAL_ALERTS');
    assert.equal(built.json.delivery, 'db_only');
    assert.deepEqual(built.json.alert_types, ['stuck_case', 'stale_review']);
    assert.ok(built.json.as_of);
  });
});
