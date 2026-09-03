import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import inputFixture from '../fixtures/identity-resolve-input.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/validate-identity-request.js');

describe('validate-identity-request', () => {
  it('accepts a valid case identity payload', () => {
    const [result] = runCodeNode(SCRIPT, { items: [inputFixture] });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
    assert.equal(result.json.exchange, 'NASDAQ');
    assert.equal(result.json.case_id, inputFixture.case_id);
    assert.equal(result.json.min_identity_confidence, 80);
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
    });

    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('case_id')));
  });

  it('rejects invalid ticker', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [{ ...inputFixture, ticker: '' }],
    });

    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('ticker')));
  });
});
