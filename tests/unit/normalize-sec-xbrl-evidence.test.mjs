import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import companyfacts from '../fixtures/sec-companyfacts-cash-debt.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/normalize-sec-xbrl-evidence.js');

const baseNodes = {
  'Validate Collection Request': [
    {
      case_id: '91815cf2-865d-4173-8263-f490cc129608',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
    },
  ],
  'Load Case And Company': [
    {
      case_id: '91815cf2-865d-4173-8263-f490cc129608',
      company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
      cik: '0001070494',
      legal_name: 'ACADIA PHARMACEUTICALS INC',
      ticker: 'ACAD',
    },
  ],
  'Load Collection Config': [
    {
      gates_json: {
        collection: {
          collectors: {
            sec_filing_bodies: { enabled: true, mode: 'companyfacts_cash_debt' },
          },
        },
      },
    },
  ],
};

describe('normalize-sec-xbrl-evidence', () => {
  it('extracts cash/debt metrics and builds companyfacts evidence doc', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [companyfacts],
      nodes: baseNodes,
    });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 1);
    assert.equal(result.json.documents[0].source_type, 'sec_companyfacts');
    assert.equal(result.json.period_end, '2024-12-31');
    assert.ok(result.json.metric_count >= 4);
    assert.ok(result.json.metrics_b64);
    assert.ok(result.json.chunk_text.includes('cash_and_equivalents'));

    const metrics = JSON.parse(Buffer.from(result.json.metrics_b64, 'base64').toString('utf8'));
    const keys = metrics.map((m) => m.metric_key);
    assert.ok(keys.includes('cash_and_equivalents'));
    assert.ok(keys.includes('marketable_securities_current'));
    assert.ok(keys.includes('long_term_debt'));
    assert.ok(keys.includes('liquid_assets'));
    assert.ok(keys.includes('total_debt'));
    assert.ok(keys.includes('net_cash'));

    const cash = metrics.find((m) => m.metric_key === 'cash_and_equivalents');
    assert.equal(cash.metric_value, 310000000);
    assert.equal(cash.assumption_set, 'reported');
  });

  it('skips when collector disabled', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [companyfacts],
      nodes: {
        ...baseNodes,
        'Load Collection Config': [
          {
            gates_json: {
              collection: {
                collectors: { sec_filing_bodies: { enabled: false } },
              },
            },
          },
        ],
      },
    });
    assert.equal(result.json.ok, true);
    assert.equal(result.json.skipped, true);
    assert.equal(result.json.document_count, 0);
  });

  it('fails when companyfacts payload is invalid', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [{ error: 'forbidden', statusCode: 403 }],
      nodes: baseNodes,
    });
    assert.equal(result.json.ok, false);
    assert.equal(result.json.error, 'sec_companyfacts_fetch_failed');
  });
});
