import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import news from '../fixtures/finnhub-company-news-regn.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-company-news-query.js');
const NORMALIZE = path.join(repoRoot, 'workflows/shared/code/normalize-company-news-evidence.js');

const baseNodes = {
  'Validate Collection Request': [
    {
      case_id: 'a87fa88d-2508-4150-b01f-da7f03a6d8c0',
      ticker: 'REGN',
      exchange: 'NASDAQ',
    },
  ],
  'Load Case And Company': [
    {
      case_id: 'a87fa88d-2508-4150-b01f-da7f03a6d8c0',
      company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
      legal_name: 'REGENERON PHARMACEUTICALS INC',
      ticker: 'REGN',
    },
  ],
  'Load Collection Config': [
    {
      gates_json: {
        collection: {
          company_news_limit: 25,
          collectors: {
            company_ir: { enabled: true, mode: 'finnhub_company_news', lookback_days: 90 },
          },
        },
      },
    },
  ],
};

describe('prepare-company-news-query', () => {
  it('builds a Finnhub date window when enabled', () => {
    const [result] = runCodeNode(PREPARE, { items: [{}], nodes: baseNodes });
    assert.equal(result.json.enabled, true);
    assert.equal(result.json.skip_fetch, false);
    assert.equal(result.json.ticker, 'REGN');
    assert.match(result.json.from_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(result.json.to_date, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('normalize-company-news-evidence', () => {
  it('compacts Finnhub headlines into evidence documents', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: news,
      nodes: {
        ...baseNodes,
        'Prepare Company News Query': [
          {
            ticker: 'REGN',
            company_news_limit: 25,
            enabled: true,
            from_date: '2024-09-01',
            to_date: '2024-09-15',
          },
        ],
      },
    });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 2);
    assert.equal(result.json.documents[0].source_type, 'finnhub_company_news');
    assert.match(result.json.documents[0].stable_source_id, /^finnhub-news-/);
    assert.ok(!JSON.stringify(result.json.documents).includes('"image"'));
  });

  it('skips when collector disabled', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: news,
      nodes: {
        ...baseNodes,
        'Load Collection Config': [
          {
            gates_json: {
              collection: { collectors: { company_ir: { enabled: false } } },
            },
          },
        ],
        'Prepare Company News Query': [{ enabled: false, skip_fetch: true }],
      },
    });
    assert.equal(result.json.skipped, true);
    assert.equal(result.json.document_count, 0);
  });
});
