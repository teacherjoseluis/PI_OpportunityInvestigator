# Follow-up questions — supervisor routing

**Document status:** Design contract. Not implemented. Do not deploy until explicitly requested.  
**Depends on:** the hosted supervisor in [`MULTI_AGENT_ORCHESTRATION.md`](MULTI_AGENT_ORCHESTRATION.md) and the chart memo in [`EMAIL_CHART_MEMO.md`](EMAIL_CHART_MEMO.md)  
**Does not add:** a new specialist that re-answers another agent’s domain, and does not turn any agent into a free-roaming chatbot.

## 1. Feasibility

Yes. The supervisor already decides which agents run. A follow-up question is a smaller plan, not a new kind of analyst.

What makes it feasible now:

- Slack `/pii` already accepts a free-text question after the ticker. Today that text is stored and then ignored. PII-00 still runs a full investigation.
- Each specialist already owns one claim category and writes it to Postgres.
- `EVENT_REASSESSMENT` and `REFRESH` already run only the agents in `dispatch_keys`.
- One fill-in pass can rerun the owner of a gap after that claim category is deactivated.

What a follow-up is not:

- It is not a second opinion layered on top of PII-04 or PII-16.
- It is not a model that may browse, recompute indicators with a new formula, or talk past an `INSUFFICIENT_EVIDENCE` row.
- It does not become possible to answer short interest, peer multiples, product-level revenue, Orange Book exclusivity, or a future PDUFA date just because the question was asked. Those sources are listed in [`EMAIL_CHART_MEMO.md`](EMAIL_CHART_MEMO.md) §14. The answer cites the gap.

The useful split is:

| Situation | What happens |
|---|---|
| The latest case already has the claim or indicator | Answer from the blackboard. No collector runs. |
| The case exists, the fact is missing, and a collector we already have can fetch it | Supervisor dispatches that collector and its analyst, then answers. |
| The fact needs a source we do not have | Answer with the insufficient text. Dispatch nothing. |
| There is no case for the ticker | Do not start a full investigation from a follow-up. Tell the owner to run `/pii TICKER`. |

An optional later composer may turn cited claims into a short paragraph. It may not add facts. The first slice does not need that model. Stored claim text is the answer.

## 2. What the owner does

```text
/pii NBIX why is timing mixed
/pii NBIX NASDAQ what is on the FDA list
/pii NBIX how does the 3-month read versus XBI compare with 12 months
```

A question after the ticker is always a follow-up. `/pii NBIX why is timing mixed` does not create a case, does not run collectors, and does not rerun PII-16 or any other analyst. It reads the latest NBIX report and answers from the stored timing claim.

- A completed case exists → answer from that case.
- No completed case → reply that there is no analysis yet. Do not start one. A full run is only `/pii NBIX` or `/pii NBIX NASDAQ`, with no question after the ticker.

Default question, which must not trigger follow-up mode:

```text
Does the current evidence justify deeper research?
```

Webhook body for the same path:

```json
{
  "mode": "FOLLOW_UP",
  "ticker": "NBIX",
  "exchange": "NASDAQ",
  "question": "why is timing mixed"
}
```

`case_id` may be sent instead of ticker. Ticker resolution uses the latest case that is not `SUPERSEDED` and that has a report. If several qualify, use the newest `as_of`.

Reply in Slack, in the same channel the command used, through the existing `response_url` on intake and the Slack DM path on PII-15 when the owner has a user id. Do not send the chart memo again unless the question asks for the memo (`send the email`, `resend the report`). That resend is the existing PII-14 dedupe path, not a new analysis.

## 3. Who routes

PII-00 routes. Specialists do not see the raw question unless the supervisor puts a one-line objective on `agent_tasks.objective` for a refresh.

```text
Slack or webhook
    → resolve ticker to a case
    → classify the question to one or more agent keys
    → if the blackboard can answer, compose and reply
    → if a known collector can fill a gap, dispatch that subgraph, then compose
    → if the source does not exist, reply with the gap
```

Classification is a table, not a model, in the first slice. A later slice may add a classifier whose only output is a key from this table, or `UNROUTED`, or `REFUSE_TRADE`. The classifier does not write the answer.

## 4. Route table

Match is case-insensitive. First match wins for a single-domain question. A question that hits two rows fans out to both agents and the reply has one block per agent. More than three agents, or no match, is `UNROUTED`: ask which of the row labels they mean, and do not run collectors.

| If the question is about | Agent | Read | Refresh only if missing |
|---|---|---|---|
| Cash, debt, runway, burn, margins, shares, dilution, revenue | PII-04 | `business_financial` claims, `financial_metrics` | `PII-03-XBRL` when no cash/debt metric |
| Growth, partnerships, licensing, headlines | PII-05 | `growth_prospects` claims, company-news documents | `PII-03-NEWS` |
| Trials, phase, enrollment, pipeline | PII-06 | `pipeline_clinical` claims | `PII-03-CT` |
| Approvals, FDA list, designations, catalysts | PII-07 | `regulatory_catalyst` claims | `PII-03-FDA` plus `PII-03-SEC` when the question names an 8-K |
| Market cap, enterprise value, net cash, multiples | PII-08 | `valuation_market` claims | None for peers. See refusals. |
| Trend, SMA, RSI, MACD, ADX, ATR, volatility, drawdown, volume, ADV, relative strength, XBI, XLV, SPY, timing | PII-16 | `technical_market` claims, `technical_indicator_values`, `market_bars` | `PII-03-MKT` when weekly bars are under 40 |
| Patents, dockets, litigation, financing risk, red flags | PII-09 | `risk_red_team` claims | `PII-03-USPTO` or `PII-03-CL` matching the noun |
| Why this score, why MONITOR, why not watchlist, gates | PII-10 | `scores`, gate results on the score row | None. Scoring is recomputed only after a specialist refresh already ran. |
| What would change the read, what are you watching | PII-12 rules already seeded on the case | `monitoring_rules` | None |
| Send the memo again | PII-14 | Latest report | None |

Timing questions include “why is timing mixed.” The answer is the `entry_timing_context` claim: the label plus the rubric reason already stored (weekly average, drawdown band, 3-month XBI, ADV). Do not restate that as a trade.

Relative-strength questions may name a window and a benchmark. Read the persisted `rs_{xbi|xlv|spy}_{1|3|6|12}m_ppt` keys from [`EMAIL_CHART_MEMO.md`](EMAIL_CHART_MEMO.md) §7. Until those keys are stored, the 3-month XBI claim is the only citable number, and the reply says the other windows are not on the case yet.

## 5. Refusals

These replies are complete. They do not dispatch work.

| Question | Reply |
|---|---|
| Buy, sell, add, trim, price target, size, “should I invest” | The research stance and timing label, then: `Timing context is not a trade instruction.` Cite `outcome_class` and `entry_timing_context`. |
| Short interest, days to cover, borrow | The existing insufficient claim. No vendor is called. |
| Peers, comps, “cheaper than” | `peer_comparison` is not configured. No industry-based peer list. |
| Product revenue mix, Orange Book, a future PDUFA date | The matching insufficient topic. Do not scrape IR or FDA calendars inside a follow-up. |
| A different ticker than the one in the command | Ask for one ticker. Do not fan out across names. |
| Anything `UNROUTED` | One line listing the domains in §4. No tool calls. |

Forbidden trade words are the same list as `config/analysis-technical.v1.json`.

## 6. Blackboard answer

A domain can be answered without a refresh when all of these hold:

- The latest report for the case exists.
- The owner agent has at least one claim that is not an insufficient placeholder, **or** the question is itself about the gap and an insufficient claim exists.
- For a PII-16 number, the indicator row exists and its `as_of` is the case as-of.
- The owner has not asked to refresh (`refresh`, `update the data`, `pull again`).

The reply shape:

```text
NBIX · {domain}
{claim text or indicator value with its unit}
Source: {agent key} · as of {date} · claim {id or indicator key}
```

Two domains produce two blocks. Do not add a sentence that is not in a claim, a score, or an indicator note.

When the only claim is `INSUFFICIENT_EVIDENCE`, that text is the answer. Then apply §7 only if a collector in the route table can fill it.

## 7. Refresh

Refresh is the existing supervisor subgraph, not a new runtime.

1. Insert `agent_tasks` for the collector key and the analyst key from §4. `dispatch_keys` contains only those keys. Identity and eligibility are not repeated.
2. The analyst’s previous claims in that category are deactivated first, same as the fill-in pass.
3. The collector that does not advance case state stays that way. Follow-up must not move the case out of its current state.
4. When the analyst envelope is `ANALYZED` or `INSUFFICIENT`, compose §6 from the new rows.
5. Cap one refresh per question. No second hop if the new result is still insufficient.

Provider caps in `config/agents.v1.json` still apply. A follow-up does not run beside a full case on the same provider.

## 8. Storage

New table `research_questions`:

| Column | Purpose |
|---|---|
| `id` | uuid |
| `case_id` | nullable until ticker resolution succeeds |
| `ticker` | as asked |
| `question_text` | raw text |
| `route_keys` | text array of agent keys, or `UNROUTED` / `REFUSE_TRADE` |
| `disposition` | `ANSWERED`, `REFRESHED`, `GAP`, `UNROUTED`, `REFUSED`, `NO_CASE` |
| `cited_claim_ids` | uuid array |
| `cited_indicator_keys` | text array |
| `task_ids` | uuid array of `agent_tasks` when a refresh ran |
| `reply_text` | what was sent |
| `created_at` | |

Unique dedupe is not required. The same question may be asked twice. The second reply uses the blackboard as it stands.

No new claim category. The composer does not insert claims.

## 9. Slices

| Slice | Delivers | Stays out |
|---|---|---|
| F0 | Route table, blackboard answers, refusals, `research_questions`, Slack reply. No new HTTP. | Refresh, email resend, classifier model |
| F1 | Refresh subgraph for the collector and analyst pairs in §4. Persist the relative-strength keys the chart memo needs so RS questions have numbers. | New vendors |
| F2 | Optional composer that paraphrases only cited claim text, plus email resend when asked. | Letting the model pick facts or override a refusal |

F0 is enough to ask “why is timing mixed” and “what did FDA return” on a case that already finished.

## 10. Acceptance

1. `/pii NBIX why is timing mixed` on a case with an `entry_timing_context` claim replies with that claim and writes `disposition = ANSWERED`. No collector runs. No analyst runs. No new `research_cases` row.
2. The same command with no prior case replies `NO_CASE` and does not call the investigate webhook. `/pii NBIX` with no question is the only slash form that starts a full run.
3. `/pii NBIX should I buy` returns the stance and the timing line, `disposition = REFUSED`, and contains no buy or sell instruction.
4. `/pii NBIX short interest` returns the insufficient claim, `disposition = GAP`, and does not call Finnhub.
5. `/pii NBIX refresh the weekly bars` in F1 dispatches `PII-03-MKT` and `PII-16` only, then answers from the new indicator rows. Case state is unchanged.
6. A question that names both FDA and the 40-week average returns two blocks and nothing from the other agents.
7. Unit tests cover the route table, the refusal list, the no-case path, and the “do not refresh when the claim exists” rule.

## 11. Non-goals

- A chat thread with memory beyond `research_questions` rows.
- Routing to an agent that is not in §4.
- Using follow-up to start Discovery, to change scores, or to publish a new report.
- Answering a portfolio question across many tickers in one command.
- Implementing F0, F1, or F2 until the owner asks for that slice.
