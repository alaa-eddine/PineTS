async function SQZMOM(tickerId, timeframe = "1w", periods = 500, stime, etime) {
  const pineTS = new PineTS(
    PineTS.Provider.Binance,
    tickerId,
    timeframe,
    periods,
    stime,
    etime
  );

  const { result, plots } = await pineTS.run((context) => {
    // This is a PineTS port of "Squeeze Momentum Indicator" indicator by LazyBear
    // List of all his indicators: https://www.tradingview.com/v/4IneGo8h/
    const { close, high, low } = context.data;

    const ta = context.ta;
    const math = context.math;

    const input = context.input;
    const { plot, plotchar, nz, color } = context.core;

    const length = input.int(20, "BB Length");
    const mult = input.float(2.0, "BB MultFactor");
    const lengthKC = input.int(20, "KC Length");
    const multKC = input.float(1.5, "KC MultFactor");

    const useTrueRange = input.bool(true, "Use TrueRange (KC)");

    // Calculate BB
    let source = close;
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

    const sqzOn = lowerBB > lowerKC && upperBB < upperKC;
    const sqzOff = lowerBB < lowerKC && upperBB > upperKC;
    const noSqz = sqzOn == false && sqzOff == false;

    const val = ta.linreg(
      source -
        math.avg(
          math.avg(ta.highest(high, lengthKC), ta.lowest(low, lengthKC)),
          ta.sma(close, lengthKC)
        ),
      lengthKC,
      0
    );

    const iff_1 = val > nz(val[1]) ? color.lime : color.green;
    const iff_2 = val < nz(val[1]) ? color.red : color.maroon;
    const bcolor = val > 0 ? iff_1 : iff_2;
    const scolor = noSqz ? color.blue : sqzOn ? color.black : color.gray;
    plot(val, "Momentum", { color: bcolor, style: "histogram", linewidth: 4 });
    plot(0, "Cross", { color: scolor, style: "cross", linewidth: 2 });
  });

  return plots;
}
