// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../../../Series';
import { hasFootprintData } from '../../../marketData/IProvider';
import type { FootprintBar } from '../../../marketData/types';
import { parseArgsForPineParams } from '../../utils';
import { FootprintObject } from '../../footprint/FootprintObject';

// Pine signature (v6):
//   request.footprint(ticks_per_row, va_percent, imbalance_percent) → footprint
const FOOTPRINT_SIGNATURES = [['ticks_per_row'], ['ticks_per_row', 'va_percent'], ['ticks_per_row', 'va_percent', 'imbalance_percent']];
const FOOTPRINT_TYPES = {
    ticks_per_row: 'series',
    va_percent: 'series',
    imbalance_percent: 'series',
};

const DEFAULT_VA_PERCENT = 70;
const DEFAULT_IMBALANCE_PERCENT = 300;

/** `request.param` hands every argument over as a `[value, name]` tuple. */
function unwrapParam(value: any): any {
    return Array.isArray(value) && value.length === 2 && typeof value[1] === 'string' ? value[0] : value;
}

function toNumber(value: any): number {
    const v = unwrapParam(value);
    if (v instanceof Series) return v.get(0);
    return typeof v === 'number' ? v : NaN;
}

/**
 * The per-context footprint store: the provider's bars keyed by `openTime`, the
 * built `footprint` objects keyed by bar and parameter set, and the market-data
 * version the store reflects (a bump means the tail must be refreshed).
 */
interface FootprintStore {
    bars: Map<number, FootprintBar>;
    built: Map<number, Map<string, FootprintObject | null>>;
    loadedVersion: number;
    warned: boolean;
}

function storeOf(context: any): FootprintStore {
    if (!context.cache.__footprint) {
        context.cache.__footprint = { bars: new Map(), built: new Map(), loadedVersion: -1, warned: false } satisfies FootprintStore;
    }
    return context.cache.__footprint;
}

function warnOnce(context: any, store: FootprintStore, message: string) {
    if (store.warned) return;
    store.warned = true;
    context.warn(message, 'request.footprint');
}

/**
 * Pull footprint bars from the provider into the store. The first load covers
 * the whole loaded history in one request; later loads (after the market data
 * changed — a forming bar ticked or new bars arrived) only ask from `fromTime`
 * onward. Every bar the provider returns REPLACES what the store held for that
 * `openTime` (footprints of a forming bar grow between polls).
 */
async function load(context: any, store: FootprintStore, fromTime: number | undefined) {
    const marketData: any[] = context.marketData ?? [];
    const first = marketData[0];
    const last = marketData[marketData.length - 1];
    const initial = fromTime === undefined;
    const sDate = initial ? first?.openTime : fromTime;
    const eDate = initial ? (last?.closeTime ?? context.eDate) : undefined;
    const limit = initial ? marketData.length : undefined;

    let bars: FootprintBar[] = [];
    try {
        bars = (await context.source.getFootprintData(context.tickerId, context.timeframe, limit, sDate, eDate)) ?? [];
    } catch (error) {
        warnOnce(
            context,
            store,
            `request.footprint(): footprint data could not be loaded (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    for (const bar of bars) {
        if (!bar || !Number.isFinite(bar.openTime)) continue;
        store.bars.set(bar.openTime, bar);
        store.built.delete(bar.openTime);
    }
    store.loadedVersion = context.dataVersion;
}

/**
 * `request.footprint(ticks_per_row, va_percent = 70, imbalance_percent = 300) → footprint`
 *
 * The volume footprint of the CURRENT bar, or `na` when the data source has none
 * for it. Footprint data comes from the provider's optional `getFootprintData`
 * surface (see `IFootprintProvider`); the row binning, POC, value area and
 * imbalance flags are computed here so every source shares one set of Pine
 * semantics. Secondary contexts (inside `request.security`) always answer `na` —
 * Pine does not allow nesting request calls.
 */
export function footprint(context: any) {
    return async (...rawArgs: any[]) => {
        if (context.isSecondaryContext) return NaN;

        const parsed = parseArgsForPineParams<any>(rawArgs.map(unwrapParam), FOOTPRINT_SIGNATURES, FOOTPRINT_TYPES);
        const ticksPerRow = toNumber(parsed.ticks_per_row);
        if (!Number.isFinite(ticksPerRow) || ticksPerRow < 1) {
            throw new Error(`request.footprint(): ticks_per_row must be a positive integer, got ${ticksPerRow}`);
        }
        const vaRaw = toNumber(parsed.va_percent);
        const vaPercent = Number.isFinite(vaRaw) ? Math.min(Math.max(vaRaw, 0), 100) : DEFAULT_VA_PERCENT;
        const imbRaw = toNumber(parsed.imbalance_percent);
        const imbalancePercent = Number.isFinite(imbRaw) && imbRaw > 0 ? imbRaw : DEFAULT_IMBALANCE_PERCENT;

        const store = storeOf(context);
        if (!hasFootprintData(context.source)) {
            warnOnce(context, store, 'request.footprint(): the market data source does not provide footprint data — returning na');
            return NaN;
        }
        const mintick = context.pine?.syminfo?.mintick;
        if (!(typeof mintick === 'number' && mintick > 0)) {
            warnOnce(context, store, 'request.footprint(): syminfo.mintick is unavailable, so rows cannot be sized — returning na');
            return NaN;
        }

        const openTime = Series.from(context.data.openTime).get(0);
        if (store.loadedVersion === -1) {
            await load(context, store, undefined);
        } else if (context.dataVersion > store.loadedVersion) {
            await load(context, store, openTime);
        }

        const bar = store.bars.get(openTime);
        if (!bar) return NaN;

        const key = `${Math.trunc(ticksPerRow)}|${vaPercent}|${imbalancePercent}`;
        let perBar = store.built.get(openTime);
        if (!perBar) {
            perBar = new Map();
            store.built.set(openTime, perBar);
        }
        if (!perBar.has(key)) {
            perBar.set(
                key,
                FootprintObject.build(context, bar.levels ?? [], { ticksPerRow: Math.trunc(ticksPerRow), mintick, vaPercent, imbalancePercent }),
            );
        }
        return perBar.get(key) ?? NaN;
    };
}
