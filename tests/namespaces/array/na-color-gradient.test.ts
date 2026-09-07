// SPDX-License-Identifier: AGPL-3.0-only
// Regression guard: na colors produced by color.from_gradient (optionally passed
// through color.new) must be storable in color arrays via every mutator, and
// color.from_gradient(na, ...) must compare equal to na.
// See TradingView behavior: array.new_color(n, na) + array.set(arr, i, na-color) is legal.

import { describe, expect, it } from 'vitest';
import { PineTS, Provider } from 'index';

function newPineTS() {
    return new PineTS(Provider.Mock, 'BTCUSDC', '60', null, new Date('2024-01-01').getTime(), new Date('2024-01-10').getTime());
}

describe('na color from color.from_gradient stored in color arrays', () => {
    it('Pine v6 repro: gradient na color through color.new into array.set', async () => {
        const pineTS = newPineTS();

        // EMA(200) is na on early bars → sc is NaN → gradient color is na.
        const { plots } = await pineTS.run(`
//@version=6
indicator("repro gradient na")
rowCols = array.new_color(2, na)
val = ta.ema(close, 200)
sc = (close - val)
c = color.from_gradient(sc, 0, 1, color.red, color.green)
array.set(rowCols, 0, color.new(c, 50))
plot(na(array.get(rowCols, 0)) ? 1 : 0, "cellIsNa")
        `);

        const data = plots['cellIsNa'].data;
        expect(data.length).toBeGreaterThan(0);
        // On the first bar the EMA is na, so the stored cell must read back as na.
        expect(data[0].value).toBe(1);
        // On the last bars the EMA is valid, so a real color is stored.
        expect(data[data.length - 1].value).toBe(0);
    });

    it('Pine v6 control: na literal into color array still works', async () => {
        const pineTS = newPineTS();

        const { plots } = await pineTS.run(`
//@version=6
indicator("repro na literal")
rowCols = array.new_color(2, na)
array.set(rowCols, 0, na)
plot(na(array.get(rowCols, 0)) ? 1 : 0, "cellIsNa")
        `);

        const data = plots['cellIsNa'].data;
        expect(data.length).toBeGreaterThan(0);
        expect(data.every((p: any) => p.value === 1)).toBe(true);
    });

    it('all five mutators accept an na-derived color', async () => {
        const pineTS = newPineTS();

        const { result } = await pineTS.run(($) => {
            const { close } = $.data;
            const { ta, array, color, na } = $.pine;

            const val = ta.ema(close, 200);
            const sc = close - val;
            const c = color.from_gradient(sc, 0, 1, color.red, color.green);
            const c2 = color.new(c, 50);

            const arrSet = array.new_color(2, na);
            array.set(arrSet, 0, c2);

            const arrFill = array.new_color(2, na);
            array.fill(arrFill, c2);

            const arrPush = array.new_color(0, na);
            array.push(arrPush, c2);

            const arrInsert = array.new_color(1, na);
            array.insert(arrInsert, 0, c2);

            const arrUnshift = array.new_color(1, na);
            array.unshift(arrUnshift, c2);

            const gradientIsNa = na(c);

            return { gradientIsNa };
        });

        // First bar: EMA is na → gradient color must be na.
        expect(result.gradientIsNa[0]).toBe(true);
        // Last bar: EMA is valid → gradient color is a real color.
        expect(result.gradientIsNa[result.gradientIsNa.length - 1]).toBe(false);
    });

    it('na literal in numeric arrays keeps working', async () => {
        const pineTS = newPineTS();

        const { result } = await pineTS.run(($) => {
            const { array, na } = $.pine;

            const arr = array.new_float(1);
            array.set(arr, 0, na);
            const cellIsNa = na(array.get(arr, 0));

            return { cellIsNa };
        });

        expect(result.cellIsNa.every((v: boolean) => v === true)).toBe(true);
    });
});
