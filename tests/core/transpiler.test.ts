import { describe, expect, it } from 'vitest';

import { transpile } from 'transpiler';

/**
 * The goal of this test is to ensure the stability of the transpiler.
 * Since it does some complex code transformations,
 * any update in the transpiler logic can lead to unexpected consequences.
 * If the modifier part breaks previously working logic, this test will fail.
 */
describe('Transpiler', () => {
    it('Native Types', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close, open, high, low, hlc3, volume } = context.data;
            const ta = context.ta;
            const math = context.math;
            const plotchar = context.plotchar;
        };

        let transpiled = transformer(source);

        console.log(transpiled.toString());
        const result = transpiled.toString().trim();

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close, open, high, low, hlc3, volume} = $.data;
  const ta = $.ta;
  const math = $.math;
  const plotchar = $.plotchar;
}`;

        expect(result).toBe(expected_code);
    });

    it('Variables and constants Initialization', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;
            const ta = context.ta;
            const math = context.math;
            const _close = close;
            const _close1 = close[1];
            const _myConst = 10;
            let sma = ta.sma(close, 20);

            let aa = 10;
            let _cc = close;
            let bb = 1;
            let cc = close;
            cc = close[1];
            cc = bb[2];
            cc = aa[bb];
            let dd = close[1];
            let ee = close[aa];
            let ff = close[aa[99]];

            let cc0 = _cc;
            let cc1 = _cc[1];
            let cc2 = _cc[aa];
            let cc3 = _cc[aa[99]];

            const tr1 = ta.ema(close, 14);
            const tr2 = ta.ema(close[199], 14);
            const tr3 = ta.ema(_cc, 14);
            const tr4 = ta.ema(_cc[1], 14);

            const tr5 = ta.ema(_cc[aa[99]], 14);

            let ap = close;
            let d = ta.ema(math.abs(ap - 99), 10);
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  const ta = $.ta;
  const math = $.math;
  $.const.glb1__close = $.init($.const.glb1__close, close);
  $.const.glb1__close1 = $.init($.const.glb1__close1, close, 1);
  $.const.glb1__myConst = $.init($.const.glb1__myConst, 10);
  $.let.glb1_sma = $.init($.let.glb1_sma, ta.sma(ta.param(close, undefined, 'p0'), ta.param(20, undefined, 'p1')));
  $.let.glb1_aa = $.init($.let.glb1_aa, 10);
  $.let.glb1__cc = $.init($.let.glb1__cc, close);
  $.let.glb1_bb = $.init($.let.glb1_bb, 1);
  $.let.glb1_cc = $.init($.let.glb1_cc, close);
  $.let.glb1_cc[0] = close[1];
  $.let.glb1_cc[0] = $.let.glb1_bb[2];
  $.let.glb1_cc[0] = $.let.glb1_aa[$.let.glb1_bb[0]];
  $.let.glb1_dd = $.init($.let.glb1_dd, close, 1);
  $.let.glb1_ee = $.init($.let.glb1_ee, close, $.let.glb1_aa[0]);
  $.let.glb1_ff = $.init($.let.glb1_ff, close, $.let.glb1_aa[99]);
  $.let.glb1_cc0 = $.init($.let.glb1_cc0, $.let.glb1__cc, 0);
  $.let.glb1_cc1 = $.init($.let.glb1_cc1, $.let.glb1__cc, 1);
  $.let.glb1_cc2 = $.init($.let.glb1_cc2, $.let.glb1__cc, $.let.glb1_aa[0]);
  $.let.glb1_cc3 = $.init($.let.glb1_cc3, $.let.glb1__cc, $.let.glb1_aa[99]);
  $.const.glb1_tr1 = $.init($.const.glb1_tr1, ta.ema(ta.param(close, undefined, 'p2'), ta.param(14, undefined, 'p3')));
  $.const.glb1_tr2 = $.init($.const.glb1_tr2, ta.ema(ta.param(close, 199, 'p4'), ta.param(14, undefined, 'p5')));
  $.const.glb1_tr3 = $.init($.const.glb1_tr3, ta.ema(ta.param($.let.glb1__cc, undefined, 'p6'), ta.param(14, undefined, 'p7')));
  $.const.glb1_tr4 = $.init($.const.glb1_tr4, ta.ema(ta.param($.let.glb1__cc, 1, 'p8'), ta.param(14, undefined, 'p9')));
  $.const.glb1_tr5 = $.init($.const.glb1_tr5, ta.ema(ta.param($.let.glb1__cc, aa[99], 'p10'), ta.param(14, undefined, 'p11')));
  $.let.glb1_ap = $.init($.let.glb1_ap, close);
  $.let.glb1_d = $.init($.let.glb1_d, ta.ema(ta.param(math.abs(math.param($.let.glb1_ap[0] - 99, undefined, 'p12')), undefined, 'p13'), ta.param(10, undefined, 'p14')));
}`;

        expect(result).toBe(expected_code);
    });

    it('Variables Reassignments', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;
            const ta = context.ta;

            let sma = ta.sma(close, 20);
            sma = ta.sma(close, 22);
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  const ta = $.ta;
  $.let.glb1_sma = $.init($.let.glb1_sma, ta.sma(ta.param(close, undefined, 'p0'), ta.param(20, undefined, 'p1')));
  $.let.glb1_sma[0] = ta.sma(ta.param(close, undefined, 'p2'), ta.param(22, undefined, 'p3'));
}`;

        expect(result).toBe(expected_code);
    });

    it('Time Series annotations ', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;
            const ta = context.ta;

            let sma = ta.sma(close, 20);
            sma = sma[1];

            const period = 14;
            sma = ta.sma(close, period);
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  const ta = $.ta;
  $.let.glb1_sma = $.init($.let.glb1_sma, ta.sma(ta.param(close, undefined, 'p0'), ta.param(20, undefined, 'p1')));
  $.let.glb1_sma[0] = $.let.glb1_sma[1];
  $.const.glb1_period = $.init($.const.glb1_period, 14);
  $.let.glb1_sma[0] = ta.sma(ta.param(close, undefined, 'p2'), ta.param($.const.glb1_period, undefined, 'p3'));
}`;

        expect(result).toBe(expected_code);
    });

    it('Binary Operators', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close, open } = context.data;
            const ta = context.ta;

            const green_candle = close > open;
            const red_candle = close < open;

            const previous_green_candle = green_candle[1];

            const ema9 = ta.ema(close[1], 9);
            const ema18 = ta.ema(close[1], 18);

            const bull_bias = ema9 > ema18;
            const bear_bias = ema9 < ema18;
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close, open} = $.data;
  const ta = $.ta;
  $.const.glb1_green_candle = $.init($.const.glb1_green_candle, close[0] > open[0]);
  $.const.glb1_red_candle = $.init($.const.glb1_red_candle, close[0] < open[0]);
  $.const.glb1_previous_green_candle = $.init($.const.glb1_previous_green_candle, $.const.glb1_green_candle, 1);
  $.const.glb1_ema9 = $.init($.const.glb1_ema9, ta.ema(ta.param(close, 1, 'p0'), ta.param(9, undefined, 'p1')));
  $.const.glb1_ema18 = $.init($.const.glb1_ema18, ta.ema(ta.param(close, 1, 'p2'), ta.param(18, undefined, 'p3')));
  $.const.glb1_bull_bias = $.init($.const.glb1_bull_bias, $.const.glb1_ema9[0] > $.const.glb1_ema18[0]);
  $.const.glb1_bear_bias = $.init($.const.glb1_bear_bias, $.const.glb1_ema9[0] < $.const.glb1_ema18[0]);
}`;

        expect(result).toBe(expected_code);
    });

    it('Conditional Assignment', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close, open } = context.data;
            const ta = context.ta;

            const green_candle = close > open ? 1 : 0;

            const bull_bias = ta.ema(close, 9) > ta.ema(close, 18) ? 1 : 0;
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close, open} = $.data;
  const ta = $.ta;
  $.const.glb1_green_candle = $.init($.const.glb1_green_candle, close[0] > open[0] ? 1 : 0);
  $.const.glb1_bull_bias = $.init($.const.glb1_bull_bias, ta.ema(ta.param(close, undefined, 'p0'), ta.param(9, undefined, 'p1')) > ta.ema(ta.param(close, undefined, 'p2'), ta.param(18, undefined, 'p3')) ? 1 : 0);
}`;

        expect(result).toBe(expected_code);
    });

    it('Conditions', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;
            const _cc = close;

            let aa = 0;

            if (_cc > 1) {
                let bb = 1;
                let cc = close;
                let dd = close[1];
                let ee = close[aa];
                let ff = close[aa[99]];

                let cc0 = _cc;
                let cc1 = _cc[1];
                let cc2 = _cc[aa];
                let cc3 = _cc[aa[99]];

                aa = 1;
            }
            if (_cc[0] > 1) {
                aa = 2;
            }
            if (_cc[1] > 1) {
                aa = 3;
            }
            if (_cc[aa] > 1) {
                aa = 3;
            }
            if (_cc[aa[0]] > 1) {
                aa = 3;
            }
            if (_cc[aa[1]] > 1) {
                aa = 3;
            }
            if (close > 1) {
                aa = 4;
            }
            if (close[0] > 1) {
                aa = 5;
            }
            if (close[1] > 1) {
                aa = 6;
            }
            if (close[aa] > 1) {
                aa = 6;
            }
            if (close[aa[1]] > 1) {
                aa = 6;
            }
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  $.const.glb1__cc = $.init($.const.glb1__cc, close);
  $.let.glb1_aa = $.init($.let.glb1_aa, 0);
  if ($.const.glb1__cc[0] > 1) {
    $.let.if2_bb = $.init($.let.if2_bb, 1);
    $.let.if2_cc = $.init($.let.if2_cc, close);
    $.let.if2_dd = $.init($.let.if2_dd, close, 1);
    $.let.if2_ee = $.init($.let.if2_ee, close, $.let.glb1_aa[0]);
    $.let.if2_ff = $.init($.let.if2_ff, close, $.let.glb1_aa[99]);
    $.let.if2_cc0 = $.init($.let.if2_cc0, $.const.glb1__cc, 0);
    $.let.if2_cc1 = $.init($.let.if2_cc1, $.const.glb1__cc, 1);
    $.let.if2_cc2 = $.init($.let.if2_cc2, $.const.glb1__cc, $.let.glb1_aa[0]);
    $.let.if2_cc3 = $.init($.let.if2_cc3, $.const.glb1__cc, $.let.glb1_aa[99]);
    $.let.glb1_aa[0] = 1;
  }
  if ($.const.glb1__cc[0] > 1) {
    $.let.glb1_aa[0] = 2;
  }
  if ($.const.glb1__cc[1] > 1) {
    $.let.glb1_aa[0] = 3;
  }
  if ($.const.glb1__cc[$.let.glb1_aa[0]] > 1) {
    $.let.glb1_aa[0] = 3;
  }
  if ($.const.glb1__cc[$.let.glb1_aa[0]] > 1) {
    $.let.glb1_aa[0] = 3;
  }
  if ($.const.glb1__cc[$.let.glb1_aa[1]] > 1) {
    $.let.glb1_aa[0] = 3;
  }
  if (close[0] > 1) {
    $.let.glb1_aa[0] = 4;
  }
  if (close[0] > 1) {
    $.let.glb1_aa[0] = 5;
  }
  if (close[1] > 1) {
    $.let.glb1_aa[0] = 6;
  }
  if (close[$.let.glb1_aa[0]] > 1) {
    $.let.glb1_aa[0] = 6;
  }
  if (close[$.let.glb1_aa[1]] > 1) {
    $.let.glb1_aa[0] = 6;
  }
}`;

        expect(result).toBe(expected_code);
    });

    it('For Loops', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;

            let aa = 10;

            let _cc = close;

            for (let i = 0; i < _cc[1]; i++) {
                let bb = 1;
                let cc = close;
                cc = close[1];
                cc = bb[2];
                cc = aa[bb];
                let dd = close[1];
                let ee = close[aa];
                let ff = close[aa[99]];

                let cc0 = _cc;
                let cc1 = _cc[1];
                let cc2 = _cc[aa];
                let cc3 = _cc[aa[99]];
                aa = i;
            }

            for (let i = 0; i < 10; i++) {
                aa = i;
            }

            for (let i = 0; i < aa; i++) {
                _cc = _cc[i];
            }

            for (let i = 0; i < _cc; i++) {
                aa = i;
            }

            for (let i = 0; i < _cc[1]; i++) {
                aa = i;
            }

            for (let i = 0; i < _cc[aa]; i++) {
                aa = i;
            }
            for (let i = 0; i < _cc[aa[99]]; i++) {
                aa = i;
            }
            for (let i = 0; i < close; i++) {
                aa = i;
            }

            for (let i = 0; i < close[1]; i++) {
                aa = i;
            }

            for (let i = 0; i < close[aa]; i++) {
                aa = i;
            }
            for (let i = 0; i < close[aa[99]]; i++) {
                aa = i;
            }
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  $.let.glb1_aa = $.init($.let.glb1_aa, 10);
  $.let.glb1__cc = $.init($.let.glb1__cc, close);
  for (let i = 0; i < $.let.glb1__cc[1]; i++) {
    $.let.for2_bb = $.init($.let.for2_bb, 1);
    $.let.for2_cc = $.init($.let.for2_cc, close);
    $.let.for2_cc[0] = close[1];
    $.let.for2_cc[0] = $.let.for2_bb[2];
    $.let.for2_cc[0] = $.let.glb1_aa[$.let.for2_bb[0]];
    $.let.for2_dd = $.init($.let.for2_dd, close, 1);
    $.let.for2_ee = $.init($.let.for2_ee, close, $.let.glb1_aa[0]);
    $.let.for2_ff = $.init($.let.for2_ff, close, $.let.glb1_aa[99]);
    $.let.for2_cc0 = $.init($.let.for2_cc0, $.let.glb1__cc, 0);
    $.let.for2_cc1 = $.init($.let.for2_cc1, $.let.glb1__cc, 1);
    $.let.for2_cc2 = $.init($.let.for2_cc2, $.let.glb1__cc, $.let.glb1_aa[0]);
    $.let.for2_cc3 = $.init($.let.for2_cc3, $.let.glb1__cc, $.let.glb1_aa[99]);
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < 10; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < $.let.glb1_aa[0]; i++) {
    $.let.glb1__cc[0] = $.let.glb1__cc[i];
  }
  for (let i = 0; i < $.let.glb1__cc[0]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < $.let.glb1__cc[1]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < $.let.glb1__cc[$.let.glb1_aa[0]]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < $.let.glb1__cc[$.let.glb1_aa[99]]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < close[0]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < close[1]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < close[$.let.glb1_aa[0]]; i++) {
    $.let.glb1_aa[0] = i;
  }
  for (let i = 0; i < close[$.let.glb1_aa[99]]; i++) {
    $.let.glb1_aa[0] = i;
  }
}`;

        expect(result).toBe(expected_code);
    });

    it('functions', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;
            const ta = context.ta;
            const math = context.math;
            const _cc = close;

            const aa = 1;
            function angle(src) {
                const rad2degree = 180 / Math.PI; //pi
                const ang: any = rad2degree * math.atan((src[0] - src[1]) / ta.atr(14));
                return ang;
            }
            function get_average(avg_src, avg_len) {
                let bb = 1;
                let cc = close;
                cc = close[1];
                cc = bb[2];
                cc = aa[bb];
                let dd = close[1];
                let ee = close[aa];
                let ff = close[aa[99]];

                let cc0 = _cc;
                let cc1 = _cc[1];
                let cc2 = _cc[aa];
                let cc3 = _cc[aa[99]];

                let ret_val = 0.0;
                for (let i = 1; i <= avg_len; i++) {
                    ret_val += avg_src[i];
                }

                if (avg_len === 0) {
                    ret_val = cc[1];
                }
                return ret_val / avg_len;
            }

            const r1 = get_average(close, 14);
            const r2 = get_average(close[1], 14);
            const r3 = get_average(_cc, 14);
            const r4 = get_average(_cc[1], 14);

            let ra = 0;
            ra = get_average(close, 14);
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  const ta = $.ta;
  const math = $.math;
  $.const.glb1__cc = $.init($.const.glb1__cc, close);
  $.const.glb1_aa = $.init($.const.glb1_aa, 1);
  function angle(src) {
    $.const.fn1_rad2degree = $.init($.const.fn1_rad2degree, 180 / Math.PI);
    $.const.fn1_ang = $.init($.const.fn1_ang, $.const.fn1_rad2degree[0] * math.atan(math.param(math.param(src[0] - src[1], undefined, 'p0') / ta.atr(ta.param(14, undefined, 'p1')), undefined, 'p2')));
    return $.precision($.const.fn1_ang[0]);
  }
  function get_average(avg_src, avg_len) {
    $.let.fn2_bb = $.init($.let.fn2_bb, 1);
    $.let.fn2_cc = $.init($.let.fn2_cc, close);
    $.let.fn2_cc[0] = close[1];
    $.let.fn2_cc[0] = $.let.fn2_bb[2];
    $.let.fn2_cc[0] = $.let.aa[$.let.fn2_bb[0]];
    $.let.fn2_dd = $.init($.let.fn2_dd, close, 1);
    $.let.fn2_ee = $.init($.let.fn2_ee, close, $.let.aa[0]);
    $.let.fn2_ff = $.init($.let.fn2_ff, close, $.let.aa[99]);
    $.let.fn2_cc0 = $.init($.let.fn2_cc0, $.let._cc, 0);
    $.let.fn2_cc1 = $.init($.let.fn2_cc1, $.let._cc, 1);
    $.let.fn2_cc2 = $.init($.let.fn2_cc2, $.let._cc, $.let.aa[0]);
    $.let.fn2_cc3 = $.init($.let.fn2_cc3, $.let._cc, $.let.aa[99]);
    $.let.fn2_ret_val = $.init($.let.fn2_ret_val, 0);
    for (let i = 1; i <= avg_len[0]; i++) {
      $.let.fn2_ret_val[0] += avg_src[i];
    }
    if (avg_len[0] === 0) {
      $.let.fn2_ret_val[0] = $.let.fn2_cc[1];
    }
    return $.precision($.let.fn2_ret_val[0] / avg_len[0]);
  }
  $.const.glb1_r1 = $.init($.const.glb1_r1, get_average($.param(close, undefined, 'p3'), $.param(14, undefined, 'p4')));
  $.const.glb1_r2 = $.init($.const.glb1_r2, get_average($.param(close, 1, 'p5'), $.param(14, undefined, 'p6')));
  $.const.glb1_r3 = $.init($.const.glb1_r3, get_average($.param($.const.glb1__cc, undefined, 'p7'), $.param(14, undefined, 'p8')));
  $.const.glb1_r4 = $.init($.const.glb1_r4, get_average($.param($.const.glb1__cc, 1, 'p9'), $.param(14, undefined, 'p10')));
  $.let.glb1_ra = $.init($.let.glb1_ra, 0);
  $.let.glb1_ra[0] = get_average($.param(close, undefined, 'p11'), $.param(14, undefined, 'p12'));
}`;

        expect(result).toBe(expected_code);
    });

    it('arrow functions', async () => {
        const fakeContext = {};
        const transformer = transpile.bind(fakeContext);

        const source = (context) => {
            const { close } = context.data;
            const ta = context.ta;
            const _cc = close;

            const aa = 1;

            const get_average = (avg_src, avg_len) => {
                let bb = 1;
                let cc = close;
                cc = close[1];
                cc = bb[2];
                cc = aa[bb];
                let dd = close[1];
                let ee = close[aa];
                let ff = close[aa[99]];

                let cc0 = _cc;
                let cc1 = _cc[1];
                let cc2 = _cc[aa];
                let cc3 = _cc[aa[99]];

                let ret_val = 0.0;
                for (let i = 1; i <= avg_len; i++) {
                    ret_val += avg_src[i];
                }

                if (avg_len === 0) {
                    ret_val = cc[1];
                }
                return ret_val / avg_len;
            };

            const r1 = get_average(close, 14);
            const r2 = get_average(close[1], 14);
            const r3 = get_average(_cc, 14);
            const r4 = get_average(_cc[1], 14);

            let ra = 0;
            ra = get_average(close, 14);
        };
        let transpiled = transformer(source);

        const result = transpiled.toString().trim();
        console.log(result);

        /* prettier-ignore */
        const expected_code = `$ => {
  const {close} = $.data;
  const ta = $.ta;
  $.const.glb1__cc = $.init($.const.glb1__cc, close);
  $.const.glb1_aa = $.init($.const.glb1_aa, 1);
  function get_average(avg_src, avg_len) {
    $.let.fn1_bb = $.init($.let.fn1_bb, 1);
    $.let.fn1_cc = $.init($.let.fn1_cc, close);
    $.let.fn1_cc[0] = close[1];
    $.let.fn1_cc[0] = $.let.fn1_bb[2];
    $.let.fn1_cc[0] = $.let.aa[$.let.fn1_bb[0]];
    $.let.fn1_dd = $.init($.let.fn1_dd, close, 1);
    $.let.fn1_ee = $.init($.let.fn1_ee, close, $.let.aa[0]);
    $.let.fn1_ff = $.init($.let.fn1_ff, close, $.let.aa[99]);
    $.let.fn1_cc0 = $.init($.let.fn1_cc0, $.let._cc, 0);
    $.let.fn1_cc1 = $.init($.let.fn1_cc1, $.let._cc, 1);
    $.let.fn1_cc2 = $.init($.let.fn1_cc2, $.let._cc, $.let.aa[0]);
    $.let.fn1_cc3 = $.init($.let.fn1_cc3, $.let._cc, $.let.aa[99]);
    $.let.fn1_ret_val = $.init($.let.fn1_ret_val, 0);
    for (let i = 1; i <= avg_len[0]; i++) {
      $.let.fn1_ret_val[0] += avg_src[i];
    }
    if (avg_len[0] === 0) {
      $.let.fn1_ret_val[0] = $.let.fn1_cc[1];
    }
    return $.precision($.let.fn1_ret_val[0] / avg_len[0]);
  }
  $.const.glb1_r1 = $.init($.const.glb1_r1, get_average($.param(close, undefined, 'p0'), $.param(14, undefined, 'p1')));
  $.const.glb1_r2 = $.init($.const.glb1_r2, get_average($.param(close, 1, 'p2'), $.param(14, undefined, 'p3')));
  $.const.glb1_r3 = $.init($.const.glb1_r3, get_average($.param($.const.glb1__cc, undefined, 'p4'), $.param(14, undefined, 'p5')));
  $.const.glb1_r4 = $.init($.const.glb1_r4, get_average($.param($.const.glb1__cc, 1, 'p6'), $.param(14, undefined, 'p7')));
  $.let.glb1_ra = $.init($.let.glb1_ra, 0);
  $.let.glb1_ra[0] = get_average($.param(close, undefined, 'p8'), $.param(14, undefined, 'p9'));
}`;

        expect(result).toBe(expected_code);
    });
});
