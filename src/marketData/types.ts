// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standardized candlestick / kline data shape used by all providers.
 */
export interface Kline {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    quoteAssetVolume: number;
    numberOfTrades: number;
    takerBuyBaseAssetVolume: number;
    takerBuyQuoteAssetVolume: number;
    ignore: number | string;
}

/**
 * Executed volume at one price level of a bar's volume footprint, split by
 * aggressor side. How volume is attributed to "buy" vs "sell" is the data
 * source's decision (taker side, intrabar direction, ...) — PineTS only sums.
 */
export interface FootprintLevel {
    /** Level price — the LOW edge of the price bucket this level covers. */
    price: number;
    /** Volume executed by buy-aggressors (ask lifts) at this level. */
    buyVolume: number;
    /** Volume executed by sell-aggressors (bid hits) at this level. */
    sellVolume: number;
}

/**
 * The volume footprint of ONE bar — a sidecar to the bar's {@link Kline}, keyed by
 * the same `openTime`. Levels may sit on any price grid: `request.footprint()`
 * re-bins them into rows of `ticks_per_row × syminfo.mintick` itself, so a source
 * serves its finest available granularity and never needs to know the row size.
 */
export interface FootprintBar {
    /** Bar open time (epoch ms) — matches the corresponding kline's `openTime`. */
    openTime: number;
    /** Price step the levels were bucketed on. Informational only. */
    tick?: number;
    /** Price levels, in any order. Levels with no volume may be omitted. */
    levels: FootprintLevel[];
}

/**
 * Interval duration in milliseconds, keyed by normalized interval strings.
 * Used by providers for pagination and date-range estimation.
 *
 * These use Binance-style interval keys ('1m', '1h', '1d', etc.)
 * which are also the de-facto standard across most market data APIs.
 */
//prettier-ignore
export const INTERVAL_DURATION_MS: Record<string, number> = {
    '1m':  60 * 1000,
    '3m':  3 * 60 * 1000,
    '5m':  5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h':  60 * 60 * 1000,
    '2h':  2 * 60 * 60 * 1000,
    '4h':  4 * 60 * 60 * 1000,
    '1d':  24 * 60 * 60 * 1000,
    '1w':  7 * 24 * 60 * 60 * 1000,
    '1M':  30 * 24 * 60 * 60 * 1000,
};

/**
 * Period types for timeframe-aware date arithmetic.
 */
export type PeriodType = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';

/**
 * Duration in seconds for each canonical timeframe.
 *
 * Uses seconds (not minutes) to naturally accommodate TradingView's
 * sub-minute timeframes ('1S', '5S', etc.) without fractional values.
 * D/W/M values are approximate — used for ratio math, not calendar grouping.
 */
//prettier-ignore
export const TIMEFRAME_SECONDS: Record<string, number> = {
    // Seconds (TradingView format: "NS")
    '1S': 1, '5S': 5, '10S': 10, '15S': 15, '30S': 30,
    // Minutes (Pine canonical: plain integers)
    '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800, '45': 2700,
    // Hours
    '60': 3600, '120': 7200, '180': 10800, '240': 14400,
    // Calendar periods (approximate, for ratio math only)
    'D': 86400, 'W': 604800, 'M': 2592000,
};

/**
 * Map from canonical timeframe to { periodType, multiplier }.
 * Used by aggregation to determine grouping strategy.
 */
//prettier-ignore
export const TIMEFRAME_PERIOD_INFO: Record<string, { periodType: PeriodType; multiplier: number }> = {
    '1S':  { periodType: 'second', multiplier: 1 },
    '5S':  { periodType: 'second', multiplier: 5 },
    '10S': { periodType: 'second', multiplier: 10 },
    '15S': { periodType: 'second', multiplier: 15 },
    '30S': { periodType: 'second', multiplier: 30 },
    '1':   { periodType: 'minute', multiplier: 1 },
    '3':   { periodType: 'minute', multiplier: 3 },
    '5':   { periodType: 'minute', multiplier: 5 },
    '15':  { periodType: 'minute', multiplier: 15 },
    '30':  { periodType: 'minute', multiplier: 30 },
    '45':  { periodType: 'minute', multiplier: 45 },
    '60':  { periodType: 'hour',   multiplier: 1 },
    '120': { periodType: 'hour',   multiplier: 2 },
    '180': { periodType: 'hour',   multiplier: 3 },
    '240': { periodType: 'hour',   multiplier: 4 },
    'D':   { periodType: 'day',    multiplier: 1 },
    'W':   { periodType: 'week',   multiplier: 1 },
    'M':   { periodType: 'month',  multiplier: 1 },
};

/**
 * Compute the start of the next period given an openTime (fixed duration math).
 *
 * For intraday / daily / weekly: adds fixed duration.
 * For monthly: uses calendar math to land on the 1st of the next month.
 *
 * **Suitable for 24/7 crypto markets** where there are no session gaps.
 * For stock/regulated markets, prefer `computeSessionClose()` or
 * the Alpaca Calendar API which account for session boundaries,
 * early closes, and holidays.
 *
 * @param openTimeMs - The bar's open time in epoch milliseconds
 * @param periodType - The period unit ('minute', 'hour', 'day', 'week', 'month')
 * @param multiplier - How many units per bar (e.g., 3 for 3Min, 4 for 4Hour). Default: 1
 */
export function computeNextPeriodStart(
    openTimeMs: number,
    periodType: PeriodType,
    multiplier: number = 1,
): number {
    if (periodType === 'month') {
        // Calendar math: advance N months, land on the 1st, keep time-of-day
        const d = new Date(openTimeMs);
        return Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth() + multiplier,
            1,
            d.getUTCHours(),
            d.getUTCMinutes(),
            d.getUTCSeconds(),
            d.getUTCMilliseconds(),
        );
    }

    // Fixed-duration periods
    const MS_PER_UNIT: Record<string, number> = {
        second: 1_000,
        minute: 60_000,
        hour:   3_600_000,
        day:    86_400_000,
        week:   7 * 86_400_000,
    };
    return openTimeMs + multiplier * MS_PER_UNIT[periodType];
}

/**
 * Convert a local date + time string in a given IANA timezone to UTC milliseconds.
 *
 * Uses `Intl.DateTimeFormat` for DST-correct conversion — no external dependencies.
 *
 * @param dateStr - Date in "YYYY-MM-DD" format
 * @param timeStr - Time in "HH:MM" format (24h)
 * @param timezone - IANA timezone name (e.g. "America/New_York", "Etc/UTC")
 * @returns UTC epoch milliseconds
 */
export function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): number {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);

    // Build a UTC timestamp for the naive date+time
    const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

    // Use Intl to find the UTC offset for this timezone at this moment.
    // Strategy: format the naive UTC time in the target timezone, parse back,
    // compute the difference = the timezone's UTC offset.
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(new Date(naiveUtcMs));
    const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);

    let fYear = get('year');
    let fMonth = get('month');
    let fDay = get('day');
    let fHour = get('hour');
    // Intl may return hour=24 for midnight — normalize to 0
    if (fHour === 24) fHour = 0;
    let fMinute = get('minute');

    // What the timezone shows when we feed it naiveUtcMs
    const formattedAsUtcMs = Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, 0, 0);

    // offset = how far ahead the timezone is from UTC
    const offsetMs = formattedAsUtcMs - naiveUtcMs;

    // The local time we want is (year, month, day, hour, minute) in that timezone.
    // So the UTC equivalent is: naiveUtcMs - offsetMs
    return naiveUtcMs - offsetMs;
}

/**
 * Compute the session close time for a bar.
 *
 * For providers without a per-day calendar API (like FMP), this computes
 * closeTime from the session string and exchange timezone.
 *
 * Logic by period type:
 * - **24x7 session**: closeTime = openTime + barDuration (no gaps)
 * - **Intraday** (minute, hour): min(openTime + barDuration, sessionEndOnThatDay)
 * - **Daily** (day): same date at session end time in timezone
 * - **Weekly** (week): Friday of that week at session end (approximation: no holiday calendar)
 * - **Monthly** (month): last weekday of month at session end (approximation: no holiday calendar)
 *
 * @param openTimeMs - Bar open time in UTC epoch milliseconds
 * @param session - Session string, e.g. "0930-1600" or "24x7"
 * @param timezone - IANA timezone name, e.g. "America/New_York"
 * @param periodType - The period unit
 * @param multiplier - How many units per bar (default: 1)
 */
export function computeSessionClose(
    openTimeMs: number,
    session: string,
    timezone: string,
    periodType: PeriodType,
    multiplier: number = 1,
): number {
    // 24x7 markets (crypto): no session boundaries
    if (session === '24x7') {
        return computeNextPeriodStart(openTimeMs, periodType, multiplier);
    }

    // Parse session end time (e.g. "0930-1600" → "16:00")
    const sessionEnd = session.split('-')[1];
    if (!sessionEnd || sessionEnd.length !== 4) {
        // Fallback if session format is unexpected
        return computeNextPeriodStart(openTimeMs, periodType, multiplier);
    }
    const endHH = sessionEnd.slice(0, 2);
    const endMM = sessionEnd.slice(2, 4);
    const endTimeStr = `${endHH}:${endMM}`;

    // Get the bar's date in the exchange timezone
    const barDate = _utcMsToLocalDate(openTimeMs, timezone);

    if (periodType === 'second' || periodType === 'minute' || periodType === 'hour') {
        // Intraday: min(openTime + barDuration, session end on that day)
        const MS_PER_UNIT: Record<string, number> = {
            second: 1_000,
            minute: 60_000,
            hour: 3_600_000,
        };
        const barEndMs = openTimeMs + multiplier * MS_PER_UNIT[periodType];
        const sessionEndMs = localTimeToUTC(barDate, endTimeStr, timezone);
        return Math.min(barEndMs, sessionEndMs);
    }

    if (periodType === 'day') {
        // Daily: session end on the bar's date
        return localTimeToUTC(barDate, endTimeStr, timezone);
    }

    if (periodType === 'week') {
        // Weekly: Friday of that week at session end
        const d = new Date(openTimeMs);
        const dayOfWeek = d.getUTCDay(); // 0=Sun, 5=Fri
        const daysToFriday = (5 - dayOfWeek + 7) % 7 || 7;
        // If bar opens on Friday (dayOfWeek=5), daysToFriday would be 7, but we want 0
        const fridayOffset = dayOfWeek <= 5 ? (5 - dayOfWeek) : (5 - dayOfWeek + 7);
        const fridayMs = openTimeMs + fridayOffset * 86_400_000;
        const fridayDate = _utcMsToLocalDate(fridayMs, timezone);
        return localTimeToUTC(fridayDate, endTimeStr, timezone);
    }

    if (periodType === 'month') {
        // Monthly: last weekday of the month at session end
        const d = new Date(openTimeMs);
        const year = d.getUTCFullYear();
        const month = d.getUTCMonth() + multiplier;
        // First day of next month, then go back to find last weekday
        const firstOfNext = new Date(Date.UTC(year, month, 1));
        const lastDay = new Date(firstOfNext.getTime() - 86_400_000);
        // Walk back from last day of month to find a weekday (Mon-Fri)
        while (lastDay.getUTCDay() === 0 || lastDay.getUTCDay() === 6) {
            lastDay.setUTCDate(lastDay.getUTCDate() - 1);
        }
        const lastWeekdayDate = lastDay.toISOString().split('T')[0];
        return localTimeToUTC(lastWeekdayDate, endTimeStr, timezone);
    }

    // Fallback
    return computeNextPeriodStart(openTimeMs, periodType, multiplier);
}

/**
 * Convert UTC ms to a local date string "YYYY-MM-DD" in the given timezone.
 * @internal
 */
function _utcMsToLocalDate(utcMs: number, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return formatter.format(new Date(utcMs));
}

/**
 * Normalize closeTime for 24/7 crypto providers (Binance, Mock).
 *
 * Many crypto APIs (e.g. Binance) return closeTime as `nextBarOpen - 1ms`.
 * For 24/7 markets, `nextBar.openTime == sessionClose`, so this is correct:
 * - For bars 0..N-2: closeTime = next bar's openTime (exact for 24/7)
 * - For the last bar: closeTime = raw closeTime + 1ms (best estimate)
 *
 * **Not suitable for stock/regulated market providers** — those must use
 * `computeSessionClose()` or the Alpaca Calendar API for session-aware close times.
 *
 * Mutates the array in place.
 */
export function normalizeCloseTime(data: Kline[]): void {
    for (let i = 0; i < data.length - 1; i++) {
        data[i].closeTime = data[i + 1].openTime;
    }
    if (data.length > 0) {
        data[data.length - 1].closeTime = data[data.length - 1].closeTime + 1;
    }
}
