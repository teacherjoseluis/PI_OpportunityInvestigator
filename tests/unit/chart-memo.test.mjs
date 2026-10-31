import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCodeNode } from '../helpers/run-code-node.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHART = path.join(repoRoot, 'workflows/shared/code/chart-memo.js');

function run(item) {
  const [result] = runCodeNode(CHART, { items: [item] });
  return JSON.parse(JSON.stringify(result.json));
}

describe('chart memo helpers', () => {
  it('lists the persisted relative-strength indicator keys', () => {
    const result = run({ chart_memo_action: 'rs_keys' });
    assert.deepEqual(result.keys, [
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
    ]);
  });

  it('fills on-file tiles only from stored facts', () => {
    const filled = run({
      chart_memo_action: 'on_file',
      evidence_counts: {
        sec_edgar_filing: 3,
        clinicaltrials_gov: 1,
        fda_drugsfda: 2,
        finnhub_company_news: 4,
        uspto_patent: 1,
        courtlistener_docket: 1,
      },
      cash_metric_count: 2,
      weekly_bar_count: 52,
    });
    assert.deepEqual(
      filled.tiles.filter((tile) => tile.on).map((tile) => tile.key),
      ['SEC', 'Trials', 'FDA', 'News', 'Cash', 'Patents', 'Courts', 'Prices'],
    );
    assert.deepEqual(
      filled.tiles.filter((tile) => !tile.on).map((tile) => tile.key),
      ['Short', 'Peers'],
    );

    const empty = run({
      chart_memo_action: 'on_file',
      evidence_counts: { sec_edgar_submissions: 1 },
      cash_metric_count: 0,
      weekly_bar_count: 12,
    });
    assert.equal(empty.tiles.find((tile) => tile.key === 'SEC').on, true);
    assert.equal(empty.tiles.find((tile) => tile.key === 'Cash').on, false);
    assert.equal(empty.tiles.find((tile) => tile.key === 'Prices').on, false);
    assert.equal(empty.tiles.find((tile) => tile.key === 'Short').on, false);
    assert.equal(empty.tiles.find((tile) => tile.key === 'Peers').on, false);
  });

  it('places the drawdown marker on the 0 to -40 axis', () => {
    const mixed = run({ chart_memo_action: 'drawdown', value: 18 });
    assert.equal(mixed.band, 'mixed band');
    assert.equal(mixed.display, '\u221218%');
    assert.equal(mixed.caption, '\u221218% \u00b7 mixed band');
    assert.equal(mixed.markerPct, 45);
    assert.equal(mixed.clamped, false);

    const inside = run({ chart_memo_action: 'drawdown', value: -10 });
    assert.equal(inside.band, 'inside 15%');
    assert.equal(inside.markerPct, 25);

    const beyond = run({ chart_memo_action: 'drawdown', value: 50 });
    assert.equal(beyond.band, 'beyond 25');
    assert.equal(beyond.display, '\u221250%');
    assert.equal(beyond.markerPct, 100);
    assert.equal(beyond.clamped, true);

    const missing = run({ chart_memo_action: 'drawdown', value: null });
    assert.equal(missing.display, '\u2014');
    assert.equal(missing.markerPct, null);
  });

  it('draws no excess-return bar for zero or null values', () => {
    const result = run({
      chart_memo_action: 'excess',
      indicators: {
        rs_xbi_3m_ppt: { metric_value: -8.4 },
        rs_xlv_3m_ppt: { metric_value: 0 },
        rs_spy_3m_ppt: { metric_value: null },
        rs_xbi_12m_ppt: { metric_value: 11.6 },
        rs_xlv_12m_ppt: { metric_value: 6.4 },
        rs_spy_12m_ppt: { metric_value: 2.8 },
      },
    });
    const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row]));
    assert.equal(byKey.rs_xbi_3m_ppt.empty, false);
    assert.equal(byKey.rs_xbi_3m_ppt.display, '\u22128.4');
    assert.equal(byKey.rs_xlv_3m_ppt.empty, true);
    assert.equal(byKey.rs_xlv_3m_ppt.display, '\u2014');
    assert.equal(byKey.rs_spy_3m_ppt.empty, true);
    assert.equal(byKey.rs_xbi_12m_ppt.widthPct > byKey.rs_xbi_3m_ppt.widthPct, true);
    assert.equal(byKey.rs_xbi_12m_ppt.scale, 11.6);
  });

  it('does not invent a MIXED timing label', () => {
    const fromNotes = run({
      chart_memo_action: 'timing',
      indicators: { timing_label: { metric_value: 2, calculation_notes: 'CONSTRUCTIVE' } },
    });
    assert.equal(fromNotes.label, 'CONSTRUCTIVE');

    const fromClaim = run({
      chart_memo_action: 'timing',
      indicators: {},
      timing_claim_text: 'Entry-timing context is UNFAVORABLE. Not a trade instruction.',
    });
    assert.equal(fromClaim.label, 'UNFAVORABLE');

    const missing = run({
      chart_memo_action: 'timing',
      indicators: { timing_label: { metric_value: 1, calculation_notes: '' } },
      timing_claim_text: 'No timing row on file.',
    });
    assert.equal(missing.label, null);
  });

  it('builds table HTML without SVG or flexbox and keeps Short as a tile label', () => {
    const memo = run({
      chart_memo_action: 'build',
      ticker: 'NBIX',
      exchange: 'NASDAQ',
      legal_name: 'NEUROCRINE BIOSCIENCES INC',
      outcome_class: 'MONITOR',
      as_of: '2026-10-29',
      case_id: '26c575e8-3b9a-4c30-ae84-ee21ed2e0da7',
      scores: {
        research_priority_score: 58,
        evidence_confidence_score: 64,
        business_quality_score: 72,
        growth_score: 61,
        pipeline_score: 58,
        valuation_context_score: 49,
        risk_score: 48,
        technical_context_score: 52,
      },
      indicators: {
        timing_label: { calculation_notes: 'MIXED' },
        drawdown_52w_pct: { metric_value: 18 },
        weekly_rsi_14: { metric_value: 54 },
        weekly_volume_ratio: { metric_value: 0.9 },
        rs_xbi_3m_ppt: { metric_value: -8.4 },
        rs_xlv_3m_ppt: { metric_value: -1.2 },
        rs_spy_3m_ppt: { metric_value: -4 },
        rs_xbi_12m_ppt: { metric_value: 11.6 },
        rs_xlv_12m_ppt: { metric_value: 6.4 },
        rs_spy_12m_ppt: { metric_value: 2.8 },
      },
      weekly_bars: [],
      weekly_bar_count: 0,
      evidence_counts: { sec_edgar_filing: 1 },
      cash_metric_count: 0,
    });
    assert.equal(memo.has_flexbox, false);
    assert.equal(memo.has_svg, false);
    assert.deepEqual(memo.forbidden, []);
    assert.match(memo.html, />Short</);
    assert.doesNotMatch(memo.html, /short the stock/i);
    assert.match(memo.html, /Price history is not on file/);
    assert.match(memo.text, /Not on file: .*Short, Peers/);
    assert.match(memo.subject_core, /\[PII\] NBIX · MONITOR · Timing MIXED/);
    assert.equal(memo.has_price_chart, false);
  });

  it('renders a PNG from weekly bars and skips the image when none exist', () => {
    const weekly = [];
    for (let i = 0; i < 45; i += 1) {
      weekly.push({
        bar_time: new Date(Date.UTC(2024, 0, 5 + i * 7)).toISOString().slice(0, 10),
        open: 80 + i * 0.4,
        high: 82 + i * 0.4,
        low: 78 + i * 0.4,
        close: 81 + i * 0.4,
        volume: 2000 + i,
      });
    }
    const png = run({
      chart_memo_action: 'render_png',
      weekly_bars: weekly,
      daily_highs: weekly.map((bar) => ({ bar_time: bar.bar_time, high: bar.high })),
      drawdown_pct: 18,
    });
    assert.equal(png.has_png, true);
    assert.equal(png.png_magic, '89504e470d0a1a0a');
    assert.ok(png.byte_length > 100);

    const empty = run({ chart_memo_action: 'render_png', weekly_bars: [] });
    assert.equal(empty.has_png, false);
  });
});
