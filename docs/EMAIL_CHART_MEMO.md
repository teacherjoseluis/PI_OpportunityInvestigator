# Chart research memo — email format

**Document status:** Implemented locally in PII-14 / PII-16. Do not deploy until explicitly requested.  
**Visual source of truth:** [`assets/pii-investor-email-charts.png`](../assets/pii-investor-email-charts.png)  
**Layout reference (browser only):** [`assets/pii-investor-email-charts.html`](../assets/pii-investor-email-charts.html)  
**Replaces, when implemented:** the supporting/challenging memo in `workflows/shared/code/evaluate-email-delivery.js`  
**Does not replace:** scoring, claim language, or the rule that timing context is not a trade instruction.

The PNG is the picture the owner accepted. This document is the contract for reproducing that picture from a real case. The numbers, the price path, and which “on file” tiles are filled come from stored evidence. The PNG’s NBIX figures are a design fixture.

## 1. What the email is

One message per investigation report. It answers whether the name stays on the research list, then shows the evidence as charts.

Subject:

```text
[PII] {TICKER} · {OUTCOME_CLASS} · Timing {TIMING_LABEL}
```

Example: `[PII] NBIX · MONITOR · Timing MIXED`

Draft deliveries that are not publication-ready keep the existing test prefix from `config/email-delivery.v1.json` in front of that subject. The body layout does not change.

Recipient, from-address, dedupe, and the publication gate stay as they are in PII-14. This slice changes the body only.

## 2. Page

| Token | Value |
|---|---|
| Page background | `#E8ECF0` |
| Card | white, 720px, centered |
| Font | Segoe UI, Helvetica, Arial, sans-serif |
| Text | `#111827` |
| Muted | `#6B7280` |
| Section label | 11px, bold, letter-spacing 0.05em, `#374151`, uppercase |

Regions, top to bottom, and nothing else:

1. Navy header with ticker and outcome pill
2. Amber banner
3. Four KPI tiles
4. Weekly price chart
5. Two columns: excess return, then drawdown + RSI
6. Score bars
7. On-file tiles
8. Four watch chips
9. Footer

Do not add MACD, ADX, ATR, realized volatility, dollar ADV, the 1-month or 6-month relative-strength windows, or a supporting/challenging essay. Those facts stay in the report and are available to follow-up questions. They are not on this email.

## 3. Header

Background `#0B1F33`. Padding about 16px 22px.

| Piece | Style | Source |
|---|---|---|
| Eyebrow | 11px, `#D7E0EA`, tracking 0.08em | Constant: `PHARMA OPPORTUNITY INVESTIGATOR` |
| Ticker | 34px, white, bold | `research_cases` ticker |
| Subline | 12px, `#C9D5E3` | `{display name} · {exchange} · {as of D Mon YYYY}` |
| Pill | right side, 1px `#5EEAD4` border, `#5EEAD4` text, full pill | `scores.outcome_class` |

Display name is the legal name with a trailing “Inc.” removed and title-cased, same helper as today’s email. As-of is the report as-of date.

Outcome text is the stored class, not a paraphrase: `MONITOR`, `ACTIVE_WATCHLIST`, `HIGH_CONVICTION_RESEARCH`, `REASSESS_OR_EXCLUDE`. The reference pill reads `MONITOR`.

## 4. Banner

Full width. Background `#F8EDE3`. Text `#8A5A2B`. 12px. One line:

```text
Research memo · timing context is not a trade instruction.
```

Do not print “charts use sample figures” on a real case. That sentence exists only on the design fixture.

## 5. KPI tiles

Four equal tiles. Background `#F8FAFC`, border `#E5E7EB`, radius 4px. Value 18px bold. Caption 10px `#6B7280`.

| Tile | Caption | Value | Color |
|---|---|---|---|
| 1 | Research stance | `outcome_class` | `#0F766E` for `MONITOR` and `ACTIVE_WATCHLIST`; `#0B1F33` for `HIGH_CONVICTION_RESEARCH`; `#B91C1C` for `REASSESS_OR_EXCLUDE` |
| 2 | Timing context | `CONSTRUCTIVE`, `MIXED`, or `UNFAVORABLE` | `#0F766E`, `#C2410C`, `#B91C1C` in that order |
| 3 | Priority score | `research_priority_score`, rounded | `#0B1F33` |
| 4 | Evidence confidence | `evidence_confidence_score`, rounded | `#0B1F33` |

Tile 4 is evidence confidence, not the technical score. The technical score is the last bar in section 8.

A null score renders as `—` in `#6B7280`. A null timing label renders as `UNAVAILABLE` in `#6B7280`. Do not invent `MIXED`.

Timing label source, in order: `technical_indicator_values.calculation_notes` where `indicator_key = 'timing_label'`, else the `entry_timing_context` claim. The numeric `metric_value` on that row is only a sort key (2 / 1 / 0) and must not be shown.

## 6. Weekly price

Section label: `WEEKLY PRICE`.

This is the only region that is a picture. Draw it from `market_bars` for the case symbol, `interval = '1week'`, ordered by `bar_time`.

| Series | Rule |
|---|---|
| Window | Last 52 weekly bars. If fewer exist, plot what exists. |
| Close | Navy `#0B1F33` line, about 2px |
| 40-week average | Teal `#0F766E` dashed line. Omit the line until 40 weekly closes exist. Compute it at render time from those closes. The stored latest SMA is a check, not the line. |
| Volume | Gray `#E5E7EB` bars in a band under the price pane. Scale each bar to the max volume in the window. |
| Y axis | Pad the min low and max high in the window. Do not anchor at zero. |
| 52-week high | Red `#B91C1C` dot on the weekly bar that contains the daily high used by `drawdown_52w_pct` (252 daily sessions). Label `52w high`. |
| Last close | Navy dot on the last weekly close. Label the drawdown, for example `−18%`, using the same `drawdown_52w_pct` as the gauge. |

Legend under the chart, 11px `#6B7280`, in this order:

```text
Weekly close · 40-week average · Volume · RSI {n} · last week {ratio}× average volume
```

`RSI` is `weekly_rsi_14`, rounded. `ratio` is the weekly volume ratio already computed for `volume_confirmation`, one decimal. If either is null, drop that clause. Do not leave a dangling dot.

If weekly bars are missing, do not draw a decorative line. Show a flat `#F3F4F6` panel and the sentence `Price history is not on file.` The Prices tile in section 9 is then empty.

## 7. Excess return

Left column. Label: `EXCESS RETURN`.

Two groups side by side, headers `3 month` and `12 month`. Rows, top to bottom: `XBI`, `XLV`, `SPY`.

| Sign | Bar |
|---|---|
| Negative | `#B91C1C`, value prefixed with a minus |
| Positive | `#0F766E`, value prefixed with a plus |
| Zero or null | No bar. Value `—` in `#6B7280` |

One shared scale across both groups, so a 12-month bar of `+11.6` is longer than a 3-month bar of `−8.4` when those are the magnitudes. Scale to the largest absolute value in the six cells, with a floor of 1 so a near-zero set still draws.

Caption: `Percentage points versus XBI, XLV, and SPY.` Foot labels under the groups: `weaker` on the left, `stronger` on the right.

### Where the six numbers come from

PII-16 already computes excess return for XBI, XLV, and SPY at 1, 3, 6, and 12 months from daily `market_bars`. It persists only `rs_xbi_3m_ppt`. The claim text mentions only the XBI 3-month figure.

This email needs six stored numbers:

| `indicator_key` | Window |
|---|---|
| `rs_xbi_3m_ppt` | already stored |
| `rs_xlv_3m_ppt` | computed, not stored |
| `rs_spy_3m_ppt` | computed, not stored |
| `rs_xbi_12m_ppt` | computed, not stored |
| `rs_xlv_12m_ppt` | computed, not stored |
| `rs_spy_12m_ppt` | computed, not stored |

Persist those keys on `technical_indicator_values` in PII-16, from the `rs` object that already exists in `technical-indicators.js`. Also persist the 1-month and 6-month keys the same way. They are not drawn here. Follow-up questions use them.

No new market-data vendor. Benchmarks SPY, XBI, and XLV are already in the PII-03-MKT fetch plan (`prepare-market-queries.js`, `config/collection-market.v1.json`). If a benchmark series is missing, that row is `—` and the tile for Prices can still be on.

Do not reimplement the excess-return formula inside PII-14. Read the indicator rows.

## 8. Drawdown and RSI

Right column.

### Drawdown

Label: `DRAWDOWN FROM 52-WEEK HIGH`.

Fixed axis from `0` to `−40%`, even when the value is outside that span. Three bands, matching `config/analysis-technical.v1.json`:

| Band | Fill | Label |
|---|---|---|
| 0 to 15% | `#D1FAE5` | `inside 15%` |
| 15 to 25% | `#FFEDD5` | `15–25` |
| beyond 25, through 40 | `#FEE2E2` | `beyond 25` |

Marker `#C2410C` at `drawdown_52w_pct`. If the value is past −40%, clamp the marker to the right edge and still print the true number. Caption under the bar: `{value}% · {band name}`. Band name is `inside 15%`, `mixed band`, or `beyond 25`. The reference reads `−18% · mixed band`.

`mixed band` is the 15–25 slice. It is not the same word as the timing label, though both can be mixed on the same case.

### RSI

Label: `RSI (14)`.

Fixed axis 0–100. Zones: below 30 `#FEE2E2`, 30 through 70 `#E5E7EB`, above 70 `#D1FAE5`. Marker `#0B1F33` at `weekly_rsi_14`. Print the integer under the marker. Axis labels `30` and `70`.

Caption under the pair:

```text
{Momentum}. Timing band is the amber slice.
```

Momentum word: `Weak` below 30, `Neutral` from 30 through 70, `Strong` above 70. The reference reads `Neutral momentum. Timing band is the amber slice.`

## 9. Scores

Label: `SCORES`.

Six rows, always, in this order. Track `#F3F4F6`. Fill width is `score / 100`. Number at the right, rounded. Null score: empty track and `—`.

| Row | Column | Fill |
|---|---|---|
| Business | `business_quality_score` | `#1D4ED8` |
| Growth | `growth_score` | `#1D4ED8` |
| Pipeline | `pipeline_score` | `#1D4ED8` |
| Valuation | `valuation_context_score` | `#0F766E` |
| Risk | `risk_score` | `#B91C1C` |
| Technical | `technical_context_score` | `#C2410C` |

After the technical number, muted 10px: `context only`. That score is not a weight in `research_priority_score`.

Color is by row, not by whether the number is high or low. A valuation of 72 stays teal.

## 10. On file

Label: `ON FILE`.

Ten tiles, equal width, this order. The reference shows the first eight filled (`#0F766E`) and the last two dashed (white, 1.5px dashed `#9CA3AF`). Production fills a tile only when the case has the fact. An empty collector uses the dashed style. Labels stay.

| Tile | On when |
|---|---|
| SEC | At least one SEC submission or filing evidence document for the case |
| Trials | At least one ClinicalTrials.gov document |
| FDA | At least one Drugs@FDA document |
| News | At least one company-news document |
| Cash | At least one XBRL cash or debt metric on `financial_metrics` for the company |
| Patents | At least one USPTO document |
| Courts | At least one CourtListener docket |
| Prices | At least 40 weekly bars for the subject in `market_bars` |
| Short | A stored licensed short-interest field. There is no such field today. The tile stays dashed. |
| Peers | A configured peer set and stored comparable multiples. There is no peer set today. The tile stays dashed. |

Do not mark Cash on because a 10-K exists. That is the SEC tile. Cash means the filing-backed cash or debt metric.

Do not add tiles for Orange Book, product-level revenue, or PDUFA. Those gaps are real and belong in answers to follow-up questions. They are not part of this picture.

## 11. What would change the read

Label: `WHAT WOULD CHANGE THE READ`.

Four chips, always, equal width. Border `#E5E7EB`, background `#F8FAFC`. Title 11px. Subtitle 10px `#6B7280`.

| Title | Subtitle | Backed by |
|---|---|---|
| Next 10-K / 10-Q | Filing | Existing `sec_filings` monitoring rule |
| Late-stage readout | Trials | Existing `clinical_trials` monitoring rule |
| Runway or offering | Financing | Existing `financing` rule (offering forms) plus XBRL burn when metrics exist |
| 40-week cross | or XBI −10 ppt | `weekly_40_sma_cross` and `rs_vs_xbi_deterioration` |

The chip is a standing watch label. It does not assert that a readout date or a runway number was measured.

`Late-stage readout` is not a dated FDA calendar. Drugs@FDA stores approvals. It does not store future PDUFA or advisory-committee dates. ClinicalTrials.gov status and new-study rules are the source behind the chip. A calendar of decision dates would be a new source and would change this email, so it is out of scope.

## 12. Footer

Top border `#E5E7EB`. 10px `#9CA3AF`.

| Left | Right |
|---|---|
| `Case {id} · As of {date}` | `Research assistance only. Not investment advice.` |

The design fixture’s “sample layout” sentence is not sent.

## 13. How it has to be sent

The reference HTML uses flexbox and inline SVG. Gmail and Outlook will not reliably show that. The sent message is table HTML plus one image.

| Region | MIME |
|---|---|
| Header, banner, KPIs, excess-return bars, drawdown, RSI, score bars, on-file tiles, watch chips, footer | Nested tables and background colors. Bar width is a percent. No flexbox. No SVG. |
| Weekly price, average, and volume | One PNG, about 1360×376 at 2x for the 680×188 slot, inline via CID. Generated in PII-14 from `market_bars`. |

No chart vendor and no hosted image URL. A short plain-text alternative lists the same KPI values, the six excess-return numbers, drawdown, RSI, the six scores, which on-file tiles are present, and the four watch titles. Clients that block images still get the numbers.

Forbidden words stay those in `config/analysis-technical.v1.json`: buy, sell, add, trim, price target, accumulate, distribute, go long, short the stock. The word “short” on the empty tile means short interest. Keep the tile label `Short`. Do not write “short the stock.”

## 14. Sources

### Already enough, once the case ran

| Need | Where it already lives |
|---|---|
| Identity, ticker, exchange, legal name | PII-01, `companies` / `securities` |
| Outcome, priority, confidence, six scores | PII-10, `scores` |
| Weekly and daily OHLCV for the subject and for SPY, XBI, XLV | PII-03-MKT, `market_bars`, TwelveData `/time_series`, Finnhub `/stock/candle` only when the plan denies the series |
| Latest drawdown, weekly RSI, timing label, XBI 3-month excess, weekly volume ratio | PII-16, `technical_indicator_values` and claims |
| SEC, trials, FDA, news, patents, dockets | PII-03 collectors, `evidence_documents` |
| Cash and debt | PII-03 XBRL into `financial_metrics`, when companyfacts actually contains the metrics |
| Watch rules | PII-11 seeds and `config/monitoring.v1.json` |

NBIX smoke stored bars (`access_status=ok`). A later case can still come back with no series if the vendor plan refuses `/time_series`. Then the price panel and the Prices tile follow the empty rules in §6 and §10. Do not scrape a chart site.

### Work required, no new vendor

| Gap | Why the picture needs it |
|---|---|
| Persist the full relative-strength grid | Six bars need six keys. Only `rs_xbi_3m_ppt` is written today. The other five for this email are already calculated in memory. |
| PNG renderer in PII-14 | The price pane cannot be a table. |
| Table HTML for every other region | The accepted picture uses flex and SVG, which email clients drop. |

### Missing sources — leave the tile empty

| Tile | What is missing | What not to do |
|---|---|---|
| Short | No licensed short-interest or days-to-cover field. Finnhub exposes a short-interest endpoint on some plans. The current key has not been checked for that plan, and this spec does not authorize the call. | Do not infer a short from price or volume. |
| Peers | No peer list and no licensed comparable multiples. PII-08 already records `peer_comparison` as insufficient. | Do not build a peer set from the industry string on the Finnhub profile. |

### Related gaps that this email does not show

These are why some follow-up questions still come back empty. They are not new tiles.

| Gap | Status |
|---|---|
| Product-level revenue and concentration | Not extracted. Company-level XBRL revenue can exist without it. |
| Orange Book exclusivity | Deferred. No ZIP ingest. |
| Future PDUFA / AdCom calendar | Not collected. Approvals on file are historical Drugs@FDA rows. |
| XBRL metrics on a given case | The collector can store a companyfacts document with `xbrl_metric_count = 0`. Cash tile stays off. |
| CourtListener coverage | A successful collect can store zero dockets. Courts tile stays off. |

## 15. Acceptance

1. A fixture case renders a message a person can set beside `assets/pii-investor-email-charts.png` and match region order, colors, labels, and chart geometry.
2. The fixture’s numbers match `scores`, `technical_indicator_values`, and `market_bars`, not the sample numbers baked into the PNG.
3. A case with no weekly bars shows the empty price panel and a dashed Prices tile, and still shows the other regions.
4. A case with no short-interest row and no peer set shows those two tiles dashed.
5. The MIME contains no SVG and no flexbox.
6. The body contains none of the forbidden trade words.
7. `npm test` covers the indicator-key list, the on-file booleans, the band placement for drawdown, and the empty-bar behavior.

## 16. Non-goals

- Changing score weights, outcome classes, or the timing rubric.
- Putting this layout in Slack. Slack keeps the short completion note.
- A second email that is the old supporting/challenging memo.
- Drawing 1-month or 6-month relative strength on this page.
- Fetching short interest or peers as part of implementing the layout.
