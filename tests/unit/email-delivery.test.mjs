import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import emailConfig from '../fixtures/email-delivery-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-email-request.js');
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
    risk_score: 68,
    evidence_confidence_score: 54,
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

describe('evaluate-email-delivery', () => {
  it('sends TEST_DELIVERY draft when publication_ready is false', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Email Request': [
          { valid: true, case_id: CASE_ID, mode: 'TEST_DELIVERY', n8n_execution_id: 'e1' },
        ],
        'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
        'Load Case And Latest Report': [caseReportBase],
        'Load Prior Deliveries': [{ deliveries_json: [] }],
      },
    });
    assert.equal(result.json.should_send, true);
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.delivery_type, 'TEST_DELIVERY');
    assert.match(result.json.subject, /DRAFT/);
    assert.match(result.json.text_body, /Draft — not publication ready/i);
    assert.match(result.json.text_body, /SUPPORTING|Supporting/i);
    assert.match(result.json.html_body, /PHARMA OPPORTUNITY INVESTIGATOR/);
    assert.match(result.json.html_body, /#0B1F33/);
    assert.match(result.json.html_body, /SUPPORTING/);
    assert.match(result.json.html_body, /CHALLENGING/);
    assert.match(result.json.html_body, /WATCH NEXT/);
    assert.match(result.json.html_body, /EVIDENCE GAPS/);
    assert.match(result.json.html_body, /MONITOR/);
    assert.ok(result.json.delivery_json_b64);
    const decoded = JSON.parse(
      Buffer.from(result.json.delivery_json_b64, 'base64').toString('utf8'),
    );
    assert.ok(Array.isArray(decoded));
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].delivery_type, 'TEST_DELIVERY');
  });

  it('skips INVESTIGATION_REPORT when publication gates fail', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Email Request': [
          { valid: true, case_id: CASE_ID, mode: 'INVESTIGATION_REPORT' },
        ],
        'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
        'Load Case And Latest Report': [caseReportBase],
        'Load Prior Deliveries': [{ deliveries_json: [] }],
      },
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.outcome, 'SKIPPED_GATES');
    assert.match(result.json.reason, /publication_ready/);
  });

  it('sends INVESTIGATION_REPORT when publication_ready', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
        'Validate Email Request': [
          { valid: true, case_id: CASE_ID, mode: 'INVESTIGATION_REPORT' },
        ],
        'Load Email Config': [{ gates_json: { email_delivery: emailConfig } }],
        'Load Case And Latest Report': [
          { ...caseReportBase, publication_ready: true },
        ],
        'Load Prior Deliveries': [{ deliveries_json: [] }],
      },
    });
    assert.equal(result.json.should_send, true);
    assert.equal(result.json.outcome, 'SENT');
    assert.equal(result.json.delivery_type, 'INVESTIGATION_REPORT');
    assert.match(result.json.subject, /\[PII Report\]/);
  });

  it('skips duplicate SENT dedupe_key', () => {
    const dedupe =
      'report:' + CASE_ID + ':' + REPORT_ID + ':TEST_DELIVERY:teacherjoseluis@gmail.com';
    const [result] = runCodeNode(EVALUATE, {
      items: [{}],
      nodes: {
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
      },
    });
    assert.equal(result.json.should_send, false);
    assert.equal(result.json.outcome, 'SKIPPED_DUPLICATE');
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
