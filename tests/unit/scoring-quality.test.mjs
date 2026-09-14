import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import claims from '../fixtures/scoring-claims-acad.json' with { type: 'json' };
import scoringConfig from '../fixtures/analysis-scoring-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-scoring-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-scoring-quality.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-scoring-result.js');

describe('validate-scoring-request', () => {
  it('accepts a valid scoring payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-scoring-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
      executionId: 'exec-scoring-bad',
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });
});

describe('evaluate-scoring-quality', () => {
  it('scores domains and fails Phase 1 quality gates to MONITOR', () => {
    const evidenceWithDates = evidence.map((row, i) => ({
      ...row,
      publication_date: row.publication_date || `2025-0${(i % 8) + 1}-15`,
    }));

    const [result] = runCodeNode(EVALUATE, {
      items: [{ scoring_config: scoringConfig }],
      nodes: {
        'Validate Scoring Request': [
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
            configuration_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        'Load Analysis Config': [
          {
            configuration_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            gates_json: {
              require_cash_debt_from_filing: true,
              require_red_team: true,
              analysis: { scoring: scoringConfig },
            },
            scores_json: {
              weights: { business_quality: 0.4, growth: 0.3, pipeline: 0.3 },
              risk_penalty_factor: 0.25,
            },
            freshness_json: { sec_days: 120, clinical_trials_days: 30 },
          },
        ],
        'Load Evidence Documents': evidenceWithDates,
        'Load Claims': claims,
      },
    });

    assert.equal(result.json.next_state, 'AWAITING_HUMAN_REVIEW');
    assert.equal(result.json.outcome_class, 'MONITOR');
    assert.equal(result.json.hard_stop, false);
    assert.ok(result.json.scores.business_quality_score != null);
    assert.ok(result.json.scores.risk_score != null);
    assert.ok(result.json.scores.research_priority_score != null);
    assert.ok(result.json.gates_failed.includes('cash_debt_from_filing'));
    assert.ok(result.json.gates_failed.includes('schema_valid_report'));
    assert.ok(Array.isArray(result.json.components));
    assert.ok(result.json.components.length >= 5);
    assert.ok(result.json.metadata_b64);
  });

  it('hard-stops when evidence is empty', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ scoring_config: scoringConfig }],
      nodes: {
        'Validate Scoring Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-2',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            ticker: 'ACAD',
          },
        ],
        'Load Analysis Config': [
          {
            gates_json: { analysis: { scoring: scoringConfig } },
            scores_json: { weights: { business_quality: 0.4, growth: 0.3, pipeline: 0.3 } },
            freshness_json: {},
          },
        ],
        'Load Evidence Documents': [],
        'Load Claims': [],
      },
    });

    assert.equal(result.json.hard_stop, true);
    assert.equal(result.json.outcome_class, 'REASSESS_OR_EXCLUDE');
    assert.equal(result.json.next_state, 'AWAITING_HUMAN_REVIEW');
  });
});

describe('build-scoring-result', () => {
  it('shapes scoring output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          outcome: 'GATES_FAILED',
          next_state: 'AWAITING_HUMAN_REVIEW',
          outcome_class: 'MONITOR',
          hard_stop: false,
          score_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          scores: { research_priority_score: 42 },
          gates_failed: ['cash_debt_from_filing'],
          claim_count: 7,
          counts: { evidence_count: 4 },
        },
      ],
    });
    assert.equal(result.json.outcome_class, 'MONITOR');
    assert.equal(result.json.next_state, 'AWAITING_HUMAN_REVIEW');
    assert.ok(result.json.as_of);
  });
});
