---
layout: default
title: Getting Started
nav_order: 5
permalink: /getting-started/
---

# Getting Started with PineTS

PineTS enables seamless conversion of Pine Script indicators to JavaScript/TypeScript code. It preserves the original functionality and behavior while providing robust handling of time-series data processing, technical analysis calculations, and Pine Script's distinctive scoping mechanisms.

## Installation

```bash
npm install pinets
```

## Usage Example

### Converting Pine Script to PineTS

Original Pine Script:

```javascript
//@version=5
indicator('My EMA Cross Strategy');

ema9 = ta.ema(close, 9);
ema18 = ta.ema(close, 18);

bull_bias = ema9 > ema18;
bear_bias = ema9 < ema18;

prev_close = close[1];
diff_close = close - prev_close;

_oo = open;
_oo = math.abs(open[1] - close[2]);
```

Equivalent PineTS code:

```javascript
const ema9 = ta.ema(close, 9);
const ema18 = ta.ema(close, 18);

const bull_bias = ema9 > ema18;
const bear_bias = ema9 < ema18;

const prev_close = close[1];
const diff_close = close - prev_close;

let _oo = open;
_oo = math.abs(open[1] - close[2]);
```

### Running PineTS Code

```javascript
import { PineTS, Providers } from 'pinets';

// Initialize with market data
const pineTS = new PineTS(Providers.Binance, 'BTCUSDT', 'D', 100);

// Run your indicator
const { result } = await pineTS.run((context) => {
    const ta = context.ta;
    const math = context.math;
    const { close, open } = context.data;

    const ema9 = ta.ema(close, 9);
    const ema18 = ta.ema(close, 18);

    const bull_bias = ema9 > ema18;
    const bear_bias = ema9 < ema18;

    const prev_close = close[1];
    const diff_close = close - prev_close;

    let _oo = open;
    _oo = math.abs(open[1] - close[2]);
});
```

## Key Differences from Pine Script

1. **Variable Declaration**: Use JavaScript's `const`, `let`, and `var` instead of Pine Script's implicit declaration
2. **Function Syntax**: JavaScript arrow functions and standard function syntax
3. **Module System**: Pine Script native types should be imported using syntax like: `const ta = context.ta; const {close, open} = context.data;`
4. **Scoping Rules**: Maintains Pine Script's series behavior through runtime transformation
5. **Return syntax**: PineTS can return an object with the results of the indicator, allowing you to get the results of the indicator in a single call.

## Core Components

### PineTS Class

The main class that handles:

-   Market data management
-   Series calculations
-   Built-in variables (open, high, low, close, volume, etc.)
-   Runtime execution context

### Namespaces

-   **Core**: Essential Pine Script functionality and base operations
-   **TechnicalAnalysis**: Comprehensive set of technical indicators and analysis functions
-   **PineMath**: Mathematical operations and precision handling
-   **Input**: Parameter and input management system
-   **Syminfo**: Symbol information and market data helpers

## Project Status

For the current implementation status:

-   See [Language Coverage](../lang-coverage/) for language features
-   See [API Coverage](../api-coverage/) for API functions and methods

## Next Steps

After getting started, try exploring our demo indicators:

-   [WillVixFix Indicator](../indicators/willvixfix/index.html)
-   [Squeeze Momentum Indicator](../indicators/sqzmom/index.html)

Or contribute to the project on [GitHub](https://github.com/alaa-eddine/PineTS)!
