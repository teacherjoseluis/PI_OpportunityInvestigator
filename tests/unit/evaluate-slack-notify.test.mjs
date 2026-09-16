import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(
  repoRoot,
  'workflows/shared/code/validate-slack-notify-request.js',
);
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-slack-notify.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-slack-notify-result.js');

const caseId = 'a732aa53-a065-4682-b062-5173e2e4f88d';

describe('validate-slack-notify-request', () => {
  it('accepts case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ case_id: caseId, ticker: 'REGN', exchange: 'NASDAQ' }],
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.case_id, caseId);
    assert.equal(result.json.mode, 'COMPLETION');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, { items: [{ ticker: 'REGN' }] });
    assert.equal(result.json.valid, false);
  });

  it('passes through EARLY_EXIT mode and stage fields', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: caseId,
          ticker: 'REGN',
          exchange: 'NASDAQ',
          mode: 'early_exit',
          stage: 'eligibility',
          reason: 'market_cap_range',
          outcome: 'FAIL',
          next_state: 'INCOMPLETE',
          detail: 'cap below min',
        },
      ],
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.mode, 'EARLY_EXIT');
    assert.equal(result.json.stage, 'eligibility');
    assert.equal(result.json.reason, 'market_cap_range');
    assert.equal(result.json.outcome, 'FAIL');
    assert.equal(result.json.next_state, 'INCOMPLETE');
    assert.equal(result.json.detail, 'cap below min');
  });
});

describe('evaluate-slack-notify', () => {
  function nodes(overrides = {}) {
    return {
      'Validate Slack Notify Request': [
        {
          valid: true,
          case_id: caseId,
          ticker: 'REGN',
          exchange: 'NASDAQ',
          mode: overrides.mode || 'COMPLETION',
          stage: overrides.stage || null,
          reason: overrides.requestReason || null,
          outcome: overrides.requestOutcome || null,
          next_state: overrides.requestNextState || null,
          detail: overrides.detail || null,
          n8n_execution_id: 'test-exec-1',
        },
      ],
      'Load Slack Notify Config': [
        {
          gates_json: {
            slack_notify: {
              enabled: true,
              notify_on_report_draft: true,
              notify_on_early_exit: true,
              include_scores: true,
              include_gates: true,
              ...(overrides.cfg || {}),
            },
          },
        },
      ],
      'Load Case And Latest Report': [
        {
          case_id: caseId,
          ticker: 'REGN',
          exchange: 'NASDAQ',
          case_state: 'AWAITING_HUMAN_REVIEW',
          outcome_class: 'MONITOR',
          legal_name: 'REGENERON PHARMACEUTICALS INC',
          request_context_json: {
            source: 'slack',
            slack: { user_id: 'U123', channel_id: 'C456', user_name: 'joseluis' },
          },
          report_id: '11111111-1111-4111-8111-111111111111',
          version_number: 1,
          schema_valid: true,
          publication_ready: false,
          scores_json: { growth_score: 55, risk_score: 40 },
          outcome_json: { gates_blocking: ['cash_debt_from_filing'] },
          ...overrides.caseRow,
        },
      ],
      'Load Prior Slack Deliveries': [
        {
          deliveries_json: overrides.prior || [],
        },
      ],
    };
  }

  it('sends DM summary when slack user and report exist', () => {
    const [result] = runCodeNode(EVALUATE, { items: [{}], nodes: nodes() });
    assert.equal(result.json.should_send, true);
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.recipient, 'U123');
    assert.match(result.json.message_text, /REGN/);
    assert.match(result.json.message_text, /cash & debt/);
    assert.match(result.json.dedupe_key, /COMPLETION/);
  });

  it('skips when no slack context', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: nodes({
        caseRow: { request_context_json: {} },
      }),
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.reason, 'no_slack_context');
  });

  it('skips duplicates', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: nodes({
        prior: [
          {
            dedupe_key: `slack:COMPLETION:${caseId}:v1`,
            status: 'SENT',
          },
        ],
      }),
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.outcome, 'SKIPPED_DUPLICATE');
  });

  it('EARLY_EXIT sends without report and mentions market_cap_range / eligibility', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: nodes({
        mode: 'EARLY_EXIT',
        stage: 'eligibility',
        requestReason: 'market_cap_range',
        requestOutcome: 'FAIL',
        requestNextState: 'INCOMPLETE',
        caseRow: {
          report_id: null,
          version_number: null,
          case_state: 'INCOMPLETE',
          outcome_class: null,
          scores_json: null,
          outcome_json: null,
        },
      }),
    });
    assert.equal(result.json.should_send, true);
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.delivery_type, 'EARLY_EXIT');
    assert.equal(result.json.report_id, null);
    assert.match(result.json.message_text, /market_cap_range/);
    assert.match(result.json.message_text, /eligibility/);
    assert.match(result.json.message_text, /Market cap is outside/);
    assert.match(result.json.message_text, /No research email or report/);
    assert.equal(result.json.dedupe_key, `slack:EARLY_EXIT:${caseId}:eligibility`);
  });

  it('EARLY_EXIT skips without slack context', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: nodes({
        mode: 'EARLY_EXIT',
        stage: 'eligibility',
        requestReason: 'market_cap_range',
        caseRow: {
          request_context_json: {},
          report_id: null,
          version_number: null,
        },
      }),
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.reason, 'no_slack_context');
  });

  it('EARLY_EXIT duplicate dedupe', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: nodes({
        mode: 'EARLY_EXIT',
        stage: 'evidence',
        requestReason: 'no_evidence_collected',
        caseRow: {
          report_id: null,
          version_number: null,
        },
        prior: [
          {
            dedupe_key: `slack:EARLY_EXIT:${caseId}:evidence`,
            status: 'SENT',
          },
        ],
      }),
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.outcome, 'SKIPPED_DUPLICATE');
    assert.equal(result.json.dedupe_key, `slack:EARLY_EXIT:${caseId}:evidence`);
  });
});

describe('build-slack-notify-result', () => {
  it('shapes final payload', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: caseId,
          ticker: 'REGN',
          outcome: 'SENT',
          delivery_status: 'SENT',
          gates_blocking: ['cash_debt_from_filing'],
          counts: { prior_deliveries: 0 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.ticker, 'REGN');
    assert.deepEqual(result.json.gates_blocking, ['cash_debt_from_filing']);
  });
});
