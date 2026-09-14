import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPAND = path.join(repoRoot, 'workflows/shared/code/expand-evidence-documents.js');
const COVERAGE = path.join(repoRoot, 'workflows/shared/code/evaluate-collection-coverage.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-collection-result.js');

describe('expand-evidence-documents', () => {
  it('expands documents into one item each', () => {
    const results = runCodeNode(EXPAND, {
      items: [
        {
          case_id: '91815cf2-865d-4173-8263-f490cc129608',
          company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
          collector: 'sec_edgar',
          ok: true,
          documents: [
            {
              source_type: 'sec_edgar_filing',
              publisher: 'SEC',
              stable_source_id: 'a',
              canonical_url: 'https://www.sec.gov/',
              title: '10-K',
              publication_date: '2025-01-01',
              content_sha256: 'abc',
              metadata_b64: 'e30=',
              chunk_text: 'filing',
            },
          ],
        },
      ],
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].json.skip_upsert, false);
    assert.equal(results[0].json.content_sha256, 'abc');
  });
});

describe('evaluate-collection-coverage', () => {
  it('advances to ANALYZING when SEC minimum is met', () => {
    const [result] = runCodeNode(COVERAGE, {
      items: [{ sec_stored_count: 4, ct_stored_count: 2 }],
      nodes: {
        'Validate Collection Request': [
          {
            case_id: '91815cf2-865d-4173-8263-f490cc129608',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: '1',
          },
        ],
        'Load Collection Config': [
          {
            gates_json: {
              collection: { min_sec_documents: 1, partial_requires_human_review: false },
            },
          },
        ],
        'Normalize SEC Evidence': [{ ok: true, document_count: 4, cik: '0001070494' }],
        'Normalize CT.gov Evidence': [{ ok: true, document_count: 2 }],
        'Expand SEC Documents': [{ skip_upsert: false }, { skip_upsert: false }],
        'Expand CT.gov Documents': [{ skip_upsert: false }],
        'Count SEC Upserts': [{ sec_stored_count: 4 }],
        'Count CT.gov Upserts': [{ ct_stored_count: 2 }],
      },
    });

    assert.equal(result.json.outcome, 'COLLECTED');
    assert.equal(result.json.next_state, 'ANALYZING');
  });

  it('fails when no evidence was stored', () => {
    const [result] = runCodeNode(COVERAGE, {
      items: [{ sec_stored_count: 0, ct_stored_count: 0 }],
      nodes: {
        'Validate Collection Request': [
          { case_id: '91815cf2-865d-4173-8263-f490cc129608', ticker: 'ACAD' },
        ],
        'Load Collection Config': [{ gates_json: { collection: { min_sec_documents: 1 } } }],
        'Normalize SEC Evidence': [{ ok: false, document_count: 0, error: 'sec_fetch_failed' }],
        'Normalize CT.gov Evidence': [{ ok: false, document_count: 0, error: 'ctgov_fetch_failed' }],
        'Expand SEC Documents': [{ skip_upsert: true }],
        'Expand CT.gov Documents': [{ skip_upsert: true }],
        'Count SEC Upserts': [{ sec_stored_count: 0 }],
        'Count CT.gov Upserts': [{ ct_stored_count: 0 }],
      },
    });
    assert.equal(result.json.outcome, 'FAILED');
    assert.equal(result.json.next_state, 'INCOMPLETE');
  });
});

describe('build-collection-result', () => {
  it('shapes collection output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: '91815cf2-865d-4173-8263-f490cc129608',
          ticker: 'ACAD',
          outcome: 'COLLECTED',
          next_state: 'ANALYZING',
          collector_status: [{ key: 'sec_edgar', ok: true }],
          counts: { sec_stored_count: 4 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'COLLECTED');
    assert.ok(result.json.as_of);
  });
});
