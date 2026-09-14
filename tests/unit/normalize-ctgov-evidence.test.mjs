import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import studies from '../fixtures/ctgov-studies-acad.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/normalize-ctgov-evidence.js');

describe('normalize-ctgov-evidence', () => {
  it('builds one document per NCT', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [studies],
      nodes: {
        'Validate Collection Request': [
          { case_id: '91815cf2-865d-4173-8263-f490cc129608', ticker: 'ACAD' },
        ],
        'Load Case And Company': [
          {
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'ACADIA PHARMACEUTICALS INC',
          },
        ],
        'Normalize SEC Evidence': [{ ok: true, document_count: 4, company_id: '7e2399f9-c323-41e5-8291-e354b3375527' }],
      },
    });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 2);
    assert.equal(result.json.documents[0].stable_source_id, 'NCT04495855');
    assert.equal(result.json.documents[0].source_type, 'clinicaltrials_gov');
    assert.equal(result.json.documents[0].publication_date, '2020-09-15');
    assert.equal(result.json.documents[1].publication_date, '2022-11-01');
  });
});
