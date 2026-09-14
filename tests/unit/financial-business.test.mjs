import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import financialConfig from '../fixtures/analysis-financial-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-financial-business.js');
const EXPAND = path.join(repoRoot, 'workflows/shared/code/expand-financial-claims.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-financial-result.js');

describe('evaluate-financial-business', () => {
  it('writes structural facts and insufficient-evidence topics', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ financial_config: financialConfig }],
      nodes: {
        'Validate Financial Request': [
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
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.next_state, 'ANALYZING');
    assert.ok(result.json.claim_count >= 6);
    assert.ok(result.json.insufficient_topics.includes('cash_debt'));
    assert.ok(result.json.claims.some((c) => c.claim_kind === 'fact' && c.claim_text.includes('10-K')));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'pipeline_presence_inference'));
  });

  it('returns INSUFFICIENT when no filings exist', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Financial Request': [
          { case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD' },
        ],
        'Load Case And Company': [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4' }],
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': [],
      },
    });

    assert.equal(result.json.outcome, 'INSUFFICIENT');
    assert.equal(result.json.next_state, 'ANALYZING');
  });
});

describe('expand-financial-claims', () => {
  it('expands one item per claim', () => {
    const [evaluated] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Financial Request': [
          { case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD' },
        ],
        'Load Case And Company': [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4' }],
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    const rows = runCodeNode(EXPAND, { items: [evaluated.json] });
    assert.equal(rows.length, evaluated.json.claim_count);
    assert.equal(rows[0].json.skip_upsert, false);
  });
});

describe('build-financial-result', () => {
  it('shapes financial output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          outcome: 'ANALYZED',
          next_state: 'ANALYZING',
          reason: 'metadata_claims_written',
          claim_count: 8,
          insufficient_topics: ['cash_debt'],
          counts: { filings_count: 3 },
        },
      ],
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.claim_count, 8);
    assert.deepEqual(result.json.insufficient_topics, ['cash_debt']);
    assert.ok(result.json.as_of);
  });
});
