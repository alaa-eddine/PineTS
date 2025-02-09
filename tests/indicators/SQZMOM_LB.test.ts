import { PineTS } from 'index';
import { describe, expect, it } from 'vitest';

import { Context } from 'Context.class';
import { Provider } from '@pinets/marketData/Provider.class';

describe('Indicators', () => {
    it('Squeeze Momentum Indicator [LazyBear]', async () => {
        const pineTS = new PineTS(Provider.Binance, 'SUIUSDT', '1d', 1000, 0, new Date('Dec 25 2024').getTime() - 1);

        const { result, plots } = await pineTS.run((context: Context) => {
            // This is a port of "Squeeze Momentum Indicator" indicator by LazyBear
            // List of all his indicators: https://www.tradingview.com/v/4IneGo8h/
            const { close, high, low } = context.data;

            const ta = context.ta;
            const math = context.math;

            const input = context.input;
            const { plot, plotchar, nz, color } = context.core;
            plotchar(close, 'close', { display: 'data_window' });

            const length = input.int(20, 'BB Length');
            const mult = input.float(2.0, 'BB MultFactor');
            const lengthKC = input.int(20, 'KC Length');
            const multKC = input.float(1.5, 'KC MultFactor');

            const useTrueRange = input.bool(true, 'Use TrueRange (KC)');

            // Calculate BB
            let source: any = close;
            const basis = ta.sma(source, length);
            const dev = multKC * ta.stdev(source, length);
            const upperBB = basis + dev;
            const lowerBB = basis - dev;

            // Calculate KC
            const ma = ta.sma(source, lengthKC);
            const range_1 = useTrueRange ? ta.tr : high - low;
            const rangema = ta.sma(range_1, lengthKC);
            const upperKC = ma + rangema * multKC;
            const lowerKC = ma - rangema * multKC;

            plotchar(lowerBB, 'lowerBB', { display: 'data_window' });
            plotchar(lowerKC, 'lowerKC', { display: 'data_window' });
            plotchar(upperBB, 'upperBB', { display: 'data_window' });
            plotchar(upperKC, 'upperKC', { display: 'data_window' });

            const sqzOn = lowerBB > lowerKC && upperBB < upperKC;
            const sqzOff = lowerBB < lowerKC && upperBB > upperKC;
            const noSqz = sqzOn == false && sqzOff == false;

            const val = ta.linreg(
                source - math.avg(math.avg(ta.highest(high, lengthKC), ta.lowest(low, lengthKC)), ta.sma(close, lengthKC)),
                lengthKC,
                0
            );

            const iff_1 = val > nz(val[1]) ? color.lime : color.green;
            const iff_2 = val < nz(val[1]) ? color.red : color.maroon;
            const bcolor = val > 0 ? iff_1 : iff_2;
            const scolor = noSqz ? color.blue : sqzOn ? color.black : color.gray;
            plot(val, 'val', { color: bcolor, style: 'histogram', linewidth: 4 });
            plot(0, 'char', { color: scolor, style: 'cross', linewidth: 2 });
        });

        const valPlot = plots['val'].data.reverse().slice(0, 40);
        const charPlot = plots['char'].data.reverse().slice(0, 40);

        const lowerBBPlot = plots['lowerBB'].data.reverse().slice(0, 10);
        const lowerKCPlot = plots['lowerKC'].data.reverse().slice(0, 10);
        const upperBBPlot = plots['upperBB'].data.reverse().slice(0, 10);
        const upperKCPlot = plots['upperKC'].data.reverse().slice(0, 10);

        valPlot.forEach((e) => (e.time = new Date(e.time).toISOString()));
        charPlot.forEach((e) => (e.time = new Date(e.time).toISOString()));
        lowerBBPlot.forEach((e) => (e.time = new Date(e.time).toISOString()));
        lowerKCPlot.forEach((e) => (e.time = new Date(e.time).toISOString()));
        upperBBPlot.forEach((e) => (e.time = new Date(e.time).toISOString()));
        upperKCPlot.forEach((e) => (e.time = new Date(e.time).toISOString()));
        console.log('>>> valPlot: ', valPlot);
        //console.log('>>> charPlot: ', charPlot);

        //console.log('>>> lowerBBPlot: ', lowerBBPlot);
        //console.log('>>> lowerKCPlot: ', lowerKCPlot);
        //console.log('>>> upperBBPlot: ', upperBBPlot);
        //console.log('>>> upperKCPlot: ', upperKCPlot);
    });
});
