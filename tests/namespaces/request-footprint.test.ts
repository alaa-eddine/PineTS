import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import type { FootprintBar } from '../../src/marketData/types';

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: 6 one-minute bars, syminfo.mintick = 0.5. Footprint data exists for
// bars 1..4 only (bar 0 and the last bar have none → `na`).
//
// Bar 2 is the hand-computed reference. With ticks_per_row = 2 (row = 1.0):
//
//   level 100.0  b10 s5  ┐
//   level 100.5  b20 s5  ┘ row0 [100,101)  buy 30  sell 10  total 40
//   level 101.0  b5  s40 ┐
//   level 101.5  b0  s10 ┘ row1 [101,102)  buy  5  sell 50  total 55
//   level 102.0  b60 s6    row2 [102,103)  buy 60  sell  6  total 66  ← POC
//   (no level)             row3 [103,104)  buy  0  sell  0  total  0
//   level 104.5  b20 s1    row4 [104,105)  buy 20  sell  1  total 21
//
//   totals: buy 115, sell 67, total 182, delta 48
//   VA 70% (target 127.4): start row2 (66) → below row1 (55) = 121 → below row0
//   (40) = 161 ≥ 127.4  ⇒  VAL = row0, VAH = row2
//   imbalance 300%: row2 sell 6 ≥ 3 × buys[row3]=0 → sell imbalance;
//                   row4 buy 20 ≥ 3 × sells[row3]=0 → buy imbalance; nothing else.
// ─────────────────────────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

function makeCandle(i: number) {
    const close = 102 + i * 0.5;
    return { openTime: T0 + i * MINUTE, closeTime: T0 + (i + 1) * MINUTE, open: close - 0.5, high: close + 2, low: close - 2, close, volume: 100 };
}

const REFERENCE_LEVELS = [
    { price: 100.0, buyVolume: 10, sellVolume: 5 },
    { price: 100.5, buyVolume: 20, sellVolume: 5 },
    { price: 101.0, buyVolume: 5, sellVolume: 40 },
    { price: 101.5, buyVolume: 0, sellVolume: 10 },
    { price: 102.0, buyVolume: 60, sellVolume: 6 },
    { price: 104.5, buyVolume: 20, sellVolume: 1 },
];

/** Footprints for bars 1..4; bar 2 carries the reference levels, the others a single level. */
function makeFootprints(): FootprintBar[] {
    return [1, 2, 3, 4].map((i) => ({
        openTime: T0 + i * MINUTE,
        tick: 0.5,
        levels: i === 2 ? REFERENCE_LEVELS : [{ price: 100 + i, buyVolume: i * 10, sellVolume: i }],
    }));
}

function makeProvider(candles: any[], footprints: FootprintBar[] | null, log: any[] = []) {
    return {
        getMarketData: async (_t: string, _tf: string, _limit?: number, sDate?: number) =>
            sDate === undefined ? candles : candles.filter((c) => c.openTime >= sDate),
        getSymbolInfo: async () => ({ ticker: 'TEST', tickerid: 'TEST', mintick: 0.5, pricescale: 2, minmove: 1, timezone: 'UTC', session: '24x7' }),
        ...(footprints
            ? {
                  getFootprintData: async (ticker: string, tf: string, limit?: number, sDate?: number, eDate?: number) => {
                      log.push({ ticker, tf, limit, sDate, eDate });
                      return footprints.filter((b) => (sDate === undefined || b.openTime >= sDate) && (eDate === undefined || b.openTime < eDate));
                  },
              }
            : {}),
    };
}

const last = (arr: any[]) => arr[arr.length - 1];
const nth = (ctx: any, key: string, i: number) => ctx.result[key][i];

describe('request.footprint — bar-level aggregates', () => {
    it('sums buy/sell volume, total and delta over the bar, and is na where the source has no bar', async () => {
        const candles = Array.from({ length: 6 }, (_, i) => makeCandle(i));
        const log: any[] = [];
        const pine = new PineTS(makeProvider(candles, makeFootprints(), log) as any, 'TEST', '1');
        await pine.ready();

        const ctx = await pine.run(($: any) => {
            const { request, footprint, na } = $.pine;
            const fp = request.footprint(2, 70, 300);
            const missing = na(fp);
            const buy = footprint.buy_volume(fp);
            const sell = footprint.sell_volume(fp);
            const total = footprint.total_volume(fp);
            const delta = footprint.delta(fp);
            return { missing, buy, sell, total, delta };
        });

        expect(ctx.result.missing).toEqual([true, false, false, false, false, true]);
        expect(nth(ctx, 'buy', 2)).toBe(115);
        expect(nth(ctx, 'sell', 2)).toBe(67);
        expect(nth(ctx, 'total', 2)).toBe(182);
        expect(nth(ctx, 'delta', 2)).toBe(48);
        // Bars without footprint data answer na on every accessor.
        expect(nth(ctx, 'buy', 0)).toBeNaN();
        expect(nth(ctx, 'delta', 5)).toBeNaN();
        // One request for the whole loaded history, sized like the kline load.
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ ticker: 'TEST', tf: '1', limit: 6, sDate: T0, eDate: T0 + 6 * MINUTE });
    });

    it('returns na on every bar (with a single warning) when the source has no footprint surface', async () => {
        const candles = Array.from({ length: 4 }, (_, i) => makeCandle(i));
        const pine = new PineTS(makeProvider(candles, null) as any, 'TEST', '1');
        await pine.ready();

        const ctx = await pine.run(($: any) => {
            const { request, footprint, na } = $.pine;
            const fp = request.footprint(2);
            const missing = na(fp);
            const delta = footprint.delta(fp);
            return { missing, delta };
        });

        expect(ctx.result.missing).toEqual([true, true, true, true]);
        expect(ctx.result.delta.every((v: number) => Number.isNaN(v))).toBe(true);
        expect(ctx.warnings.filter((w: any) => w.method === 'request.footprint')).toHaveLength(1);
    });

    it('rejects a non-positive ticks_per_row', async () => {
        const candles = Array.from({ length: 2 }, (_, i) => makeCandle(i));
        const pine = new PineTS(makeProvider(candles, makeFootprints()) as any, 'TEST', '1');
        await pine.ready();
        await expect(
            pine.run(($: any) => {
                const { request } = $.pine;
                const fp = request.footprint(0);
                return { fp };
            }),
        ).rejects.toThrow(/ticks_per_row/);
    });
});

describe('request.footprint — rows, POC, value area, imbalances', () => {
    async function runReference(script: (pine: any) => any) {
        const candles = Array.from({ length: 6 }, (_, i) => makeCandle(i));
        const pine = new PineTS(makeProvider(candles, makeFootprints()) as any, 'TEST', '1');
        await pine.ready();
        return pine.run(script);
    }

    it('bins levels into ticks_per_row × mintick rows, contiguous from the lowest to the highest level', async () => {
        const ctx = await runReference(($: any) => {
            const { request, footprint, volume_row, array, na } = $.pine;
            const fp = request.footprint(2);
            let n = NaN;
            let r0_down = NaN;
            let r0_up = NaN;
            let r0_buy = NaN;
            let r0_sell = NaN;
            let r0_total = NaN;
            let r1_delta = NaN;
            let r3_total = NaN;
            let r4_down = NaN;
            let r4_up = NaN;
            if (!na(fp)) {
                const rows = footprint.rows(fp);
                n = array.size(rows);
                const r0 = array.get(rows, 0);
                r0_down = volume_row.down_price(r0);
                r0_up = volume_row.up_price(r0);
                r0_buy = volume_row.buy_volume(r0);
                r0_sell = volume_row.sell_volume(r0);
                r0_total = volume_row.total_volume(r0);
                if (n > 4) {
                    const r1 = array.get(rows, 1);
                    const r3 = array.get(rows, 3);
                    r1_delta = volume_row.delta(r1);
                    const r4 = array.get(rows, 4);
                    r3_total = volume_row.total_volume(r3);
                    r4_down = volume_row.down_price(r4);
                    r4_up = volume_row.up_price(r4);
                }
            }
            return { n, r0_down, r0_up, r0_buy, r0_sell, r0_total, r1_delta, r3_total, r4_down, r4_up };
        });

        expect(nth(ctx, 'n', 2)).toBe(5);
        expect(nth(ctx, 'r0_down', 2)).toBe(100);
        expect(nth(ctx, 'r0_up', 2)).toBe(101);
        expect(nth(ctx, 'r0_buy', 2)).toBe(30);
        expect(nth(ctx, 'r0_sell', 2)).toBe(10);
        expect(nth(ctx, 'r0_total', 2)).toBe(40);
        expect(nth(ctx, 'r1_delta', 2)).toBe(-45);
        // The empty row between 102-103 and 104-105 exists with zero volume.
        expect(nth(ctx, 'r3_total', 2)).toBe(0);
        expect(nth(ctx, 'r4_down', 2)).toBe(104);
        expect(nth(ctx, 'r4_up', 2)).toBe(105);
        // Bars with a single level yield exactly one row; bars without data yield na.
        expect(nth(ctx, 'n', 1)).toBe(1);
        expect(nth(ctx, 'n', 0)).toBeNaN();
    });

    it('finds the POC and the value area boundaries', async () => {
        const ctx = await runReference(($: any) => {
            const { request, footprint, volume_row } = $.pine;
            const fp = request.footprint(2, 70);
            const poc = footprint.poc(fp);
            const vah = footprint.vah(fp);
            const val = footprint.val(fp);
            const poc_down = volume_row.down_price(poc);
            const poc_total = volume_row.total_volume(poc);
            const vah_up = volume_row.up_price(vah);
            const val_down = volume_row.down_price(val);
            return { poc_down, poc_total, vah_up, val_down };
        });

        expect(nth(ctx, 'poc_down', 2)).toBe(102);
        expect(nth(ctx, 'poc_total', 2)).toBe(66);
        expect(nth(ctx, 'vah_up', 2)).toBe(103);
        expect(nth(ctx, 'val_down', 2)).toBe(100);
    });

    it('flags diagonal imbalances against the imbalance_percent of the request', async () => {
        const ctx = await runReference(($: any) => {
            const { request, footprint, volume_row, array, na } = $.pine;
            const fp = request.footprint(2, 70, 300);
            let buy = '';
            let sell = '';
            if (!na(fp)) {
                const rows = footprint.rows(fp);
                for (let i = 0; i < array.size(rows); i++) {
                    const row = array.get(rows, i);
                    buy = buy + (volume_row.has_buy_imbalance(row) ? '1' : '0');
                    sell = sell + (volume_row.has_sell_imbalance(row) ? '1' : '0');
                }
            }
            return { buy, sell };
        });

        expect(nth(ctx, 'buy', 2)).toBe('00001');
        expect(nth(ctx, 'sell', 2)).toBe('00100');
    });

    it('lowers the imbalance bar when imbalance_percent is 100', async () => {
        const ctx = await runReference(($: any) => {
            const { request, footprint, volume_row, array, na } = $.pine;
            const fp = request.footprint(2, 70, 100);
            let buy = '';
            let sell = '';
            if (!na(fp)) {
                const rows = footprint.rows(fp);
                for (let i = 0; i < array.size(rows); i++) {
                    const row = array.get(rows, i);
                    buy = buy + (volume_row.has_buy_imbalance(row) ? '1' : '0');
                    sell = sell + (volume_row.has_sell_imbalance(row) ? '1' : '0');
                }
            }
            return { buy, sell };
        });

        // ratio 1: row2 buy 60 ≥ sells[row1] 50; row4 buy 20 ≥ 0
        //          row0 sell 10 ≥ buys[row1] 5; row2 sell 6 ≥ 0
        expect(nth(ctx, 'buy', 2)).toBe('00101');
        expect(nth(ctx, 'sell', 2)).toBe('10100');
    });

    it('resolves a price to the row whose [down_price, up_price) range contains it', async () => {
        const ctx = await runReference(($: any) => {
            const { request, footprint, volume_row, na } = $.pine;
            const fp = request.footprint(2);
            const inside = volume_row.down_price(footprint.get_row_by_price(fp, 101.7));
            const lowEdge = volume_row.down_price(footprint.get_row_by_price(fp, 100));
            const topRow = volume_row.down_price(footprint.get_row_by_price(fp, 104.99));
            const emptyRow = volume_row.total_volume(footprint.get_row_by_price(fp, 103.2));
            const above = na(footprint.get_row_by_price(fp, 105));
            const below = na(footprint.get_row_by_price(fp, 99.9));
            return { inside, lowEdge, topRow, emptyRow, above, below };
        });

        expect(nth(ctx, 'inside', 2)).toBe(101);
        expect(nth(ctx, 'lowEdge', 2)).toBe(100);
        expect(nth(ctx, 'topRow', 2)).toBe(104);
        expect(nth(ctx, 'emptyRow', 2)).toBe(0);
        expect(nth(ctx, 'above', 2)).toBe(true);
        expect(nth(ctx, 'below', 2)).toBe(true);
    });

    it('breaks POC ties toward the lowest row and value-area ties upward', async () => {
        // ticks_per_row = 1 → rows of 0.5; totals per row: 20, 30, 30, 20 (sum 100)
        const candles = Array.from({ length: 2 }, (_, i) => makeCandle(i));
        const footprints: FootprintBar[] = [
            {
                openTime: T0 + MINUTE,
                levels: [
                    { price: 100.0, buyVolume: 10, sellVolume: 10 },
                    { price: 100.5, buyVolume: 15, sellVolume: 15 },
                    { price: 101.0, buyVolume: 15, sellVolume: 15 },
                    { price: 101.5, buyVolume: 10, sellVolume: 10 },
                ],
            },
        ];
        const pine = new PineTS(makeProvider(candles, footprints) as any, 'TEST', '1');
        await pine.ready();
        const ctx = await pine.run(($: any) => {
            const { request, footprint, volume_row } = $.pine;
            const fp = request.footprint(1, 70);
            const poc = volume_row.down_price(footprint.poc(fp));
            const val = volume_row.down_price(footprint.val(fp));
            const vah = volume_row.up_price(footprint.vah(fp));
            return { poc, val, vah };
        });
        // POC: the lower of the two 30-volume rows (100.5-101.0).
        // VA (target 70): 30 → above wins 30 vs 20 → 60 → 20 vs 20 is a tie → up → 80.
        expect(last(ctx.result.poc)).toBe(100.5);
        expect(last(ctx.result.val)).toBe(100.5);
        expect(last(ctx.result.vah)).toBe(102);
    });
});

describe('request.footprint — Pine Script v6 syntax', () => {
    const plotAt = (ctx: any, title: string, i: number) => ctx.plots[title].data[i].value;

    async function runPine(source: string) {
        const candles = Array.from({ length: 6 }, (_, i) => makeCandle(i));
        const pine = new PineTS(makeProvider(candles, makeFootprints()) as any, 'TEST', '1');
        await pine.ready();
        return pine.run(source);
    }

    it('supports the typed declarations, method-call syntax and row iteration of the reference manual', async () => {
        const ctx = await runPine(`//@version=6
indicator("Footprint", overlay = true)
int ticks = input.int(2, "Ticks per row")
footprint fp = request.footprint(ticks, 70, 300)
float d = na
float pocUp = na
float vahUp = na
float valDown = na
int n = na
int buyImb = 0
int sellImb = 0
float rowAtClose = na
if not na(fp)
    d := fp.delta()
    volume_row poc = fp.poc()
    pocUp := poc.up_price()
    vahUp := fp.vah().up_price()
    valDown := fp.val().down_price()
    array<volume_row> rows = fp.rows()
    n := array.size(rows)
    for row in rows
        if row.has_buy_imbalance()
            buyImb += 1
        if row.has_sell_imbalance()
            sellImb += 1
    volume_row atClose = fp.get_row_by_price(101.5)
    rowAtClose := volume_row.total_volume(atClose)
plot(d, "d")
plot(pocUp, "pocUp")
plot(vahUp, "vahUp")
plot(valDown, "valDown")
plot(n, "n")
plot(buyImb, "buyImb")
plot(sellImb, "sellImb")
plot(rowAtClose, "rowAtClose")
`);
        expect(plotAt(ctx, 'd', 2)).toBe(48);
        expect(plotAt(ctx, 'pocUp', 2)).toBe(103);
        expect(plotAt(ctx, 'vahUp', 2)).toBe(103);
        expect(plotAt(ctx, 'valDown', 2)).toBe(100);
        expect(plotAt(ctx, 'n', 2)).toBe(5);
        expect(plotAt(ctx, 'buyImb', 2)).toBe(1);
        expect(plotAt(ctx, 'sellImb', 2)).toBe(1);
        expect(plotAt(ctx, 'rowAtClose', 2)).toBe(55);
        // Bars without data keep the na defaults.
        expect(plotAt(ctx, 'd', 0)).toBeNaN();
        expect(plotAt(ctx, 'n', 5)).toBeNaN();
        expect(plotAt(ctx, 'buyImb', 5)).toBe(0);
    });

    it('treats footprint ids as series (history access), supports type casts, typed arrays and user methods', async () => {
        const ctx = await runPine(`//@version=6
indicator("Footprint types")
method doubledBuy(volume_row row) => row.buy_volume() * 2
var array<volume_row> pocs = array.new<volume_row>()
footprint fp = request.footprint(2)
footprint prev = fp[1]
footprint casted = footprint(na)
volume_row rowCast = volume_row(na)
float prevDelta = na(prev) ? na : prev.delta()
float pocDoubled = na
if not na(fp)
    volume_row poc = fp.poc()
    array.push(pocs, poc)
    pocDoubled := poc.doubledBuy()
plot(prevDelta, "prevDelta")
plot(na(casted) ? 1 : 0, "castedNa")
plot(na(rowCast) ? 1 : 0, "rowCastNa")
plot(array.size(pocs), "pocs")
plot(pocDoubled, "pocDoubled")
`);
        // Bar 3 sees bar 2's footprint through fp[1].
        expect(plotAt(ctx, 'prevDelta', 3)).toBe(48);
        expect(plotAt(ctx, 'prevDelta', 1)).toBeNaN();
        expect(plotAt(ctx, 'castedNa', 2)).toBe(1);
        expect(plotAt(ctx, 'rowCastNa', 2)).toBe(1);
        // One POC pushed per bar with data (bars 1..4).
        expect(plotAt(ctx, 'pocs', 5)).toBe(4);
        expect(plotAt(ctx, 'pocDoubled', 2)).toBe(120);
    });

    it('dispatches user methods on UNTYPED footprint / volume_row variables (static type inferred from the producing call)', async () => {
        const ctx = await runPine(`//@version=6
indicator("Footprint inference")
method halfDelta(footprint f) => f.delta() / 2
method rowRange(volume_row r) => r.up_price() - r.down_price()
fp = request.footprint(2)
float half = na
float span = na
if not na(fp)
    half := fp.halfDelta()
    poc = footprint.poc(fp)
    span := poc.rowRange()
plot(half, "half")
plot(span, "span")
`);
        expect(plotAt(ctx, 'half', 2)).toBe(24);
        expect(plotAt(ctx, 'span', 2)).toBe(1);
        expect(plotAt(ctx, 'half', 0)).toBeNaN();
    });
});

describe('request.footprint — live updates', () => {
    it('re-reads the forming bar from the source after a market data update', async () => {
        const N = 4;
        const candles = Array.from({ length: N }, (_, i) => makeCandle(i));
        const lastOpen = candles[N - 1].openTime;
        // The forming bar's footprint grows between polls: one level first, two later.
        let phase = 0;
        const footprintsFor = (): FootprintBar[] => [
            { openTime: candles[1].openTime, levels: [{ price: 100, buyVolume: 1, sellVolume: 1 }] },
            {
                openTime: lastOpen,
                levels:
                    phase === 0
                        ? [{ price: 103, buyVolume: 10, sellVolume: 4 }]
                        : [
                              { price: 103, buyVolume: 10, sellVolume: 4 },
                              { price: 103.5, buyVolume: 7, sellVolume: 3 },
                          ],
            },
        ];
        const log: any[] = [];
        const provider = {
            getMarketData: async (_t: string, _tf: string, _l?: number, sDate?: number) => {
                if (sDate !== undefined && sDate >= lastOpen) return [{ ...candles[N - 1], close: candles[N - 1].close + 0.5 }];
                return candles;
            },
            getSymbolInfo: async () => ({ ticker: 'TEST', mintick: 0.5 }),
            getFootprintData: async (_t: string, _tf: string, _l?: number, sDate?: number) => {
                log.push(sDate);
                return footprintsFor().filter((b) => sDate === undefined || b.openTime >= sDate);
            },
        };
        const pine = new PineTS(provider as any, 'TEST', '1');
        await pine.ready();

        const ctx = await pine.run(($: any) => {
            const { request, footprint } = $.pine;
            const fp = request.footprint(1);
            const delta = footprint.delta(fp);
            const total = footprint.total_volume(fp);
            return { delta, total };
        });
        expect(last(ctx.result.delta)).toBe(6);
        expect(last(ctx.result.total)).toBe(14);
        // The initial load spans the whole history, from the first bar's openTime.
        expect(log).toEqual([T0]);

        phase = 1;
        expect(await pine.updateTail(ctx)).toBe(true);
        // Only the tail was re-requested, from the forming bar's openTime.
        expect(log).toEqual([T0, lastOpen]);
        expect(last(ctx.result.delta)).toBe(10);
        expect(last(ctx.result.total)).toBe(24);
        // History is untouched.
        expect(ctx.result.total[1]).toBe(2);
    });
});
