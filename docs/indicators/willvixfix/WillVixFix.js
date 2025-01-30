async function WillVixFix(tickerId, timeframe = '1w', periods = 500, stime, etime) {
    const pineTS = new PineTS(PineTS.Provider.Binance, tickerId, timeframe, periods, stime, etime);

    const { result, plots } = await pineTS.run((context) => {
        // This is a PineTS port of "Squeeze Momentum Indicator" indicator by LazyBear
        // List of all his indicators: https://www.tradingview.com/v/4IneGo8h/
        const { close, high, low } = context.data;

        const ta = context.ta;
        const math = context.math;

        const input = context.input;
        const { plot, plotchar, nz, color } = context.core;

        const pd = input.int(22, 'LookBack Period Standard Deviation High');
        const bbl = input.int(20, 'Bolinger Band Length');
        const mult = input.float(2.0, 'Bollinger Band Standard Devaition Up');
        const lb = input.int(50, 'Look Back Period Percentile High');
        const ph = input.float(0.85, 'Highest Percentile - 0.90=90%, 0.95=95%, 0.99=99%');
        const pl = input.float(1.01, 'Lowest Percentile - 1.10=90%, 1.05=95%, 1.01=99%');
        const hp = input.bool(true, 'Show High Range - Based on Percentile and LookBack Period?');
        const sd = input.bool(true, 'Show Standard Deviation Line?');

        const wvf = ((ta.highest(close, pd) - low) / ta.highest(close, pd)) * 100;

        const sDev = mult * ta.stdev(wvf, bbl);
        const midLine = ta.sma(wvf, bbl);
        const lowerBand = midLine - sDev;
        const upperBand = midLine + sDev;

        const rangeHigh = ta.highest(wvf, lb) * ph;
        const rangeLow = ta.lowest(wvf, lb) * pl;

        const col = wvf >= upperBand || wvf >= rangeHigh ? color.lime : color.gray;

        const RangeHigh = hp && rangeHigh ? rangeHigh : NaN;
        const RangeLow = hp && rangeLow ? rangeLow : NaN;
        const UpperBand = sd && upperBand ? upperBand : NaN;

        plot(RangeHigh, 'RangeHigh', { style: 'line', linewidth: 1, color: 'lime' });
        plot(RangeLow, 'RangeLow', { style: 'line', linewidth: 1, color: 'orange' });
        plot(UpperBand, 'UpperBand', { style: 'line', linewidth: 2, color: 'aqua' });
        plot(wvf, 'WilliamsVixFix', { style: 'histogram', linewidth: 4, color: col });
    });

    return plots;
}
