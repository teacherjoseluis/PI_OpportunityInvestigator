import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import profile from '../fixtures/twelvedata-profile-acad.json' with { type: 'json' };
import statistics from '../fixtures/twelvedata-statistics-acad.json' with { type: 'json' };
import quote from '../fixtures/twelvedata-quote-acad.json' with { type: 'json' };
import eligibility from '../fixtures/eligibility-config-v1.json' with { type: 'json' };
import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'workflows/shared/code/evaluate-eligibility.js');

function baseItem(overrides = {}) {
  return {
    case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
    ticker: 'ACAD',
    exchange: 'NASDAQ',
    case: {
      case_id: '91e5b497-a6f2-4f55-bf37-c995b8e8aef4',
      ticker: 'ACAD',
      exchange: 'NASDAQ',
      company_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      security_id: 'ffffffff-1111-4222-8333-444444444444',
      cik: '0001070494',
      legal_name: 'ACADIA PHARMACEUTICALS INC',
    },
    config: {
      configuration_version_id: '11111111-2222-4333-8444-555555555555',
      version_label: 'v1',
      eligibility_json: eligibility,
    },
    duplicate: { duplicate_count: 0 },
    profile,
    statistics,
    quote,
    ...overrides,
  };
}

describe('evaluate-eligibility', () => {
  it('passes ACAD with profile statistics and quote in range', () => {
    const [result] = runCodeNode(SCRIPT, { items: [baseItem()] });
    assert.equal(result.json.outcome, 'PASS');
    assert.equal(result.json.next_state, 'COLLECTING');
    assert.equal(result.json.market_cap_usd, 2500000000);
    assert.ok(result.json.adv_dollar_usd > 1000000);
    assert.ok(result.json.rules_b64);
    assert.ok(result.json.rules.every((r) => r.status === 'PASS'));
  });

  it('fails disallowed ETF security type', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        baseItem({
          profile: { ...profile, type: 'ETF', sector: 'Healthcare', industry: 'Biotechnology' },
        }),
      ],
    });
    assert.equal(result.json.outcome, 'FAIL');
    assert.equal(result.json.next_state, 'INCOMPLETE');
    assert.ok(result.json.rules.some((r) => r.key === 'security_type' && r.status === 'FAIL'));
  });

  it('fails shell/SPAC name patterns', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        baseItem({
          profile: {
            ...profile,
            name: 'Example Acquisition Corp',
            description: 'A blank check company',
          },
        }),
      ],
    });
    assert.equal(result.json.outcome, 'FAIL');
    assert.ok(result.json.rules.some((r) => r.key === 'not_shell_spac' && r.status === 'FAIL'));
  });

  it('routes missing market data to human review', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        baseItem({
          statistics: { code: 400, message: 'Not found' },
          quote: { code: 400, message: 'Not found' },
        }),
      ],
    });
    assert.equal(result.json.outcome, 'HUMAN_REVIEW');
    assert.equal(result.json.next_state, 'AWAITING_HUMAN_REVIEW');
  });

  it('uses PASS_WITH_EXCEPTION for industry mismatch', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        baseItem({
          profile: {
            ...profile,
            sector: 'Technology',
            industry: 'Consumer Electronics',
            name: 'Example Devices Inc',
            description: 'Makes gadgets',
          },
        }),
      ],
    });
    assert.equal(result.json.outcome, 'PASS_WITH_EXCEPTION');
    assert.equal(result.json.next_state, 'COLLECTING');
  });

  it('flags recent duplicate cases for human review', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [baseItem({ duplicate: { duplicate_count: 2 } })],
    });
    assert.equal(result.json.outcome, 'HUMAN_REVIEW');
    assert.ok(
      result.json.rules.some((r) => r.key === 'duplicate_recent_case' && r.status === 'HUMAN_REVIEW'),
    );
  });

  it('falls back to Finnhub profile2 when TwelveData profile/statistics are plan-blocked', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        baseItem({
          profile: {
            code: 403,
            message: '/profile is available exclusively with grow or pro plans',
            status: 'error',
          },
          statistics: {
            code: 403,
            message: '/statistics is available exclusively with pro plans',
            status: 'error',
          },
          finnhub: {
            ticker: 'ACAD',
            name: 'ACADIA Pharmaceuticals Inc',
            finnhubIndustry: 'Biotechnology',
            marketCapitalization: 2500,
            weburl: 'https://www.acadia.com',
          },
        }),
      ],
    });
    assert.equal(result.json.outcome, 'PASS');
    assert.equal(result.json.next_state, 'COLLECTING');
    assert.equal(result.json.market_cap_usd, 2_500_000_000);
    assert.equal(result.json.industry, 'Biotechnology');
    assert.equal(result.json.sector, 'Healthcare');
    assert.match(result.json.provenance, /finnhub\.profile2/);
    assert.ok(
      result.json.rules.every((r) => r.status === 'PASS' || r.status === 'PASS_WITH_EXCEPTION'),
    );
  });

  it('matches industry via legal_name keywords when profile is unavailable', () => {
    const [result] = runCodeNode(SCRIPT, {
      items: [
        baseItem({
          profile: { code: 403, status: 'error', message: 'plan' },
          statistics: {
            statistics: {
              valuations_metrics: { market_capitalization: 2_500_000_000 },
            },
          },
          finnhub: {},
        }),
      ],
    });
    assert.equal(result.json.outcome, 'PASS');
    assert.ok(
      result.json.rules.some(
        (r) =>
          r.key === 'industry_or_sector' &&
          r.status === 'PASS' &&
          r.measured_value?.matched_via === 'keyword',
      ),
    );
  });
});
