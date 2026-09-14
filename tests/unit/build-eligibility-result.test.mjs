import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/build-eligibility-result.js');

describe('build-eligibility-result', () => {
  it('shapes eligibility output payload', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        {
          case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          outcome: 'PASS',
          next_state: 'COLLECTING',
          market_cap_usd: 2500000000,
          adv_dollar_usd: 45100000,
          rules: [{ key: 'allowed_exchange', status: 'PASS' }],
        },
      ],
    });

    assert.equal(result.json.outcome, 'PASS');
    assert.equal(result.json.next_state, 'COLLECTING');
    assert.equal(result.json.ticker, 'ACAD');
    assert.equal(result.json.rules.length, 1);
    assert.ok(result.json.as_of);
  });
});
