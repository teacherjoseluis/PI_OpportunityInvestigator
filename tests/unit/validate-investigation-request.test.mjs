import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import validFixture from '../fixtures/investigation-request-valid.json' with { type: 'json' };
import { runCodeNode, VALIDATE_SCRIPT } from '../helpers/run-code-node.mjs';

describe('validate-investigation-request', () => {
  it('accepts a minimal valid payload and normalizes ticker', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, { items: [validFixture] });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
    assert.equal(result.json.exchange, 'NASDAQ');
    assert.equal(result.json.mode, 'FULL');
    assert.match(result.json.request_id, /^[0-9a-f-]{36}$/i);
    assert.equal(result.json.n8n_execution_id, 'test-exec-1');
  });

  it('reads fields from webhook body wrapper', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [{ body: validFixture }],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('preserves a valid provided request_id', () => {
    const requestId = '550e8400-e29b-41d4-a716-446655440000';
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [{ ...validFixture, request_id: requestId }],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.request_id, requestId);
    assert.equal(result.json.correlation_id, requestId);
  });

  it('accepts camelCase aliases', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [
        {
          ticker: 'MRNA',
          researchQuestion: 'Pipeline review',
          requestedBy: 'analyst',
          configurationVersion: 'v1',
          forceRefresh: true,
          asOfDate: '2026-09-02',
        },
      ],
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'MRNA');
    assert.equal(result.json.research_question, 'Pipeline review');
    assert.equal(result.json.requested_by, 'analyst');
    assert.equal(result.json.force_refresh, true);
    assert.equal(result.json.as_of_date, '2026-09-02');
  });

  it('rejects missing ticker', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [{ exchange: 'NASDAQ', mode: 'FULL' }],
    });

    assert.equal(result.json.valid, false);
    assert.equal(result.json.statusCode, 400);
    assert.ok(result.json.errors.some((e) => e.includes('ticker')));
  });

  it('rejects invalid mode', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [{ ...validFixture, mode: 'INVALID' }],
    });

    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('mode must be one of')));
  });

  it('rejects malformed request_id', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [{ ...validFixture, request_id: 'not-a-uuid' }],
    });

    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('request_id')));
  });

  it('rejects malformed as_of_date', () => {
    const [result] = runCodeNode(VALIDATE_SCRIPT, {
      items: [{ ...validFixture, as_of_date: '09/02/2026' }],
    });

    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('as_of_date')));
  });
});

describe('investigation-request schema fixture', () => {
  it('requires ticker in the JSON schema', () => {
    const schema = JSON.parse(
      readFileSync(
        new URL('../../workflows/shared/schemas/investigation-request.schema.json', import.meta.url),
        'utf8',
      ),
    );

    assert.deepEqual(schema.required, ['ticker']);
    assert.ok(schema.properties.mode.enum.includes('FULL'));
  });
});
