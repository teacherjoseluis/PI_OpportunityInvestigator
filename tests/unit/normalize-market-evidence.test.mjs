import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NORMALIZE = path.join(repoRoot, 'workflows/shared/code/normalize-market-evidence.js');

describe('normalize-market-evidence', () => {
  it('stores TwelveData bars and a benchmark document', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [
        {
          fetches: [
            {
              symbol: 'ACAD',
              interval: '1day',
              role: 'bars',
              provider: 'twelvedata',
              body: {
                status: 'ok',
                values: [
                  { datetime: '2024-01-02', open: 10, high: 12, low: 9, close: 11, volume: 1000 },
                  { datetime: '2024-01-03', open: 11, high: 13, low: 10, close: 12, volume: 1100 },
                ],
              },
            },
            {
              symbol: 'XBI',
              interval: '1day',
              role: 'benchmark',
              provider: 'twelvedata',
              body: {
                status: 'ok',
                values: [{ datetime: '2024-01-03', open: 80, high: 82, low: 79, close: 81, volume: 5000 }],
              },
            },
          ],
        },
      ],
    });
    assert.equal(result.json.access_status, 'ok');
    assert.equal(result.json.bar_count, 3);
    assert.equal(result.json.status, 'SUCCEEDED');
    const docs = JSON.parse(Buffer.from(result.json.documents_b64, 'base64').toString('utf8'));
    assert.ok(docs.some((doc) => doc.source_type === 'market_ohlcv'));
    assert.ok(docs.some((doc) => doc.source_type === 'market_benchmark'));
  });

  it('records a plan denial instead of inventing bars', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [
        {
          symbol: 'ACAD',
          interval: '1day',
          provider: 'twelvedata',
          body: { status: 'error', code: 403, message: 'This endpoint is not available on your plan' },
        },
      ],
    });
    assert.equal(result.json.access_status, 'denied');
    assert.equal(result.json.bar_count, 0);
    assert.equal(result.json.status, 'INSUFFICIENT');
    assert.match(result.json.provider_plan_note, /INSUFFICIENT_EVIDENCE/);
  });

  it('reads Finnhub candle arrays as a fallback shape', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [
        {
          symbol: 'SPY',
          interval: '1day',
          role: 'benchmark',
          provider: 'finnhub',
          body: { s: 'ok', t: [1704240000], o: [470], h: [472], l: [469], c: [471], v: [100000] },
        },
      ],
    });
    assert.equal(result.json.bar_count, 1);
    const bars = JSON.parse(Buffer.from(result.json.bars_b64, 'base64').toString('utf8'));
    assert.equal(bars[0].close, 471);
    assert.equal(bars[0].source, 'finnhub');
  });
});
