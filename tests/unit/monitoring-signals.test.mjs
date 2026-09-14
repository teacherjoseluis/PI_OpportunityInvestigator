import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import secSubmissions from '../fixtures/sec-submissions-acad.json' with { type: 'json' };
import ctgovStudies from '../fixtures/ctgov-studies-acad.json' with { type: 'json' };
import monitoringConfig from '../fixtures/monitoring-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATE = path.join(repoRoot, 'workflows/shared/code/validate-monitoring-request.js');
const EVALUATE = path.join(repoRoot, 'workflows/shared/code/evaluate-monitoring-signals.js');
const BUILD = path.join(repoRoot, 'workflows/shared/code/build-monitoring-result.js');

describe('validate-monitoring-request', () => {
  it('accepts a valid monitoring payload', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'acad',
          exchange: 'nasdaq',
        },
      ],
      executionId: 'exec-mon-1',
    });
    assert.equal(result.json.valid, true);
    assert.equal(result.json.ticker, 'ACAD');
  });

  it('rejects missing case_id', () => {
    const [result] = runCodeNode(VALIDATE, {
      items: [{ ticker: 'ACAD', exchange: 'NASDAQ' }],
      executionId: 'exec-mon-bad',
    });
    assert.equal(result.json.valid, false);
  });
});

describe('evaluate-monitoring-signals', () => {
  it('detects new SEC filings after report as_of and matches rules', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ monitoring_config: monitoringConfig }],
      nodes: {
        'Validate Monitoring Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-mon-2',
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
            case_state: 'AWAITING_HUMAN_REVIEW',
            outcome_class: 'MONITOR',
          },
        ],
        'Load Monitoring Config': [
          {
            gates_json: { monitoring: monitoringConfig },
          },
        ],
        'Load Latest Report': [
          {
            report_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            version_number: 3,
            as_of: '2026-01-01T00:00:00.000Z',
          },
        ],
        'Load Monitoring Rules': [
          {
            rules_json: [
              { rule_type: 'sec_filings', is_active: true },
              { rule_type: 'clinical_trials', is_active: true },
              { rule_type: 'financing', is_active: true },
            ],
          },
        ],
        'Load Evidence Fingerprints': [
          {
            evidence_json: [
              {
                id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                source_type: 'clinicaltrials_gov',
                stable_source_id: 'NCT04495855',
                metadata_json: { overall_status: 'ACTIVE_NOT_RECRUITING' },
              },
            ],
          },
        ],
        'Fetch SEC Submissions': [secSubmissions],
        'Fetch CT.gov Studies': [ctgovStudies],
      },
      executionId: 'exec-mon-2',
    });

    assert.ok(result.json.event_count > 0);
    assert.equal(result.json.has_events, true);
    assert.ok(
      result.json.outcome === 'EVENTS_RECORDED' || result.json.outcome === 'MATERIAL_EVENTS',
    );
    assert.ok(result.json.events_json_b64);
    assert.ok(String(result.json.change_memo).includes('Monitoring check'));
    // Existing NCT with different status should surface a status-change event
    const events = JSON.parse(
      Buffer.from(result.json.events_json_b64, 'base64').toString('utf8'),
    );
    assert.ok(events.some((e) => e.event_type === 'ctgov_status_change'));
    assert.ok(events.some((e) => String(e.event_type).startsWith('sec_')));
  });

  it('returns NO_EVENTS when filings are already known and older than as_of', () => {
    const [result] = runCodeNode(EVALUATE, {
      items: [{ monitoring_config: monitoringConfig }],
      nodes: {
        'Validate Monitoring Request': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            ticker: 'ACAD',
            exchange: 'NASDAQ',
            n8n_execution_id: 'exec-mon-3',
          },
        ],
        'Load Case And Company': [
          {
            case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
            company_id: '7e2399f9-c323-41e5-8291-e354b3375527',
            legal_name: 'ACADIA PHARMACEUTICALS INC',
            ticker: 'ACAD',
            case_state: 'AWAITING_HUMAN_REVIEW',
          },
        ],
        'Load Monitoring Config': [{ gates_json: { monitoring: monitoringConfig } }],
        'Load Latest Report': [{ version_number: 3, as_of: '2026-12-31T00:00:00.000Z' }],
        'Load Monitoring Rules': [{ rules_json: [{ rule_type: 'sec_filings', is_active: true }] }],
        'Load Evidence Fingerprints': [
          {
            evidence_json: [
              { stable_source_id: '0001070494-26-000012' },
              { stable_source_id: '0001070494-26-000008' },
              { stable_source_id: '0001070494-25-000045' },
              {
                stable_source_id: 'NCT04495855',
                metadata_json: { overall_status: 'COMPLETED' },
              },
              {
                stable_source_id: 'NCT05543018',
                metadata_json: { overall_status: 'RECRUITING' },
              },
            ],
          },
        ],
        'Fetch SEC Submissions': [secSubmissions],
        'Fetch CT.gov Studies': [ctgovStudies],
      },
      executionId: 'exec-mon-3',
    });

    assert.equal(result.json.outcome, 'NO_EVENTS');
    assert.equal(result.json.event_count, 0);
  });
});

describe('build-monitoring-result', () => {
  it('returns a stable subworkflow payload', () => {
    const [result] = runCodeNode(BUILD, {
      items: [
        {
          case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
          ticker: 'ACAD',
          exchange: 'NASDAQ',
          outcome: 'MATERIAL_EVENTS',
          next_state: 'AWAITING_HUMAN_REVIEW',
          event_count: 2,
          material_event_count: 1,
          matched_rule_types: ['sec_filings'],
          change_memo: 'test memo',
          counts: { event_count: 2 },
        },
      ],
    });
    assert.equal(result.json.outcome, 'MATERIAL_EVENTS');
    assert.equal(result.json.event_count, 2);
  });
});
