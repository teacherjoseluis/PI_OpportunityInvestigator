# PII-16 Technical and Market Behavior Analyst

Computes trend, momentum, volatility, drawdown, ADV, relative strength, and entry-timing context from stored bars. Claims use `claim_category=technical_market`. Timing labels are `CONSTRUCTIVE`, `MIXED`, or `UNFAVORABLE`. Claim text does not use buy or sell language.

`technical_context_score` is stored for the report. It is not a weight in `research_priority_score`.

**Not deployed.** Workflow id placeholder: `PENDING_PII_16_DEPLOY`. Apply migration `025` before a deploy.

```bash
npm run bundle:pii-16
```
