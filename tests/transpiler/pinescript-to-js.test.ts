// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Pine Script to JavaScript Transpiler Test Suite
 *
 * This test suite validates the consistency of native Pine Script v6 code transpilation to executable JavaScript.
 * Each test case focuses on specific Pine Script features to ensure proper transformation through the full
 * 2-stage transpilation pipeline:
 *   Stage 1 (pineToJS): Pine Script → PineTS JavaScript syntax
 *   Stage 2 (transpile): PineTS JavaScript → Executable low-level JS
 *
 * Coverage Goals:
 * - Lexer: Tokenization, indentation handling, literals, operators
 * - Parser: AST construction for all Pine Script syntax elements
 * - CodeGen: JavaScript code generation from AST
 * - Full transpilation pipeline integrity
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler/index';
import { extractPineScriptVersion } from '../../src/transpiler/pineToJS/pineToJS.index';

describe('Pine Script Version Detection', () => {
    it('should extract version 5 from source code', () => {
        const code = '//@version=5\nindicator("Test")';
        const version = extractPineScriptVersion(code);
        expect(version).toBe(5);
    });

    it('should extract version 6 from source code', () => {
        const code = '//@version=6\nindicator("Test")';
        const version = extractPineScriptVersion(code);
        expect(version).toBe(6);
    });

    it('should return null when version is missing', () => {
        const code = 'indicator("Test")';
        const version = extractPineScriptVersion(code);
        expect(version).toBeNull();
    });

    it('should handle version comment with extra whitespace', () => {
        const code = '//  @version  =  6  \nindicator("Test")';
        const version = extractPineScriptVersion(code);
        expect(version).toBe(6);
    });
});

describe('Pine Script Transpilation - Basic Features', () => {
    it('should transpile simple variable declarations', () => {
        const code = `
//@version=6
indicator("Simple Variable Test")

x = 10
y = 20
z = x + y

plot(z, title="Sum")
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('$.let.glb1_x = $.init($.let.glb1_x, 10)');
        expect(jsCode).toContain('$.let.glb1_y = $.init($.let.glb1_y, 20)');
        expect(jsCode).toContain('$.let.glb1_z = $.init($.let.glb1_z, $.get($.let.glb1_x, 0) + $.get($.let.glb1_y, 0))');
    });

    it('should transpile ternary operator', () => {
        const code = `
//@version=6
indicator("Ternary Test")

result = close > open ? 1 : 0
plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('?');
        expect(jsCode).toContain(':');
        // `close > open` routes through the na-aware relational helper.
        expect(jsCode).toContain('$.pine.math.__gt($.get(close, 0), $.get(open, 0))');
    });

    it('should transpile scientific notation literals', () => {
        const code = `
//@version=6
indicator("Scientific Notation Test")

a = 10e10
b = 1.2e-5
c = 1E+5

plot(a)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // 10e10 -> 100000000000
        expect(jsCode).toContain('100000000000');
        // 1.2e-5 -> 0.000012
        expect(jsCode).toContain('0.000012');
        // 1E+5 -> 100000
        expect(jsCode).toContain('100000');
    });

    it('should reject Pine Script version < 5', () => {
        const code = '//@version=4\nindicator("Test")';

        expect(() => transpile(code)).toThrow('Unsupported Pine Script version 4');
    });

    it('should fail gracefully when version is missing', () => {
        const code = 'indicator("Test")';

        // When version is missing, it's treated as PineTS syntax, which should transpile
        const result = transpile(code);
        expect(result).toBeDefined();
    });
});

describe('Pine Script Transpilation - Control Flow', () => {
    it('should transpile if-else statements', () => {
        const code = `
//@version=6
indicator("If Test")

price = close
signal = 0

if price > 100
    signal := 1
else
    signal := -1

plot(signal)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('if (');
        expect(jsCode).toContain('} else {');
        expect(jsCode).toContain('$.set($.let.glb1_signal, 1)');
        expect(jsCode).toContain('$.set($.let.glb1_signal, -1)');
    });

    it('should transpile for loops', () => {
        const code = `
//@version=6
indicator("For Loop Test")

sum = 0.0
for i = 0 to 10
    sum := sum + i

plot(sum)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('for (');
        expect(jsCode).toContain('let i = 0;');
        expect(jsCode).toContain('i <= 10');
        expect(jsCode).toContain('i++');
    });

    it('should transpile while loops', () => {
        const code = `
//@version=6
indicator("While Loop Test")

counter = 0
value = 10

while counter < 5
    value := value + counter
    counter := counter + 1

plot(value)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('while (');
        expect(jsCode).toContain('$.get($.let.glb1_counter, 0) < 5');
    });

    it('should transpile switch expressions', () => {
        const code = `
//@version=6
indicator("Switch Test")

mode = 1
result = switch mode
    1 => 10
    2 => 20
    => 30

plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Switch is converted to if-else chain or ternary
        expect(jsCode).toBeDefined();
    });
});

describe('Pine Script Transpilation - Functions', () => {
    it('should transpile simple function', () => {
        const code = `
//@version=6
indicator("Function Test")

add(a, b) =>
    a + b

result = add(10, 20)
plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('function add(a, b)');
        expect(jsCode).toContain('return $.precision(');
    });

    it('should transpile function with multiple statements', () => {
        const code = `
//@version=6
indicator("Function Test")

calculate(x, y) =>
    sum = x + y
    product = x * y
    sum + product

result = calculate(5, 3)
plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('function calculate(x, y)');
        // Expect _callId to be retrieved from context stack, not passed as argument
        expect(jsCode).toContain('$.peekCtx()');
        expect(jsCode).toContain('$.let.fn');
    });

    it('should transpile function returning tuple', () => {
        const code = `
//@version=6
indicator("Tuple Test")

calcMinMax(a, b) =>
    [math.min(a, b), math.max(a, b)]

[minVal, maxVal] = calcMinMax(close, open)
plot(minVal)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('function calcMinMax');
        // Tuple handling
        expect(jsCode).toBeDefined();
    });
});

describe('Pine Script Transpilation - Variables', () => {
    it('should transpile var keyword', () => {
        const code = `
//@version=6
indicator("Var Test")

var float counter = 0
counter := counter + 1

plot(counter)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // var means initialize only once with initVar
        expect(jsCode).toContain('$.initVar(');
        expect(jsCode).toContain('$.set(');
        expect(jsCode).toContain('$.var.glb1_counter');
    });

    it('should transpile varip keyword', () => {
        const code = `
//@version=6
indicator("Varip Test")

varip int tick_counter = 0
tick_counter := tick_counter + 1

plot(tick_counter)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // varip uses initVar like var
        expect(jsCode).toContain('$.initVar(');
        expect(jsCode).toContain('$.var.glb1_tick_counter');
    });

    it('should transpile reassignment operator :=', () => {
        const code = `
//@version=6
indicator("Reassignment Test")

x = 10
x := 20

plot(x)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('$.init(');
        expect(jsCode).toContain('$.set(');
    });
});

describe('Pine Script Transpilation - Operators', () => {
    it('should transpile logical operators', () => {
        const code = `
//@version=6
indicator("Logical Test")

bull = close > open and volume > 1000
bear = close < open or volume < 500
not_bull = not bull

plot(bull ? 1 : 0)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('&&');
        expect(jsCode).toContain('||');
        expect(jsCode).toContain('!');
    });

    it('should transpile comparison operators', () => {
        const code = `
//@version=6
indicator("Comparison Test")

eq = close == open
neq = close != open
gt = close > open
lt = close < open
gte = close >= open
lte = close <= open

plot(gt ? 1 : 0)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Relational operators route through na-aware helpers (na propagation
        // + 1e-10 tolerance), same as == / != .
        expect(jsCode).toContain('$.pine.math.__eq(');
        expect(jsCode).toContain('$.pine.math.__neq(');
        expect(jsCode).toContain('$.pine.math.__gt(');
        expect(jsCode).toContain('$.pine.math.__lt(');
        expect(jsCode).toContain('$.pine.math.__ge(');
        expect(jsCode).toContain('$.pine.math.__le(');
    });

    it('should transpile arithmetic operators', () => {
        const code = `
//@version=6
indicator("Arithmetic Test")

sum = 10 + 20
diff = 10 - 5
prod = 10 * 2
quot = 10 / 2
mod = 10 % 3

plot(sum)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('+');
        expect(jsCode).toContain('-');
        expect(jsCode).toContain('*');
        // Pine v6 never truncates int/int division (see the v6 migration guide,
        // "Fractional division of constants"), so `10 / 2` stays a native `/`
        // and must NOT lower to the v5-only `__idiv` helper.
        expect(jsCode).toContain('/');
        expect(jsCode).not.toContain('__idiv');
        expect(jsCode).toContain('%');
    });

    it('should preserve parentheses in arithmetic precedence', () => {
        const code = `
//@version=6
indicator("Precedence Test")

x = 10
y = 20
z = 30
res = (x + y) * z
res2 = 100 * (x - y) / z

plot(res)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // (x + y) * z -> should have parens around addition
        expect(jsCode).toMatch(/(\(.*\+.*\))\s*\*/);

        // 100 * (x - y) / z -> should have parens around subtraction. This is
        // int/int division (RC2b), so the trailing `/ z` lowers into the
        // `__idiv(100 * (x - y), z)` helper — the parenthesized subtraction is
        // still preserved inside the first argument.
        expect(jsCode).toMatch(/100\s*\*\s*\(.*-.*\)/);
    });
});

describe('Pine Script Transpilation - Series and Arrays', () => {
    it('should transpile historical reference operator []', () => {
        const code = `
//@version=6
indicator("Series Test")

prev_close = close[1]
prev_prev_close = close[2]
high_5 = high[5]

plot(prev_close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('close, 1');
        expect(jsCode).toContain('close, 2');
        expect(jsCode).toContain('high, 5');
    });

    it('should transpile array operations', () => {
        const code = `
//@version=6
indicator("Array Test")

prices = array.new_float(5, 0.0)
array.push(prices, close)
size = array.size(prices)

plot(size)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('array.new_float');
        expect(jsCode).toContain('array.push');
        expect(jsCode).toContain('array.size');
    });

    it('should transpile method call syntax', () => {
        const code = `
//@version=6
indicator("Method Test")

arr = array.new_float(0)
arr.push(close)
size = arr.size()

plot(size)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('?.push?.(');
        expect(jsCode).toContain('?.size?.()');
    });
});

describe('Pine Script Transpilation - Built-in Functions', () => {
    it('should transpile ta functions', () => {
        const code = `
//@version=6
indicator("TA Functions Test")

sma_val = ta.sma(close, 20)
ema_val = ta.ema(close, 20)
rsi_val = ta.rsi(close, 14)

plot(sma_val)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('ta.sma');
        expect(jsCode).toContain('ta.ema');
        expect(jsCode).toContain('ta.rsi');
    });

    it('should transpile math functions', () => {
        const code = `
//@version=6
indicator("Math Test")

abs_val = math.abs(-10)
max_val = math.max(close, open)
sqrt_val = math.sqrt(close)

plot(max_val)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('math.abs');
        expect(jsCode).toContain('math.max');
        expect(jsCode).toContain('math.sqrt');
    });

    it('should transpile input functions', () => {
        const code = `
//@version=6
indicator("Input Test")

length = input.int(14, "Length", minval=1, maxval=200)
src = input.source(close, "Source")
multiplier = input.float(2.0, "Multiplier")

plot(src)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('input.int');
        expect(jsCode).toContain('input.source');
        expect(jsCode).toContain('input.float');
    });

    it('should transpile string functions', () => {
        const code = `
//@version=6
indicator("String Test")

text = "Hello World"
length = str.length(text)
contains = str.contains(text, "Hello")

plot(length)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('str.length');
        expect(jsCode).toContain('str.contains');
    });

    it('should transpile color functions', () => {
        const code = `
//@version=6
indicator("Color Test")

base = color.blue
trans = color.new(color.blue, 50)
rgb = color.rgb(255, 0, 0)
dynamic = close > open ? color.green : color.red

plot(close, color=dynamic)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('color.blue');
        expect(jsCode).toContain('color.new');
        expect(jsCode).toContain('color.rgb');
        expect(jsCode).toContain('color.green');
        expect(jsCode).toContain('color.red');
    });
});

describe('Pine Script Transpilation - Special Values', () => {
    it('should transpile na (not available)', () => {
        const code = `
//@version=6
indicator("NA Test")

var float prev = na
is_na = na(prev)
safe = nz(prev, close)

plot(safe)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('na.__value');
    });

    it('should handle boolean values', () => {
        const code = `
//@version=6
indicator("Boolean Test")

flag = true
flag2 = false

result = flag ? 1 : 0
plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('true');
        expect(jsCode).toContain('false');
    });
});

describe('Pine Script Transpilation - Comments', () => {
    it('should handle single-line comments', () => {
        const code = `
//@version=6
indicator("Comment Test")

// This is a comment
x = 10  // Inline comment

plot(x)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Comments should be filtered out or preserved based on options
        expect(jsCode).toBeDefined();
    });

    it('should handle indicator declaration', () => {
        const code = `
//@version=6
indicator("My Indicator", shorttitle="MI", overlay=true)

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('indicator');
        expect(jsCode).toContain('My Indicator');
    });
});

describe('Pine Script Transpilation - Complex Expressions', () => {
    it('should transpile nested ternary operators', () => {
        const code = `
//@version=6
indicator("Nested Ternary")

signal = close > open ? 1 : (close < open ? -1 : 0)
plot(signal)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('?');
        expect(jsCode).toContain(':');
    });

    it('should transpile complex boolean expressions', () => {
        const code = `
//@version=6
indicator("Complex Boolean")

condition = (close > open and volume > 1000) or (close < open and volume < 500)
plot(condition ? 1 : 0)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('&&');
        expect(jsCode).toContain('||');
    });

    it('should transpile function calls with expressions', () => {
        const code = `
//@version=6
indicator("Expression Test")

result = ta.sma(close > open ? close : open, 14)
plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('ta.sma');
    });
});

describe('Pine Script Transpilation - Error Handling', () => {
    it('should handle syntax errors gracefully', () => {
        const code = `
//@version=6
indicator("Error Test")

x = 
plot(x)
        `;

        // transpile may throw an error or produce incomplete output
        try {
            const result = transpile(code);
            const jsCode = result.toString();
            // If it doesn't throw, it should at least produce some output
            expect(jsCode).toBeDefined();
        } catch (error) {
            // Error is expected and acceptable for invalid syntax
            expect(error).toBeDefined();
        }
    });

    it('should handle invalid indentation', () => {
        const code = `
//@version=6
indicator("Indent Error")

if close > open
plot(close)
        `;

        // Should either succeed with warning or fail with descriptive error
        try {
            const result = transpile(code);
            expect(result).toBeDefined();
        } catch (error) {
            // Error is acceptable for invalid syntax
            expect(error).toBeDefined();
        }
    });
});

describe('Pine Script Transpilation - Bug Fixes', () => {
    describe('Comment tokens in layout positions', () => {
        it('accepts a trailing comment on a user-defined type field', () => {
            const code = `
//@version=6
indicator("udt field comment")
type Level
    float price // the level itself
    int hits = 0 // how often it was tagged
var Level lv = Level.new(close)
plot(lv.price)
`;
            const jsCode = transpile(code).toString();
            expect(jsCode).toContain('Type(');
        });

        it('accepts comment-only lines between an if block and its else', () => {
            const code = `
//@version=6
indicator("if else comment")
float v = na
if close > open
    v := 1
    // note inside the block
// note between the branches
else
    v := -1
plot(v)
`;
            const jsCode = transpile(code).toString();
            expect(jsCode).toContain('else');
        });
    });

    describe('Generic Type Syntax', () => {
        it('should parse and transpile simple generic types (array<float>)', () => {
            const code = `
//@version=6
indicator("Generic Types Test")

type Vector
    array<float> values

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain("values: 'array<float>'");
            expect(jsCode).toContain('Type(');
        });

        it('should parse nested generic types (array<array<float>>)', () => {
            const code = `
//@version=6
indicator("Nested Generics")

type NestedData
    array<array<float>> matrix

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toContain("matrix: 'array<array<float>>'");
        });

        it('should parse multi-parameter generic types (map<string, float>)', () => {
            const code = `
//@version=6
indicator("Map Types")

type KeyValueStore
    map<string, float> lookup

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toContain("lookup: 'map<string, float>'");
        });

        it('should handle multiple generic fields in one type', () => {
            const code = `
//@version=6
indicator("Multiple Generics")

type DataContainer
    array<int> integers
    matrix<float> grid
    map<string, float> pairs

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toContain("integers: 'array<int>'");
            expect(jsCode).toContain("grid: 'matrix<float>'");
            expect(jsCode).toContain("pairs: 'map<string, float>'");
        });

        it('should handle mixed simple and generic types', () => {
            const code = `
//@version=6
indicator("Mixed Types")

type MixedData
    float scalar
    array<float> vector
    int count
    map<string, int> lookup

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toContain("scalar: 'float'");
            expect(jsCode).toContain("vector: 'array<float>'");
            expect(jsCode).toContain("count: 'int'");
            expect(jsCode).toContain("lookup: 'map<string, int>'");
        });

        it('should handle generic types in function parameters', () => {
            const code = `
//@version=6
indicator("Generic Function Params")

sumArray(array<float> arr) =>
    float total = 0.0
    for i = 0 to array.size(arr) - 1
        total += array.get(arr, i)
    total

lookupValue(map<string, float> m, string key) =>
    map.get(m, key)

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();
            expect(jsCode).toBeDefined();
            // The function should be transpiled without errors
            // Generic type annotations in params should not cause parse failures
            expect(jsCode).toContain('sumArray');
            expect(jsCode).toContain('lookupValue');
        });
    });

    describe('Dot-Prefix Number Literals', () => {
        it('should parse numbers starting with dot (.5 becomes 0.5)', () => {
            const code = `
//@version=6
indicator("Dot Numbers")

x = .5
y = .123
z = .999999

plot(x + y + z)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.let.glb1_x = $.init($.let.glb1_x, 0.5)');
            expect(jsCode).toContain('$.let.glb1_y = $.init($.let.glb1_y, 0.123)');
            expect(jsCode).toContain('$.let.glb1_z = $.init($.let.glb1_z, 0.999999)');
        });

        it('should handle dot-prefix numbers in function calls', () => {
            const code = `
//@version=6
indicator("Dot Numbers in Calls")

step = input.float(.5, 'Step', minval = 0, step = 0.1)
threshold = .75

plot(step + threshold)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toContain('0.5');
            expect(jsCode).toContain('$.let.glb1_threshold = $.init($.let.glb1_threshold, 0.75)');
            expect(jsCode).toContain('0.1');
        });

        it('should distinguish dot-prefix numbers from member access', () => {
            const code = `
//@version=6
indicator("Dot Disambiguation")

// Dot-prefix number
factor = .25

// Member access
sma = ta.sma(close, 10)

// Both together
result = sma * .5

plot(result)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            // Should have dot-prefix number
            expect(jsCode).toContain('0.25');
            expect(jsCode).toContain('0.5');

            // Should still have member access
            expect(jsCode).toContain('ta.sma');
        });

        it('should handle various decimal formats', () => {
            const code = `
//@version=6
indicator("Decimal Formats")

a = .5      // 0.5
b = 0.5     // 0.5
c = 10.5    // 10.5
d = 1.5     // 1.5
e = .001    // 0.001

plot(a + b + c + d + e)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toContain('0.5');
            expect(jsCode).toContain('10.5');
            expect(jsCode).toContain('1.5');
            expect(jsCode).toContain('0.001');
        });
    });

    describe('Multiple Statements in Switch Cases', () => {
        it('should generate all statements in switch cases with multiple if blocks', () => {
            const code = `
//@version=6
strategy("Multi-Statement Switch")

scenario = input.string("both", "Mode", options=["both", "single"])
longCond = close > open
shortCond = close < open

switch scenario
    "both" =>
        if longCond
            strategy.entry("Long", strategy.long)
        if shortCond
            strategy.entry("Short", strategy.short)
    "single" =>
        if longCond
            strategy.entry("Long Only", strategy.long)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();

            // Should contain switch with proper discriminant
            expect(jsCode).toContain('switch ($.get($.let.glb1_scenario, 0))');

            // Should have both if statements in the "both" case
            expect(jsCode).toContain('$.get($.let.glb1_longCond, 0)');
            expect(jsCode).toContain('$.get($.let.glb1_shortCond, 0)');
        });

        it('should handle side-effect statements in switch cases', () => {
            const code = `
//@version=6
indicator("Switch Side Effects")

mode = input.string("A", "Mode", options=["A", "B"])

var signal = 0

switch mode
    "A" =>
        signal := 1
        signal := signal + 1
    "B" =>
        signal := -1

plot(signal)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('switch ($.get($.let.glb1_mode, 0))');
            expect(jsCode).toContain('$.var.glb1_signal');
        });

        it('should preserve all if statements in complex switch cases (from switch3.pine)', () => {
            const code = `
//@version=6
strategy("Complex Switch")

scenario = input.string("market", "Scenario", options=["market", "limit"])
longCondition = ta.crossover(ta.sma(close, 14), ta.sma(close, 28))
shortCondition = ta.crossunder(ta.sma(close, 14), ta.sma(close, 28))

switch scenario
    "market" =>
        if longCondition
            strategy.order(id="long_mkt", direction=strategy.long)
        if shortCondition
            strategy.order(id="short_mkt", direction=strategy.short)
    "limit" =>
        if longCondition
            strategy.order(id="long_lim", direction=strategy.long, limit=close * 0.995)
        if shortCondition
            strategy.order(id="short_lim", direction=strategy.short, limit=close * 1.005)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();

            // Verify switch discriminant is transformed
            expect(jsCode).toContain('switch ($.get($.let.glb1_scenario, 0))');

            // Verify both conditions are preserved (should appear multiple times)
            const longCondMatches = (jsCode.match(/\$\.get\(\$\.let\.glb1_longCondition, 0\)/g) || []).length;
            const shortCondMatches = (jsCode.match(/\$\.get\(\$\.let\.glb1_shortCondition, 0\)/g) || []).length;

            // Both conditions should appear at least twice (once per case in switch)
            expect(longCondMatches).toBeGreaterThanOrEqual(2);
            expect(shortCondMatches).toBeGreaterThanOrEqual(2);
        });

        it('should handle switch cases with multiple statements of different types', () => {
            const code = `
//@version=6
indicator("Mixed Statements Switch")

mode = input.string("debug", "Mode", options=["debug", "normal"])

var count = 0

switch mode
    "debug" =>
        count := count + 1
        plot(count, "Count", color=color.blue)
        plot(close, "Close", color=color.green)
    "normal" =>
        plot(close, "Close")
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('switch ($.get($.let.glb1_mode, 0))');
            expect(jsCode).toContain('$.var.glb1_count');
        });
    });

    describe('Typed Array Variable Declarations', () => {
        it('should transpile float[] array shorthand syntax', () => {
            const code = `
//@version=5
indicator("Array Shorthand")

float[] prices = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.let.glb1_prices = $.init($.let.glb1_prices, na.__value)');
        });

        it('should transpile array<float> generic syntax', () => {
            const code = `
//@version=6
indicator("Array Generic")

array<float> prices = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.let.glb1_prices = $.init($.let.glb1_prices, na.__value)');
            // Should NOT produce standalone 'array;' expression
            expect(jsCode).not.toMatch(/^\s*array\s*;/m);
        });

        it('should transpile var float[] with array shorthand', () => {
            const code = `
//@version=5
indicator("Var Array Shorthand")

var float[] prices = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.var.glb1_prices');
            expect(jsCode).toContain('$.initVar(');
        });

        it('should transpile var array<float> with generic syntax', () => {
            const code = `
//@version=6
indicator("Var Array Generic")

var array<float> prices = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.var.glb1_prices');
            expect(jsCode).toContain('$.initVar(');
        });

        it('should handle both array syntaxes together', () => {
            const code = `
//@version=6
indicator("Both Array Syntaxes")

var float[] prices1 = na
float[] prices2 = na
array<float> prices3 = na
var array<float> prices4 = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.var.glb1_prices1');
            expect(jsCode).toContain('$.let.glb1_prices2');
            expect(jsCode).toContain('$.let.glb1_prices3');
            expect(jsCode).toContain('$.var.glb1_prices4');
        });

        it('should transpile int[] array shorthand', () => {
            const code = `
//@version=6
indicator("Int Array")

int[] counts = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.let.glb1_counts = $.init($.let.glb1_counts, na.__value)');
        });

        it('should transpile map<string, float> generic syntax', () => {
            const code = `
//@version=6
indicator("Map Generic")

map<string, float> lookup = na

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('$.let.glb1_lookup = $.init($.let.glb1_lookup, na.__value)');
        });

        it('should transpile typed array declarations inside function bodies', () => {
            const code = `
//@version=6
indicator("Array In Function")

myFunc() =>
    float[] local_prices = na
    local_prices

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            expect(jsCode).toContain('fn');
            expect(jsCode).toContain('local_prices');
        });
    });

    describe('Combined Bug Fixes', () => {
        it('should handle generic types with dot-prefix numbers', () => {
            const code = `
//@version=6
indicator("Combined Test")

type Config
    array<float> thresholds
    float factor

step = input.float(.25, "Step")
multiplier = .5

plot(step * multiplier)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            // Generic type
            expect(jsCode).toContain("thresholds: 'array<float>'");

            // Dot-prefix numbers
            expect(jsCode).toContain('0.5');
            expect(jsCode).toContain('0.25');
        });

        it('should handle all fixes together in complex code', () => {
            const code = `
//@version=6
strategy("All Fixes Test")

type Position
    array<float> entries
    float stopLoss

scenario = input.string("market", "Scenario", options=["market", "limit"])
threshold = .75
longCond = close > open

switch scenario
    "market" =>
        if longCond
            strategy.entry("Long", strategy.long)
        if close > threshold
            strategy.exit("Exit", "Long")
    "limit" =>
        if longCond
            strategy.entry("Long Limit", strategy.long, limit=close * .995)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();

            // Generic type
            expect(jsCode).toContain("entries: 'array<float>'");

            // Dot-prefix numbers
            expect(jsCode).toContain('0.75');
            expect(jsCode).toContain('0.995');

            // Switch with multiple statements
            expect(jsCode).toContain('switch ($.get($.let.glb1_scenario, 0))');
            expect(jsCode).toContain('$.get($.let.glb1_longCond, 0)');
        });

        it('should handle function and variable name collision', () => {
            const code = `
//@version=5
indicator("bug")

plus(x1, x2)=> x2*x1

kernel_matrix(X1, X2, l)=>
    km = matrix.new<float>(X1.size(), X2.size())    
    
    for x1 in X1
        plus = plus(x1, 1)
        j = 0    
    km

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            // The variable 'plus' should be renamed to avoid collision with function 'plus'
            expect(jsCode).toContain('plus_var');
            // The function call 'plus(...)' should remain 'plus'
            expect(jsCode).toContain('$.call(plus,');
        });

        it('should Pine Script arrays in for in loops', () => {
            const code = `
//@version=5
indicator("bug")

plus(x1, x2)=> x2*x1

kernel_matrix(X1, X2, l)=>
    km = matrix.new<float>(X1.size(), X2.size())    
    
    for x1 in X1
        plus = plus(x1, 1)
        j = 0    
    km

plot(close)
            `;

            const result = transpile(code);
            const jsCode = result.toString();

            expect(jsCode).toBeDefined();
            // The variable 'plus' should be renamed to avoid collision with function 'plus'
            expect(jsCode).toContain('for (const x1 of $.iter($.get(X1, 0)))');
        });
    });
});

describe('Pine Script Transpilation - Comma-Separated Statements', () => {
    it('should parse comma-separated variable declarations', () => {
        const code = `
//@version=6
indicator("Comma Test")

a = high, b = low

plot(a + b)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('$.let.glb1_a = $.init($.let.glb1_a, high)');
        expect(jsCode).toContain('$.let.glb1_b = $.init($.let.glb1_b, low)');
    });

    it('should parse comma-separated function calls', () => {
        const code = `
//@version=6
indicator("Comma Calls")

plot(close), plot(open), plot(high)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        // Should have three separate plot calls
        const plotCalls = (jsCode.match(/plot\.any/g) || []).length;
        expect(plotCalls).toBeGreaterThanOrEqual(3);
    });

    it('should handle three comma-separated declarations', () => {
        const code = `
//@version=6
indicator("Three Variables")

a = 1, b = 2, c = 3
plot(a + b + c)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('$.let.glb1_a = $.init($.let.glb1_a, 1)');
        expect(jsCode).toContain('$.let.glb1_b = $.init($.let.glb1_b, 2)');
        expect(jsCode).toContain('$.let.glb1_c = $.init($.let.glb1_c, 3)');
    });

    it('should handle comma-separated var declarations', () => {
        const code = `
//@version=6
indicator("Var Test")

var x = 0, y = 0
x := 10, y := 20

plot(x + y)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('$.var.glb1_x');
        // Note: The second variable in a var statement is treated as let
        expect(jsCode).toContain('$.let.glb1_y');
    });

    it('should handle mixed declarations and function calls', () => {
        const code = `
//@version=6
indicator("Mixed Test")

fast = ta.sma(close, 10), slow = ta.sma(close, 20), plot(fast - slow)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('$.let.glb1_fast');
        expect(jsCode).toContain('$.let.glb1_slow');
        expect(jsCode).toContain('ta.sma');
    });

    it('should handle comma-separated assignments', () => {
        const code = `
//@version=6
indicator("Assignments")

var a = 0
var b = 0

a := 10, b := 20

plot(a + b)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('$.var.glb1_a');
        expect(jsCode).toContain('$.var.glb1_b');
    });

    it('should handle complex expressions in comma-separated statements', () => {
        const code = `
//@version=6
indicator("Complex")

result1 = close > open ? 1 : 0, result2 = high - low

plot(result1 + result2)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('$.let.glb1_result1');
        expect(jsCode).toContain('$.let.glb1_result2');
        // `close > open` routes through the na-aware relational helper.
        expect(jsCode).toMatch(/\$\.pine\.math\.__gt\(\$\.get\(close, 0\), \$\.get\(open, 0\)\)/);
    });

    it('should not confuse commas in function arguments with statement separators', () => {
        const code = `
//@version=6
indicator("Comma in Args")

a = ta.sma(close, 10)
b = input.int(20, "Period", minval=1)

plot(a * b)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('$.let.glb1_a');
        expect(jsCode).toContain('$.let.glb1_b');
        // Should not have incorrectly split the arguments
        expect(jsCode).toContain('ta.sma');
        expect(jsCode).toContain('input.int');
    });

    it('should handle comma-separated statements on multiple lines separately', () => {
        const code = `
//@version=6
indicator("Multiple Lines")

a = 1, b = 2
c = 3, d = 4

plot(a + b + c + d)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('$.let.glb1_a');
        expect(jsCode).toContain('$.let.glb1_b');
        expect(jsCode).toContain('$.let.glb1_c');
        expect(jsCode).toContain('$.let.glb1_d');
    });

    it('should handle the original bug.pine test case', () => {
        const code = `
//@version=5
indicator("bug")

a = high, b = low
plot(a), plot(b)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('$.let.glb1_a');
        expect(jsCode).toContain('$.let.glb1_b');

        // Should have two plot calls
        const plotCalls = (jsCode.match(/plot\.any/g) || []).length;
        expect(plotCalls).toBeGreaterThanOrEqual(2);
    });
});

describe('Pine Script Transpilation - For-Of and For-In Loops', () => {
    it('should handle for-of loops without breaking variable declarations', () => {
        const code = `
//@version=5
indicator("For-Of Test")

kernel_matrix(X1, X2, l)=>
    km = close
    
    for x1 in X1
        j = 0
    
    km

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        // Should contain for-of loop with $.get() on the iterable
        expect(jsCode).toContain('for (const x1 of $.iter($.get(X1, 0)))');
        // Should NOT contain malformed loop syntax
        expect(jsCode).not.toMatch(/for \([^)]+= undefined[^)]*of/);
    });

    it('should preserve for-of loop variables without transformation', () => {
        const code = `
//@version=6
indicator("For-Of Variables")

process_array(arr)=>
    sum = 0.0
    for item in arr
        sum := sum + item
    sum

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // The iterable should use $.get(), but the loop variable should not be transformed
        expect(jsCode).toContain('for (const item of $.iter($.get(arr, 0)))');
        expect(jsCode).not.toContain('$$.const.fn1_item');
    });

    it('should handle for-of loops with destructuring', () => {
        const code = `
//@version=5
indicator("For-Of Destructuring")

kernel_matrix(X1)=>
    for [idx, x1] in X1
        j = 0
    0

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        // Should contain for-of loop with .entries()
        expect(jsCode).toContain('for (const [idx, x1] of $.entries($.get(X1, 0)))');
    });

    it('should handle for-of destructuring over a member expression iterable', () => {
        // Regression: iterating with [index, value] destructuring over a UDT field
        // (e.g. eachDay.prices) must route through $.entries() so the runtime can
        // resolve the underlying array — otherwise destructuring a scalar yielded
        // by PineArrayObject's [Symbol.iterator] throws "is not iterable".
        const code = `
//@version=6
indicator("For-Of Member Destructuring")

type bucket
    array<float> prices = na

process(buckets) =>
    for [i, b] in buckets
        for [j, p] in b.prices
            x = p

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('for (const [j, p] of $.entries(b.prices))');
        // Outer loop too — destructuring over a function param identifier
        expect(jsCode).toContain('for (const [i, b] of $.entries(');
    });

    it('should wrap non-destructuring iteration over a member expression with $.iter', () => {
        // Regression: built-ins like box.all return plain JS arrays (not PineArrayObject).
        // Previously the codegen emitted `<expr>.array` unconditionally for member-expr
        // iterables, which broke `for element in box.all` because plain arrays have no
        // `.array` field. The $.iter helper handles both shapes uniformly.
        const code = `
//@version=6
indicator("ForOf MemberExpr Plain JS Array")

if true
    for element in box.all
        element.delete()
    for ln in line.all
        ln.delete()

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('for (const element of $.iter(box.all))');
        expect(jsCode).toContain('for (const ln of $.iter(line.all))');
        // Must NOT regress to the broken `.array` form
        expect(jsCode).not.toContain('box.all.array');
        expect(jsCode).not.toContain('line.all.array');
    });

    it('should handle for-of destructuring over a built-in plain JS array', () => {
        // Symmetric to the non-destructuring case: `for [i, el] in box.all` must work
        // even though box.all is a plain JS array (not a PineArrayObject).
        const code = `
//@version=6
indicator("ForOf MemberExpr Destructuring Plain JS")

if true
    for [i, el] in box.all
        x = i

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('for (const [i, el] of $.entries(box.all))');
        expect(jsCode).not.toContain('box.all.array');
    });

    it('should handle for-of loops with nested operations', () => {
        const code = `
//@version=6
indicator("Nested For-Of")

calculate(values)=>
    result = 0.0
    for val in values
        temp = val * 2
        result := result + temp
    result

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('for (const val of $.iter($.get(values, 0)))');
        // The temp variable inside the loop should be transformed
        expect(jsCode).toMatch(/\$\$\.let\.fn\d+_temp/);
    });

    it('should handle multiple for-of loops in same function', () => {
        const code = `
//@version=6
indicator("Multiple For-Of")

process(arr1, arr2)=>
    sum1 = 0.0
    for x in arr1
        sum1 := sum1 + x
    
    sum2 = 0.0
    for y in arr2
        sum2 := sum2 + y
    
    sum1 + sum2

plot(close)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('for (const x of $.iter($.get(arr1, 0)))');
        expect(jsCode).toContain('for (const y of $.iter($.get(arr2, 0)))');
    });

    it('should handle for-of with array operations', () => {
        const code = `
//@version=6
indicator("For-Of with Arrays")

sum_array(arr)=>
    total = 0.0
    for element in arr
        total := total + element
    total

values = array.from(1, 2, 3, 4, 5)
result = sum_array(values)
plot(result)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('for (const element of $.iter($.get(arr, 0)))');
    });
});

describe('Pine Script Transpilation - Type-as-function (typed-na pattern)', () => {
    // Pine v6 lets you write `<TypeName>(value)` to wrap/cast a value as that type.
    // The most common use is `box(na)`, `line(na)` etc. inside UDT initializers
    // where a typed-na is needed. The transpiler must rewrite this to
    // `<TypeName>.any(...)` — calling the namespace directly fails because the
    // namespace object isn't callable. Each namespace's `any()` method delegates
    // to `new()`.

    it('rewrites box(na) → box.any(...) so the namespace call resolves at runtime', () => {
        // Regression: `box(na)` previously emitted as a literal `box(...)` call,
        // which threw "box is not a function" because BoxHelper isn't callable.
        const code = `
//@version=6
indicator("box(na) typed-na", overlay=true)
b = box(na)
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        expect(jsCode).toContain('box.any(');
        // Must NOT regress to the broken raw-call form (no "box(p" — but allow box.new(, box.any(, etc.)
        expect(jsCode).not.toMatch(/[^.\w]box\(p\d+/);
    });

    it('rewrites line(na) → line.any(...) (already-working case kept stable)', () => {
        const code = `
//@version=6
indicator("line(na) typed-na", overlay=true)
l = line(na)
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('line.any(');
        expect(jsCode).not.toMatch(/[^.\w]line\(p\d+/);
    });

    it('rewrites linefill(na) → linefill.any(...)', () => {
        const code = `
//@version=6
indicator("linefill(na) typed-na", overlay=true)
lf = linefill(na)
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('linefill.any(');
        expect(jsCode).not.toMatch(/[^.\w]linefill\(p\d+/);
    });

    it('rewrites polyline(na) → polyline.any(...)', () => {
        const code = `
//@version=6
indicator("polyline(na) typed-na", overlay=true)
p = polyline(na)
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('polyline.any(');
        expect(jsCode).not.toMatch(/[^.\w]polyline\(p\d+/);
    });

    it('rewrites table(na) → table.any(...)', () => {
        const code = `
//@version=6
indicator("table(na) typed-na", overlay=true)
t = table(na)
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('table.any(');
        expect(jsCode).not.toMatch(/[^.\w]table\(p\d+/);
    });
});

describe('Pine Script Transpilation - Contextual keywords as UDT field names', () => {
    // Pine v5/v6 treats `type`, `method`, `enum` as contextual keywords:
    // they're reserved only when they introduce a declaration. Elsewhere they're
    // valid identifiers — most notably as UDT field names like `int type = 0`.

    it('parses `type` as a UDT field name', () => {
        // Regression: "Expected IDENTIFIER but got KEYWORD at <line:col>"
        const code = `
//@version=6
indicator("UDT field named type", overlay=true)
type MS
    int type = 0

m = MS.new(5)
plot(m.type)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        // The field should be present in the type definition / object initialization
        expect(jsCode).toMatch(/type\s*[:=]/);
    });

    it('parses `method` as a UDT field name', () => {
        const code = `
//@version=6
indicator("UDT field named method", overlay=true)
type Action
    string method = "click"

a = Action.new("hover")
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        expect(jsCode).toMatch(/method\s*[:=]/);
    });

    it('parses `enum` as a UDT field name', () => {
        const code = `
//@version=6
indicator("UDT field named enum", overlay=true)
type Item
    int enum = 1

i = Item.new(2)
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        expect(jsCode).toMatch(/enum\s*[:=]/);
    });

    it('still rejects `type` at the START of a top-level declaration line', () => {
        // Sanity check: the contextual-keyword relaxation must NOT break the
        // primary syntactic role of `type` as a UDT-introducer keyword.
        const code = `
//@version=6
indicator("type still works as keyword")
type Foo
    int x = 1

f = Foo.new(5)
plot(f.x)
        `;
        // Should parse cleanly, with the `type` keyword properly consumed
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        // The Foo type should still produce a constructor / type wiring
        expect(jsCode).toContain('Foo');
    });
});

describe('Pine Script Transpilation - Comma-separated typed declarations', () => {
    // Pine v6 allows multiple typed variable declarations on a single line
    // sharing the leading type qualifier:
    //   float a = 0.0, b = 1.0, c = 2.0
    // Each segment after the first comma is `name = expr` with the captured
    // type re-applied. The parser previously only handled this for var/varip
    // chains (`var int x = 1, var int y = 2`).

    it('parses comma-separated float declarations sharing the type', () => {
        // Regression: previously failed with "Unexpected token COMMA ',' at <line:col>"
        const code = `
//@version=6
indicator("multi-float decl")
my_func() =>
    float sumW = 0.0, sumWX = 0.0, sumWY = 0.0
    sumW + sumWX + sumWY
plot(my_func())
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        // All three identifiers must end up as separate scoped bindings
        expect(jsCode).toContain('fn1_sumW');
        expect(jsCode).toContain('fn1_sumWX');
        expect(jsCode).toContain('fn1_sumWY');
        // None must end up swallowed as a sub-expression of the previous initializer
        expect(jsCode).not.toMatch(/sumW\s*=\s*\([^)]*sumWX/);
    });

    it('parses comma-separated int declarations sharing the type', () => {
        const code = `
//@version=6
indicator("multi-int decl")
my_func() =>
    int aa = 1, bb = 2, cc = 3
    aa + bb + cc
plot(my_func())
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('fn1_aa');
        expect(jsCode).toContain('fn1_bb');
        expect(jsCode).toContain('fn1_cc');
    });

    it('parses comma-separated bool declarations sharing the type', () => {
        const code = `
//@version=6
indicator("multi-bool decl")
my_func() =>
    bool xx = true, yy = false
    xx or yy
plot(my_func() ? 1 : 0)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('fn1_xx');
        expect(jsCode).toContain('fn1_yy');
        // Both literal values must be present somewhere in the initializers
        expect(jsCode).toContain('true');
        expect(jsCode).toContain('false');
    });

    it('parses comma-separated string declarations sharing the type', () => {
        const code = `
//@version=6
indicator("multi-string decl")
my_func() =>
    string ss = "hello", tt = "world"
    ss + tt
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('fn1_ss');
        expect(jsCode).toContain('fn1_tt');
        expect(jsCode).toMatch(/['"]hello['"]/);
        expect(jsCode).toMatch(/['"]world['"]/);
    });

    it('parses comma-separated qualified-type declarations (series float)', () => {
        const code = `
//@version=6
indicator("multi series-float decl")
series float ema1 = 0.0, ema2 = 0.0
plot(ema1 + ema2)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        // Both bindings emitted at global scope (glb1_*)
        expect(jsCode).toContain('glb1_ema1');
        expect(jsCode).toContain('glb1_ema2');
    });

    it('parses comma-separated generic-type declarations (array<float>)', () => {
        const code = `
//@version=6
indicator("multi generic-type decl")
my_func() =>
    array<float> pp = na, qq = na
    array.size(pp) + array.size(qq)
plot(my_func())
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toContain('fn1_pp');
        expect(jsCode).toContain('fn1_qq');
    });

    it('does not consume commas belonging to outer constructs', () => {
        // Sanity check: a single typed decl followed by a function call
        // (whose args are comma-separated) must not pull those args into the decl.
        const code = `
//@version=6
indicator("guard")
my_func() =>
    float a = 1.0
    math.max(a, 2.0, 3.0)
plot(my_func())
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        // math.max called normally
        expect(jsCode).toMatch(/math\.max\(/);
        // The constants `2` and `3` from math.max args must not have been
        // mis-treated as additional declarators (which would emit fn1_2 etc.)
        expect(jsCode).not.toMatch(/fn1_2\b/);
        expect(jsCode).not.toMatch(/fn1_3\b/);
    });
});

describe('Pine Script Transpilation - User function names colliding with JS reserved keywords', () => {
    // Pine allows user-defined functions/methods named after JS reserved keywords
    // (e.g. `method delete(...)`). The codegen must rename these consistently at
    // both the declaration site (`function delete()` is invalid JS) and at any
    // direct call site, while leaving method-style invocations (`obj.delete()`)
    // alone since JS allows reserved words as property names.

    it('renames user method named `delete` so generated JS parses', () => {
        // Regression: previously emitted `function delete()` → "Unexpected keyword 'delete'"
        const code = `
//@version=6
indicator("delete method", overlay=true)
type Foo
    int x
method delete(Foo this) =>
    this.x := 0

f = Foo.new(1)
f.delete()
plot(close)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        expect(jsCode).toBeDefined();
        // Declaration must NOT be the bare reserved word (would break JS parse).
        expect(jsCode).not.toMatch(/function\s+delete\s*\(/);
        // Method declarations get a `$M_` JS prefix that is collision-proof
        // by construction — no `_$N` reserved-name suffix is needed (and adding
        // one would break Pine-name lookup at the call site, since the AnalysisPass
        // strips only `$M_` to recover the Pine name `delete`).
        expect(jsCode).toMatch(/function\s+\$M_delete\s*\(/);
        // The Pine call site `f.delete()` retargets to `$.call($M_delete, ...)`
        // when the receiver is a known UDT instance.
        expect(jsCode).toMatch(/\$\.call\s*\(\s*\$M_delete\b/);
    });

    it('renames direct call to a user function named after a JS reserved word', () => {
        // When a user function name is renamed, direct CallExpression callees
        // referencing it must be renamed too. (Method-style `obj.delete()` is
        // a property access and stays as `obj.delete()`.)
        const code = `
//@version=6
indicator("direct call to user delete()")
delete(int x) =>
    x + 1
y = delete(5)
plot(y)
        `;
        const result = transpile(code);
        const jsCode = result.toString();
        // Declaration renamed
        expect(jsCode).toMatch(/function\s+delete_\$\d+\s*\(/);
        // Direct call site renamed too — same rename
        expect(jsCode).toMatch(/delete_\$\d+\(/);
        // Must NOT leave a bare `delete(` call (would fail JS parse if `delete` is the keyword)
        expect(jsCode).not.toMatch(/[^_\w]delete\(\d/);
    });
});

describe('Pine Script Transpilation - Real-World Example (MACD)', () => {
    it('should transpile complete MACD indicator', () => {
        const code = `
//@version=6
indicator("MACD", shorttitle="MACD")

fast_length = input.int(12, "Fast Length", minval=1)
slow_length = input.int(26, "Slow Length", minval=1)
signal_length = input.int(9, "Signal Length", minval=1)
src = input.source(close, "Source")

fast_ma = ta.ema(src, fast_length)
slow_ma = ta.ema(src, slow_length)
macd = fast_ma - slow_ma
signal = ta.ema(macd, signal_length)
hist = macd - signal

plot(hist, title="Histogram", style=plot.style_histogram, color=color.blue)
plot(macd, title="MACD", color=color.blue)
plot(signal, title="Signal", color=color.orange)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        expect(jsCode).toContain('input.int');
        expect(jsCode).toContain('ta.ema');
        expect(jsCode).toContain('plot');
        expect(jsCode).toContain('$.let.glb1_macd');
        expect(jsCode).toContain('$.let.glb1_signal');
        expect(jsCode).toContain('$.let.glb1_hist');
    });
});

describe('Pine Script Transpilation - Tuple Return in Functions', () => {
    it('should transform all variable references in tuple return with complex expressions', () => {
        const code = `
//@version=5
indicator("Tuple Return Test")

myBands(src, len, mult) =>
    float _mid = ta.sma(src, len)
    float _dev = ta.stdev(src, len)
    [_mid, _mid + _dev * mult, _mid - _dev * mult]

[mid, upper, lower] = myBands(close, 20, 2.0)
plot(mid)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Extract the return statement from inside the function
        const returnMatch = jsCode.match(/return \$\.precision\(\[\[(.+?)\]\]\)/);
        expect(returnMatch).toBeTruthy();
        const tupleContent = returnMatch![1];

        // The return line must NOT contain bare _mid or _dev identifiers (only scoped $$.let.fn..._mid)
        expect(tupleContent).not.toMatch(/(?<!\w)_mid\b/);
        expect(tupleContent).not.toMatch(/(?<!\w)_dev\b/);

        // All variable references should be resolved via $.get()
        // 3 for _mid + 2 for _dev + 1 for mult = 6 $.get() calls
        const getCallCount = (tupleContent.match(/\$\.get\(/g) || []).length;
        expect(getCallCount).toBeGreaterThanOrEqual(5);

        // Verify scoped variable names appear in $.get calls
        expect(tupleContent).toContain('$.get($$.let.fn');
    });

    it('should transform unary expressions in tuple return', () => {
        const code = `
//@version=5
indicator("Tuple Unary Test")

myFunc(src, len) =>
    float _val = ta.sma(src, len)
    [_val, -_val]

[pos, neg] = myFunc(close, 20)
plot(pos)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Extract the return statement
        const returnMatch = jsCode.match(/return \$\.precision\(\[\[(.+?)\]\]\)/);
        expect(returnMatch).toBeTruthy();
        const tupleContent = returnMatch![1];

        // The negated element should NOT have bare _val, must use $.get on the resolved variable
        expect(tupleContent).not.toMatch(/(?<!\w)_val\b/);
        expect(tupleContent).toContain('-$.get($$');
    });

    it('should transform call expressions in tuple return', () => {
        const code = `
//@version=5
indicator("Tuple Call Test")

myFunc(src, len) =>
    float _sma = ta.sma(src, len)
    float _ema = ta.ema(src, len)
    [_sma, math.abs(_sma - _ema)]

[sma_val, diff] = myFunc(close, 20)
plot(sma_val)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Extract the return statement
        const returnMatch = jsCode.match(/return \$\.precision\(\[\[(.+?)\]\]\)/);
        expect(returnMatch).toBeTruthy();
        const tupleContent = returnMatch![1];

        // No bare _sma or _ema in the return — all resolved via $.get
        expect(tupleContent).not.toMatch(/(?<!\w)_sma\b/);
        expect(tupleContent).not.toMatch(/(?<!\w)_ema\b/);
    });
});

describe('Pine Script Transpilation - Nested Member Assignment', () => {
    it('should transform 2-level deep member assignment (obj.a.b = val)', () => {
        const code = `
//@version=5
indicator("Nested UDT Assignment")

type Inner
    float value

type Outer
    Inner inner
    float scale

var _outer = Outer.new(Inner.new(close), 2.0)
_outer := Outer.new(Inner.new(close), 2.0)

_outer.inner.value := close * _outer.scale
_modified = _outer.inner.value
plot(_modified)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // Left side: must be $.get($.var.glb1__outer, 0).inner.value, NOT bare _outer.inner.value
        expect(jsCode).toContain('$.get($.var.glb1__outer, 0).inner.value =');
        expect(jsCode).not.toMatch(/(?<!\w)_outer\.inner\.value\s*=/);

        // Right side should also have _outer.scale resolved
        expect(jsCode).toContain('$.get($.var.glb1__outer, 0).scale');
    });

    it('should still transform 1-level deep member assignment (obj.prop = val)', () => {
        const code = `
//@version=5
indicator("Shallow UDT Assignment")

type Point
    float x
    float y

var _pt = Point.new(0.0, 0.0)
_pt := Point.new(close, open)
_pt.x := close * 2
plot(_pt.x)
        `;

        const result = transpile(code);
        const jsCode = result.toString();

        // 1-level assignment: _pt.x := ... should become $.get($.var.glb1__pt, 0).x = ...
        expect(jsCode).toContain('$.get($.var.glb1__pt, 0).x =');
        expect(jsCode).not.toMatch(/(?<!\w)_pt\.x\s*=/);
    });
});
