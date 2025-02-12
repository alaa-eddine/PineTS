This project aims to provide a Javascript/Typescript port for Tradingview's Pine Script.
The current version does not run Pine Script directly, instead it runs a close Javascript equivalent called PineTS.

PineTS makes it possible to migrate Pine Script v5+ indicators to Javascript/Typescript, in order to run them in a Javascript environment.

## Disclaimer

PineTS is an independent project and is not affiliated with, endorsed by, or associated with TradingView or Pine Script™. All trademarks and registered trademarks mentioned belong to their respective owners.

## Overview

PineTS enables seamless conversion of Pine Script indicators to JavaScript/TypeScript code. It preserves the original functionality and behavior while providing robust handling of time-series data processing, technical analysis calculations, and Pine Script's distinctive scoping mechanisms.

## See it in action

Bellow are two ports of Pine Script indicators running in the browser.
PineTS is used to generate plot data, and tradingview light weight chart is used to display the plot.

-   [Williams Vix Fix](https://alaa-eddine.github.io/PineTS/indicators/willvixfix/)
-   [Squeeze Momentum](https://alaa-eddine.github.io/PineTS/indicators/sqzmom/)

## Key Features

-   **Pine Script Compatibility**: Supports Pine Script v5+ syntax and functionality
-   **Time-Series Processing**: Handles historical data and series operations
-   **Technical Analysis Functions**: Comprehensive set of TA indicators and calculations
-   **Mathematical Operations**: Advanced mathematical functions and precision handling
-   **Input Management**: Flexible parameter and input handling system
-   **Context Management**: Maintains proper scoping and variable access rules
-   **Runtime Transpilation**: Converts PineTS code to executable JavaScript at runtime

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
3. **Module System**: Pine Script native types should be imported using syntax like : const ta = context.ta; const {close, open} = context.data;
4. **Scoping Rules**: Maintains Pine Script's series behavior through runtime transformation
5. **Return syntax**: PineTS can returns an object with the results of the indicator, allowing you to get the results of the indicator in a single call.

## Project Goals

-   Runtime Transpiler
-   Core Pine Script functions and variables
-   Series and scope management
-   Technical analysis functions
-   Mathematical functions
-   Input handling
-   Plots data handling
-   Market data connectors
-   Visualization add-ons
-   Strategy execution
-   Backtesting and simulation

## Technical Details

The library uses a runtime transpiler that:

1. Transforms PineTS code to handle time-series data
2. Manages variable scoping and context
3. Handles array indexing and series operations
4. Provides Pine Script-compatible function calls

## Contributing

Contributions are welcome! Please feel free to submit pull requests, create issues, or suggest improvements.

## License

This project is open-source and available under the AGPL License.

## Disclaimer

PineTS is an independent project and is not affiliated with, endorsed by, or associated with TradingView or Pine Script. All trademarks and registered trademarks mentioned belong to their respective owners.
