import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import valuationConfig from '../fixtures/analysis-valuation-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-valuation-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-valuation-market.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-valuation-result.js');

describe('validate-valuation-request', () => {
  it('accepts a valid valuation payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-valuation-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
      executionId: 'exec-valuation-bad',
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });
});

describe('evaluate-valuation-market', () => {
  it('writes valuation structural claims and insufficient topics', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ valuation_config: valuationConfig }],
      nodes: {
        'Validate Valuation Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-1',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'ACADIA PHARMACEUTICALS INC',
            ticker: 'ACAD',
          },
        ],
        'Load Analysis Config': [
          { gates_json: { analysis: { valuation: valuationConfig } } },
        ],
        'Load Evidence Documents': evidence,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.next_state, 'ANALYZING');
    assert.ok(result.json.claim_count >= 8);
    assert.ok(result.json.insufficient_topics.includes('market_cap_enterprise_value'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'periodic_filings_valuation_anchor'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'material_event_market_context'));
    assert.ok(result.json.claims.every((c) => c.claim_category === 'valuation_market'));
  });
});

describe('build-valuation-result', () => {
  it('shapes valuation output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          outcome: 'ANALYZED',
          next_state: 'ANALYZING',
          claim_count: 10,
          insufficient_topics: ['peer_comparison'],
          counts: { filings_count: 3 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.claim_count, 10);
    assert.ok(result.json.as_of);
  });
});
