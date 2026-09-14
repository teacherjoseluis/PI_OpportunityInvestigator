import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/validate-eligibility-request.js');

const valid = {
  case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
  ticker: 'ACAD',
  exchange: 'NASDAQ',
};

describe('validate-eligibility-request', () => {
  it('accepts a valid eligibility payload', () => {
    const [result] = runCodeNode(SCRIPT, { items: [valid] });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
    assert.equal(result.json.exchange, 'NASDAQ');
    assert.equal(result.json.case_id, valid.case_id);
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
      items: [{ ...valid, ticker: '' }],
    });
    assert.equal(result.json.valid, false);
    assert.ok(result.json.errors.some((e) => e.includes('ticker')));
  });
});
