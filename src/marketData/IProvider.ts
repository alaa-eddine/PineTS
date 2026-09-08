// SPDX-License-Identifier: AGPL-3.0-only

import type { FootprintBar, Kline } from './types';

// ── Provider configuration types ────────────────────────────────────────

/** Base config — all providers extend this (may be empty for keyless providers). */
export interface BaseProviderConfig {}

/** Config for providers that require an API key (FMP, Alpaca, etc.). */
export interface ApiKeyProviderConfig extends BaseProviderConfig {
    apiKey: string;
}

// ── Symbol info ─────────────────────────────────────────────────────────

export type ISymbolInfo = {
    //Symbol Identification
    current_contract: string;
    description: string;
    isin: string;
    main_tickerid: string;
    prefix: string;
    root: string;
    ticker: string;
    tickerid: string;
    type: string;

    //  "Currency & Location": {
    basecurrency: string;
    country: string;
    currency: string;
    timezone: string;

    // Company Data
    employees: number;
    industry: string;
    sector: string;
    shareholders: number;
    shares_outstanding_float: number;
    shares_outstanding_total: number;

    // Session & Market
    expiration_date: number; //Pinescript timestamp
    session: string;
    volumetype: string;

    // Price & Contract Info
    mincontract: number;
    minmove: number;
    mintick: number;
    pointvalue: number;
    pricescale: number;

    // Analyst Ratings
    recommendations_buy: number;
    recommendations_buy_strong: number;
    recommendations_date: number; //Pinescript timestamp
    recommendations_hold: number;
    recommendations_sell: number;
    recommendations_sell_strong: number;
    recommendations_total: number;

    // Price Targets
    target_price_average: number;
    target_price_date: number; //Pinescript timestamp
    target_price_estimates: number;
    target_price_high: number;
    target_price_low: number;
    target_price_median: number;
};
/**
 * Market data provider interface.
 *
 * ## closeTime convention
 * Providers MUST return `closeTime` as the **session close time** for the bar,
 * mirroring TradingView's `time_close` built-in variable.
 *
 * - **Stocks / regulated markets**: `closeTime` = the session close time on
 *   the bar's trading day (e.g., 16:00 ET for NYSE daily bars, 13:00 ET for
 *   early-close days). For weekly/monthly bars, use the session close of the
 *   last trading day in the period.
 * - **24/7 markets (crypto)**: `closeTime` = the start of the next bar
 *   (equivalent to `openTime + barDuration`), since there are no session gaps.
 *
 * Use `computeSessionClose()` from `types.ts` for session-aware computation,
 * or the Alpaca Calendar API for exact per-day close times including early closes.
 */
export interface IProvider extends Partial<IFootprintProvider> {
    getMarketData(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<Kline[]>;
    getSymbolInfo(tickerId: string): Promise<ISymbolInfo>;
    configure(config: any): void;
}

/**
 * Optional order-flow surface a provider may implement next to {@link IProvider}.
 * It backs Pine's `request.footprint()`: the engine asks for the per-bar footprints
 * of the chart series with the SAME `(tickerId, timeframe, limit, sDate, eDate)`
 * vocabulary as `getMarketData` — one call for the loaded history, then tail
 * calls from the forming bar's `openTime` whenever the market data changes.
 *
 * Bars the source cannot serve (no order-flow coverage, still pending) are simply
 * omitted from the result; the script sees `na` for them. A provider without this
 * method makes `request.footprint()` return `na` on every bar.
 */
export interface IFootprintProvider {
    getFootprintData(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<FootprintBar[]>;
}

/** Narrow a market data source to its optional footprint surface. */
export function hasFootprintData(source: unknown): source is IFootprintProvider {
    return source != null && !Array.isArray(source) && typeof (source as Partial<IFootprintProvider>).getFootprintData === 'function';
}
