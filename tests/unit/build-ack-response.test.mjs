import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUILD_ACK_SCRIPT, runCodeNode } from '../helpers/run-code-node.mjs';

describe('build-ack-response', () => {
  it('builds a created-case acknowledgement', () => {
    const [result] = runCodeNode(BUILD_ACK_SCRIPT, {
      items: [
        {
          case_id: '660e8400-e29b-41d4-a716-446655440001',
          request_id: '550e8400-e29b-41d4-a716-446655440000',
          ticker: 'ACAD',
          state: 'REQUESTED',
          created: true,
        },
      ],
    });

    assert.equal(result.json.case_id, '660e8400-e29b-41d4-a716-446655440001');
    assert.equal(result.json.created, true);
    assert.match(result.json.message, /created/i);
    assert.ok(result.json.as_of);
  });

  it('builds an idempotent existing-case acknowledgement', () => {
    const [result] = runCodeNode(BUILD_ACK_SCRIPT, {
      items: [
        {
          case_id: '660e8400-e29b-41d4-a716-446655440001',
          request_id: '550e8400-e29b-41d4-a716-446655440000',
          ticker: 'ACAD',
          state: 'IDENTITY_REVIEW',
          created: false,
        },
      ],
    });

    assert.equal(result.json.created, false);
    assert.match(result.json.message, /Existing case returned/i);
    assert.equal(result.json.state, 'IDENTITY_REVIEW');
  });

  it('treats created="true" as created', () => {
    const [result] = runCodeNode(BUILD_ACK_SCRIPT, {
      items: [
        {
          case_id: '660e8400-e29b-41d4-a716-446655440001',
          request_id: '550e8400-e29b-41d4-a716-446655440000',
          ticker: 'ACAD',
          created: 'true',
        },
      ],
    });

    assert.equal(result.json.created, true);
  });
});
