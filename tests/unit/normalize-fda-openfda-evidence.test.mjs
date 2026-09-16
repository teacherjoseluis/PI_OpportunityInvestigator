import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import openfda from '../fixtures/openfda-drugsfda-regn.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-openfda-query.js');
const NORMALIZE = path.join(repoRoot, 'workflows/shared/code/normalize-fda-openfda-evidence.js');

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
          openfda_limit: 25,
          collectors: {
            fda_openfda: { enabled: true, mode: 'drugsfda_compact', limit: 25 },
          },
        },
      },
    },
  ],
};

describe('prepare-openfda-query', () => {
  it('builds manufacturer/sponsor search URL from legal name', () => {
    const [result] = runCodeNode(PREPARE, {
      items: [{}],
      nodes: baseNodes,
    });
    assert.equal(result.json.enabled, true);
    assert.equal(result.json.skip_fetch, false);
    assert.equal(result.json.search_token, 'REGENERON');
    assert.match(result.json.openfda_url, /api\.fda\.gov\/drug\/drugsfda\.json/);
    assert.match(result.json.openfda_url, /REGENERON/);
  });

  it('skips when collector disabled', () => {
    const [result] = runCodeNode(PREPARE, {
      items: [{}],
      nodes: {
        ...baseNodes,
        'Load Collection Config': [
          {
            gates_json: {
              collection: { collectors: { fda_openfda: { enabled: false } } },
            },
          },
        ],
      },
    });
    assert.equal(result.json.skip_fetch, true);
    assert.equal(result.json.skip_reason, 'collector_disabled');
  });
});

describe('normalize-fda-openfda-evidence', () => {
  it('compacts Drugs@FDA applications into evidence documents', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [openfda],
      nodes: {
        ...baseNodes,
        'Prepare OpenFDA Query': [
          {
            search_token: 'REGENERON',
            openfda_limit: 25,
            enabled: true,
            skip_fetch: false,
          },
        ],
      },
    });

    assert.equal(result.json.ok, true);
    assert.ok(result.json.document_count >= 1);
    assert.equal(result.json.documents[0].source_type, 'fda_drugsfda');
    assert.equal(result.json.documents[0].publisher, 'openFDA');
    assert.match(result.json.documents[0].stable_source_id, /^fda-drugsfda-/);
    assert.ok(result.json.documents[0].chunk_text.includes('FDA Drugs@FDA'));

    const meta = JSON.parse(
      Buffer.from(result.json.documents[0].metadata_b64, 'base64').toString('utf8'),
    );
    assert.ok(meta.application_number);
    assert.ok(Array.isArray(meta.brand_names));
    assert.equal(meta.mode, 'drugsfda_compact');
  });

  it('treats NOT_FOUND as empty success', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [{ error: { code: 'NOT_FOUND', message: 'No matches found!' } }],
      nodes: {
        ...baseNodes,
        'Prepare OpenFDA Query': [{ search_token: 'REGENERON', enabled: true }],
      },
    });
    assert.equal(result.json.ok, true);
    assert.equal(result.json.document_count, 0);
  });

  it('skips when collector disabled', () => {
    const [result] = runCodeNode(NORMALIZE, {
      items: [openfda],
      nodes: {
        ...baseNodes,
        'Load Collection Config': [
          {
            gates_json: {
              collection: { collectors: { fda_openfda: { enabled: false } } },
            },
          },
        ],
        'Prepare OpenFDA Query': [{ enabled: false, skip_fetch: true }],
      },
    });
    assert.equal(result.json.skipped, true);
    assert.equal(result.json.document_count, 0);
  });
});
