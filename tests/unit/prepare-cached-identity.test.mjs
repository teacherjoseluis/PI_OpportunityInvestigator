import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/prepare-cached-identity.js');

describe('prepare-cached-identity', () => {
  it('reuses an existing security with high confidence', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        {
          case_id: '70883370-8893-4534-a148-2aa4172f497b',
          company_id: '11111111-1111-4111-8111-111111111111',
          security_id: '22222222-2222-4222-8222-222222222222',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          cik: '0001561582',
          legal_name: 'ACADIA PHARMACEUTICALS INC',
          identity_confidence: 95,
          min_identity_confidence: 80,
        },
      ],
    });

    assert.equal(result.json.reused_existing, true);
    assert.equal(result.json.outcome, 'RESOLVED');
    assert.equal(result.json.next_state, 'ELIGIBILITY_REVIEW');
    assert.ok(result.json.identity_confidence >= 90);
  });
});
