import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import growthConfig from '../fixtures/analysis-growth-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-growth-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-growth-prospects.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-growth-result.js');

describe('validate-growth-request', () => {
  it('accepts a valid growth payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-growth-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });
});

describe('evaluate-growth-prospects', () => {
  it('writes growth structural claims and insufficient topics', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ growth_config: growthConfig }],
      nodes: {
        'Validate Growth Request': [
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
        'Load Analysis Config': [{ gates_json: { analysis: { growth: growthConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.next_state, 'ANALYZING');
    assert.ok(result.json.claim_count >= 6);
    assert.ok(result.json.insufficient_topics.includes('tam_addressable_market'));
    assert.ok(
      result.json.claims.some((c) => c.topic_key === 'clinical_activity_growth_dependence'),
    );
    assert.ok(result.json.claims.some((c) => c.claim_category === 'growth_prospects'));
  });

  it('emits news inventory and partnership headline signal', () => {
    const withNews = [
      ...evidence,
      {
        id: '11111111-1111-4111-8111-111111111401',
        source_type: 'finnhub_company_news',
        metadata_json: {
          headline: 'Company expands licensing collaboration with partner',
          summary: 'New partnership announced for a mid-stage program.',
          source: 'Reuters',
        },
      },
    ];
    const [result] = runCodeNode(EVALUATE, {
      items: [{ growth_config: growthConfig }],
      nodes: {
        'Validate Growth Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'REGN',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-news-1',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'REGENERON PHARMACEUTICALS INC',
            ticker: 'REGN',
          },
        ],
        'Load Analysis Config': [{ gates_json: { analysis: { growth: growthConfig } } }],
        'Load Evidence Documents': withNews,
      },
    });

    assert.ok(result.json.claims.some((c) => c.topic_key === 'recent_company_news_inventory'));
    assert.ok(
      result.json.claims.some((c) => c.topic_key === 'partnerships_licensing_headline_signal'),
    );
    assert.ok(!result.json.insufficient_topics.includes('partnerships_licensing'));
    assert.equal(result.json.counts.news_count, 1);
  });
});

describe('build-growth-result', () => {
  it('shapes growth output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          outcome: 'ANALYZED',
          next_state: 'ANALYZING',
          claim_count: 9,
          insufficient_topics: ['tam_addressable_market'],
          counts: { trials_count: 2 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.claim_count, 9);
    assert.ok(result.json.as_of);
  });
});
