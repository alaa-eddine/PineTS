(context) => {
    const { close } = context.data;
    const ta = context.ta;
    const math = context.math;
    const input = context.input;
    const { plot, plotchar } = context.pine;

    const length = input.int(14, 'Length');
    const mult = input.float(1.0, 'Mult');
    const src = close;

    const dev = ta.stdev(src, length) * mult;
    const basis = ta.ema(src, length);

    const upper = basis + dev;
    const lower = basis - dev;

    let bull = 0.0;
    let bear = 0.0;
    let bull_den = 0.0;
    let bear_den = 0.0;

    for (let i = 0; i < length; i++) {
        bull += math.max(src[i] - upper[i], 0);
        bear += math.max(lower[i] - src[i], 0);
        bull_den += math.abs(src[i] - upper[i]);
        bear_den += math.abs(lower[i] - src[i]);
    }

    bull = (bull / bull_den) * 100;
    bear = (bear / bear_den) * 100;
    const bullish = bull > bear;

    plotchar(bullish, '_plotchar');
    plot(bull, '_plot');

    return {
        upper,
        lower,
        bull,
        bear,
        bullish,
    };
};
