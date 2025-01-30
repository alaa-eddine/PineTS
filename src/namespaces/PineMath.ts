// SPDX-License-Identifier: AGPL-3.0-only
export class PineMath {
    private _cache = {};
    constructor(private context: any) {}

    param(source, index = 0) {
        if (Array.isArray(source)) {
            return source[index];
        }
        return source;
    }

    abs(n: number) {
        return Math.abs(n);
    }

    pow(a: number, b: number) {
        return Math.pow(a, b);
    }

    sqrt(a: number) {
        return Math.sqrt(a);
    }

    log(a: number) {
        return Math.log(a);
    }

    ln(a: number) {
        return Math.log(a);
    }

    exp(a: number) {
        return Math.exp(a);
    }

    floor(a: number) {
        return Math.floor(a);
    }

    ceil(a: number) {
        return Math.ceil(a);
    }

    round(a: number) {
        return Math.round(a);
    }

    random() {
        return Math.random();
    }
    max(...args) {
        return Math.max(...args);
    }

    min(...args) {
        return Math.min(...args);
    }

    sin(a: number) {
        return Math.sin(a);
    }

    cos(a: number) {
        return Math.cos(a);
    }

    tan(a: number) {
        return Math.tan(a);
    }

    asin(a: number) {
        return Math.asin(a);
    }

    acos(a: number) {
        return Math.acos(a);
    }

    atan(a: number) {
        return Math.atan(a);
    }
    avg(...args) {
        return (
            args.reduce((a, b) => {
                const aVal = Array.isArray(a) ? a[0] : a;
                const bVal = Array.isArray(b) ? b[0] : b;
                return aVal + bVal;
            }, 0) / args.length
        );
    }
}

//max([0,1,2,3,4,5,6,7,8,9], 5)
export default PineMath;
