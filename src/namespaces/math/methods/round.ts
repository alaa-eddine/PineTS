// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

// Pine rounds halves away from zero; JS Math.round rounds halves toward +Infinity.
const roundHalfAwayFromZero = (x: number): number => (Number.isNaN(x) ? NaN : Math.sign(x) * Math.round(Math.abs(x)));

export function round(context: any) {
    return (source: any, precision?: any) => {
        const value = Series.from(source).get(0);
        const digits = precision === undefined || precision === null ? 0 : Series.from(precision).get(0);
        if (!digits) return roundHalfAwayFromZero(value);
        const scale = 10 ** digits;
        return roundHalfAwayFromZero(value * scale) / scale;
    };
}
