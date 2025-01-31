import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../utils';
import { Provider } from '@pinets/index';
import PineTS from 'PineTS.class';

describe('Array', () => {
    it('SET, AVG, VARIANCE', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);

        const { result } = await pineTS.run((context) => {
            const ta = context.ta;
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(10, close);

            array.set(arr, 1, 99);

            const avg = array.avg(arr);
            const variance = array.variance(arr, false);
            const variance_biased = array.variance(arr);
            const arr_val = array.get(arr, 1);

            return {
                avg,
                variance,
                variance_biased,
                arr_val,
            };
        });

        const part_arr_val = result.arr_val.reverse().slice(0, 5);
        const part_variance = result.variance.reverse().slice(0, 5);
        const part_variance_biased = result.variance_biased.reverse().slice(0, 5);
        const part_avg = result.avg.reverse().slice(0, 5);

        const expected_avg = [91208.313, 85100.454, 88537.149, 84374.28, 85677.543];
        const expected_variance = [1024803322.8804907, 892005824.9523604, 965593357.8452102, 876829977.664, 904158891.6052902];
        const expected_variance_biased = [922322990.5924416, 802805242.4571244, 869034022.0606892, 789146979.8976, 813743002.4447612];
        const expected_arr_val = [99, 99, 99, 99, 99];
        // console.log('AVG', part_avg);
        // console.log('VARIANCE', part_variance);
        // console.log('VARIANCE_BIASED', part_variance_biased);
        // console.log('VAL', part_arr_val);

        expect(part_avg).toEqual(expected_avg);
        expect(part_variance).toEqual(expected_variance);
        expect(part_variance_biased).toEqual(expected_variance_biased);
        expect(part_arr_val).toEqual(expected_arr_val);
    });

    it('SUM, FIRST, STDEV, STDEV_BIASED', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);

        const { result } = await pineTS.run((context) => {
            const ta = context.ta;
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(10, close);
            const sum = array.sum(arr);
            const first = array.first(arr);

            array.set(arr, 1, 99); // set a variance in order to get stdv values (otherwise it will be 0 and we can't test it proprtly)
            const stdev = array.stdev(arr, false);
            const stdev_biased = array.stdev(arr);

            return {
                sum,
                first,
                stdev,
                stdev_biased,
            };
        });

        const part_sum = result.sum.reverse().slice(0, 5);
        const part_first = result.first.reverse().slice(0, 5);
        const part_stdev = result.stdev.reverse().slice(0, 5);
        const part_stdev_biased = result.stdev_biased.reverse().slice(0, 5);

        const expected_sum = [1013315.7000000002, 945450.6000000001, 983636.1, 937381.9999999998, 951862.7000000001];
        const expected_first = [101331.57, 94545.06, 98363.61, 93738.2, 95186.27];
        const expected_stdev = [32012.5494592432, 29866.4665628922, 31073.9980988158, 29611.3150276039, 30069.2349687399];
        const expected_stdev_biased = [30369.771, 28333.818, 29479.383, 28091.76, 28526.181];
        // console.log('SUM', part_sum);
        // console.log('FIRST', part_first);
        // console.log('STDEV', part_stdev);
        // console.log('STDEV_BIASED', part_stdev_biased);

        expect(part_sum).toEqual(expected_sum);
        expect(part_first).toEqual(expected_first);
        expect(part_stdev).toEqual(expected_stdev);
        expect(part_stdev_biased).toEqual(expected_stdev_biased);
    });
});
