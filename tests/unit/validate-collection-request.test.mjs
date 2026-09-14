import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/validate-collection-request.js');

const valid = {
  case_id: '91815cf2-865d-4173-8263-f490cc129608',
  ticker: 'ACAD',
  exchange: 'NASDAQ',
};

describe('validate-collection-request', () => {
  it('accepts a valid collection payload', () => {
    const [result] = runCodeNode(SCRIPT, { items: [valid] });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
    });
    assert.equal(result.json.valid, false);
  });
});
