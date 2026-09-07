// Regression guard: repeated `_` (discard) declarations.
//
// TradingView docs ("Using an underscore (_) as an identifier"):
//   "You can assign any number of values to a `_` identifier anywhere in the
//    script, even if the current scope already has such an assignment."
//
// Pine Script therefore allows:
//   [_, s1, _] = ta.macd(...)
//   [_, s2, _] = ta.macd(...)      // same scope, `_` re-declared
//   _ = ta.sma(close, 10)          // plain declaration to `_`
//   _ = ta.sma(close, 20)          // ... again
//
// JavaScript forbids re-declaring a `let`/`const` binding in the same scope,
// so before the fix the generated code failed with
//   SyntaxError: Identifier '_' has already been declared
//
// The fix (pineToJS codegen) renames every `_` declaration target to a fresh
// `_$N` placeholder. `$` is not legal in Pine identifiers, so the placeholders
// can never collide with user variables.
import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

function newPineTS() {
    return new PineTS(Provider.Mock, 'BTCUSDC', '60', null, new Date('2024-01-01').getTime(), new Date('2024-01-10').getTime());
}

function series(plots: any, title: string): number[] {
    const data = plots[title]?.data;
    expect(data, `plot "${title}" missing`).toBeDefined();
    expect(data.length).toBeGreaterThan(0);
    return data.map((d: any) => d.value);
}

/**
 * Reference values: the same computations expressed WITHOUT `_`, using
 * uniquely-named variables. This is plain, already-supported Pine, so it
 * gives us an independent expectation for what the `_` variants must produce.
 */
async function reference() {
    const { plots } = await newPineTS().run(`
//@version=5
indicator("reference")
[m1, s1, h1] = ta.macd(close, 12, 26, 9)
[m2, s2, h2] = ta.macd(close, 5, 10, 3)
[bbm, bbu, bbl] = ta.bb(close, 20, 2)
sma10 = ta.sma(close, 10)
plot(s1, "s1")
plot(s2, "s2")
plot(m1, "m1")
plot(h2, "h2")
plot(bbu, "bbu")
plot(bbl, "bbl")
plot(sma10, "sma10")
`);
    return plots;
}

describe('`_` discard identifier can be declared multiple times (TV semantics)', () => {
    it('two tuple declarations re-using `_` in the global scope', async () => {
        const ref = await reference();
        const { plots } = await newPineTS().run(`
//@version=5
indicator("t")
[_, s1, _] = ta.macd(close, 12, 26, 9)
[_, s2, _] = ta.macd(close, 5, 10, 3)
plot(s1, "s1")
plot(s2, "s2")
`);
        expect(series(plots, 's1')).toEqual(series(ref, 's1'));
        expect(series(plots, 's2')).toEqual(series(ref, 's2'));
    });

    it('TradingView docs example: `_` re-used across two ta.bb() tuples', async () => {
        const ref = await reference();
        const { plots } = await newPineTS().run(`
//@version=5
indicator("Underscore demo")
[_, bbUpper, bbLower] = ta.bb(close, 20, 2)
[bbMiddleLong, _, _] = ta.bb(close, 20, 2)
plot(bbUpper, "bbu")
plot(bbLower, "bbl")
plot(bbMiddleLong, "bbm")
`);
        expect(series(plots, 'bbu')).toEqual(series(ref, 'bbu'));
        expect(series(plots, 'bbl')).toEqual(series(ref, 'bbl'));
        // bbMiddleLong is the SMA(20) basis — compare against ta.sma via the
        // reference's bb middle. Both come from the same ta.bb call shape.
        const refPlots = await newPineTS().run(`
//@version=5
indicator("ref2")
[bbm, u, l] = ta.bb(close, 20, 2)
plot(bbm, "bbm")
`);
        expect(series(plots, 'bbm')).toEqual(series(refPlots.plots, 'bbm'));
    });

    it('plain `_ = expr` declared twice, then a real variable', async () => {
        const ref = await reference();
        const { plots } = await newPineTS().run(`
//@version=5
indicator("t")
_ = ta.sma(close, 10)
_ = ta.sma(close, 20)
x = ta.sma(close, 10)
plot(x, "x")
`);
        expect(series(plots, 'x')).toEqual(series(ref, 'sma10'));
    });

    it('tuple `_` followed by plain `_` in the same scope', async () => {
        const ref = await reference();
        const { plots } = await newPineTS().run(`
//@version=5
indicator("t")
[m, _, _] = ta.macd(close, 12, 26, 9)
_ = ta.sma(close, 10)
plot(m, "m")
`);
        expect(series(plots, 'm')).toEqual(series(ref, 'm1'));
    });

    it('`_` re-declared inside a user function body', async () => {
        const ref = await reference();
        const { plots } = await newPineTS().run(`
//@version=5
indicator("t")
f() =>
    [_, a, _] = ta.macd(close, 12, 26, 9)
    [_, _, b] = ta.macd(close, 5, 10, 3)
    [a, b]
[fa, fb] = f()
plot(fa, "s1")
plot(fb, "h2")
`);
        expect(series(plots, 's1')).toEqual(series(ref, 's1'));
        expect(series(plots, 'h2')).toEqual(series(ref, 'h2'));
    });

    it('`_` re-declared in both if/else branches and after the if', async () => {
        const ref = await reference();
        const { plots } = await newPineTS().run(`
//@version=5
indicator("t")
r = 0.0
if true
    [_, a, _] = ta.macd(close, 12, 26, 9)
    r := a
else
    [_, b, _] = ta.macd(close, 5, 10, 3)
    r := b
[_, s2, _] = ta.macd(close, 5, 10, 3)
_ = r
plot(r, "s1")
plot(s2, "s2")
`);
        expect(series(plots, 's1')).toEqual(series(ref, 's1'));
        expect(series(plots, 's2')).toEqual(series(ref, 's2'));
    });

    it('`_` declared many times in a for-in loop body', async () => {
        const { plots } = await newPineTS().run(`
//@version=5
indicator("t")
arr = array.from(1.0, 2.0, 3.0)
total = 0.0
for v in arr
    _ = v * 2
    _ = v * 3
    total += v
plot(total, "t")
`);
        const t = series(plots, 't');
        expect(t[t.length - 1]).toBe(6);
    });

    it('generated JS never contains a bare `_` declaration', () => {
        const out = pineToJS(`//@version=5
indicator("t")
[_, s1, _] = ta.macd(close, 12, 26, 9)
_ = ta.sma(close, 10)
plot(s1)
`);
        expect(out.success, out.error).toBe(true);
        const js: string = out.code;
        // Every `_` target must have been renamed to a unique `_$N` placeholder
        expect(js).not.toMatch(/\b(let|const|var)\s+_\s*=/);
        expect(js).not.toMatch(/\[\s*_\s*,/);
        expect(js).not.toMatch(/,\s*_\s*\]/);
        const placeholders = js.match(/_\$\d+/g) ?? [];
        expect(placeholders.length).toBe(3);
        expect(new Set(placeholders).size).toBe(3);
    });
});
