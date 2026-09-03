import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sample from '../fixtures/edgar-company-tickers-exchange-sample.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/resolve-edgar-identity.js');

describe('resolve-edgar-identity', () => {
  it('resolves ACAD on NASDAQ with high confidence', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        {
          ...sample,
          case_id: '70883370-8893-4534-a148-2aa4172f497b',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          min_identity_confidence: 80,
        },
      ],
    });

    assert.equal(result.json.resolved, true);
    assert.equal(result.json.cik, '0001561582');
    assert.equal(result.json.legal_name, 'ACADIA PHARMACEUTICALS INC');
    assert.equal(result.json.identity_confidence, 95);
    assert.equal(result.json.outcome, 'RESOLVED');
    assert.equal(result.json.next_state, 'ELIGIBILITY_REVIEW');
    assert.equal(result.json.aliases.length, 2);
  });

  it('routes ticker-only mismatch below confidence gate', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        {
          ...sample,
          case_id: '70883370-8893-4534-a148-2aa4172f497b',
          ticker: 'ACAD',
          exchange: 'AMEX',
          min_identity_confidence: 80,
        },
      ],
    });

    // Multiple ticker matches and no exchange match → ambiguous
    assert.equal(result.json.outcome, 'NEEDS_HUMAN_REVIEW');
    assert.equal(result.json.next_state, 'AWAITING_HUMAN_REVIEW');
    assert.ok(result.json.identity_confidence < 80);
  });

  it('returns human review when ticker is missing', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        {
          ...sample,
          case_id: '70883370-8893-4534-a148-2aa4172f497b',
          ticker: 'ZZZZ',
          exchange: 'NASDAQ',
        },
      ],
    });

    assert.equal(result.json.resolved, false);
    assert.equal(result.json.identity_confidence, 0);
    assert.equal(result.json.reason, 'ticker_not_found_in_edgar');
  });
});
