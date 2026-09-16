import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import wrapper from '../fixtures/uspto-patent-file-wrapper-regn.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-uspto-query.js');
const NORMALIZE = path.join(repoRoot, 'workflows/shared/code/normalize-uspto-patents-evidence.js');

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
          uspto_patents_limit: 25,
          collectors: {
            uspto_patents: { enabled: true, mode: 'patent_file_wrapper_compact', limit: 25 },
          },
        },
      },
    },
  ],
};

describe('prepare-uspto-query', () => {
  it('builds an assignee/applicant query when enabled', () => {
    const [result] = runCodeNode(PREPARE, { items: [{}], nodes: baseNodes });
    assert.equal(result.json.enabled, true);
    assert.equal(result.json.skip_fetch, false);
    assert.equal(result.json.search_token, 'REGENERON');
    assert.match(result.json.query, /assigneeNameText:"REGENERON"/);
    assert.match(result.json.query, /applicantNameText:"REGENERON"/);
  });
});

describe('normalize-uspto-patents-evidence', () => {
  it('compacts Patent File Wrapper rows into evidence documents', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [wrapper],
      nodes: {
        ...baseNodes,
        'Prepare USPTO Query': [
          {
            ticker: 'REGN',
            uspto_patents_limit: 25,
            enabled: true,
            search_token: 'REGENERON',
          },
        ],
      },
    });

    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 2);
    assert.equal(result.json.documents[0].source_type, 'uspto_patent');
    assert.match(result.json.documents[0].stable_source_id, /^uspto-app-/);
    assert.equal(result.json.documents[0].publisher, 'USPTO');
    assert.ok(result.json.documents[0].title.includes('12345678'));
  });

  it('skips when collector disabled', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [wrapper],
      nodes: {
        ...baseNodes,
        'Load Collection Config': [
          {
            gates_json: {
              collection: {
                collectors: { uspto_patents: { enabled: false } },
              },
            },
          },
        ],
        'Prepare USPTO Query': [{ enabled: false, skip_fetch: true }],
      },
    });
    assert.equal(result.json.ok, true);
    assert.equal(result.json.skipped, true);
    assert.equal(result.json.document_count, 0);
  });
});
