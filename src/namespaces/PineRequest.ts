// SPDX-License-Identifier: AGPL-3.0-only

import { PineTS, Provider } from '@pinets/index';
//Pine Script Timeframes
const TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', 'D', 'W', 'M'];

export class PineRequest {
    private _cache = {};
    constructor(private context: any) {}

    param(source, index, name?: string) {
        if (!this.context.params[name]) this.context.params[name] = [];
        if (Array.isArray(source)) {
            if (index) {
                this.context.params[name] = source.slice(index);
            } else {
                this.context.params[name] = source.slice(0);
            }
            return [source[index], name];
        } else {
            this.context.params[name][0] = source;
            return [source, name];
        }
    }

    async security(
        symbol: any,
        timeframe: any,
        expression: any,
        gaps = false,
        lookahead = false,
        ignore_invalid_symbol = false,
        currency = null,
        calc_bars_count = null
    ) {
        const _symbol = symbol[0];
        const _timeframe = timeframe[0];
        const _expression = expression[0];
        const _expression_name = expression[1];

        const ctxTimeframeIdx = TIMEFRAMES.indexOf(this.context.timeframe);
        const reqTimeframeIdx = TIMEFRAMES.indexOf(_timeframe);

        if (ctxTimeframeIdx == -1 || reqTimeframeIdx == -1) {
            throw new Error('Invalid timeframe');
        }
        if (ctxTimeframeIdx > reqTimeframeIdx) {
            throw new Error('Only higher timeframes are supported for now');
        }

        if (ctxTimeframeIdx === reqTimeframeIdx) {
            return _expression;
        }

        const myOpenTime = this.context.data.openTime[0];
        const myCloseTime = this.context.data.closeTime[0];

        if (this.context.cache[_expression_name]) {
            const secContext = this.context.cache[_expression_name];
            const secContextIdx = this._findSecContextIdx(myOpenTime, myCloseTime, secContext.data.openTime, secContext.data.closeTime, lookahead);
            return secContextIdx == -1 ? NaN : secContext.params[_expression_name][secContextIdx];
        }

        const pineTS = new PineTS(this.context.source, _symbol, _timeframe, this.context.limit || 1000, this.context.sDate, this.context.eDate);

        const secContext = await pineTS.run(this.context.pineTSCode);

        this.context.cache[_expression_name] = secContext;

        const secContextIdx = this._findSecContextIdx(myOpenTime, myCloseTime, secContext.data.openTime, secContext.data.closeTime, lookahead);
        return secContextIdx == -1 ? NaN : secContext.params[_expression_name][secContextIdx];
    }

    private _findSecContextIdx(myOpenTime: number, myCloseTime: number, openTime: number[], closeTime: number[], lookahead = false) {
        for (let i = 0; i < openTime.length; i++) {
            if (openTime[i] <= myOpenTime && myCloseTime <= closeTime[i]) {
                return i + (lookahead ? 1 : 2); //lookahead_on +1 lookahead_off +2
            }
        }
        return -1;
    }
}
