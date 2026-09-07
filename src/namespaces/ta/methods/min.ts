// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Trailing Minimum (ta.min)
 *
 * Returns the all-time low value of `source` from the first bar of the
 * chart up to the current bar.
 *
 * - `na` is returned until the first non-na `source` value is seen.
 * - Later `na` values are ignored (the previous minimum is carried forward)
 *   so a single missing value cannot poison the running result.
 *
 * State is committed per bar (keyed by `context.idx`) so re-evaluations of
 * the still-forming live bar do not corrupt history.
 *
 * @param source - The series to track
 * @returns The trailing minimum up to the current bar
 */
export function min(context: any) {
    return (source: any, _callId?: string) => {
        if (!context.taState) context.taState = {};
        const stateKey = _callId || 'min';

        if (!context.taState[stateKey]) {
            context.taState[stateKey] = {
                lastIdx: -1,
                // Committed state (as of the previous bar)
                prevMin: NaN,
                // Tentative state (current bar, may be re-evaluated)
                currentMin: NaN,
            };
        }

        const state = context.taState[stateKey];

        // Commit the previous bar's tentative value when moving to a new bar
        if (context.idx > state.lastIdx) {
            if (state.lastIdx >= 0) {
                state.prevMin = state.currentMin;
            }
            state.lastIdx = context.idx;
        }

        const currentValue = Series.from(source).get(0);

        let result: number;
        if (isNaN(currentValue)) {
            result = state.prevMin;
        } else if (isNaN(state.prevMin)) {
            result = currentValue;
        } else {
            result = Math.min(state.prevMin, currentValue);
        }

        state.currentMin = result;
        return context.precision(result);
    };
}
