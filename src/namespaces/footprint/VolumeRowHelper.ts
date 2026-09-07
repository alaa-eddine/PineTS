// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../../Series';
import { VolumeRowObject } from './VolumeRowObject';
import { resolveArg } from './resolve';

function asRow(id: any): VolumeRowObject | null {
    const resolved = resolveArg(id);
    return resolved instanceof VolumeRowObject ? resolved : null;
}

/**
 * The `volume_row.*` namespace: read-only accessors over one footprint row. As
 * with `footprint.*`, an `na` id yields `na` (numeric getters) or `false`
 * (imbalance predicates) rather than a runtime error.
 */
export class VolumeRowHelper {
    constructor(private context: any) {}

    param(source: any, index: number = 0, _name?: string) {
        return Series.from(source).get(index);
    }

    /** `volume_row(x)` — the type-cast form: pass a row through, anything else is `na`. */
    any(...args: any[]): VolumeRowObject | number {
        if (args.length === 1) {
            const value = resolveArg(args[0]);
            return value instanceof VolumeRowObject ? value : NaN;
        }
        return NaN;
    }

    up_price(id: any): number {
        return asRow(id)?.up_price() ?? NaN;
    }

    down_price(id: any): number {
        return asRow(id)?.down_price() ?? NaN;
    }

    buy_volume(id: any): number {
        return asRow(id)?.buy_volume() ?? NaN;
    }

    sell_volume(id: any): number {
        return asRow(id)?.sell_volume() ?? NaN;
    }

    total_volume(id: any): number {
        return asRow(id)?.total_volume() ?? NaN;
    }

    delta(id: any): number {
        return asRow(id)?.delta() ?? NaN;
    }

    has_buy_imbalance(id: any): boolean {
        return asRow(id)?.has_buy_imbalance() ?? false;
    }

    has_sell_imbalance(id: any): boolean {
        return asRow(id)?.has_sell_imbalance() ?? false;
    }
}
