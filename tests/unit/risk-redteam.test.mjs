import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import riskConfig from '../fixtures/analysis-risk-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-risk-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-risk-redteam.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-risk-result.js');

describe('validate-risk-request', () => {
  it('accepts a valid risk payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-risk-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
      executionId: 'exec-risk-bad',
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });
});

describe('evaluate-risk-redteam', () => {
  it('writes risk structural claims and insufficient topics', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ risk_config: riskConfig }],
      nodes: {
        'Validate Risk Request': [
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
        'Load Analysis Config': [{ gates_json: { analysis: { risk: riskConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.next_state, 'ANALYZING');
    assert.ok(result.json.claim_count >= 10);
    assert.ok(result.json.insufficient_topics.includes('thesis_breaking_conditions'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'periodic_risk_factor_anchor'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'material_event_risk_signal'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'clinical_execution_risk_signal'));
    assert.ok(result.json.claims.every((c) => c.claim_category === 'risk_red_team'));
  });

  it('writes patent inventory and skips patent_exclusivity insufficient when USPTO rows exist', () => {
    const withPatents = [
      ...evidence,
      {
        id: 'pat-1',
        source_type: 'uspto_patent',
        title: 'US12345678 — Anti-VEGF antibody compositions',
        metadata_json: {
          patent_number: '12345678',
          application_number: '16123456',
          invention_title: 'Anti-VEGF antibody compositions and methods',
        },
      },
    ];
    const [result] = runCodeNode(EVALUATE, {
      items: [{ risk_config: riskConfig }],
      nodes: {
        'Validate Risk Request': [
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
        'Load Analysis Config': [{ gates_json: { analysis: { risk: riskConfig } } }],
        'Load Evidence Documents': withPatents,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.ok(result.json.claims.some((c) => c.topic_key === 'patent_portfolio_inventory'));
    assert.equal(result.json.counts.patents_count, 1);
    assert.ok(!result.json.insufficient_topics.includes('patent_exclusivity'));
    assert.ok(
      !result.json.claims.some((c) => c.topic_key === 'insufficient_patent_exclusivity'),
    );
  });

  it('emits liquidity inventory and skips financial_financing_depth when XBRL metrics exist', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ risk_config: riskConfig }],
      nodes: {
        'Validate Risk Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-xbrl',
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
        'Load Analysis Config': [{ gates_json: { analysis: { risk: riskConfig } } }],
        'Load Evidence Documents': [
          ...evidence,
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            source_type: 'sec_companyfacts',
            title: 'SEC companyfacts cash/debt',
            metadata_json: { collector: 'sec_filing_bodies' },
          },
        ],
        'Load Financial Metrics': [
          {
            metric_key: 'cash_and_equivalents',
            metric_value: 310000000,
            currency: 'USD',
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'total_debt',
            metric_value: 40000000,
            currency: 'USD',
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'net_cash',
            metric_value: 270000000,
            currency: 'USD',
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.ok(result.json.claims.some((c) => c.topic_key === 'liquidity_balance_sheet_inventory'));
    assert.ok(!result.json.insufficient_topics.includes('financial_financing_depth'));
    assert.equal(result.json.counts.metrics_count, 3);
  });
});

describe('build-risk-result', () => {
  it('shapes risk output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          outcome: 'ANALYZED',
          next_state: 'ANALYZING',
          claim_count: 14,
          insufficient_topics: ['thesis_breaking_conditions'],
          counts: { filings_count: 3 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.claim_count, 14);
    assert.ok(result.json.as_of);
  });
});
