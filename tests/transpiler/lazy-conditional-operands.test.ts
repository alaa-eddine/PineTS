// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lazy evaluation of `?:` branches and `and` / `or` operands.
 *
 * Reference: TradingView's "To Pine Script version 6" migration guide, section
 * "Lazy evaluation of conditions":
 *
 *   - `?:` is lazy in EVERY Pine version: only the taken branch is evaluated.
 *     ("Pine v5 evaluates all bool expressions except for the `?:` ternary
 *     operator strictly".)
 *   - `and` / `or` are STRICT in v5 (both operands always evaluated) and LAZY
 *     in v6 (the right operand is skipped once the result is known).
 *   - Bare PineTS syntax is JavaScript, whose `&&` / `||` / `?:` are lazy.
 *
 * Historically the transpiler hoisted every namespace call inside these
 * operands into an unconditional `temp_N` const ahead of the statement, so a
 * guarded `array.get(a, 0)` ran even when `array.size(a) > 0` was false and
 * threw "Index 0 is out of bounds". Stateful `ta.*` calls in an untaken
 * branch were also executed on every bar, diverging from TradingView.
 *
 * Observable used for "was the branch executed on this bar?": `ta.cum(1)`
 * counts the bars on which it was actually called, so its value on a given
 * bar is a hand-derivable execution count.
 */
import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

function mk() {
    return new PineTS(Provider.Mock, 'BTCUSDC', '60', null, new Date('2024-01-01').getTime(), new Date('2024-01-10').getTime());
}

const pine = (version: 5 | 6, body: string) => `//@version=${version}\nindicator("t")\n${body}`;

describe('?: is lazy (all versions)', () => {
    for (const v of [5, 6] as const) {
        it(`v${v}: guarded array.get in a ternary branch does not throw on an empty array`, async () => {
            const { plots } = await mk().run(
                pine(v, `var a = array.new_float()
x = array.size(a) > 0 ? array.get(a, 0) : na
plot(x, "x")`)
            );
            const x = plots['x'].data.map((p) => p.value);
            expect(x.length).toBeGreaterThan(0);
            expect(x.every((val) => Number.isNaN(val))).toBe(true);
        });

        it(`v${v}: the alternate branch is lazy too`, async () => {
            const { plots } = await mk().run(
                pine(v, `var a = array.new_float()
x = array.size(a) == 0 ? na : array.get(a, 0)
plot(x, "x")`)
            );
            expect(plots['x'].data.every((p) => Number.isNaN(p.value))).toBe(true);
        });

        it(`v${v}: ta.* inside a ternary branch only executes on bars where the branch is taken`, async () => {
            const { plots } = await mk().run(
                pine(v, `// even bars: count executions; odd bars: -1
x = bar_index % 2 == 0 ? ta.cum(1) : -1
plot(x, "x")`)
            );
            const x = plots['x'].data.map((p) => p.value);
            // Hand-derived under TV lazy semantics: on even bar 2k the branch has
            // run k+1 times so far (bars 0, 2, ..., 2k).
            expect(x[0]).toBe(1);
            expect(x[1]).toBe(-1);
            expect(x[2]).toBe(2);
            expect(x[3]).toBe(-1);
            expect(x[10]).toBe(6);
            expect(x[20]).toBe(11);
        });

        it(`v${v}: ternary inside a user function is lazy`, async () => {
            const { plots } = await mk().run(
                pine(v, `f(arr) => array.size(arr) > 0 ? array.get(arr, 0) : na
var a = array.new_float()
plot(f(a), "x")`)
            );
            expect(plots['x'].data.every((p) => Number.isNaN(p.value))).toBe(true);
        });

        it(`v${v}: ternary passed directly as a function argument is lazy`, async () => {
            const { plots } = await mk().run(
                pine(v, `var a = array.new_float()
plot(array.size(a) > 0 ? array.get(a, 0) : na, "x")`)
            );
            expect(plots['x'].data.every((p) => Number.isNaN(p.value))).toBe(true);
        });

        it(`v${v}: nested call inside the taken branch still works and gets its arguments`, async () => {
            const { plots } = await mk().run(
                pine(v, `var a = array.from(1.0, 2.0, 3.0)
x = array.size(a) > 0 ? math.max(array.get(a, 0), array.get(a, 2)) : na
plot(x, "x")`)
            );
            expect(plots['x'].data.every((p) => p.value === 3)).toBe(true);
        });

        it(`v${v}: built-in ta variable (ta.tr) inside a ternary branch works`, async () => {
            const { plots } = await mk().run(
                pine(v, `x = bar_index % 2 == 0 ? ta.tr : 0
plot(x, "x")
plot(ta.tr, "ref")`)
            );
            const x = plots['x'].data.map((p) => p.value);
            const ref = plots['ref'].data.map((p) => p.value);
            expect(x[2]).toBeCloseTo(ref[2], 8);
            expect(x[3]).toBe(0);
        });

        it(`v${v}: built-in ta variable as an argument of a call inside a ternary branch works`, async () => {
            const { plots } = await mk().run(
                pine(v, `x = bar_index % 2 == 0 ? math.max(ta.tr, 0) : 0
plot(x, "x")
plot(ta.tr, "ref")`)
            );
            const x = plots['x'].data.map((p) => p.value);
            const ref = plots['ref'].data.map((p) => p.value);
            expect(x[2]).toBeCloseTo(ref[2], 8);
            expect(x[3]).toBe(0);
        });
    }
});

describe('and / or: strict in v5, lazy in v6 (TradingView semantics)', () => {
    it('v6: `size > 0 and get(...)` guard does not throw on an empty array', async () => {
        const { plots } = await mk().run(
            pine(6, `var a = array.new_float()
y = array.size(a) > 0 and array.get(a, 0) > 0
plot(y ? 1 : 0, "y")`)
        );
        expect(plots['y'].data.every((p) => p.value === 0)).toBe(true);
    });

    it('v6: `size == 0 or get(...)` guard does not throw on an empty array', async () => {
        const { plots } = await mk().run(
            pine(6, `var a = array.new_float()
z = array.size(a) == 0 or array.get(a, 0) > 0
plot(z ? 1 : 0, "z")`)
        );
        expect(plots['z'].data.every((p) => p.value === 1)).toBe(true);
    });

    it('v6: ta.* on the right of `and` only runs when the left side is true', async () => {
        const { plots } = await mk().run(
            pine(6, `// cum executes only on even bars: its k-th execution happens on bar 2(k-1)
flag = bar_index % 2 == 0 and ta.cum(1) >= 50
plot(flag ? 1 : 0, "f")`)
        );
        const f = plots['f'].data.map((p) => p.value);
        // 50th execution is on bar 98 -> first true at bar 98, false before
        expect(f[50]).toBe(0);
        expect(f[96]).toBe(0);
        expect(f[98]).toBe(1);
    });

    it('v5: ta.* on the right of `and` runs on every bar (strict evaluation)', async () => {
        const { plots } = await mk().run(
            pine(5, `flag = bar_index % 2 == 0 and ta.cum(1) >= 50
plot(flag ? 1 : 0, "f")`)
        );
        const f = plots['f'].data.map((p) => p.value);
        // cum runs every bar: cum = bar_index + 1, so >= 50 from bar 49; first even bar is 50
        expect(f[48]).toBe(0);
        expect(f[50]).toBe(1);
        expect(f[51]).toBe(0);
        expect(f[52]).toBe(1);
    });

    it('v5: `and` guard is strict, so the guarded array.get still throws (as it does on TradingView v5)', async () => {
        await expect(
            mk().run(
                pine(5, `var a = array.new_float()
y = array.size(a) > 0 and array.get(a, 0) > 0
plot(y ? 1 : 0, "y")`)
            )
        ).rejects.toThrow(/out of bounds/);
    });
});

describe('switch expression arms are lazy (compiled to an IIFE with if/else)', () => {
    // A Pine `switch` used as an expression compiles to an IIFE whose arms are
    // `if (...) { return <arm> }` blocks. Calls inside those blocks used to be
    // hoisted to the IIFE body ahead of the `if`, so every arm ran on every bar.

    it('guarded array.get in a switch arm does not throw (declaration)', async () => {
        const { plots } = await mk().run(
            pine(5, `var a = array.new_float()
x = switch
    array.size(a) > 0 => array.get(a, 0)
    => na
plot(x, "x")`)
        );
        expect(plots['x'].data.every((p) => Number.isNaN(p.value))).toBe(true);
    });

    it('guarded array.get in a switch arm does not throw (reassignment)', async () => {
        const { plots } = await mk().run(
            pine(5, `var a = array.new_float()
float x = na
x := switch
    array.size(a) > 0 => array.get(a, 0)
    => -1
plot(x, "x")`)
        );
        expect(plots['x'].data.every((p) => p.value === -1)).toBe(true);
    });

    it('guarded array.get in a switch arm does not throw (function return)', async () => {
        const { plots } = await mk().run(
            pine(5, `f(arr) =>
    switch
        array.size(arr) > 0 => array.get(arr, 0)
        => na
var a = array.new_float()
plot(f(a), "x")`)
        );
        expect(plots['x'].data.every((p) => Number.isNaN(p.value))).toBe(true);
    });

    it('ta.* in a switch arm only executes on bars where the arm is taken', async () => {
        const { plots } = await mk().run(
            pine(5, `x = switch bar_index % 2
    0 => ta.cum(1)
    => -1
plot(x, "x")`)
        );
        const x = plots['x'].data.map((p) => p.value);
        expect(x.slice(0, 5)).toEqual([1, -1, 2, -1, 3]);
    });
});

describe('PineTS syntax (JavaScript semantics)', () => {
    it('?: and && are lazy', async () => {
        const { plots } = await mk().run(($) => {
            const { array, plot } = $.pine;
            var a = array.new_float();
            const x = array.size(a) > 0 ? array.get(a, 0) : NaN;
            const y = array.size(a) > 0 && array.get(a, 0) > 0;
            plot(x, 'x');
            plot(y ? 1 : 0, 'y');
            return { x, y };
        });
        expect(plots['x'].data.every((p) => Number.isNaN(p.value))).toBe(true);
        expect(plots['y'].data.every((p) => p.value === 0)).toBe(true);
    });
});

describe('unchanged: eager positions still hoist and run every bar', () => {
    it('ta.* in the ternary TEST runs every bar', async () => {
        const { plots } = await mk().run(
            pine(5, `x = ta.cum(1) >= 3 ? 1 : 0
plot(x, "x")`)
        );
        const x = plots['x'].data.map((p) => p.value);
        expect(x.slice(0, 2)).toEqual([0, 0]);
        expect(x[2]).toBe(1);
        expect(x[5]).toBe(1);
    });

    it('ta.* on the LEFT of `and` runs every bar (v6)', async () => {
        const { plots } = await mk().run(
            pine(6, `flag = ta.cum(1) >= 3 and bar_index % 2 == 0
plot(flag ? 1 : 0, "f")`)
        );
        const f = plots['f'].data.map((p) => p.value);
        expect(f[2]).toBe(1);
        expect(f[3]).toBe(0);
        expect(f[4]).toBe(1);
    });
});
