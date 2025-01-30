// SPDX-License-Identifier: AGPL-3.0-only

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

    async security(symbol: any, timeframe: any, expression: any) {
        //not implemented
        throw new Error('Not implemented');
    }
}
