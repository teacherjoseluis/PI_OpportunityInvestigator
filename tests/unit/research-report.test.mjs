import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import claims from '../fixtures/scoring-claims-acad.json' with { type: 'json' };
import reportConfig from '../fixtures/analysis-report-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-report-request.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-research-report.js');
const RESULT = path.join(repoRoot, 'workflows/shared/code/build-report-result.js');

describe('validate-report-request', () => {
  it('accepts a valid report payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-report-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
      executionId: 'exec-report-bad',
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });
});

describe('build-research-report', () => {
  it('assembles schema-valid draft report and stays in review when cash/debt missing', () => {
    const [result] = runCodeNode(BUILD, {
      items: [{ report_config: reportConfig }],
      nodes: {
        'Validate Report Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-report-2',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'ACADIA PHARMACEUTICALS INC',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            cik: '0001070494',
            outcome_class: 'MONITOR',
          },
        ],
        'Load Analysis Config': [
          {
            configuration_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            gates_json: { analysis: { report: reportConfig } },
          },
        ],
        'Load Scores': [
          {
            score_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            outcome_class: 'MONITOR',
            hard_stop: false,
            business_quality_score: null,
            growth_score: 63.33,
            pipeline_score: 73.75,
            valuation_context_score: 27.5,
            risk_score: 100,
            evidence_confidence_score: 100,
            data_freshness_score: 85.44,
            research_priority_score: 16.12,
          },
        ],
        'Load Report Version': [{ max_version: 0 }],
        'Load Evidence Documents': [
          {
            evidence_total: evidence.length,
            evidence_json: evidence,
          },
        ],
        'Load Claims': [
          {
            claim_total: claims.length,
            claims_json: claims,
          },
        ],
        'Load Score Components': [
          {
            component_key: 'growth_coverage',
            parent_score_key: 'growth_score',
            normalized_value: 63.33,
            missing: false,
          },
        ],
      },
      executionId: 'exec-report-2',
    });

    assert.equal(result.json.schema_valid, true);
    assert.equal(result.json.publication_ready, false);
    assert.equal(result.json.next_state, 'AWAITING_HUMAN_REVIEW');
    assert.equal(result.json.outcome, 'REPORT_DRAFT');
    assert.ok(result.json.report_json_b64);
    assert.ok(result.json.report_markdown_b64);
    assert.equal(result.json.report_version, 1);
    assert.ok(result.json.monitoring_rules_json_b64);
    const report = JSON.parse(
      Buffer.from(result.json.report_json_b64, 'base64').toString('utf8'),
    );
    assert.equal(report.schema_version, 'report.v1');
    const markdown = Buffer.from(result.json.report_markdown_b64, 'base64').toString(
      'utf8',
    );
    assert.ok(markdown.includes('Executive research brief'));
    const plan = JSON.parse(
      Buffer.from(result.json.monitoring_rules_json_b64, 'base64').toString('utf8'),
    );
    assert.ok(plan.length >= 3);
  });
});

describe('build-report-result', () => {
  it('returns a stable subworkflow payload', () => {
    const [result] = runCodeNode(RESULT, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          outcome: 'REPORT_DRAFT',
          next_state: 'AWAITING_HUMAN_REVIEW',
          outcome_class: 'MONITOR',
          schema_valid: true,
          publication_ready: false,
          report_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          report_version: 1,
          claim_count: 10,
          counts: { evidence_count: 21 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'REPORT_DRAFT');
    assert.equal(result.json.report_version, 1);
    assert.equal(result.json.schema_valid, true);
  });
});
