import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/validate-financial-request.js');

describe('validate-financial-request', () => {
  it('accepts a valid financial payload', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-fin-1',
    });

    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
    assert.equal(result.json.n8n_execution_id, 'exec-fin-1');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [{ ticker: 'ACAD' }],
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });
});
