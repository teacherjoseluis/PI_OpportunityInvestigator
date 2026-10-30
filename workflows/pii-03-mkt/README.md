# PII-03-MKT Market Data Collector

Fetches daily and weekly OHLCV for the case ticker plus SPY, XBI, and XLV once per investigation. TwelveData `/time_series` is primary. Finnhub `/stock/candle` is the fallback when that plan denies the series. Bars land in `market_bars` and compact `evidence_documents` rows (`market_ohlcv` / `market_benchmark`).

Indicators are not requested from the vendor.

**Not deployed.** Workflow id placeholder: `PENDING_PII_03_MKT_DEPLOY`. Apply migration `025` before a deploy. TwelveData `/time_series` plan coverage is unverified; a denial is stored as `access_status=denied` and PII-16 emits `INSUFFICIENT_EVIDENCE`.

```bash
npm run bundle:pii-03-mkt
```
