import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import slackFixture from '../fixtures/slack-slash-regn.json' with { type: 'json' };
import {
  runCodeNode,
  PARSE_SLACK_SCRIPT,
  BUILD_SLACK_FOLLOWUP_SCRIPT,
} from '../helpers/run-code-node.mjs';

describe('parse-slack-slash-command', () => {
  it('parses ticker and exchange from slash text', () => {
    const [result] = runCodeNode(PARSE_SLACK_SCRIPT, {
      items: [{ body: slackFixture }],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'REGN');
    assert.equal(result.json.exchange, 'NASDAQ');
    assert.equal(result.json.mode, 'FULL');
    assert.equal(result.json.requested_by, 'slack:joseluis');
    assert.deepEqual(result.json.request_context.slack.user_id, 'U00000000');
    assert.match(result.json.slack_immediate.text, /REGN/);
  });

  it('defaults exchange to NASDAQ when omitted', () => {
    const [result] = runCodeNode(PARSE_SLACK_SCRIPT, {
      items: [{ body: { ...slackFixture, text: 'acad' } }],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
    assert.equal(result.json.exchange, 'NASDAQ');
  });

  it('treats non-exchange second token as research question', () => {
    const [result] = runCodeNode(PARSE_SLACK_SCRIPT, {
      items: [{ body: { ...slackFixture, text: 'MRNA cash runway check' } }],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'MRNA');
    assert.equal(result.json.exchange, 'NASDAQ');
    assert.equal(result.json.research_question, 'cash runway check');
  });

  it('captures exchange plus research question', () => {
    const [result] = runCodeNode(PARSE_SLACK_SCRIPT, {
      items: [
        {
          body: {
            ...slackFixture,
            text: 'REGN NYSE Does the current evidence justify deeper research?',
          },
        },
      ],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.exchange, 'NYSE');
    assert.equal(
      result.json.research_question,
      'Does the current evidence justify deeper research?',
    );
  });

  it('rejects empty text with usage guidance', () => {
    const [result] = runCodeNode(PARSE_SLACK_SCRIPT, {
      items: [{ body: { ...slackFixture, text: '' } }],
    });

    assert.equal(result.json.valid, false);
    assert.match(result.json.slack_immediate.text, /Usage:/);
  });

  it('rejects invalid ticker', () => {
    const [result] = runCodeNode(PARSE_SLACK_SCRIPT, {
      items: [{ body: { ...slackFixture, text: '!!!' } }],
    });

    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('ticker')));
  });
});

describe('build-slack-followup', () => {
  it('builds success follow-up from PII-00 ack', () => {
    const [result] = runCodeNode(BUILD_SLACK_FOLLOWUP_SCRIPT, {
      items: [
        {
          case_id: 'a732aa53-a065-4682-b062-5173e2e4f88d',
          request_id: '550e8400-e29b-41d4-a716-446655440000',
          ticker: 'REGN',
          state: 'REQUESTED',
          created: true,
          message: 'Investigation case created. Processing continues asynchronously.',
        },
      ],
      nodes: {
        'Parse Slack Slash Command': [
          {
            valid: true,
            ticker: 'REGN',
            exchange: 'NASDAQ',
            response_url: slackFixture.response_url,
            user_name: 'joseluis',
            channel_id: 'C00000000',
          },
        ],
      },
    });

    assert.equal(result.json.outcome, 'ACKED');
    assert.equal(result.json.case_id, 'a732aa53-a065-4682-b062-5173e2e4f88d');
    assert.match(result.json.slack_followup.text, /case_id/);
  });

  it('builds failure follow-up when ack lacks case_id', () => {
    const [result] = runCodeNode(BUILD_SLACK_FOLLOWUP_SCRIPT, {
      items: [{ error: 'validation_failed' }],
      nodes: {
        'Parse Slack Slash Command': [
          {
            valid: true,
            ticker: 'REGN',
            exchange: 'NASDAQ',
            response_url: slackFixture.response_url,
            user_name: 'joseluis',
            channel_id: 'C00000000',
          },
        ],
      },
    });

    assert.equal(result.json.outcome, 'FAILED');
    assert.match(result.json.slack_followup.text, /Failed to start/);
  });
});
