import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import emailConfig from '../fixtures/email-delivery-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-email-request.js');
const CHART = path.join(repoRoot, 'workflows/shared/code/chart-memo.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-email-delivery.js');
const PREPARE = path.join(repoRoot, 'workflows/shared/code/prepare-email-aggregate.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-email-result.js');

const CASE_ID = 'fb342540-1bd9-49a4-a38b-5328501ccac4';
const REPORT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const caseReportBase = {
  case_id: CASE_ID,
  company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ticker: 'ACAD',
  exchange: 'NASDAQ',
  legal_name: 'ACADIA PHARMACEUTICALS INC',
  outcome_class: 'MONITOR',
  report_id: REPORT_ID,
  version_number: 3,
  schema_valid: true,
  publication_ready: false,
  executive_brief: {
    why_now: 'Why now text for Acadia franchise risk over the next 12-18 months.',
    strongest_for: 'For text from SEC 10-K franchise discussion',
    strongest_against: 'Against text on financing risk',
    thesis_changers: 'Cash/debt; catalysts',
    monitor_next: 'sec_filings, clinical_trials, financing',
  },
  outcome_json: {
    class: 'MONITOR',
    explanation: 'Coverage-aware MONITOR outcome.',
    rules: ['publication_blocked:cash_debt_from_filing'],
  },
  scores_json: {
    business_quality_score: 62,
    growth_score: 48,
    pipeline_score: 71,
    valuation_context_score: 49,
    risk_score: 68,
    evidence_confidence_score: 54,
    research_priority_score: 58,
    technical_context_score: 52,
  },
  monitoring_plan: [
    {
      rule_type: 'sec_filings',
      description: 'Next periodic report for cash, debt, and dilution.',
    },
    {
      rule_type: 'clinical_trials',
      description: 'Watch CT.gov status changes for late-stage assets.',
    },
  ],
  unresolved_json: {
    questions: ['INSUFFICIENT_EVIDENCE: cash and debt from filings'],
  },
  business_json: {
    claims: [{ text: 'Periodic SEC filings present for franchise review', insufficient: false }],
    limitations: [],
  },
  growth_json: { claims: [], limitations: [] },
  pipeline_json: {
    claims: [{ text: 'CT.gov shows ongoing late-stage study activity', insufficient: false }],
    limitations: [],
  },
  risks_json: {
    claims: [{ text: 'Financing and dilution risk remains material', insufficient: false }],
    limitations: [],
  },
  as_of: '2025-04-22',
  report_markdown_preview: '# ACAD draft',
};

describe('validate-email-request', () => {
  it('accepts case_id and optional mode', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ case_id: CASE_ID, mode: 'test_delivery' }],
      executionId: 'exec-email-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.mode, 'TEST_DELIVERY');
    assert.equal(result.json.n8n_execution_id, 'exec-email-1');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ mode: 'TEST_DELIVERY' }],
    });
    assert.equal(result.json.valid, false);
    assert.equal(result.json.outcome, 'FAILED');
  });

  it('rejects invalid mode', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ case_id: CASE_ID, mode: 'WEEKLY' }],
    });
    assert.equal(result.json.valid, false);
  });
});

const emptyChartPack = {
  indicators_json: {},
  weekly_bars_json: [],
  daily_highs_json: [],
  weekly_bar_count: 0,
  evidence_counts_json: {},
  cash_metric_count: 0,
  timing_claim_text: null,
};

function evaluateEmail(nodes) {
  return runCodeNode(EVALUATE, {
    items: [{}],
    prepend: [CHART],
    nodes,
  });
}

describe('evaluate-email-delivery', () => {
  it('sends TEST_DELIVERY draft when publication_ready is false', () => {
    const [result] = evaluateEmail({
      'Validate Email Request': [
        { valid: true, case_id: CASE_ID, mode: 'TEST_DELIVERY', n8n_execution_id: 'e1' },
      ],
      'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
      'Load Case And Latest Report': [caseReportBase],
      'Load Prior Deliveries': [{ deliveries_json: [] }],
      'Load Chart Memo Inputs': [emptyChartPack],
    });
    assert.equal(result.json.should_send, true);
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.delivery_type, 'TEST_DELIVERY');
    assert.match(result.json.subject, /DRAFT/);
    assert.match(result.json.subject, /\[PII\] ACAD · MONITOR · Timing UNAVAILABLE/);
    assert.match(result.json.text_body, /Research stance: MONITOR/);
    assert.match(result.json.text_body, /Price history is not on file/);
    assert.match(result.json.html_body, /PHARMA OPPORTUNITY INVESTIGATOR/);
    assert.match(result.json.html_body, /#0B1F33/);
    assert.match(result.json.html_body, /Weekly price/i);
    assert.match(result.json.html_body, /Excess return/i);
    assert.match(result.json.html_body, /On file/i);
    assert.match(result.json.html_body, /What would change the read/i);
    assert.doesNotMatch(result.json.html_body, /SUPPORTING/);
    assert.doesNotMatch(result.json.html_body, /CHALLENGING/);
    assert.doesNotMatch(result.json.html_body, /<svg\b/i);
    assert.doesNotMatch(result.json.html_body, /display\s*:\s*flex/i);
    assert.match(result.json.html_body, /MONITOR/);
    assert.equal(result.json.has_price_chart, false);
    assert.ok(result.json.delivery_json_b64);
    const decoded = JSON.parse(
      Buffer.from(result.json.delivery_json_b64, 'base64').toString('utf8'),
    );
    assert.ok(Array.isArray(decoded));
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].delivery_type, 'TEST_DELIVERY');
  });

  it('skips INVESTIGATION_REPORT when publication gates fail', () => {
    const [result] = evaluateEmail({
      'Validate Email Request': [
        { valid: true, case_id: CASE_ID, mode: 'INVESTIGATION_REPORT' },
      ],
      'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
      'Load Case And Latest Report': [caseReportBase],
      'Load Prior Deliveries': [{ deliveries_json: [] }],
      'Load Chart Memo Inputs': [emptyChartPack],
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.outcome, 'SKIPPED_GATES');
    assert.match(result.json.reason, /publication_ready/);
  });

  it('sends INVESTIGATION_REPORT when publication_ready', () => {
    const [result] = evaluateEmail({
      'Validate Email Request': [
        { valid: true, case_id: CASE_ID, mode: 'INVESTIGATION_REPORT' },
      ],
      'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
      'Load Case And Latest Report': [
        { ...caseReportBase, publication_ready: true },
      ],
      'Load Prior Deliveries': [{ deliveries_json: [] }],
      'Load Chart Memo Inputs': [emptyChartPack],
    });
    assert.equal(result.json.should_send, true);
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.delivery_type, 'INVESTIGATION_REPORT');
    assert.match(result.json.subject, /^\[PII\] ACAD · MONITOR · Timing UNAVAILABLE$/);
    assert.doesNotMatch(result.json.subject, /PII Report/);
  });

  it('skips duplicate SENT dedupe_key', () => {
    const dedupe =
      'report:' + CASE_ID + ':' + REPORT_ID + ':TEST_DELIVERY:teacherjoseluis@gmail.com';
    const [result] = evaluateEmail({
      'Validate Email Request': [
        { valid: true, case_id: CASE_ID, mode: 'TEST_DELIVERY' },
      ],
      'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
      'Load Case And Latest Report': [caseReportBase],
      'Load Prior Deliveries': [
        {
          deliveries_json: [{ dedupe_key: dedupe, status: 'SENT' }],
        },
      ],
      'Load Chart Memo Inputs': [emptyChartPack],
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.outcome, 'SKIPPED_DUPLICATE');
  });

  it('embeds a CID weekly-price PNG when bars are on file', () => {
    const weekly = [];
    for (let i = 0; i < 52; i += 1) {
      weekly.push({
        bar_time: new Date(Date.UTC(2025, 0, 3 + i * 7)).toISOString().slice(0, 10),
        open: 100 + i,
        high: 102 + i,
        low: 98 + i,
        close: 101 + i,
        volume: 1000 + i * 10,
      });
    }
    const [result] = evaluateEmail({
      'Validate Email Request': [
        { valid: true, case_id: CASE_ID, mode: 'TEST_DELIVERY' },
      ],
      'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
      'Load Case And Latest Report': [caseReportBase],
      'Load Prior Deliveries': [{ deliveries_json: [] }],
      'Load Chart Memo Inputs': [
        {
          indicators_json: {
            timing_label: { metric_value: 1, calculation_notes: 'MIXED' },
            drawdown_52w_pct: { metric_value: 18, calculation_notes: 'from 52w high' },
            weekly_rsi_14: { metric_value: 54, calculation_notes: 'wilder' },
            weekly_volume_ratio: { metric_value: 0.9, calculation_notes: 'last week' },
            rs_xbi_3m_ppt: { metric_value: -8.4 },
            rs_xlv_3m_ppt: { metric_value: -1.2 },
            rs_spy_3m_ppt: { metric_value: -4 },
            rs_xbi_12m_ppt: { metric_value: 11.6 },
            rs_xlv_12m_ppt: { metric_value: 6.4 },
            rs_spy_12m_ppt: { metric_value: 2.8 },
          },
          weekly_bars_json: weekly,
          daily_highs_json: weekly.map((bar) => ({ bar_time: bar.bar_time, high: bar.high })),
          weekly_bar_count: 52,
          evidence_counts_json: {
            sec_edgar_filing: 4,
            clinicaltrials_gov: 2,
          },
          cash_metric_count: 0,
          timing_claim_text: 'Entry-timing context is MIXED. Not a trade instruction.',
        },
      ],
    });
    assert.match(result.json.subject, /Timing MIXED/);
    assert.match(result.json.html_body, /cid:priceChart/);
    assert.match(result.json.html_body, /RSI 54/);
    assert.equal(result.json.has_price_chart, true);
    assert.ok(result.binary);
    assert.ok(result.binary.priceChart);
    assert.equal(result.binary.priceChart.mimeType, 'image/png');
    const png = Buffer.from(result.binary.priceChart.data, 'base64');
    assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
  });
});

describe('prepare-email-aggregate and build-email-result', () => {
  it('slims evaluate output and builds final result', () => {
    const [prepared] = runCodeNode(PREPARE, {
      items: [{}],
      nodes: {
        'Evaluate Email Delivery': [
          {
            case_id: CASE_ID,
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            mode: 'TEST_DELIVERY',
            outcome: 'SENT',
            reason: 'test_draft_delivery',
            should_send: true,
            delivery_type: 'TEST_DELIVERY',
            delivery_status: 'SENT',
            report_id: REPORT_ID,
            report_version: 3,
            recipient: 'teacherjoseluis@gmail.com',
            subject: '[PII DRAFT] ACAD',
            schema_valid: true,
            publication_ready: false,
            gates_blocking: [],
            counts: { prior_deliveries: 0 },
            metadata_b64: 'e30=',
            delivery_json_b64: 'e30=',
            text_body: 'should-drop',
            html_body: 'should-drop',
          },
        ],
      },
    });
    assert.equal(prepared.json.outcome, 'SENT');
    assert.equal(prepared.json.text_body, undefined);

    const [built] = runCodeNode(BUILD, { items: [prepared.json] });
    assert.equal(built.json.outcome, 'SENT');
    assert.equal(built.json.ticker, 'ACAD');
    assert.ok(built.json.as_of);
  });
});
