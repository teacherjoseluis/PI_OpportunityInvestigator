import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-evidence-chunk-upsert.js');

describe('prepare-evidence-chunk-upsert', () => {
  it('pairs Upsert SEC Evidence with Expand SEC Documents chunk_text', () => {
    const rows = runCodeNode(PREPARE, {
      items: [
        {
          evidence_id: 'ev-1',
          source_type: 'sec_edgar_filing',
          stable_source_id: 'acc-1',
        },
        {
          evidence_id: 'ev-2',
          source_type: 'sec_edgar_filing',
          stable_source_id: 'acc-2',
        },
      ],
      nodes: {
        'Upsert SEC Evidence': [
          {
            evidence_id: 'ev-1',
            source_type: 'sec_edgar_filing',
            stable_source_id: 'acc-1',
          },
          {
            evidence_id: 'ev-2',
            source_type: 'sec_edgar_filing',
            stable_source_id: 'acc-2',
          },
        ],
        'Expand SEC Documents': [
          {
            skip_upsert: false,
            stable_source_id: 'acc-1',
            collector: 'sec_edgar',
            source_type: 'sec_edgar_filing',
            chunk_text: '10-K filing summary for ticker ACAD',
          },
          {
            skip_upsert: false,
            stable_source_id: 'acc-2',
            collector: 'sec_edgar',
            source_type: 'sec_edgar_filing',
            chunk_text: '10-Q filing summary for ticker ACAD',
          },
        ],
      },
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].json.evidence_id, 'ev-1');
    assert.equal(rows[0].json.chunk_index, 0);
    assert.ok(rows[0].json.chunk_text.includes('10-K'));
    assert.ok(rows[0].json.chunk_metadata_b64);
    assert.equal(rows[0].json.skip_chunk, undefined);
    assert.equal(rows[1].json.evidence_id, 'ev-2');
  });

  it('returns skip_chunk when no chunk_text is available', () => {
    const rows = runCodeNode(PREPARE, {
      items: [{ evidence_id: 'ev-1', stable_source_id: 'acc-1' }],
      nodes: {
        'Upsert SEC Evidence': [{ evidence_id: 'ev-1', stable_source_id: 'acc-1' }],
        'Expand SEC Documents': [
          {
            skip_upsert: false,
            stable_source_id: 'acc-1',
            chunk_text: '',
          },
        ],
      },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].json.skip_chunk, true);
  });
});
