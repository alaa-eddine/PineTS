---
layout: default
title: Data Providers
nav_order: 7
permalink: /data-providers/
---

# Data Providers

PineTS supports multiple market data providers out of the box. Each provider fetches OHLCV candle data and symbol metadata, which PineTS uses to run your indicators.

---

## Overview

There are two ways to use a provider:

**1. Singleton** (from the `Provider` registry):

```typescript
import { PineTS, Provider } from 'pinets';

const pine = new PineTS(Provider.Binance, 'BTCUSDT', 'D', 100);
```

**2. Direct instantiation** (for provider-specific config):

```typescript
import { PineTS, BinanceProvider } from 'pinets';

const binance = new BinanceProvider();
const pine = new PineTS(binance, 'BTCUSDT', 'D', 100);
```

Providers that require API keys must be configured before use, either via `.configure()` on the singleton or by passing config to the constructor.

### Timeframe Aggregation

If a provider doesn't natively support a requested timeframe, PineTS automatically selects the best sub-timeframe and aggregates candles. For example, requesting `'45'` (45 min) from Binance will fetch `'15'` minute candles and aggregate 3:1. This is handled transparently by the `BaseProvider` class.

---

## Binance

The Binance provider fetches cryptocurrency market data. **No API key required.**

### Quick Start

```typescript
import { PineTS, Provider } from 'pinets';

// Fetch 100 daily BTC candles and compute SMA
const pine = new PineTS(Provider.Binance, 'BTCUSDT', 'D', 100);

const { result, plots } = await pine.run(`
//@version=6
indicator("BTC SMA Cross")
sma20 = ta.sma(close, 20)
sma50 = ta.sma(close, 50)
plot(sma20, "SMA 20", color.blue)
plot(sma50, "SMA 50", color.red)
`);
```

### Symbols

| Format   | Example              | Market |
| -------- | -------------------- | ------ |
| `SYMBOL` | `BTCUSDT`, `ETHUSDC` | Spot   |

### Supported Timeframes

`'1'`, `'3'`, `'5'`, `'15'`, `'30'`, `'60'`, `'120'`, `'240'`, `'D'`, `'W'`, `'M'`

Timeframes not in this list (e.g., `'45'`, `'180'`) are automatically aggregated from smaller candles.

### Features

- **No API key** required
- **Auto-pagination** for fetching >1000 candles
- **5-minute cache** for repeated identical requests
- **Dual endpoint fallback**: tries `api.binance.com`, falls back to `api.binance.us`

### Examples

```typescript
import { PineTS, Provider, BinanceProvider } from 'pinets';

// Using the singleton
const pine1 = new PineTS(Provider.Binance, 'BTCUSDT', 'D', 100);

// Direct instantiation (equivalent)
const binance = new BinanceProvider();
const pine2 = new PineTS(binance, 'ETHUSDT', '1W', 50);

// With date range
const sDate = new Date('2024-01-01').getTime();
const eDate = new Date('2024-06-30').getTime();
const pine3 = new PineTS(Provider.Binance, 'BTCUSDT', 'D', undefined, sDate, eDate);
```

---

## FMP (Financial Modeling Prep)

The FMP provider fetches stock, forex, and crypto data from [Financial Modeling Prep](https://financialmodelingprep.com/). **Requires an API key.**

### Quick Start

```typescript
import { PineTS, Provider } from 'pinets';

// Configure with your API key
Provider.FMP.configure({ apiKey: 'your-api-key' });

// Fetch 200 daily AAPL candles
const pine = new PineTS(Provider.FMP, 'AAPL', 'D', 200);

const { result } = await pine.run(`
//@version=6
indicator("AAPL RSI")
rsi = ta.rsi(close, 14)
plot(rsi, "RSI")
hline(70, "Overbought")
hline(30, "Oversold")
`);
```

### Configuration

```typescript
// Option 1: Configure the singleton
Provider.FMP.configure({ apiKey: 'your-api-key' });

// Option 2: Direct instantiation with config
import { FMPProvider } from 'pinets';
const fmp = new FMPProvider({ apiKey: 'your-api-key' });
const pine = new PineTS(fmp, 'AAPL', 'D', 200);
```

| Option    | Type     | Required | Description               |
| --------- | -------- | -------- | ------------------------- |
| `apiKey`  | `string` | Yes      | Your FMP API key          |
| `baseUrl` | `string` | No       | Override the API base URL |

### Symbols

| Format | Example               | Market         |
| ------ | --------------------- | -------------- |
| Ticker | `AAPL`, `MSFT`, `SPY` | US Stocks      |
| Crypto | `BTCUSD`, `ETHUSD`    | Cryptocurrency |
| Forex  | `EURUSD`              | Currency pairs |

### Supported Timeframes

| Tier     | Timeframes                                    |
| -------- | --------------------------------------------- |
| **Free** | `'D'` (daily only)                            |
| **Paid** | `'1'`, `'5'`, `'15'`, `'30'`, `'60'`, `'240'` |

### Features

- **Exchange-aware session times**: maps exchanges to IANA timezones (e.g., NYSE = `America/New_York`, `0930-1600`)
- **Session-aware closeTime**: correctly computes bar close times including early-close days
- **Profile caching**: symbol metadata is fetched once and cached

### Examples

```typescript
import { PineTS, Provider, FMPProvider } from 'pinets';

// Configure singleton
Provider.FMP.configure({ apiKey: 'your-api-key' });

// US Stock
const pine1 = new PineTS(Provider.FMP, 'AAPL', 'D', 200);

// Crypto via FMP
const pine2 = new PineTS(Provider.FMP, 'BTCUSD', 'D', 100);

// Forex
const pine3 = new PineTS(Provider.FMP, 'EURUSD', 'D', 100);

// Direct instantiation (separate instance with its own config)
const fmp = new FMPProvider({ apiKey: 'different-api-key' });
const pine4 = new PineTS(fmp, 'MSFT', 'D', 100);
```

---

## Alpaca

The Alpaca provider fetches US stock and crypto data from [Alpaca Markets](https://alpaca.markets/). **Requires an API key and secret.**

### Quick Start

```typescript
import { PineTS, Provider } from 'pinets';

// Configure with your credentials
Provider.Alpaca.configure({
    apiKey: 'PK...',
    apiSecret: '...',
    paper: true,
    feed: 'iex',
});

// Fetch 200 daily AAPL candles
const pine = new PineTS(Provider.Alpaca, 'AAPL', 'D', 200);

const { result } = await pine.run(`
//@version=6
indicator("AAPL Bollinger Bands")
[middle, upper, lower] = ta.bb(close, 20, 2)
plot(middle, "Middle", color.blue)
plot(upper, "Upper", color.green)
plot(lower, "Lower", color.red)
`);
```

### Configuration

```typescript
// Option 1: Configure the singleton
Provider.Alpaca.configure({
    apiKey: 'PK...',
    apiSecret: '...',
    paper: true,
    feed: 'sip',
});

// Option 2: Direct instantiation
import { AlpacaProvider } from 'pinets';
const alpaca = new AlpacaProvider({
    apiKey: 'PK...',
    apiSecret: '...',
    paper: true,
    feed: 'iex',
});
const pine = new PineTS(alpaca, 'AAPL', 'D', 200);
```

| Option       | Type             | Required | Default | Description                                                      |
| ------------ | ---------------- | -------- | ------- | ---------------------------------------------------------------- |
| `apiKey`     | `string`         | Yes      | -       | Alpaca API key ID (`PK...`)                                      |
| `apiSecret`  | `string`         | Yes      | -       | Alpaca secret key                                                |
| `paper`      | `boolean`        | No       | `true`  | `true` for paper trading, `false` for live                       |
| `feed`       | `'sip' \| 'iex'` | No       | `'sip'` | `'sip'` = full market data (paid), `'iex'` = IEX exchange (free) |
| `dataUrl`    | `string`         | No       | -       | Override the market data API URL                                 |
| `tradingUrl` | `string`         | No       | -       | Override the trading/asset API URL                               |

### Symbols

| Format | Example               | Market                          |
| ------ | --------------------- | ------------------------------- |
| Ticker | `AAPL`, `MSFT`, `SPY` | US Stocks                       |
| Crypto | `BTC/USD`, `ETH/USD`  | Cryptocurrency (note the slash) |

> **Note:** Crypto symbols use slash notation (`BTC/USD`), not concatenated (`BTCUSD`).

### Supported Timeframes

`'1'`, `'3'`, `'5'`, `'15'`, `'30'`, `'45'`, `'60'`, `'120'`, `'180'`, `'240'`, `'D'`, `'W'`, `'M'`

Alpaca natively supports all common timeframes including `'45'` and `'180'` which other providers aggregate.

### Features

- **Calendar-aware closeTime** for stocks: uses Alpaca's trading calendar API for exact session times (handles early closes and DST)
- **Fixed-duration closeTime** for crypto: 24/7 markets use computed period boundaries
- **Auto-pagination**: handles large requests (10,000+ candles) via page tokens
- **Asset and calendar caching**: symbol info and trading calendar fetched once per session

### Data Feed Options

| Feed    | Cost            | Coverage                                            |
| ------- | --------------- | --------------------------------------------------- |
| `'sip'` | Paid ($9/month) | Full consolidated market data from all US exchanges |
| `'iex'` | Free            | IEX exchange data only (may have gaps or lag)       |

### Examples

```typescript
import { PineTS, Provider, AlpacaProvider } from 'pinets';

// Configure singleton
Provider.Alpaca.configure({
    apiKey: 'PK...',
    apiSecret: '...',
    paper: true,
    feed: 'iex',
});

// US Stock
const pine1 = new PineTS(Provider.Alpaca, 'AAPL', 'D', 200);

// Crypto (note the slash notation)
const pine2 = new PineTS(Provider.Alpaca, 'BTC/USD', 'D', 100);

// Direct instantiation
const alpaca = new AlpacaProvider({
    apiKey: 'PK...',
    apiSecret: '...',
    feed: 'sip',
});
const pine3 = new PineTS(alpaca, 'MSFT', '60', 500);
```

---

## Custom Data

You can bypass providers entirely by passing your own OHLCV data array:

```typescript
import { PineTS } from 'pinets';

const customData = [
    {
        openTime: new Date('2024-01-01').getTime(),
        open: 42000,
        high: 43000,
        low: 41500,
        close: 42500,
        volume: 1234.56,
        closeTime: new Date('2024-01-02').getTime(),
    },
    {
        openTime: new Date('2024-01-02').getTime(),
        open: 42500,
        high: 44000,
        low: 42000,
        close: 43800,
        volume: 2345.67,
        closeTime: new Date('2024-01-03').getTime(),
    },
    // ... more candles
];

const pine = new PineTS(customData);
const { result } = await pine.run(`
//@version=6
indicator("Custom Data SMA")
plot(ta.sma(close, 10))
`);
```

### Data Format

Each candle object must include:

| Field       | Type     | Required | Description                   |
| ----------- | -------- | -------- | ----------------------------- |
| `open`      | `number` | Yes      | Opening price                 |
| `high`      | `number` | Yes      | Highest price                 |
| `low`       | `number` | Yes      | Lowest price                  |
| `close`     | `number` | Yes      | Closing price                 |
| `volume`    | `number` | Yes      | Trading volume                |
| `openTime`  | `number` | No       | Bar open time (ms timestamp)  |
| `closeTime` | `number` | No       | Bar close time (ms timestamp) |

If `openTime` / `closeTime` are omitted, time-dependent functions (`time`, `hour`, `dayofmonth`, etc.) will not work correctly.

---

## Custom Providers

You can create your own provider by implementing the `IProvider` interface or extending `BaseProvider`:

```typescript
import { BaseProvider, PineTS } from 'pinets';
import type { ISymbolInfo, Kline } from 'pinets';

class MyProvider extends BaseProvider {
    constructor() {
        super({ requiresApiKey: false, providerName: 'MyProvider' });
    }

    protected getSupportedTimeframes() {
        return new Set(['1', '5', '15', '60', 'D']);
    }

    protected async _getMarketDataNative(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<Kline[]> {
        // Fetch data from your API
        const response = await fetch(`https://my-api.com/candles?symbol=${tickerId}&tf=${timeframe}`);
        const data = await response.json();

        return data.map((candle) => ({
            openTime: candle.time,
            open: candle.o,
            high: candle.h,
            low: candle.l,
            close: candle.c,
            volume: candle.v,
            closeTime: candle.time + 86400000, // next bar open
        }));
    }

    async getSymbolInfo(tickerId: string): Promise<ISymbolInfo> {
        // Return symbol metadata
        return { ticker: tickerId /* ... */ } as ISymbolInfo;
    }
}

// Use it
const provider = new MyProvider();
const pine = new PineTS(provider, 'AAPL', 'D', 100);
```

By extending `BaseProvider`, you get automatic timeframe aggregation for free. If you request a timeframe not in `getSupportedTimeframes()`, the base class will automatically fetch a supported sub-timeframe and aggregate.

You can also add your provider to the global registry for convenience:

```typescript
import { Provider } from 'pinets';

Provider['MyProvider'] = new MyProvider();
// Now available as Provider.MyProvider
```

### Chart-Type Modifiers (Extended Tickers)

A ticker may carry a chart-type modifier suffix — `"BTCUSDT;heikinashi"` (see [Non-Standard Chart Types](initialization-and-usage.html#non-standard-chart-types-heikin-ashi)). The contract at the provider boundary:

-   **Providers extending `BaseProvider`** never see the modifier in `getMarketData()` — the base class strips it, because a venue API serves standard candles only. Strip it likewise at the top of your `getSymbolInfo()` (all bundled providers do): `tickerId = stripTickerModifier(tickerId)` (exported from `pinets`).
-   **A source that OWNS a chart-type transform** (typically an embedding host implementing `IProvider` directly, not via `BaseProvider`) receives the extended ticker verbatim and must serve the derived bars for `"SYM;heikinashi"` and raw bars for `"SYM"` — the modifier is the only thing distinguishing the two requests.
-   **PineTS itself never transforms bars** — the modifier is routing metadata, end to end.

### Volume Footprints (`request.footprint()`)

Pine's `request.footprint()` needs order-flow data that plain candles do not carry. A provider opts in by implementing the optional `IFootprintProvider` surface next to `IProvider` — the same `(tickerId, timeframe, limit, sDate, eDate)` vocabulary as `getMarketData`, returning one `FootprintBar` per bar it can serve:

```typescript
import type { FootprintBar } from 'pinets';

class MyProvider extends BaseProvider {
    // ...getMarketData / getSymbolInfo as above...

    async getFootprintData(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<FootprintBar[]> {
        const bars = await fetchMyFootprints(tickerId, timeframe, sDate, eDate);
        return bars.map((bar) => ({
            openTime: bar.time, // matches the kline's openTime
            tick: bar.grid, // optional: the price step the levels sit on
            levels: bar.levels.map((l) => ({ price: l.price, buyVolume: l.buy, sellVolume: l.sell })),
        }));
    }
}
```

The contract:

-   **Levels are raw, rows are PineTS's job.** Serve the finest price granularity you have; `request.footprint()` re-bins levels into rows of `ticks_per_row × syminfo.mintick` and derives POC, value area and imbalances itself, so every source shares one set of Pine semantics. A level's `price` is the **low edge** of its bucket. Make sure `getSymbolInfo()` returns a correct `mintick` — without it rows cannot be sized and the call returns `na`.
-   **Buy/sell is your classification** (aggressor side for trade feeds, intrabar direction for candle-derived footprints). PineTS only sums.
-   **Omit what you cannot serve.** Bars missing from the result read as `na` in the script. A provider without `getFootprintData` makes every `request.footprint()` call return `na` (with a single runtime warning).
-   **Call pattern.** The first call covers the loaded history (`sDate` = first bar's `openTime`, `eDate` = last bar's `closeTime`, `limit` = bar count). Whenever the market data changes afterwards (a forming bar ticks, new bars arrive), PineTS asks again from the forming bar's `openTime` onward and replaces what it holds for the returned bars — so a live source just answers with its current in-memory state for the tail.

---

## Timeframe Reference

Standard timeframe strings used across all providers:

| String            | Description | Period   |
| ----------------- | ----------- | -------- |
| `'1'`             | 1 minute    | Intraday |
| `'3'`             | 3 minutes   | Intraday |
| `'5'`             | 5 minutes   | Intraday |
| `'15'`            | 15 minutes  | Intraday |
| `'30'`            | 30 minutes  | Intraday |
| `'45'`            | 45 minutes  | Intraday |
| `'60'`            | 1 hour      | Intraday |
| `'120'`           | 2 hours     | Intraday |
| `'180'`           | 3 hours     | Intraday |
| `'240'` or `'4H'` | 4 hours     | Intraday |
| `'D'` or `'1D'`   | 1 day       | Daily    |
| `'W'` or `'1W'`   | 1 week      | Weekly   |
| `'M'` or `'1M'`   | 1 month     | Monthly  |

### Provider Support Matrix

| Timeframe | Binance    | FMP (Free) | FMP (Paid) | Alpaca |
| --------- | ---------- | ---------- | ---------- | ------ |
| `'1'`     | Native     | -          | Native     | Native |
| `'3'`     | Native     | -          | -          | Native |
| `'5'`     | Native     | -          | Native     | Native |
| `'15'`    | Native     | -          | Native     | Native |
| `'30'`    | Native     | -          | Native     | Native |
| `'45'`    | Aggregated | -          | -          | Native |
| `'60'`    | Native     | -          | Native     | Native |
| `'120'`   | Native     | -          | -          | Native |
| `'180'`   | Aggregated | -          | -          | Native |
| `'240'`   | Native     | -          | Native     | Native |
| `'D'`     | Native     | Native     | Native     | Native |
| `'W'`     | Native     | -          | -          | Native |
| `'M'`     | Native     | -          | -          | Native |

**Native** = provider fetches directly. **Aggregated** = PineTS fetches smaller candles and combines them. **-** = not available.
