import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDICATORS = path.join(repoRoot, 'workflows/shared/code/technical-indicators.js');

function run(item) {
  const [result] = runCodeNode(INDICATORS, { items: [item] });
  return result.json;
}

function risingBars(count, start) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const close = start + i * 0.4;
    const day = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    bars.push({
      bar_time: day,
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 2000000,
    });
  }
  return bars;
}

describe('technical indicators', () => {
  it('computes SMA and Wilder RSI on a frozen series', () => {
    assert.equal(run({ action: 'sma', values: [10, 11, 12, 11, 13], period: 3 }).value, 12);
    const rsi = run({ action: 'rsi', values: [10, 12, 11, 13], period: 2 }).value;
    assert.ok(Math.abs(rsi - (100 - 100 / 7)) < 1e-9);
  });

  it('keeps MACD equal to fast EMA minus slow EMA', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const fast = run({ action: 'ema', values, period: 3 }).value;
    const slow = run({ action: 'ema', values, period: 5 }).value;
    const row = run({ action: 'macd', values, fast: 3, slow: 5, signal: 3 });
    assert.ok(Math.abs(row.macd - (fast - slow)) < 1e-9);
    assert.ok(row.macd > 0);
    assert.equal(typeof row.histogram, 'number');
  });

  it('computes ATR, drawdown, ADV, relative strength, and ADX direction', () => {
    const atr = run({
      action: 'atr',
      period: 2,
      bars: [
        { high: 10, low: 8, close: 9 },
        { high: 11, low: 9, close: 10 },
        { high: 12, low: 10, close: 11 },
      ],
    }).value;
    assert.equal(atr, 2);

    const dd = run({
      action: 'drawdown',
      sessions: 10,
      bars: [
        { high: 100, low: 90, close: 95 },
        { high: 120, low: 100, close: 110 },
        { high: 110, low: 80, close: 90 },
      ],
    });
    assert.equal(dd.drawdown_pct, 25);

    const adv = run({
      action: 'adv',
      window: 2,
      bars: [
        { close: 10, volume: 100 },
        { close: 10, volume: 300 },
      ],
    }).value;
    assert.equal(adv, 2000);

    const stock = Array.from({ length: 22 }, () => 100);
    stock[21] = 110;
    const bench = Array.from({ length: 22 }, () => 100);
    const rs = run({ action: 'relative_strength', stock, benchmark: bench, sessions: 21 });
    assert.ok(Math.abs(rs.excess_ppt - 10) < 1e-9);

    const trend = [];
    for (let i = 0; i < 40; i += 1) {
      trend.push({ high: 10 + i, low: 8 + i, close: 9 + i });
    }
    const adx = run({ action: 'adx', bars: trend, period: 5 });
    assert.ok(adx.adx > 20);
    assert.ok(adx.plus_di > adx.minus_di);
  });

  it('labels timing CONSTRUCTIVE, MIXED, UNFAVORABLE, or insufficient', () => {
    const rubric = {
      constructive: {
        close_above_weekly_sma: 40,
        max_drawdown_from_52w_high_pct: 15,
        min_rs_vs_xbi_3m_ppt: -5,
      },
      unfavorable: {
        close_below_weekly_sma: 40,
        any_of: {
          min_drawdown_from_52w_high_pct: 25,
          max_rs_vs_xbi_3m_ppt: -15,
          adv_below_eligibility_minimum: true,
        },
      },
    };
    assert.equal(
      run({
        action: 'rubric',
        rubric,
        metrics: {
          close: 110,
          weekly_sma: 100,
          drawdown_pct: 10,
          rs_xbi_3m_ppt: -2,
          adv20: 2_000_000,
          adv_minimum: 1_000_000,
        },
      }).label,
      'CONSTRUCTIVE',
    );
    assert.equal(
      run({
        action: 'rubric',
        rubric,
        metrics: {
          close: 90,
          weekly_sma: 100,
          drawdown_pct: 30,
          rs_xbi_3m_ppt: -20,
          adv20: 2_000_000,
          adv_minimum: 1_000_000,
        },
      }).label,
      'UNFAVORABLE',
    );
    assert.equal(
      run({
        action: 'rubric',
        rubric,
        metrics: {
          close: 110,
          weekly_sma: 100,
          drawdown_pct: 20,
          rs_xbi_3m_ppt: -10,
          adv20: 2_000_000,
          adv_minimum: 1_000_000,
        },
      }).label,
      'MIXED',
    );
    assert.equal(
      run({
        action: 'rubric',
        rubric,
        metrics: {
          close: 110,
          weekly_sma: null,
          drawdown_pct: 10,
          rs_xbi_3m_ppt: 0,
          adv20: 2_000_000,
          adv_minimum: 1_000_000,
        },
      }).label,
      null,
    );
  });

  it('emits technical claims from fixture bars without trade language', () => {
    const daily = risingBars(280, 40);
    const weekly = risingBars(80, 40);
    const xbi = risingBars(280, 50);
    const spy = risingBars(280, 80);
    const xlv = risingBars(280, 70);
    const result = run({
      action: 'evaluate',
      ticker: 'ACAD',
      case_id: 'fb342540-1bd9-49a4-a38b-5328501ccac4',
      bars: { ACAD: { '1day': daily, '1week': weekly }, XBI: { '1day': xbi }, SPY: { '1day': spy }, XLV: { '1day': xlv } },
      evidence_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      catalyst_dates: [daily[100].bar_time],
    });
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.entry_timing_context, 'CONSTRUCTIVE');
    assert.ok(result.technical_context_score > 0);
    const keys = result.claims.map((claim) => claim.topic_key);
    for (const key of [
      'trend_regime',
      'sma_stack',
      'momentum_rsi_macd',
      'volatility_drawdown',
      'liquidity_adv',
      'relative_strength',
      'entry_timing_context',
      'short_interest',
    ]) {
      assert.ok(keys.includes(key) || keys.includes('insufficient_' + key), key);
    }
    const blob = result.claims.map((claim) => claim.claim_text).join('\n');
    assert.equal(run({ action: 'audit_text', text: blob }).hits.length, 0);
    assert.match(blob, /Not a trade instruction/);
    const indicatorKeys = result.indicator_rows.map((row) => row.indicator_key);
    for (const key of [
      'rs_xbi_1m_ppt',
      'rs_xlv_1m_ppt',
      'rs_spy_1m_ppt',
      'rs_xbi_3m_ppt',
      'rs_xlv_3m_ppt',
      'rs_spy_3m_ppt',
      'rs_xbi_6m_ppt',
      'rs_xlv_6m_ppt',
      'rs_spy_6m_ppt',
      'rs_xbi_12m_ppt',
      'rs_xlv_12m_ppt',
      'rs_spy_12m_ppt',
      'weekly_volume_ratio',
    ]) {
      assert.ok(indicatorKeys.includes(key), key);
    }
  });

  it('returns insufficient claims and a market-data fill-in when bars are missing', () => {
    const result = run({
      action: 'evaluate',
      ticker: 'ACAD',
      bars: { ACAD: { '1day': [], '1week': [] } },
    });
    assert.equal(result.status, 'INSUFFICIENT');
    assert.equal(result.technical_context_score, null);
    assert.equal(result.fill_in_suggestions[0].agent_key, 'PII-03-MKT');
    assert.ok(result.claims.every((claim) => claim.claim_text.startsWith('INSUFFICIENT_EVIDENCE')));
  });

  it('keeps only the event-reaction claim for the follow-up task', () => {
    const focused = run({
      action: 'apply_focus',
      focus: 'events',
      evaluated: {
        claims: [
          { topic_key: 'trend_regime', claim_text: 'Weekly close is below the 40-week SMA.' },
          {
            topic_key: 'event_price_reaction',
            claim_text: 'Latest dated catalyst window: -2% versus XBI. Not a trade instruction.',
          },
        ],
        indicator_rows: [
          { indicator_key: 'weekly_rsi_14' },
          { indicator_key: 'event_excess_return_pct' },
        ],
        monitoring_seeds: [{ rule_type: 'volume_spike' }],
      },
    });
    assert.equal(focused.agent_key, 'PII-16-EVENTS');
    assert.deepEqual(
      focused.claims.map((claim) => claim.topic_key),
      ['event_price_reaction'],
    );
    assert.deepEqual(
      focused.indicator_rows.map((row) => row.indicator_key),
      ['event_excess_return_pct'],
    );
    assert.equal(focused.monitoring_seeds.length, 0);
  });
});
