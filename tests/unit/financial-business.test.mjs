import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidence from '../fixtures/financial-evidence-acad.json' with { type: 'json' };
import financialConfig from '../fixtures/analysis-financial-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-financial-business.js');
const EXPAND = path.join(repoRoot, 'workflows/shared/code/expand-financial-claims.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-financial-result.js');

describe('evaluate-financial-business', () => {
  it('writes structural facts and insufficient-evidence topics', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ financial_config: financialConfig }],
      nodes: {
        'Validate Financial Request': [
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
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.next_state, 'ANALYZING');
    assert.ok(result.json.claim_count >= 6);
    assert.ok(result.json.insufficient_topics.includes('cash_debt'));
    assert.ok(result.json.claims.some((c) => c.claim_kind === 'fact' && c.claim_text.includes('10-K')));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'pipeline_presence_inference'));
  });

  it('emits cash_debt fact when XBRL financial metrics are present', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ financial_config: financialConfig }],
      nodes: {
        'Validate Financial Request': [
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
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
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
            period_label: 'XBRL_2024-12-31',
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'total_debt',
            metric_value: 40000000,
            currency: 'USD',
            period_label: 'XBRL_2024-12-31',
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'net_cash',
            metric_value: 270000000,
            currency: 'USD',
            period_label: 'XBRL_2024-12-31',
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.ok(!result.json.insufficient_topics.includes('cash_debt'));
    const cashClaim = result.json.claims.find((c) => c.topic_key === 'cash_debt');
    assert.ok(cashClaim);
    assert.equal(cashClaim.extraction_method, 'deterministic_xbrl_metrics');
    assert.ok(cashClaim.claim_text.includes('310,000,000'));
  });

  it('emits margins burn_runway and share_count when extended XBRL metrics exist', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ financial_config: financialConfig }],
      nodes: {
        'Validate Financial Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-xbrl-e8',
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
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': [
          ...evidence,
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            source_type: 'sec_companyfacts',
            title: 'SEC companyfacts snapshot',
            metadata_json: { collector: 'sec_filing_bodies' },
          },
        ],
        'Load Financial Metrics': [
          {
            metric_key: 'cash_and_equivalents',
            metric_value: 310000000,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'revenue',
            metric_value: 800000000,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'gross_profit',
            metric_value: 600000000,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'gross_margin',
            metric_value: 0.75,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'operating_cash_flow',
            metric_value: -50000000,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'cash_burn',
            metric_value: 50000000,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'estimated_cash_runway_months',
            metric_value: 96,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            metric_key: 'shares_outstanding',
            metric_value: 165000000,
            period_end: '2024-12-31',
            source_evidence_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
      },
    });

    assert.ok(!result.json.insufficient_topics.includes('margins'));
    assert.ok(!result.json.insufficient_topics.includes('burn_runway'));
    assert.ok(!result.json.insufficient_topics.includes('dilution'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'margins'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'burn_runway'));
    assert.ok(result.json.claims.some((c) => c.topic_key === 'share_count'));
  });

  it('soft-closes dilution when offering forms are present', () => {
    const withOffering = [
      ...evidence,
      {
        id: '11111111-1111-4111-8111-111111111105',
        source_type: 'sec_edgar_filing',
        metadata_json: {
          form: 'S-3',
          accessionNumber: '0001070494-25-000070',
          filingDate: '2025-07-01',
        },
      },
    ];
    const [result] = runCodeNode(EVALUATE, {
      items: [{ financial_config: financialConfig }],
      nodes: {
        'Validate Financial Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-dilution',
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
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': withOffering,
      },
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.ok(result.json.claims.some((c) => c.topic_key === 'offering_forms_present'));
    assert.ok(!result.json.insufficient_topics.includes('dilution'));
  });

  it('returns INSUFFICIENT when no filings exist', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Financial Request': [
          { case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD' },
        ],
        'Load Case And Company': [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4' }],
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': [],
      },
    });

    assert.equal(result.json.outcome, 'INSUFFICIENT');
    assert.equal(result.json.next_state, 'ANALYZING');
  });
});

describe('expand-financial-claims', () => {
  it('expands one item per claim', () => {
    const [evaluated] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Financial Request': [
          { case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4', ticker: 'ACAD' },
        ],
        'Load Case And Company': [{ case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4' }],
        'Load Analysis Config': [{ gates_json: { analysis: { financial: financialConfig } } }],
        'Load Evidence Documents': evidence,
      },
    });

    const rows = runCodeNode(EXPAND, { items: [evaluated.json] });
    assert.equal(rows.length, evaluated.json.claim_count);
    assert.equal(rows[0].json.skip_upsert, false);
  });
});

describe('build-financial-result', () => {
  it('shapes financial output', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          outcome: 'ANALYZED',
          next_state: 'ANALYZING',
          reason: 'metadata_claims_written',
          claim_count: 8,
          insufficient_topics: ['cash_debt'],
          counts: { filings_count: 3 },
        },
      ],
    });

    assert.equal(result.json.outcome, 'ANALYZED');
    assert.equal(result.json.claim_count, 8);
    assert.deepEqual(result.json.insufficient_topics, ['cash_debt']);
    assert.ok(result.json.as_of);
  });
});
