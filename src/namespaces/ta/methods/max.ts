// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Trailing Maximum (ta.max)
 *
 * Returns the all-time high value of `source` from the first bar of the
 * chart up to the current bar.
 *
 * - `na` is returned until the first non-na `source` value is seen.
 * - Later `na` values are ignored (the previous maximum is carried forward)
 *   so a single missing value cannot poison the running result.
 *
 * State is committed per bar (keyed by `context.idx`) so re-evaluations of
 * the still-forming live bar do not corrupt history.
 *
 * @param source - The series to track
 * @returns The trailing maximum up to the current bar
 */
export function max(context: any) {
    return (source: any, _callId?: string) => {
        if (!context.taState) context.taState = {};
        const stateKey = _callId || 'max';

        if (!context.taState[stateKey]) {
            context.taState[stateKey] = {
                lastIdx: -1,
                // Committed state (as of the previous bar)
                prevMax: NaN,
                // Tentative state (current bar, may be re-evaluated)
                currentMax: NaN,
            };
        }

        const state = context.taState[stateKey];

        // Commit the previous bar's tentative value when moving to a new bar
        if (context.idx > state.lastIdx) {
            if (state.lastIdx >= 0) {
                state.prevMax = state.currentMax;
            }
            state.lastIdx = context.idx;
        }

        const currentValue = Series.from(source).get(0);

        let result: number;
        if (isNaN(currentValue)) {
            result = state.prevMax;
        } else if (isNaN(state.prevMax)) {
            result = currentValue;
        } else {
            result = Math.max(state.prevMax, currentValue);
        }

        state.currentMax = result;
        return context.precision(result);
    };
}
