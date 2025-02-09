import { PineTS } from 'index';
import { describe, expect, it } from 'vitest';

import { Provider } from '@pinets/marketData/Provider.class';

describe('Indicators', () => {
    it('pine_supertrend', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', '240', 1000);

        const { result, plots } = await pineTS.run((context) => {
            const ta = context.ta;

            const { close, hl2 } = context.data;
            const { na, nz, plot } = context.core;

            function pine_supertrend(factor, atrPeriod) {
                const src = hl2;
                const atr = ta.atr(atrPeriod);
                let upperBand = src + factor * atr;
                let lowerBand = src - factor * atr;
                const prevLowerBand = nz(lowerBand[1]);
                const prevUpperBand = nz(upperBand[1]);

                lowerBand = lowerBand > prevLowerBand || close[1] < prevLowerBand ? lowerBand : prevLowerBand;
                upperBand = upperBand < prevUpperBand || close[1] > prevUpperBand ? upperBand : prevUpperBand;
                let _direction = NaN;
                let superTrend = NaN;
                const prevSuperTrend = superTrend[1];
                if (na(atr[1])) _direction = 1;
                else if (prevSuperTrend == prevUpperBand) {
                    _direction = close > upperBand ? -1 : 1;
                } else {
                    _direction = close < lowerBand ? 1 : -1;
                }
                superTrend = _direction == -1 ? lowerBand : upperBand;
                return [superTrend, _direction];
            }

            const [supertrend, direction] = pine_supertrend(3, 10);
            plot(supertrend, 'supertrend', { color: 'green', style: 'linebr' });
            plot(direction, 'direction', { color: 'green', style: 'linebr' });
            plot(direction < 0 ? supertrend[2] : na, 'Up', { color: 'green', style: 'linebr' });
            plot(direction > 0 ? supertrend : na, 'Down', { color: 'red', style: 'linebr' });

            return {
                direction,
                supertrend,
            };
        });

        const data = plots['Up'].data.reverse().slice(0, 30);
        data.forEach((d) => {
            d.time = new Date(d.time).toISOString();
            delete d.options;
        });

        console.log('>>> plots: ', data);
        //console.log('>>> plots: ', plots['Down'].data.reverse().slice(0, 10));
    });
});
