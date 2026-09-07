// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../../Series';
import { FootprintObject } from './FootprintObject';
import { VolumeRowObject } from './VolumeRowObject';
import { resolveArg } from './resolve';

function asFootprint(id: any): FootprintObject | null {
    const resolved = resolveArg(id);
    return resolved instanceof FootprintObject ? resolved : null;
}

/**
 * The `footprint.*` namespace: read-only accessors over the `footprint` object a
 * `request.footprint()` call returns. Every function accepts `na` and answers
 * `na` (or `false`), so scripts that don't guard with `not na(fp)` degrade quietly
 * instead of throwing.
 */
export class FootprintHelper {
    constructor(private context: any) {}

    param(source: any, index: number = 0, _name?: string) {
        return Series.from(source).get(index);
    }

    /** `footprint(x)` — the type-cast form: pass a footprint through, anything else is `na`. */
    any(...args: any[]): FootprintObject | number {
        if (args.length === 1) {
            const value = resolveArg(args[0]);
            return value instanceof FootprintObject ? value : NaN;
        }
        return NaN;
    }

    buy_volume(id: any): number {
        return asFootprint(id)?.buy_volume() ?? NaN;
    }

    sell_volume(id: any): number {
        return asFootprint(id)?.sell_volume() ?? NaN;
    }

    total_volume(id: any): number {
        return asFootprint(id)?.total_volume() ?? NaN;
    }

    delta(id: any): number {
        return asFootprint(id)?.delta() ?? NaN;
    }

    poc(id: any): VolumeRowObject | number {
        return asFootprint(id)?.poc() ?? NaN;
    }

    vah(id: any): VolumeRowObject | number {
        return asFootprint(id)?.vah() ?? NaN;
    }

    val(id: any): VolumeRowObject | number {
        return asFootprint(id)?.val() ?? NaN;
    }

    rows(id: any) {
        return asFootprint(id)?.rows() ?? NaN;
    }

    get_row_by_price(id: any, price: any): VolumeRowObject | number {
        const fp = asFootprint(id);
        if (!fp) return NaN;
        return fp.get_row_by_price(price);
    }
}
