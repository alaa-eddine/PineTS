import { describe, expect, it } from 'vitest';

import { PineTS, Provider } from 'index';

describe('Technical Analysis - Volatility', () => {
    it('Squeeze Index (LuxAlgo) - weekly regression baseline', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            // PineTS port of the LuxAlgo "Squeeze Index" (https://www.luxalgo.com/library/indicator/squeeze-index/)
            const { close } = context.data;
            const { bar_index, plotchar, nz } = context.pine;
            const ta = context.ta;
            const math = context.math;
            const input = context.input;

            const conv = input.int(50, 'Convergence Factor');
            const length = input.int(20, 'Length');
            const src = close;

            var max = 0.0;
            var min = 0.0;

            max = nz(math.max(src, max - (max - src) / conv), src);
            min = nz(math.min(src, min + (src - min) / conv), src);
            const diff = math.log(max - min);

            const psi = -50 * ta.correlation(diff, bar_index, length) + 50;

            plotchar(psi, '_psi');
            plotchar(psi > 80, '_squeezed');
        };

        const { plots } = await pineTS.run(sourceCode);

        const psiData = plots['_psi']?.data;
        const squeezedData = plots['_squeezed']?.data;
        const startDate = new Date('2019-08-19').getTime();
        const endDate = new Date('2019-11-18').getTime();

        let plotdata_str = '';
        for (let i = 0; i < psiData.length; i++) {
            const time = psiData[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }
            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            plotdata_str += `[${str_time}]: ${parseFloat(psiData[i].value).toFixed(3)} ${squeezedData[i].value}\n`;
        }

        const expected_plot = `[2019-08-19T00:00:00.000-00:00]: 7.585 false
[2019-08-26T00:00:00.000-00:00]: 10.461 false
[2019-09-02T00:00:00.000-00:00]: 14.356 false
[2019-09-09T00:00:00.000-00:00]: 19.584 false
[2019-09-16T00:00:00.000-00:00]: 27.663 false
[2019-09-23T00:00:00.000-00:00]: 40.868 false
[2019-09-30T00:00:00.000-00:00]: 53.167 false
[2019-10-07T00:00:00.000-00:00]: 63.740 false
[2019-10-14T00:00:00.000-00:00]: 75.510 false
[2019-10-21T00:00:00.000-00:00]: 88.371 true
[2019-10-28T00:00:00.000-00:00]: 99.006 true
[2019-11-04T00:00:00.000-00:00]: 99.404 true
[2019-11-11T00:00:00.000-00:00]: 99.944 true
[2019-11-18T00:00:00.000-00:00]: 99.944 true`;

        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
