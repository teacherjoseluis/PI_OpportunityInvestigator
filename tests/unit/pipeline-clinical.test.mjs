import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import pipelineConfig from '../fixtures/analysis-pipeline-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-pipeline-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-pipeline-clinical.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-pipeline-result.js');

describe('validate-pipeline-request', () => {
  it('accepts a valid pipeline payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-pipeline-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
      executionId: 'exec-pipeline-bad',
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
    assert.equal(result.json.next_state, 'INCOMPLETE');
  });
});

describe('evaluate-pipeline-clinical', () => {
  it('writes pipeline structural claims and insufficient topics', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ pipeline_config: pipelineConfig }],
      nodes: {
        'Validate Pipeline Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-1',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'ACADIA PHARMACEUTICALS INC',
            ticker: 'ACAD',
          },
        ],
        'Load Analysis Config': [{ gates_json: { analysis: { pipeline: pipelineConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.next_state, 'ANALYZING');
    assert.ok(result.json.claim_count >= 8);
    assert.ok(result.json.insufficient_topics.includes('efficacy_and_durability'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'pipeline_study_inventory'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'pipeline_phase_status_mix'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'late_stage_concentration'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'sec_pipeline_context_anchor'));
    assert.ok(result.json.claims.every((c) => c.claim_category === 'pipeline_clinical'));
  });

  it('writes enrollment inventory and skips enrollment_and_timelines when counts exist', () => {
    const withEnrollment = evidence.map((row) => {
      if (row.source_type !== 'clinicaltrials_gov') return row;
      const meta = row.metadata_json || {};
      return {
        ...row,
        metadata_json: { ...meta, enrollment: 392, enrollment_type: 'ACTUAL' },
      };
    });
    const [result] = runCodeNode(EVALUATE, {
      items: [{ pipeline_config: pipelineConfig }],
      nodes: {
        'Validate Pipeline Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-enroll',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'ACADIA PHARMACEUTICALS INC',
            ticker: 'ACAD',
          },
        ],
        'Load Analysis Config': [{ gates_json: { analysis: { pipeline: pipelineConfig } } }],
        'Load Evidence Documents': withEnrollment,
      },
    });
    assert.ok(result.json.claims.some((c) => c.topic_key === 'enrollment_inventory'));
    assert.ok(!result.json.insufficient_topics.includes('enrollment_and_timelines'));
  });
});

describe('build-pipeline-result', () => {
  it('shapes pipeline output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          outcome: 'ANALYZED',
          next_state: 'ANALYZING',
          claim_count: 12,
          insufficient_topics: ['efficacy_and_durability'],
          counts: { trials_count: 2 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.claim_count, 12);
    assert.ok(result.json.as_of);
  });
});
