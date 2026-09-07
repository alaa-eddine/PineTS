(context) => {
    const { close } = context.data;
    const { bar_index } = context.pine;
    const ta = context.ta;
    const math = context.math;
    const input = context.input;
    const { plot, plotchar, nz } = context.pine;

    const conv = input.int(50, 'Convergence Factor');
    const length = input.int(20, 'Length');
    const src = close;

    var max = 0.0;
    var min = 0.0;

    max = nz(math.max(src, max - (max - src) / conv), src);
    min = nz(math.min(src, min + (src - min) / conv), src);
    const diff = math.log(max - min);

    const psi = -50 * ta.correlation(diff, bar_index, length) + 50;
    const squeezed = psi > 80;

    plotchar(squeezed, '_plotchar');
    plot(psi, '_plot');

    return {
        max,
        min,
        diff,
        psi,
        squeezed,
    };
};
