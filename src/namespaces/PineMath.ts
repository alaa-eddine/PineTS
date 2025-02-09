// SPDX-License-Identifier: AGPL-3.0-only
export class PineMath {
    private _cache = {};
    constructor(private context: any) {}

    param(source, index, name?: string) {
        if (!this.context.params[name]) this.context.params[name] = [];
        if (Array.isArray(source)) {
            if (index) {
                this.context.params[name] = source.slice(index);
                this.context.params[name].length = source.length; //ensure length is correct
                return this.context.params[name];
            }
            this.context.params[name] = source.slice(0);
            return this.context.params[name];
        } else {
            this.context.params[name][0] = source;
            return this.context.params[name];
        }
        //return [source];
    }

    abs(source: number[]) {
        return Math.abs(source[0]);
    }
    pow(source: number[], power: number[]) {
        return Math.pow(source[0], power[0]);
    }
    sqrt(source: number[]) {
        return Math.sqrt(source[0]);
    }
    log(source: number[]) {
        return Math.log(source[0]);
    }
    ln(source: number[]) {
        return Math.log(source[0]);
    }
    exp(source: number[]) {
        return Math.exp(source[0]);
    }
    floor(source: number[]) {
        return Math.floor(source[0]);
    }
    ceil(source: number[]) {
        return Math.ceil(source[0]);
    }
    round(source: number[]) {
        return Math.round(source[0]);
    }
    random() {
        return Math.random();
    }
    max(...source: number[]) {
        const arg = source.map((e) => e[0]);
        return Math.max(...arg);
    }
    min(...source: number[]) {
        const arg = source.map((e) => e[0]);
        return Math.min(...arg);
    }

    //sum of last n values
    sum(source: number[], length: number) {
        const len = Array.isArray(length) ? length[0] : length;
        if (Array.isArray(source)) {
            return source.slice(0, len).reduce((a, b) => a + b, 0);
        }
        return source;
    }

    sin(source: number[]) {
        return Math.sin(source[0]);
    }
    cos(source: number[]) {
        return Math.cos(source[0]);
    }
    tan(source: number[]) {
        return Math.tan(source[0]);
    }

    acos(source: number[]) {
        return Math.acos(source[0]);
    }
    asin(source: number[]) {
        return Math.asin(source[0]);
    }
    atan(source: number[]) {
        return Math.atan(source[0]);
    }

    avg(source: number[]) {
        const args = source.map((e) => e[0]);

        return (
            args.reduce((a, b) => {
                const aVal = Array.isArray(a) ? a[0] : a;
                const bVal = Array.isArray(b) ? b[0] : b;
                return aVal + bVal;
            }, 0) / args.length
        );
    }
}

export default PineMath;
