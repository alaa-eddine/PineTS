import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../utils';

async function runTAFunctionWithArgs(taFunction: string, ...args) {
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'ta', taFunction, ...args);

    return result;
}

describe('Technical Analysis', () => {
    it('SMA', async () => {
        const result = await runTAFunctionWithArgs('sma', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            98165.4322222222, 98227.7911111111, 98267.7311111111, 98284.2288888889, 98274.3355555556, 98301.0066666667, 98279.7622222222,
            98254.6066666667, 98231.1377777778, 98184.59,
        ];
        console.log(' SMA ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('EMA', async () => {
        const result = await runTAFunctionWithArgs('ema', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            98092.5952187622, 98202.6940234527, 98288.1075293159, 98292.9419116449, 98253.3098895561, 98226.8923619451, 98194.2504524314,
            98195.8230655392, 98187.908831924, 98204.003539905,
        ];
        console.log(' EMA ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });
    it('VWMA', async () => {
        const result = await runTAFunctionWithArgs('vwma', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            98079.8986896213, 98167.1529112588, 98261.5131863432, 98283.9227768612, 98291.1386644332, 98338.0590699097, 98315.1688886961,
            98291.82040143, 98271.618598433, 98179.8444083532,
        ];
        console.log(' VWMA ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });
    it('WMA', async () => {
        const result = await runTAFunctionWithArgs('wma', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            98104.78755555557, 98219.90577777778, 98301.24399999999, 98304.33577777777, 98268.90888888888, 98257.31422222221, 98241.77466666665,
            98255.10399999999, 98255.83555555555, 98268.04755555555,
        ];
        console.log(' WMA ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });
    it('HMA', async () => {
        const result = await runTAFunctionWithArgs('hma', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            97959.84629629628, 98249.99948148146, 98409.70892592594, 98387.06711111113, 98285.28803703707, 98196.03533333332, 98135.86240740742,
            98158.53088888888, 98236.40748148148, 98384.02648148149,
        ];
        console.log(' HMA ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });
    it('RMA', async () => {
        const result = await runTAFunctionWithArgs('rma', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            98119.1752970878, 98177.5472092238, 98217.1106103768, 98210.6531866739, 98180.5510850081, 98158.2474706341, 98133.3459044634,
            98126.5191425214, 98113.8990353365, 98112.6951647536,
        ];
        console.log(' RMA ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });
    it('CHANGE', async () => {
        const result = await runTAFunctionWithArgs('change', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            -561.2299999999959, -359.4600000000064, -148.47999999999593, 89.04000000000815, -240.04000000000815, 191.20000000001164,
            226.40000000000873, 211.22000000000116, 418.929999999993, 555.4899999999907,
        ];
        console.log(' CHANGE ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });

    it('RSI', async () => {
        const result = await runTAFunctionWithArgs('rsi', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            32.27075359802164, 37.56594758334729, 52.522168734203916, 62.42066649822401, 58.93836309982853, 58.88270371925891, 52.500600534468326,
            54.24561329345435, 50.39033565293185, 53.880425552496156,
        ];
        console.log(' RSI ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });

    it('ATR', async () => {
        const result = await runTAFunctionWithArgs('atr', 14);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            311.07058448421424, 311.5306294445376, 297.7245240171947, 305.5441027877488, 314.0336491560377, 320.0962375526559, 318.9651789028611,
            331.30942343385004, 347.40399446722296, 353.1773786570089,
        ];
        console.log(' ATR ', part);

        expect(part).toEqual(arrayPrecision(expected));
    });

    // it('DEMA', async () => {
    //     const result = await runTAFunctionWithArgs('dema', 'close', 9);

    //     const part = result.values.reverse().slice(0, 10);
    //     const expected = [
    //         98019.75783752798, 98178.09803691452, 98310.48384986906, 98301.58981343972, 98217.68194727238, 98159.89484433009, 98108.60853852264,
    //         98137.79128264699, 98180.97389132534, 98220.40824788594,
    //     ];
    //     console.log(' DEMA ', part);
    //     expect(part).toEqual(expected);
    // });

    // it('TEMA', async () => {
    //     const result = await runTAFunctionWithArgs('tema', 'close', 9);

    //     const part = result.values.reverse().slice(0, 10);
    //     const expected = [
    //         97947.02045629379, 98153.50205037633, 98332.85018842222, 98310.23771523458, 98182.05400498869, 98092.89732671511, 98022.96662461392,
    //         98079.76949975479, 98174.03895072671, 98236.81295586693,
    //     ];
    //     console.log(' TEMA ', part);
    //     expect(part).toEqual(expected);
    // });

    it('MOM', async () => {
        const result = await runTAFunctionWithArgs('mom', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            -561.2299999999959, -359.4600000000064, -148.47999999999593, 89.04000000000815, -240.04000000000815, 191.20000000001164,
            226.40000000000873, 211.22000000000116, 418.929999999993, 555.4899999999907,
        ];
        console.log(' MOM ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('ROC', async () => {
        const result = await runTAFunctionWithArgs('roc', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            -0.571439160611737, -0.36597248028670837, -0.15086786107109876, 0.09052236712737592, -0.2434506955545888, 0.19477160482635444,
            0.23111106029753786, 0.21549485768993956, 0.42877203325124197, 0.5688119163684905,
        ];
        console.log(' ROC ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('DEV', async () => {
        const result = await runTAFunctionWithArgs('dev', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            191.0059259259, 116.7812345679, 81.2790123457, 99.6098765432, 88.6172839506, 118.2518518519, 119.8696296296, 136.64, 152.2859259259,
            197.7066666667,
        ];
        console.log(' DEV ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('VARIANCE', async () => {
        const result = await runTAFunctionWithArgs('variance', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            58778.54210853577, 25878.408052444458, 9343.958097457886, 11555.650184631348, 9029.530424118042, 19235.43853378296, 20447.410486221313,
            30128.49809074402, 35808.07350540161, 63159.44429016113,
        ];
        console.log(' VARIANCE ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('HIGHEST', async () => {
        const result = await runTAFunctionWithArgs('highest', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [98451.47, 98451.47, 98451.47, 98451.47, 98417.25, 98599.02, 98599.02, 98599.02, 98599.02, 98599.02];
        console.log(' HIGHEST ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('LOWEST', async () => {
        const result = await runTAFunctionWithArgs('lowest', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [97652.2, 97861.04, 98123.53, 98123.53, 98123.53, 98123.53, 98123.53, 97961.56, 97961.56, 97704.6];
        console.log(' LOWEST ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('MEDIAN', async () => {
        const result = await runTAFunctionWithArgs('median', 'close', 9);

        const part = result.values.reverse().slice(0, 10);
        const expected = [98227.48, 98227.48, 98227.48, 98227.48, 98227.48, 98227.48, 98220.5, 98220.5, 98213.43, 98213.43];
        console.log(' MEDIAN ', part);
        expect(part).toEqual(arrayPrecision(expected));
    });

    it('STDEV', async () => {
        const result_default = await runTAFunctionWithArgs('stdev', 'close', 9);
        const result_unbiased = await runTAFunctionWithArgs('stdev', 'close', 9, false);

        const part_default = result_default.values.reverse().slice(0, 10);
        const part_unbiased = result_unbiased.values.reverse().slice(0, 10);
        const expected_default = [
            242.44286359093738, 160.8676724961285, 96.6641510528364, 107.49721013893554, 95.02384134884949, 138.691883444323, 142.99444214357064,
            173.5756264251678, 189.23021298453767, 251.3154278767793,
        ];
        const expected_unbiased = [
            257.14948934315544, 170.62593314356369, 102.52781506065205, 114.01800937181491, 100.78800388824918, 147.1049569185226, 151.66850956755937,
            184.10475374090856, 200.7089502101119, 266.56026490270403,
        ];
        console.log(' STDEV ', part_default);
        console.log(' STDEV_UNBIASED ', part_unbiased);
        expect(part_default).toEqual(arrayPrecision(expected_default));
        expect(part_unbiased).toEqual(arrayPrecision(expected_unbiased));
    });
});
