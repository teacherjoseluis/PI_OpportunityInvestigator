import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import submissions from '../fixtures/sec-submissions-acad.json' with { type: 'json' };
import config from '../fixtures/collection-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/normalize-sec-evidence.js');

describe('normalize-sec-evidence', () => {
  it('builds submissions summary plus recent filing documents', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [submissions],
      nodes: {
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
          },
        ],
        'Load Collection Config': [config],
      },
    });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 4); // 1 summary + 3 filings
    assert.equal(result.json.documents[0].source_type, 'sec_edgar_submissions');
    assert.equal(result.json.documents[1].source_type, 'sec_edgar_filing');
    assert.ok(result.json.documents[1].content_sha256);
    assert.ok(result.json.documents[1].metadata_b64);
  });

  it('fails when filings are missing', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [{ error: 'forbidden' }],
      nodes: {
        'Validate Collection Request': [{ case_id: '91815cf2-865d-4173-8263-f490cc129608', ticker: 'ACAD' }],
        'Load Case And Company': [{ cik: '0001070494', company_id: '7e2399f9-c323-41e5-8291-e354b3375527' }],
        'Load Collection Config': [config],
      },
    });
    assert.equal(result.json.ok, false);
    assert.equal(result.json.document_count, 0);
  });
});
