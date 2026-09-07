// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

export interface VolumeRowData {
    /** Lower price boundary of the row. */
    downPrice: number;
    /** Upper price boundary of the row. */
    upPrice: number;
    /** "Buy" volume executed inside the row. */
    buyVolume: number;
    /** "Sell" volume executed inside the row. */
    sellVolume: number;
    /** `buyVolume + sellVolume`, already rounded to Pine precision. */
    totalVolume: number;
    /** `buyVolume - sellVolume`, already rounded to Pine precision. */
    delta: number;
    /** Buy volume exceeds the sell volume of the row BELOW by the imbalance ratio. */
    buyImbalance: boolean;
    /** Sell volume exceeds the buy volume of the row ABOVE by the imbalance ratio. */
    sellImbalance: boolean;
}

/**
 * One row of a bar's volume footprint (Pine's `volume_row` type). Rows are
 * immutable snapshots: every value is fixed when the owning footprint is built,
 * including the imbalance flags, which depend on the NEIGHBOURING rows and on
 * the `imbalance_percent` of the `request.footprint()` call that produced them.
 *
 * Instance methods mirror the `volume_row.*` namespace functions so both Pine
 * call styles work: `volume_row.delta(row)` and `row.delta()`.
 */
export class VolumeRowObject {
    public readonly downPrice: number;
    public readonly upPrice: number;
    public readonly buyVolume: number;
    public readonly sellVolume: number;
    public readonly totalVolume: number;
    public readonly deltaVolume: number;
    public readonly buyImbalance: boolean;
    public readonly sellImbalance: boolean;

    constructor(data: VolumeRowData) {
        this.downPrice = data.downPrice;
        this.upPrice = data.upPrice;
        this.buyVolume = data.buyVolume;
        this.sellVolume = data.sellVolume;
        this.totalVolume = data.totalVolume;
        this.deltaVolume = data.delta;
        this.buyImbalance = data.buyImbalance;
        this.sellImbalance = data.sellImbalance;
    }

    up_price(): number {
        return this.upPrice;
    }

    down_price(): number {
        return this.downPrice;
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

    has_buy_imbalance(): boolean {
        return this.buyImbalance;
    }

    has_sell_imbalance(): boolean {
        return this.sellImbalance;
    }
}
