// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../../Series';
import { NAHelper } from '../Core';

/**
 * Unwrap a transpiler-delivered argument to a plain value. Namespace calls get
 * their arguments `param`-wrapped, but instance-method calls (`fp.get_row_by_price(close)`)
 * hand over whatever the script referenced: a Series, a `var` thunk, or the `na` helper.
 */
export function resolveArg(value: any): any {
    if (value instanceof NAHelper) return NaN;
    if (value instanceof Series) return value.get(0);
    if (typeof value === 'function') return value();
    return value;
}
