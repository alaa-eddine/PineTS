import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../utils';

async function runMathFunctionWithArgs(taFunction: string, ...args) {
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'math', taFunction, ...args);

    return result;
}

describe('Math', () => {
    it('math.max', async () => {
        const result_source_number = await runMathFunctionWithArgs('max', 'close', 98000);
        const result_source_source = await runMathFunctionWithArgs('max', 'close', 'open');
        const result_numbers = await runMathFunctionWithArgs('max', 1, 2, 3);

        const part_source_number = result_source_number.values.reverse().slice(0, 10);
        const expected_source_number = [98000, 98000, 98268.77, 98451.47, 98358.98, 98357.46, 98187.96, 98227.48, 98123.53, 98213.43];

        const part_source_source = result_source_source.values.reverse().slice(0, 10);
        const expected_source_source = [97861.04, 98268.77, 98451.48, 98451.47, 98358.98, 98357.46, 98227.49, 98227.48, 98213.44, 98220.51];

        const part_numbers = result_numbers.values.reverse().slice(0, 10);
        const expected_numbers = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3];

        expect(part_source_number).toEqual(arrayPrecision(expected_source_number));
        expect(part_source_source).toEqual(arrayPrecision(expected_source_source));
        expect(part_numbers).toEqual(arrayPrecision(expected_numbers));
    });

    it('math.min', async () => {
        const result = await runMathFunctionWithArgs('min', 'close', 98000);
        const part = result.values.reverse().slice(0, 10);
        const expected = [97652.2, 97861.04, 98000, 98000, 98000, 98000, 98000, 98000, 98000, 98000];

        expect(part).toEqual(arrayPrecision(expected));
    });
});
