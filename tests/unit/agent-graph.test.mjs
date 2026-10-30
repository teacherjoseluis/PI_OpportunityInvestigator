import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import agentsConfig from '../../config/agents.v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN = path.join(repoRoot, 'workflows/shared/code/plan-agent-tasks.js');

function run(item) {
  const [result] = runCodeNode(PLAN, { items: [item] });
  return result.json;
}

function keysOf(tasks) {
  return tasks.map((task) => task.agent_key);
}

describe('agent envelopes', () => {
  it('accepts the specialist input and output contract', () => {
    const input = run({
      action: 'validate_envelope',
      kind: 'input',
      envelope: {
        task_id: '11111111-1111-4111-8111-111111111111',
        case_id: '22222222-2222-4222-8222-222222222222',
        agent_key: 'PII-16',
        objective: 'Compute weekly trend from stored bars.',
        mode: 'FULL',
      },
    });
    assert.equal(input.ok, true);
    const output = run({
      action: 'validate_envelope',
      kind: 'output',
      envelope: {
        task_id: '11111111-1111-4111-8111-111111111111',
        case_id: '22222222-2222-4222-8222-222222222222',
        agent_key: 'PII-16',
        status: 'INSUFFICIENT',
        outcome: 'INSUFFICIENT',
      },
    });
    assert.equal(output.ok, true);
    const bad = run({
      action: 'validate_envelope',
      kind: 'output',
      envelope: { task_id: 'x', case_id: 'y', agent_key: 'PII-16', status: 'EXPLODED' },
    });
    assert.equal(bad.ok, false);
  });
});

describe('supervisor DAG', () => {
  it('plans a FULL graph and stops before collection when eligibility fails', () => {
    const full = run({
      action: 'plan',
      mode: 'FULL',
      agents_config: agentsConfig,
    });
    const fullKeys = keysOf(full.planned_tasks);
    for (const key of ['PII-01', 'PII-02', 'PII-03-COVER', 'PII-04', 'PII-16', 'PII-09', 'PII-10', 'PII-11']) {
      assert.ok(fullKeys.includes(key), key);
    }
    assert.equal(full.planned_tasks.find((task) => task.agent_key === 'PII-01').status, 'READY');
    assert.ok(fullKeys.includes('PII-03-MKT'));
    assert.equal(full.shadow_plan_only, false);
    assert.equal(full.canvas_executes, 'SUPERVISOR_WAVES');
    assert.ok(String(full.dispatch_keys).includes('|PII-03-SEC|'));
    assert.ok(String(full.dispatch_keys).includes('|PII-16|'));
    assert.equal(String(full.dispatch_keys).includes('|PII-03|'), false);

    const stopped = run({
      action: 'plan',
      mode: 'FULL',
      eligibility_outcome: 'FAIL',
      agents_config: agentsConfig,
    });
    const stoppedKeys = keysOf(stopped.planned_tasks);
    assert.equal([...stoppedKeys].sort().join('|'), 'PII-01|PII-02');
  });

  it('plans an FDA reassessment subgraph and a SEC-only refresh', () => {
    const fda = run({
      action: 'plan',
      mode: 'EVENT_REASSESSMENT',
      event_type: 'FDA_DECISION',
      materiality: 'HIGH',
      agents_config: agentsConfig,
    });
    const fdaKeys = keysOf(fda.planned_tasks);
    for (const key of ['PII-03-FDA', 'PII-07', 'PII-16-EVENTS', 'PII-09', 'PII-10', 'PII-11']) {
      assert.ok(fdaKeys.includes(key), key);
    }
    assert.equal(fdaKeys.includes('PII-01'), false);
    assert.equal(fdaKeys.includes('PII-05'), false);

    const refresh = run({
      action: 'plan',
      mode: 'REFRESH',
      stale_sources: ['sec_edgar'],
      agents_config: agentsConfig,
    });
    const refreshKeys = keysOf(refresh.planned_tasks);
    assert.ok(refreshKeys.includes('PII-03-SEC'));
    assert.ok(refreshKeys.includes('PII-03-XBRL'));
    assert.ok(refreshKeys.includes('PII-04'));
    assert.equal(refreshKeys.includes('PII-03-CT'), false);
    assert.equal(refreshKeys.includes('PII-03-FDA'), false);
    assert.equal(refreshKeys.includes('PII-05'), false);
  });

  it('keeps SEC collectors in separate waves and joins specialists', () => {
    const plan = run({ action: 'plan', mode: 'FULL', agents_config: agentsConfig });
    const tasks = plan.planned_tasks.map((task) => ({ ...task }));
    for (const task of tasks) {
      if (task.agent_key === 'PII-01' || task.agent_key === 'PII-02') task.status = 'SUCCEEDED';
    }
    const first = run({ action: 'ready', tasks, agents_config: agentsConfig });
    assert.equal(first.wave, 'collect');
    assert.equal(first.agent_keys.includes('PII-03-SEC') && first.agent_keys.includes('PII-03-XBRL'), false);

    for (const task of tasks) {
      if (task.wave === 'collect' || task.agent_key === 'PII-03-COVER') task.status = 'SUCCEEDED';
    }
    const specialists = run({ action: 'ready', tasks, agents_config: agentsConfig });
    assert.equal(specialists.wave, 'specialists');
    for (const key of ['PII-04', 'PII-05', 'PII-06', 'PII-07', 'PII-08', 'PII-16']) {
      assert.ok(specialists.agent_keys.includes(key), key);
    }

    const insufficient = run({
      action: 'apply',
      tasks: specialists.tasks,
      result: { agent_key: 'PII-04', status: 'INSUFFICIENT', outcome: 'INSUFFICIENT' },
    });
    assert.notEqual(insufficient.decision.state, 'AWAITING_HUMAN_REVIEW');

    const failed = run({
      action: 'apply',
      tasks: specialists.tasks,
      result: { agent_key: 'PII-06', status: 'FAILED', outcome: 'FAILED' },
    });
    assert.equal(failed.decision.reason, 'mandatory_task_failed');
    const risk = failed.tasks.find((task) => task.agent_key === 'PII-09');
    assert.equal(risk.status, 'SKIPPED');
  });

  it('enqueues a fill-in collector inside the remaining HTTP budget', () => {
    const plan = run({ action: 'plan', mode: 'FULL', agents_config: agentsConfig });
    const tasks = plan.planned_tasks.map((task) => ({ ...task, status: 'SUCCEEDED' }));
    const replanned = run({
      action: 'replan',
      tasks,
      suggestions: [
        { agent_key: 'PII-03-MKT', reason: 'bars missing' },
        { agent_key: 'PII-03-MKT', reason: 'duplicate' },
      ],
      budget: { max_fill_ins: 2, remaining_http_calls: 1 },
    });
    assert.equal(replanned.added.map(String).join('|'), 'PII-03-MKT');
    assert.equal(replanned.remaining_http_calls, 0);
    const again = run({
      action: 'replan',
      tasks: replanned.tasks,
      suggestions: [{ agent_key: 'PII-03-NEWS', reason: 'second' }],
      budget: { max_fill_ins: 2, remaining_http_calls: 0 },
    });
    assert.equal(again.added.length, 0);
  });

  it('selects one fill-in collector from a specialist suggestion', () => {
    const decided = run({
      action: 'canvas_fill_in',
      suggestions: [{ agent_key: 'PII-03-MKT', reason: 'bars missing' }],
      budget: { max_fill_ins: 1, remaining_http_calls: 2 },
      request: { mode: 'FULL', agents_config: agentsConfig },
    });
    assert.equal(decided.run_fill_in, true);
    assert.ok(decided.fill_in_keys.includes('|PII-03-MKT|'));
  });

  it('runs a scripted supervisor to completion without treating INSUFFICIENT as failure', () => {
    const result = run({
      action: 'run',
      request: { mode: 'FULL', agents_config: agentsConfig },
      outcomes: {
        'PII-05': { status: 'INSUFFICIENT', outcome: 'INSUFFICIENT' },
      },
    });
    assert.equal(result.decision.state, 'COMPLETE');
    assert.ok(result.waves[0].includes('PII-01'));
    const growth = result.tasks.find((task) => task.agent_key === 'PII-05');
    assert.equal(growth.status, 'INSUFFICIENT');
  });
});
