// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Ala-eddine KADDOURI

import { Core } from '@pinets/namespaces/Core';
import { Input } from '@pinets/namespaces/Input';
import PineMath from '@pinets/namespaces/PineMath';
import { PineRequest } from '@pinets/namespaces/PineRequest';
import TechnicalAnalysis from '@pinets/namespaces/TechnicalAnalysis';
import { PineArray } from './namespaces/PineArray';
import { IProvider } from './marketData/IProvider';

export class Context {
    public data: any = {
        open: [],
        high: [],
        low: [],
        close: [],
        volume: [],
        hl2: [],
        hlc3: [],
        ohlc4: [],
    };
    public cache: any = {};

    public NA: any = NaN;

    public math: PineMath;
    public ta: TechnicalAnalysis;
    public input: Input;
    public request: PineRequest;
    public array: PineArray;
    public core: any;
    public lang: any;

    public idx: number = 0;

    public params: any = {};
    public const: any = {};
    public var: any = {};
    public let: any = {};

    public result: any = undefined;
    public plots: any = {};

    public marketData: any;
    public source: IProvider | any[];
    public tickerId: string;
    public timeframe: string = '';
    public limit: number;
    public sDate: number;
    public eDate: number;

    public pineTSCode: Function | String;

    constructor({
        marketData,
        source,
        tickerId,
        timeframe,
        limit,
        sDate,
        eDate,
    }: {
        marketData: any;
        source: IProvider | any[];
        tickerId?: string;
        timeframe?: string;
        limit?: number;
        sDate?: number;
        eDate?: number;
    }) {
        this.marketData = marketData;
        this.source = source;
        this.tickerId = tickerId;
        this.timeframe = timeframe;
        this.limit = limit;
        this.sDate = sDate;
        this.eDate = eDate;

        this.math = new PineMath(this);

        this.ta = new TechnicalAnalysis(this);
        this.input = new Input(this);
        this.request = new PineRequest(this);

        this.array = new PineArray(this);
        const core = new Core(this);
        this.core = {
            plotchar: core.plotchar.bind(core),
            na: core.na.bind(core),
            color: core.color,
            plot: core.plot.bind(core),
            nz: core.nz.bind(core),
        };
    }

    //#region [Runtime functions] ===========================

    /**
     * this function is used to initialize the target variable with the source array
     * this array will represent a time series and its values will be shifted at runtime in order to mimic Pine script behavior
     * @param trg - the target variable name : used internally to maintain the series in the execution context
     * @param src - the source data, can be an array or a single value
     * @param idx - the index of the source array, used to get a sub-series of the source data
     * @returns the target array
     */
    init(trg, src: any, idx: number = 0) {
        if (!trg) {
            if (Array.isArray(src)) {
                trg = [this.precision(src[src.length - this.idx - 1 + idx])];
            } else {
                trg = [this.precision(src)];
            }
        } else {
            if (!Array.isArray(src) || Array.isArray(src[0])) {
                //here we check that this is not a 2D array, in which case we consider it an array of values
                //this is important for handling TA functions that return tupples or series of tuples
                trg[0] = Array.isArray(src?.[0]) ? src[0] : this.precision(src);
            } else {
                trg[0] = this.precision(src[src.length - this.idx - 1 + idx]);
            }
        }

        return trg;
    }

    /**
     * this function is used to set the floating point precision of a number
     * by default it is set to 10 decimals which is the same as pine script
     * @param n - the number to be precision
     * @param decimals - the number of decimals to precision to
     * @returns the precision number
     */
    precision(n: number, decimals: number = 10) {
        if (typeof n !== 'number' || isNaN(n)) return n;
        return Number(n.toFixed(decimals));
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
        if (!Array.isArray(source) && typeof source === 'object') return source;

        if (!this.params[name]) this.params[name] = [];
        if (Array.isArray(source)) {
            if (index) {
                this.params[name] = source.slice(index);
                return this.params[name];
            }
            this.params[name] = source.slice(0);
            return this.params[name];
        } else {
            this.params[name][0] = source;
            return this.params[name];
        }
    }
    //#endregion
}
export default Context;
