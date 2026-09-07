import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '../../../src/marketData/Provider.class';

// ta.max(source) / ta.min(source): all-time (trailing) high / low of `source`
// from the first bar of the chart up to the current bar.
//
// Expected values below are derived independently of the implementation:
// either by hand from a synthetic step series, or by a plain JS running
// max/min over the raw `close` series that the script also plots.

function mk(from = '2024-01-01', to = '2024-01-05') {
    return new PineTS(Provider.Mock, 'BTCUSDC', '60', null, new Date(from).getTime(), new Date(to).getTime());
}

describe('ta.max / ta.min - trailing maximum / minimum', () => {
    it('tracks a hand-built step series', async () => {
        const { plots } = await mk().run(`//@version=5
indicator("t")
// 0,0,0,100,0,0,0,-50,0,0,...  -> max steps up at bar 3, min steps down at bar 7
s = bar_index == 3 ? 100 : bar_index == 7 ? -50 : 0
plot(ta.max(s), "mx")
plot(ta.min(s), "mn")`);

        const mx = plots['mx'].data.map((p) => p.value);
        const mn = plots['mn'].data.map((p) => p.value);
        expect(mx.length).toBeGreaterThan(10);

        // Hand-derived expectations
        expect(mx.slice(0, 3)).toEqual([0, 0, 0]);
        expect(mx[3]).toBe(100);
        expect(mx.slice(3).every((v) => v === 100)).toBe(true);

        expect(mn.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(mn[7]).toBe(-50);
        expect(mn.slice(7).every((v) => v === -50)).toBe(true);
    });

    it('matches an independent running max/min over close', async () => {
        const { plots } = await mk('2024-01-01', '2024-01-10').run(`//@version=5
indicator("t")
plot(close, "c")
plot(ta.max(close), "mx")
plot(ta.min(close), "mn")`);

        const c = plots['c'].data.map((p) => p.value);
        const mx = plots['mx'].data.map((p) => p.value);
        const mn = plots['mn'].data.map((p) => p.value);
        expect(c.length).toBeGreaterThan(100);

        let runMax = -Infinity;
        let runMin = Infinity;
        for (let i = 0; i < c.length; i++) {
            runMax = Math.max(runMax, c[i]);
            runMin = Math.min(runMin, c[i]);
            expect(mx[i]).toBeCloseTo(runMax, 8);
            expect(mn[i]).toBeCloseTo(runMin, 8);
        }
        // The trailing max/min must never move the "wrong" way
        for (let i = 1; i < c.length; i++) {
            expect(mx[i]).toBeGreaterThanOrEqual(mx[i - 1]);
            expect(mn[i]).toBeLessThanOrEqual(mn[i - 1]);
        }
    });

    it('returns na until the first non-na value and ignores later na values', async () => {
        const { plots } = await mk().run(`//@version=5
indicator("t")
// na for bars 0-2, then a spike, then na again on bar 5 which must not reset/poison the result
s = bar_index < 3 ? na : bar_index == 4 ? 500 : bar_index == 5 ? na : bar_index == 6 ? -5 : 10
plot(ta.max(s), "mx")
plot(ta.min(s), "mn")`);

        const mx = plots['mx'].data.map((p) => p.value);
        const mn = plots['mn'].data.map((p) => p.value);

        expect(mx.slice(0, 3).every((v) => Number.isNaN(v))).toBe(true);
        expect(mn.slice(0, 3).every((v) => Number.isNaN(v))).toBe(true);
        // bar 3: 10
        expect(mx[3]).toBe(10);
        expect(mn[3]).toBe(10);
        // bar 4: 500
        expect(mx[4]).toBe(500);
        expect(mn[4]).toBe(10);
        // bar 5: na input -> carry previous
        expect(mx[5]).toBe(500);
        expect(mn[5]).toBe(10);
        // bar 6: -5
        expect(mx[6]).toBe(500);
        expect(mn[6]).toBe(-5);
        // afterwards stable
        expect(mx[mx.length - 1]).toBe(500);
        expect(mn[mn.length - 1]).toBe(-5);
    });

    it('keeps independent state across multiple call sites', async () => {
        const { plots } = await mk().run(`//@version=5
indicator("t")
a = bar_index == 2 ? 7 : 1
b = bar_index == 4 ? 3 : 1
plot(ta.max(a), "ma")
plot(ta.max(b), "mb")
plot(ta.min(a), "na")
plot(ta.min(b), "nb")`);

        const last = (k: string) => plots[k].data[plots[k].data.length - 1].value;
        expect(last('ma')).toBe(7);
        expect(last('mb')).toBe(3);
        expect(last('na')).toBe(1);
        expect(last('nb')).toBe(1);
        // ma must jump at bar 2, mb at bar 4 — proves the two calls don't share state
        expect(plots['ma'].data[2].value).toBe(7);
        expect(plots['mb'].data[2].value).toBe(1);
        expect(plots['mb'].data[4].value).toBe(3);
    });

    it('works via the PineTS ($) syntax as well', async () => {
        const { plots } = await mk().run(($) => {
            const { close } = $.data;
            const { ta, plot } = $.pine;
            const mx = ta.max(close);
            const mn = ta.min(close);
            plot(mx, 'mx');
            plot(mn, 'mn');
            plot(close, 'c');
            return { mx, mn };
        });
        const c = plots['c'].data.map((p) => p.value);
        expect(plots['mx'].data[plots['mx'].data.length - 1].value).toBeCloseTo(Math.max(...c), 8);
        expect(plots['mn'].data[plots['mn'].data.length - 1].value).toBeCloseTo(Math.min(...c), 8);
    });
});
