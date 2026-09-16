import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import searchHits from '../fixtures/courtlistener-search-regn.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-courtlistener-query.js');
const NORMALIZE = path.join(repoRoot, 'workflows/shared/code/normalize-courtlistener-evidence.js');

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
          courtlistener_limit: 10,
          collectors: {
            courtlistener: { enabled: true, mode: 'search_v4_compact', limit: 10 },
          },
        },
      },
    },
  ],
};

describe('prepare-courtlistener-query', () => {
  it('builds a party query when enabled', () => {
    const [result] = runCodeNode(PREPARE, { items: [{}], nodes: baseNodes });
    assert.equal(result.json.enabled, true);
    assert.equal(result.json.skip_fetch, false);
    assert.equal(result.json.query, 'party:"REGENERON PHARMACEUTICALS INC"');
  });
});

describe('normalize-courtlistener-evidence', () => {
  it('compacts search hits into evidence documents', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [searchHits],
      nodes: {
        ...baseNodes,
        'Prepare CourtListener Query': [
          {
            ticker: 'REGN',
            courtlistener_limit: 10,
            enabled: true,
            query: 'party:"REGENERON PHARMACEUTICALS INC"',
          },
        ],
      },
    });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 2);
    assert.equal(result.json.documents[0].source_type, 'courtlistener_docket');
    assert.equal(result.json.documents[0].publisher, 'CourtListener');
    assert.match(result.json.documents[0].stable_source_id, /^courtlistener-/);
    assert.ok(result.json.documents[0].canonical_url.includes('courtlistener.com'));
  });

  it('skips when collector disabled', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [searchHits],
      nodes: {
        ...baseNodes,
        'Load Collection Config': [
          {
            gates_json: {
              collection: { collectors: { courtlistener: { enabled: false } } },
            },
          },
        ],
        'Prepare CourtListener Query': [{ enabled: false, skip_fetch: true }],
      },
    });
    assert.equal(result.json.ok, true);
    assert.equal(result.json.skipped, true);
    assert.equal(result.json.document_count, 0);
  });
});
