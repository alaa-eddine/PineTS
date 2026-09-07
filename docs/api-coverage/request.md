---
layout: default
title: Request
parent: API Coverage
---

## Request

### Data Requests

| Function                      | Status | Description                  |
| ----------------------------- | ------ | ---------------------------- |
| `request.security()`          | ✅     | Request security data        |
| `request.security_lower_tf()` | ✅     | Request lower timeframe data |
| `request.footprint()`         | ✅     | Request the current bar's volume footprint (see [Footprint](footprint.html)) |
| `request.currency_rate()`     |        | Request currency rate        |
| `request.dividends()`         |        | Request dividends data       |
| `request.earnings()`          |        | Request earnings data        |
| `request.economic()`          |        | Request economic data        |
| `request.financial()`         |        | Request financial data       |
| `request.quandl()`            |        | Request Quandl data          |
| `request.seed()`              |        | Request seed data            |
| `request.splits()`            |        | Request splits data          |

### Notes

- **Chart-type routing (extended tickers)** — the symbol argument may carry a chart-type modifier (`"BTCUSDT;heikinashi"`, built by `ticker.heikinashi()` or inherited from `syminfo.tickerid` on a Heikin Ashi chart; see [Ticker](ticker.html)). The modifier rides through to the data source untouched: a host data source that owns the transform serves derived bars; PineTS' bundled providers strip it and serve standard candles. An empty-string symbol (`""`) resolves to the chart's own ticker, **modifier included**.
- **Same-timeframe shortcut is chart-type aware** — `request.security(sym, tf, expr)` with the chart's own symbol *and* timeframe evaluates the expression against the chart's series directly (no secondary context). "Same symbol" requires the chart-type modifier to match too: on a Heikin Ashi chart, `security(syminfo.tickerid, <chart tf>, close)` shortcuts to the chart's (Heikin Ashi) series, while `security(ticker.standard(syminfo.tickerid), <chart tf>, close)` builds a secondary context that fetches STANDARD data.
- **`request.footprint()` needs an order-flow capable data source** — the provider must implement the optional `getFootprintData(tickerId, timeframe, limit?, sDate?, eDate?)` surface (`IFootprintProvider`). Without it, or for bars the source has no footprint for, the call returns `na`. Inside a `request.security()` expression (secondary context) it always returns `na`, as Pine forbids nesting request calls.
