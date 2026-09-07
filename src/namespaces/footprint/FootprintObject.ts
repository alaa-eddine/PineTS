// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import type { FootprintLevel } from '../../marketData/types';
import { PineArrayObject, PineArrayType } from '../array/PineArrayObject';
import { VolumeRowObject } from './VolumeRowObject';
import { resolveArg } from './resolve';

/** Parameters of the `request.footprint()` call a footprint was built for. */
export interface FootprintParams {
    /** Row height in ticks (`ticks_per_row`). */
    ticksPerRow: number;
    /** `syminfo.mintick` — the size of one tick in price units. */
    mintick: number;
    /** Share of the total volume the value area must contain (`va_percent`). */
    vaPercent: number;
    /** Ratio (in percent) one side must reach against its diagonal neighbour (`imbalance_percent`). */
    imbalancePercent: number;
}

/**
 * Comparison tolerance shared with the transpiled `>=` helper (`math.__ge`), so a
 * row whose buy volume is exactly 3× the neighbour's sell volume still counts as
 * imbalanced when binary rounding lands a hair below the threshold.
 */
const EPSILON = 1e-10;

/** `Math.floor` guarded against values that sit a rounding error below an integer. */
function floorTolerant(x: number): number {
    return Math.floor(x + 1e-6);
}

/**
 * The row a tick falls into. A level's price is the LOW edge of its bucket, so
 * the tick that contains it is `round(price / mintick)`; rows are then
 * `ticks_per_row` consecutive ticks anchored at price 0, which keeps every row of
 * every bar on one shared grid (the same convention as a footprint chart's rows).
 */
function rowIndexOfTick(tickIndex: number, ticksPerRow: number): number {
    return Math.floor(tickIndex / ticksPerRow);
}

/**
 * A bar's volume footprint (Pine's `footprint` type): contiguous rows from the
 * lowest to the highest priced level, each `ticks_per_row × mintick` high, plus
 * the bar-level aggregates derived from them. Built once per bar and parameter
 * set; immutable afterwards.
 *
 * Instance methods mirror the `footprint.*` namespace functions so both Pine
 * call styles work: `footprint.poc(fp)` and `fp.poc()`.
 */
export class FootprintObject {
    /** Rows ascending by price — index 0 is the lowest row. */
    public readonly rowList: readonly VolumeRowObject[];
    public readonly buyVolume: number;
    public readonly sellVolume: number;
    public readonly totalVolume: number;
    public readonly deltaVolume: number;
    /** Index (into `rowList`) of the Point of Control row. */
    public readonly pocIndex: number;
    /** Index of the highest row inside the value area. */
    public readonly vahIndex: number;
    /** Index of the lowest row inside the value area. */
    public readonly valIndex: number;

    private readonly _rowSize: number;
    private readonly _firstRowIndex: number;
    private readonly _context: any;

    private constructor(
        context: any,
        rows: VolumeRowObject[],
        rowSize: number,
        firstRowIndex: number,
        totals: { buy: number; sell: number; total: number; delta: number },
        poc: number,
        va: { lo: number; hi: number },
    ) {
        this._context = context;
        this.rowList = rows;
        this._rowSize = rowSize;
        this._firstRowIndex = firstRowIndex;
        this.buyVolume = totals.buy;
        this.sellVolume = totals.sell;
        this.totalVolume = totals.total;
        this.deltaVolume = totals.delta;
        this.pocIndex = poc;
        this.valIndex = va.lo;
        this.vahIndex = va.hi;
    }

    /**
     * Build the footprint of one bar from its price levels.
     *
     * Returns `null` when the bar has no usable level (no footprint — Pine `na`).
     */
    static build(context: any, levels: readonly FootprintLevel[], params: FootprintParams): FootprintObject | null {
        const precision = (v: number) => context.precision(v);
        const { ticksPerRow, mintick } = params;
        const rowSize = ticksPerRow * mintick;

        // Accumulate per row index; the row grid is anchored at price 0.
        const buyByRow = new Map<number, number>();
        const sellByRow = new Map<number, number>();
        let minRow = Infinity;
        let maxRow = -Infinity;
        for (const level of levels) {
            if (!level || !Number.isFinite(level.price)) continue;
            const buy = Number.isFinite(level.buyVolume) ? level.buyVolume : 0;
            const sell = Number.isFinite(level.sellVolume) ? level.sellVolume : 0;
            const row = rowIndexOfTick(Math.round(level.price / mintick), ticksPerRow);
            buyByRow.set(row, (buyByRow.get(row) ?? 0) + buy);
            sellByRow.set(row, (sellByRow.get(row) ?? 0) + sell);
            if (row < minRow) minRow = row;
            if (row > maxRow) maxRow = row;
        }
        if (!Number.isFinite(minRow)) return null;

        const count = maxRow - minRow + 1;
        const buys = new Array<number>(count);
        const sells = new Array<number>(count);
        const totals = new Array<number>(count);
        let sumBuy = 0;
        let sumSell = 0;
        for (let i = 0; i < count; i++) {
            const buy = buyByRow.get(minRow + i) ?? 0;
            const sell = sellByRow.get(minRow + i) ?? 0;
            buys[i] = buy;
            sells[i] = sell;
            totals[i] = buy + sell;
            sumBuy += buy;
            sumSell += sell;
        }

        // Point of Control: the row with the most total volume; on a tie the
        // lowest row wins (first encountered scanning upward).
        let poc = 0;
        for (let i = 1; i < count; i++) {
            if (totals[i] > totals[poc] + EPSILON) poc = i;
        }

        // Value area: grow outward from the POC one row at a time, always taking
        // the adjacent row with the larger volume (ties expand upward), until the
        // area holds `va_percent` of the bar's volume.
        const grandTotal = sumBuy + sumSell;
        const target = (grandTotal * params.vaPercent) / 100;
        let lo = poc;
        let hi = poc;
        let inArea = totals[poc];
        while (inArea + EPSILON < target && (lo > 0 || hi < count - 1)) {
            const above = hi < count - 1 ? totals[hi + 1] : -Infinity;
            const below = lo > 0 ? totals[lo - 1] : -Infinity;
            if (above + EPSILON >= below) {
                hi++;
                inArea += above;
            } else {
                lo--;
                inArea += below;
            }
        }

        // Imbalances are diagonal: a row's buys against the sells one row below,
        // its sells against the buys one row above. The extreme rows have no
        // counterpart on that side and never flag there.
        const ratio = params.imbalancePercent / 100;
        const rows: VolumeRowObject[] = new Array(count);
        for (let i = 0; i < count; i++) {
            const buy = buys[i];
            const sell = sells[i];
            const buyImbalance = i > 0 && buy > 0 && buy + EPSILON >= ratio * sells[i - 1];
            const sellImbalance = i < count - 1 && sell > 0 && sell + EPSILON >= ratio * buys[i + 1];
            const downPrice = precision((minRow + i) * rowSize);
            const upPrice = precision((minRow + i + 1) * rowSize);
            rows[i] = new VolumeRowObject({
                downPrice,
                upPrice,
                buyVolume: precision(buy),
                sellVolume: precision(sell),
                totalVolume: precision(buy + sell),
                delta: precision(buy - sell),
                buyImbalance,
                sellImbalance,
            });
        }

        return new FootprintObject(
            context,
            rows,
            rowSize,
            minRow,
            { buy: precision(sumBuy), sell: precision(sumSell), total: precision(grandTotal), delta: precision(sumBuy - sumSell) },
            poc,
            { lo, hi },
        );
    }

    buy_volume(): number {
        return this.buyVolume;
    }

    sell_volume(): number {
        return this.sellVolume;
    }

    total_volume(): number {
        return this.totalVolume;
    }

    delta(): number {
        return this.deltaVolume;
    }

    poc(): VolumeRowObject {
        return this.rowList[this.pocIndex];
    }

    vah(): VolumeRowObject {
        return this.rowList[this.vahIndex];
    }

    val(): VolumeRowObject {
        return this.rowList[this.valIndex];
    }

    /** A NEW Pine array of the rows, lowest first — callers may mutate it freely. */
    rows(): PineArrayObject {
        return new PineArrayObject([...this.rowList], PineArrayType.any, this._context);
    }

    /** The row whose `[down_price, up_price)` range contains `price`; `na` outside the footprint. */
    get_row_by_price(priceArg: any): VolumeRowObject | number {
        const price = resolveArg(priceArg);
        if (typeof price !== 'number' || !Number.isFinite(price)) return NaN;
        const index = floorTolerant(price / this._rowSize) - this._firstRowIndex;
        if (index < 0 || index >= this.rowList.length) return NaN;
        return this.rowList[index];
    }
}
