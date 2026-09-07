// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { IProvider, ISymbolInfo } from './marketData/IProvider';
import { PineArray } from './namespaces/array/array.index';
import { PineMap } from './namespaces/map/map.index';
import { PineMatrix } from './namespaces/matrix/matrix.index';
import { Barstate } from './namespaces/Barstate';
import { Session } from './namespaces/Session';
import { Core, NAHelper, AlertHelper } from './namespaces/Core';
import { PineColor } from './namespaces/color/PineColor';
import { TimeHelper, TimeComponentHelper, EXTRACTORS, getDatePartsInTimezone } from './namespaces/Time';
import { Input } from './namespaces/input/input.index';
import PineMath from './namespaces/math/math.index';
import { PineRequest } from './namespaces/request/request.index';
import TechnicalAnalysis from './namespaces/ta/ta.index';
import { PineTypeObject } from './namespaces/PineTypeObject';
import { Strategy, StrategyState } from './namespaces/strategy/strategy.index';
import { Series } from './Series';
import { Log } from './namespaces/Log';
import { Runtime } from './namespaces/Runtime';
import { Str } from './namespaces/Str';
import types, { display, shape } from './namespaces/Types';
import { Timeframe } from './namespaces/Timeframe';
import { FillHelper, HlineHelper, PlotHelper } from './namespaces/Plots';
import { ChartHelper } from './namespaces/chart/ChartHelper';
import { LabelHelper } from './namespaces/label/LabelHelper';
import { LineHelper } from './namespaces/line/LineHelper';
import { BoxHelper } from './namespaces/box/BoxHelper';
import { LinefillHelper } from './namespaces/linefill/LinefillHelper';
import { PolylineHelper } from './namespaces/polyline/PolylineHelper';
import { TableHelper } from './namespaces/table/TableHelper';
import { FootprintHelper } from './namespaces/footprint/FootprintHelper';
import { VolumeRowHelper } from './namespaces/footprint/VolumeRowHelper';
import { Ticker } from './namespaces/Ticker';
import type { IndicatorOptions } from './types/PineTypes';

export class Context {
    public data: any = {
        open: new Series([]),
        high: new Series([]),
        low: new Series([]),
        close: new Series([]),
        volume: new Series([]),
        hl2: new Series([]),
        hlc3: new Series([]),
        ohlc4: new Series([]),
        hlcc4: new Series([]),
        bar_index: new Series([]),
    };
    public indicator: IndicatorOptions;
    public cache: any = {};
    public taState: any = {}; // State for incremental TA calculations
    public strategy?: StrategyState; // State for strategy calculations
    public isSecondaryContext: boolean = false; // Flag to prevent infinite recursion in request.security
    public chartTimezone: string | null = null; // Chart display timezone (affects log timestamps only, not computation)
    public chartStyle: string = 'standard'; // Chart type DERIVED from the ticker's chart-type modifier ("SYM;heikinashi") at context init; read by chart.is_*
    public dataVersion: number = 0; // Incremented when market data changes (streaming mode)

    public __maxLoops: number = 500000;
    public NA: any = NaN;

    /** Runtime warnings (OOB access, etc.) — non-blocking, script continues. */
    public warnings: { message: string; method?: string; bar: number }[] = [];

    /** Alert events emitted by alert() and alertcondition() calls. */
    public alerts: { type: string; id: string; message: string; title?: string; freq?: string; bar_index: number; time: number }[] = [];

    /** Alert mode: 'realtime' = only fire on live bars (TV behavior), 'all' = fire on every bar (backtest). */
    public _alertMode: 'realtime' | 'all' = 'realtime';

    /** Name-keyed map of declaration-prop overrides from `Indicator.prop`. Layered on top of
     *  the source's `indicator()`/`strategy()` call args inside the per-bar handlers
     *  (see Core.indicator and initializeStrategy). Empty object when no overrides are set. */
    public _propOverrides: Record<string, unknown> = {};

    /** Monotonically increasing counter, incremented each time a bar starts executing.
     *  Used by alertcondition/AlertHelper to detect re-execution of the same bar. */
    public _execTick: number = 0;

    /** Emit a runtime warning. The script continues execution (returns na/no-op). */
    public warn(message: string, method?: string): void {
        this.warnings.push({ message, method, bar: this.idx });
    }

    public lang: any;
    public length: number = 0;

    /** References to drawing helpers for streaming rollback and plot sync */
    public _drawingHelpers: { rollbackFromBar(barIdx: number): void; syncToPlot?(): void }[] = [];

    // Combined namespace and core functions - the default way to access everything
    public pine: {
        // input: Input;
        // ta: TechnicalAnalysis;
        // math: PineMath;
        // request: PineRequest;
        // array: PineArray;
        // map: PineMap;
        // matrix: PineMatrix;
        // na: () => any;
        // plotchar: (...args: any[]) => any;
        // color: any;
        // plot: (...args: any[]) => any;
        // nz: (...args: any[]) => any;
        // bar_index: number;
        // syminfo: ISymbolInfo;
        // barstate: Barstate;
        // log: Log;
        // str: Str;
        // timeframe: Timeframe;
        [key: string]: any;
    };

    // Track deprecation warnings to avoid spam
    private static _deprecationWarningsShown = new Set<string>();

    public idx: number = 0;

    public params: any = {};
    public const: any = {};
    public var: any = {};
    public let: any = {};
    public lctx: Map<string, any> = new Map();

    public result: any = undefined;
    public plots: any = {};

    public marketData: any;
    public source: IProvider | any[];
    public tickerId: string;
    public timeframe: string = '';
    public limit: number;
    public sDate: number;
    public eDate: number;
    public fullContext: Context;

    // Host-bound viewport state. PineTS.setVisibleRange() flows these in via
    // _initializeContext. Undefined means "no override" — ChartHelper falls
    // back to marketData[0]/[last].openTime.
    public viewportLeft: number | undefined = undefined;
    public viewportRight: number | undefined = undefined;

    public pineTSCode: Function | String;

    public inputs: Record<string, any> = {};

    constructor({
        marketData,
        source,
        tickerId,
        timeframe,
        limit,
        sDate,
        eDate,
        fullContext,
        inputs,
    }: {
        marketData: any;
        source: IProvider | any[];
        tickerId?: string;
        timeframe?: string;
        limit?: number;
        sDate?: number;
        eDate?: number;
        fullContext?: Context;
        inputs?: Record<string, any>;
    }) {
        this.marketData = marketData;
        this.source = source;
        this.tickerId = tickerId;
        this.timeframe = timeframe;
        this.limit = limit;
        this.sDate = sDate;
        this.eDate = eDate;
        this.fullContext = fullContext || this;
        this.inputs = inputs || {};
        // console.log('Context initialized with inputs keys:', Object.keys(this.inputs));
        // Initialize core functions
        const core = new Core(this);
        const coreFunctions = {
            Type: core.Type.bind(core),

            na: new NAHelper(),

            nz: core.nz.bind(core),
            indicator: core.indicator.bind(core),
            fixnan: core.fixnan.bind(core),
            alertcondition: core.alertcondition.bind(core),
            alert: new AlertHelper(this),
            error: core.error.bind(core),
            max_bars_back: core.max_bars_back.bind(core),
            timestamp: core.timestamp.bind(core),
            time: new TimeHelper(this, 'openTime'),
            time_close: new TimeHelper(this, 'closeTime'),
            dayofmonth: new TimeComponentHelper(this, EXTRACTORS.dayofmonth),
            dayofweek: new TimeComponentHelper(this, EXTRACTORS.dayofweek),
            hour: new TimeComponentHelper(this, EXTRACTORS.hour),
            minute: new TimeComponentHelper(this, EXTRACTORS.minute),
            month: new TimeComponentHelper(this, EXTRACTORS.month),
            second: new TimeComponentHelper(this, EXTRACTORS.second),
            weekofyear: new TimeComponentHelper(this, EXTRACTORS.weekofyear),
            year: new TimeComponentHelper(this, EXTRACTORS.year),
            //types
            bool: core.bool.bind(core),
            int: core.int.bind(core),
            float: core.float.bind(core),
            string: core.string.bind(core),
        };

        // Initialize everything directly in pine - the default way to access everything
        const _this = this;
        this.pine = {
            input: new Input(this),
            ta: new TechnicalAnalysis(this),
            math: new PineMath(this),
            request: new PineRequest(this),
            array: new PineArray(this),
            map: new PineMap(this),
            matrix: new PineMatrix(this),
            ticker: new Ticker(this),
            strategy: new Strategy(this),

            syminfo: null,
            timeframe: new Timeframe(this),
            //FIXME : this is a temporary solution to get the barstate values,
            //we need to implement a better way to handle realtime states
            barstate: new Barstate(this),
            session: new Session(this),
            get bar_index() {
                return _this.data.bar_index;
            },
            get last_bar_index() {
                // TV semantics: `last_bar_index` is the bar_index of the LAST
                // bar of the chart's history — a CONSTANT across the whole
                // historical run (it only grows when new realtime bars are
                // appended). `bar_index` values are the raw indices into the
                // full preloaded `marketData` array, so its last index is the
                // constant we need. Falling back to the progressively-fed
                // `data.close` window (current bar's index) is best-effort if
                // marketData isn't available.
                const md = _this.marketData;
                if (Array.isArray(md) && md.length > 0) {
                    return md.length - 1;
                }
                return _this.data.close.length - 1;
            },
            get last_bar_time() {
                // TV semantics: `last_bar_time` is the open time of the LAST
                // bar of the chart's history — a CONSTANT across the whole
                // script execution, even when iterating over historical bars.
                // PineTS has the full preloaded series on `marketData`, so we
                // read the absolute last bar's openTime there. Falling back
                // to the progressively-fed `data.openTime` (current bar's
                // time) is best-effort if marketData isn't available.
                const md = _this.marketData;
                if (Array.isArray(md) && md.length > 0) {
                    return md[md.length - 1].openTime;
                }
                return _this.data.openTime.get(0);
            },
            get timenow() {
                return new Date().getTime();
            },
            get time_tradingday() {
                // TradingView returns 00:00 UTC of the trading day the bar belongs to.
                // For daily+ timeframes on 24/7 markets, this equals the bar's close date
                // (i.e. the date the bar settles / completes).
                const closeTime = Series.from(_this.data.closeTime).get(0);
                if (isNaN(closeTime)) return NaN;
                const timezone = _this.pine?.syminfo?.timezone || 'UTC';
                const parts = getDatePartsInTimezone(closeTime, timezone);
                return Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
            },
            get inputs() {
                return _this.inputs;
            },
            log: new Log(this),
            runtime: new Runtime(this),
            str: new Str(this),
            // linefill namespace will be bound below via bindContextObject
            ...coreFunctions,
            ...types,
        };

        // Merge dayofweek enum constants onto the dual-use TimeComponentHelper.
        // The ...types spread above overwrites coreFunctions.dayofweek with the enum,
        // so we restore the TimeComponentHelper and attach the enum constants to it.
        const dowComponent = coreFunctions.dayofweek as any;
        Object.assign(dowComponent, { sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 });
        this.pine.dayofweek = dowComponent;

        const plotHelper = new PlotHelper(this);
        const hlineHelper = new HlineHelper(this);
        const fillHelper = new FillHelper(this);
        this.bindContextObject(plotHelper, ['plotchar', 'plotshape', 'plotarrow', 'plotbar', 'plotcandle', 'bgcolor', 'barcolor']);
        this.bindContextObject(
            plotHelper,
            [
                'any',
                'param',
                'linestyle_dashed',
                'linestyle_dotted',
                'linestyle_solid',
                'style_area',
                'style_areabr',
                'style_circles',
                'style_columns',
                'style_cross',
                'style_histogram',
                'style_line',
                'style_linebr',
                'style_stepline',
                'style_stepline_diamond',
                'style_steplinebr',
            ],
            'plot',
        );

        this.bindContextObject(hlineHelper, ['any', 'style_dashed', 'style_solid', 'style_dotted', 'param'], 'hline');
        this.bindContextObject(fillHelper, ['any', 'param'], 'fill');

        // chart namespace (with nested chart.point sub-namespace)
        const chartHelper = new ChartHelper(this);
        this.pine['chart'] = {
            param: chartHelper.param.bind(chartHelper),
            bg_color: chartHelper.bg_color.bind(chartHelper),
            fg_color: chartHelper.fg_color.bind(chartHelper),
            // Chart-type predicates are Pine VARIABLES (`chart.is_heikinashi`, no call) —
            // exposed as getters so bare member access yields the boolean, like the
            // visible-range built-ins below.
            get is_standard() { return chartHelper.is_standard(); },
            get is_heikinashi() { return chartHelper.is_heikinashi(); },
            get is_kagi() { return chartHelper.is_kagi(); },
            get is_linebreak() { return chartHelper.is_linebreak(); },
            get is_pnf() { return chartHelper.is_pnf(); },
            get is_range() { return chartHelper.is_range(); },
            get is_renko() { return chartHelper.is_renko(); },
            point: chartHelper.point,
            // Visible-range built-ins. Host (e.g. chart UI) overrides via
            // PineTS.setVisibleRange(); fallback is the loaded data range.
            get left_visible_bar_time() {
                if (_this.viewportLeft !== undefined) return _this.viewportLeft;
                const md = _this.marketData;
                return Array.isArray(md) && md.length > 0 ? md[0].openTime : NaN;
            },
            get right_visible_bar_time() {
                if (_this.viewportRight !== undefined) return _this.viewportRight;
                const md = _this.marketData;
                return Array.isArray(md) && md.length > 0 ? md[md.length - 1].openTime : NaN;
            },
        };

        // label namespace
        const labelHelper = new LabelHelper(this);
        this.bindContextObject(
            labelHelper,
            [
                'any',
                'new',
                'param',
                'set_x',
                'set_y',
                'set_xy',
                'set_text',
                'set_color',
                'set_textcolor',
                'set_size',
                'set_style',
                'set_textalign',
                'set_tooltip',
                'set_point',
                'set_xloc',
                'set_yloc',
                'get_x',
                'get_y',
                'get_text',
                'copy',
                'delete',
                // style constants
                'style_label_down',
                'style_label_up',
                'style_label_left',
                'style_label_right',
                'style_label_lower_left',
                'style_label_lower_right',
                'style_label_upper_left',
                'style_label_upper_right',
                'style_label_center',
                'style_circle',
                'style_square',
                'style_diamond',
                'style_flag',
                'style_arrowup',
                'style_arrowdown',
                'style_cross',
                'style_xcross',
                'style_triangleup',
                'style_triangledown',
                'style_none',
                'style_text_outline',
            ],
            'label',
        );
        Object.defineProperty(this.pine['label'], 'all', {
            get: () => labelHelper.all,
        });

        // line namespace
        const lineHelper = new LineHelper(this);
        this.bindContextObject(
            lineHelper,
            [
                'any',
                'new',
                'param',
                'set_x1',
                'set_y1',
                'set_x2',
                'set_y2',
                'set_xy1',
                'set_xy2',
                'set_color',
                'set_width',
                'set_style',
                'set_extend',
                'set_xloc',
                'set_first_point',
                'set_second_point',
                'get_x1',
                'get_y1',
                'get_x2',
                'get_y2',
                'get_price',
                'copy',
                'delete',
                // style constants
                'style_solid',
                'style_dotted',
                'style_dashed',
                'style_arrow_left',
                'style_arrow_right',
                'style_arrow_both',
            ],
            'line',
        );
        Object.defineProperty(this.pine['line'], 'all', {
            get: () => lineHelper.all,
        });

        // box namespace
        const boxHelper = new BoxHelper(this);
        this.bindContextObject(
            boxHelper,
            [
                'any',
                'new',
                'param',
                'copy',
                'delete',
                'set_left',
                'set_right',
                'set_top',
                'set_bottom',
                'set_lefttop',
                'set_rightbottom',
                'set_top_left_point',
                'set_bottom_right_point',
                'set_bgcolor',
                'set_border_color',
                'set_border_width',
                'set_border_style',
                'set_extend',
                'set_xloc',
                'set_text',
                'set_text_color',
                'set_text_size',
                'set_text_halign',
                'set_text_valign',
                'set_text_wrap',
                'set_text_font_family',
                'set_text_formatting',
                'get_left',
                'get_right',
                'get_top',
                'get_bottom',
            ],
            'box',
        );
        Object.defineProperty(this.pine['box'], 'all', {
            get: () => boxHelper.all,
        });

        // linefill namespace
        const linefillHelper = new LinefillHelper(this);
        this.bindContextObject(linefillHelper, ['any', 'new', 'param', 'set_color', 'get_line1', 'get_line2', 'delete'], 'linefill');
        Object.defineProperty(this.pine['linefill'], 'all', {
            get: () => linefillHelper.all,
        });

        // polyline namespace
        const polylineHelper = new PolylineHelper(this);
        this.bindContextObject(polylineHelper, ['any', 'new', 'param', 'delete'], 'polyline');
        Object.defineProperty(this.pine['polyline'], 'all', {
            get: () => polylineHelper.all,
        });

        // table namespace
        const tableHelper = new TableHelper(this);
        this.bindContextObject(
            tableHelper,
            [
                'any',
                'new',
                'param',
                'cell',
                'delete',
                'clear',
                'merge_cells',
                'cell_set_text',
                'cell_set_bgcolor',
                'cell_set_text_color',
                'cell_set_text_size',
                'cell_set_height',
                'cell_set_width',
                'cell_set_tooltip',
                'cell_set_text_halign',
                'cell_set_text_valign',
                'cell_set_text_font_family',
                'set_position',
                'set_bgcolor',
                'set_border_color',
                'set_border_width',
                'set_frame_color',
                'set_frame_width',
            ],
            'table',
        );
        Object.defineProperty(this.pine['table'], 'all', {
            get: () => tableHelper.all,
        });

        // Register all drawing helpers for streaming rollback and plot sync
        this._drawingHelpers = [labelHelper, lineHelper, boxHelper, linefillHelper, polylineHelper, tableHelper];

        // footprint / volume_row namespaces — read-only views over the objects that
        // request.footprint() returns (no drawings, nothing to roll back).
        const footprintHelper = new FootprintHelper(this);
        this.bindContextObject(
            footprintHelper,
            ['any', 'param', 'buy_volume', 'sell_volume', 'total_volume', 'delta', 'poc', 'vah', 'val', 'rows', 'get_row_by_price'],
            'footprint',
        );
        const volumeRowHelper = new VolumeRowHelper(this);
        this.bindContextObject(
            volumeRowHelper,
            ['any', 'param', 'up_price', 'down_price', 'buy_volume', 'sell_volume', 'total_volume', 'delta', 'has_buy_imbalance', 'has_sell_imbalance'],
            'volume_row',
        );

        // color namespace
        const colorHelper = new PineColor(this);
        this.bindContextObject(
            colorHelper,
            [
                'any',
                'param',
                'new',
                'rgb',
                'from_gradient',
                'r',
                'g',
                'b',
                't',
                'aqua',
                'black',
                'blue',
                'fuchsia',
                'gray',
                'green',
                'lime',
                'maroon',
                'navy',
                'olive',
                'orange',
                'purple',
                'red',
                'silver',
                'teal',
                'white',
                'yellow',
            ],
            'color',
        );
    }

    /**
     * Roll back all drawing objects created at or after the given bar index.
     * Called during streaming updates to prevent accumulation when bars are re-processed.
     */
    rollbackDrawings(fromBarIdx: number): void {
        for (const helper of this._drawingHelpers) {
            helper.rollbackFromBar(fromBarIdx);
        }
    }

    private bindContextObject(instance: any, entries: string[], root: string = '') {
        if (root && !this.pine[root]) this.pine[root] = {};

        const target = root ? this.pine[root] : this.pine;
        for (const entry of entries) {
            if (typeof instance[entry] === 'function') {
                target[entry] = instance[entry].bind(instance);
            } else {
                target[entry] = instance[entry];
            }
        }
    }

    //#region [Runtime functions] ===========================

    /**
     * this function is used to initialize the target variable with the source array
     * this array will represent a time series and its values will be shifted at runtime in order to mimic Pine script behavior
     * @param trg - the target variable name : used internally to maintain the series in the execution context
     * @param src - the source data, can be Series, array, or a single value
     * @param idx - the index of the source array, used to get a sub-series of the source data
     * @returns Series object
     */
    init(trg, src: any, idx: number = 0): Series {
        // Extract value from source
        let value;
        if (src instanceof Series) {
            value = src.get(0);
        } else if (Array.isArray(src)) {
            // Handle 2D arrays (tuples wrapped by $.precision() or from request.security)
            // e.g., [[a, b]] from return $.precision([[a, b]]) or request.security tuple
            if (Array.isArray(src[0])) {
                value = src[0];
            } else {
                // Flat 1D array = time-series data (forward-ordered)
                // Extract the element at the right position
                value = src[src.length - 1 + idx];
            }
        } else {
            value = src;
        }

        // If target doesn't exist, create new Series
        if (!trg) {
            return new Series([value]);
        }

        // If target is already a Series, update it
        if (trg instanceof Series) {
            trg.data[trg.data.length - 1] = value;
            return trg;
        }

        // Legacy: if trg is an array, convert to Series
        if (Array.isArray(trg)) {
            trg[trg.length - 1] = value;
            return new Series(trg);
        }

        // Default: create new Series
        return new Series([value]);
    }

    /**
     * Initializes a 'var' variable.
     * - First bar: uses the initial value.
     * - Subsequent bars: maintains the previous value (state).
     * @param trg - The target variable
     * @param src - The source initializer value
     * @returns Series object
     */
    initVar(trg, src: any): Series {
        // If target exists (subsequent bars), return it as is.
        // PineTS automatically shifts context variables by copying the last value,
        // so the previous value is already carried over to the current slot.
        if (trg) {
            return trg;
        }

        // First bar: evaluate thunk if source is a deferred factory call
        if (typeof src === 'function') {
            src = src();
        }

        // Resolve thunks inside PineTypeObject fields (UDT instances).
        // When a `var` declaration initializes a UDT with factory calls like
        // `MyType.new(line.new(...), label.new(...))`, the factory calls are
        // wrapped in thunks to prevent orphan objects on bars 1+. Here on bar 0,
        // we evaluate those thunks to get the actual drawing objects.
        if (src instanceof PineTypeObject) {
            const def = src.__def__;
            for (const key in def) {
                if (typeof src[key] === 'function') {
                    src[key] = src[key]();
                }
            }
        }

        // First bar: Initialize with source value
        let value;
        if (src instanceof Series) {
            value = src.get(0);
        } else if (Array.isArray(src)) {
            if (Array.isArray(src[0])) {
                value = src[0];
            } else {
                value = this.precision(src[src.length - 1]);
            }
        } else {
            value = this.precision(src);
        }

        return new Series([value]);
    }

    /**
     * this function is used to set the floating point precision of a number
     * by default it is set to 10 decimals which is the same as pine script
     * @param n - the number to be precision
     * @param decimals - the number of decimals to precision to
     * @returns the precision number
     */
    private static readonly PRECISION_EPSILON = 10 ** 10; // Cache default epsilon

    precision(value: number, decimals: number = 10) {
        const epsilon = decimals === 10 ? Context.PRECISION_EPSILON : 10 ** decimals;
        return typeof value === 'number' ? Math.round(value * epsilon) / epsilon : value;
        //if (typeof n !== 'number' || isNaN(n)) return n;
        //return Number(n.toFixed(decimals));
    }

    /**
     * This function is used to apply special transformation to internal PineTS parameters and handle them as time-series
     * @param source - the source data, can be an array or a single value
     * @param index - the index of the source array, used to get a sub-series of the source data
     * @param name - the name of the parameter, used as a unique identifier in the current execution context, this allows us to properly handle the param as a series
     * @returns the current value of the param
     */
    param(source, index, name?: string) {
        if (typeof source === 'string') return source;
        if (source instanceof Series) {
            if (index) {
                return new Series(source.data, source.offset + index);
            }
            return source;
        }

        if (!Array.isArray(source) && typeof source === 'object') return source;

        if (!this.params[name]) this.params[name] = [];
        if (Array.isArray(source)) {
            return new Series(source, index || 0);
        } else {
            if (this.params[name].length === 0) {
                this.params[name].push(source);
            } else {
                this.params[name][this.params[name].length - 1] = source;
            }
            return new Series(this.params[name], index || 0);
        }
    }

    /**
     * Access a series value with Pine Script semantics (reverse order)
     * @param source - The source series or array
     * @param index - The lookback index (0 = current value)
     */
    get(source: any, index: number) {
        // Truncate fractional history offsets toward zero (RC2 boundary safety
        // net — Pine offsets are integers; a fractional value indicates
        // int-division divergence). The Series path re-guards offset+index inside
        // Series.get; this covers the array/scalar paths below.
        if (typeof index === 'number' && !Number.isInteger(index)) index = Math.trunc(index);

        if (source instanceof Series) {
            return source.get(index);
        }

        if (Array.isArray(source)) {
            // Optimized forward array access:
            // index 0 -> last element (length - 1)
            // index 1 -> second last element (length - 2)
            const realIndex = source.length - 1 - index;
            if (realIndex < 0 || realIndex >= source.length) {
                return NaN;
            }
            return source[realIndex];
        }

        // Scalar value - return as is, ignoring index
        return source;
    }

    /**
     * Set the current value of a series (index 0)
     * @param target - The target series or array
     * @param value - The value to set
     */
    set(target: any, value: any) {
        if (target instanceof Series) {
            target.set(0, typeof value === 'number' ? this.precision(value) : value);
            return;
        }

        if (Array.isArray(target)) {
            if (target.length > 0) {
                target[target.length - 1] = value;
            } else {
                target.push(value);
            }
            return;
        }
    }

    /**
     * Resolve an iterable for `for x in collection` codegen.
     * Handles PineArrayObject (unwrap to inner JS array) and plain JS arrays uniformly.
     * Returns the value itself if it's already iterable (Map, Set, etc.).
     *
     * Centralizing this here means the transpiler can emit a uniform shape regardless of
     * whether the iterable is a built-in returning a plain array (e.g. box.all) or a UDT
     * field holding a PineArrayObject — and future collection types only need to update
     * this helper, not the codegen.
     */
    iter(source: any): any {
        if (source == null) return [];
        // PineArrayObject wraps the underlying JS array as `.array`
        if (Array.isArray(source.array)) return source.array;
        // PineMapObject wraps a JS Map as `.map` — iterating yields [key, value]
        // pairs (Pine's `for v in map` semantics).
        if (source.map instanceof Map) return source.map;
        return source;
    }

    /**
     * Resolve an iterable yielding [key, value] tuples for `for [k, v] in collection`
     * destructuring codegen. PineArrayObject's [Symbol.iterator] yields scalar values, so
     * we must explicitly call `.entries()` on the underlying array. PineMapObject stores
     * its data on `.map` (a JS Map) — without this branch the fallthrough returned an
     * empty iterator and `for [k,v] in map` silently iterated 0 times.
     */
    entries(source: any): IterableIterator<[any, any]> {
        if (source == null) return [].entries();
        if (Array.isArray(source.array)) return source.array.entries();
        if (source.map instanceof Map) return source.map.entries();
        if (Array.isArray(source)) return source.entries();
        // Map / Set / other iterables that already yield tuples
        if (typeof source.entries === 'function') return source.entries();
        return [].entries();
    }

    //#region [Call Stack Management] ===========================

    private _callStack: string[] = [];
    /**
     * Cumulative call-path stack. Each entry is the full path from the root to
     * the current call, formed by joining the syntactic call-site ids with '|'.
     *
     * Pine semantics is per-call-PATH (not per-syntactic-call-site): a function
     * with internal `var` state, called via two distinct paths through a wrapper,
     * must keep state independent per path. Keying lctx by the path (rather than
     * the immediate site id) makes `$$.var.*` slots and `$$.id + '_taN'` ta
     * callsite ids correctly path-scoped without any transpiler changes.
     */
    private _pathStack: string[] = [];

    /**
     * Pushes a call ID onto the stack
     * @param id - The call ID
     */
    public pushId(id: string) {
        const parent = this._pathStack.length > 0 ? this._pathStack[this._pathStack.length - 1] : '';
        const path = parent ? parent + '|' + id : id;
        this._callStack.push(id);
        this._pathStack.push(path);
    }

    /**
     * Pops a call ID from the stack
     */
    public popId() {
        this._callStack.pop();
        this._pathStack.pop();
    }

    /**
     * Returns the current call PATH (cumulative ids joined by '|') from the top
     * of the stack. Used as the lctx key for the current function call.
     */
    public peekId() {
        return this._pathStack.length > 0 ? this._pathStack[this._pathStack.length - 1] : '';
    }

    /**
     * Returns the local context object for the current call ID.
     * Creates it if it doesn't exist.
     */
    public peekCtx() {
        const id = this.peekId();
        if (!id) return this; // Fallback to global context if not in a function call

        let ctx = this.lctx.get(id);
        if (!ctx) {
            ctx = {
                id: id,
                let: {},
                const: {},
                var: {},
            };
            this.lctx.set(id, ctx);
        }
        return ctx;
    }

    /**
     * Calls a function with a specific call ID context
     * @param fn - The function to call
     * @param id - The call ID to use
     * @param args - Arguments to pass to the function
     */
    public call(fn: Function, id: string, ...args: any[]) {
        this.pushId(id);
        try {
            return fn(...args);
        } finally {
            this.popId();
        }
    }

    //#endregion

    //#region [Deprecated getters] ===========================

    /**
     * @deprecated Use context.pine.math instead. This will be removed in a future version.
     */
    get math(): PineMath {
        this._showDeprecationWarning('const math = context.math', 'const { math, ta, input } = context.pine');
        return this.pine.math;
    }

    /**
     * @deprecated Use context.pine.ta instead. This will be removed in a future version.
     */
    get ta(): TechnicalAnalysis {
        this._showDeprecationWarning('const ta = context.ta', 'const { ta, math, input } = context.pine');
        return this.pine.ta;
    }

    /**
     * @deprecated Use context.pine.input instead. This will be removed in a future version.
     */
    get input(): Input {
        this._showDeprecationWarning('const input = context.input', 'const { input, math, ta } = context.pine');
        return this.pine.input;
    }

    /**
     * @deprecated Use context.pine.request instead. This will be removed in a future version.
     */
    get request(): PineRequest {
        this._showDeprecationWarning('const request = context.request', 'const { request, math, ta } = context.pine');
        return this.pine.request;
    }

    /**
     * @deprecated Use context.pine.array instead. This will be removed in a future version.
     */
    get array(): PineArray {
        this._showDeprecationWarning('const array = context.array', 'const { array, math, ta } = context.pine');
        return this.pine.array;
    }

    /**
     * @deprecated Use context.pine.* (e.g., context.pine.na, context.pine.plot) instead. This will be removed in a future version.
     */
    get core(): any {
        this._showDeprecationWarning('context.core.*', 'context.pine (e.g., const { na, plotchar, color, plot, nz } = context.pine)');
        return {
            na: this.pine.na,
            fill: this.pine.fill,
            plotchar: this.pine.plotchar,
            plotshape: this.pine.plotshape,
            plotarrow: this.pine.plotarrow,
            color: this.pine.color,
            plot: this.pine.plot,
            nz: this.pine.nz,
        };
    }

    /**
     * Shows a deprecation warning once per property access pattern
     */
    private _showDeprecationWarning(oldUsage: string, newUsage: string): void {
        const warningKey = `${oldUsage}->${newUsage}`;
        if (!Context._deprecationWarningsShown.has(warningKey)) {
            Context._deprecationWarningsShown.add(warningKey);

            // Try CSS styling for browsers, fallback to ANSI codes for Node.js
            if (typeof window !== 'undefined') {
                // Browser environment - use CSS styling
                console.warn(
                    '%c[WARNING]%c %s syntax is deprecated. Use %s instead. This will be removed in a future version.',
                    'color: #FFA500; font-weight: bold;',
                    'color: #FFA500;',
                    oldUsage,
                    newUsage,
                );
            } else {
                // Node.js environment - use ANSI color codes
                console.warn(
                    `\x1b[33m[WARNING] ${oldUsage} syntax is deprecated. Use ${newUsage} instead. This will be removed in a future version.\x1b[0m`,
                );
            }
        }
    }

    //#endregion
}
export default Context;
