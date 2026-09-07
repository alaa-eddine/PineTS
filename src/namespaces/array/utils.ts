import { PineArrayType } from './PineArrayObject';

// export function precision(value: any, epsilon: number = 1e10): number {
//     return typeof value === 'number' ? Math.round(value * epsilon) / epsilon : value;
// }

export function inferArrayType(values: any[]): PineArrayType {
    if (values.every((value) => typeof value === 'number')) {
        if (values.every((value) => Number.isInteger(value))) {
            return PineArrayType.int;
        } else {
            return PineArrayType.float;
        }
    } else if (values.every((value) => typeof value === 'string')) {
        return PineArrayType.string;
    } else if (values.every((value) => typeof value === 'boolean')) {
        return PineArrayType.bool;
    } else {
        //throw new Error('Cannot infer type from values');
        return PineArrayType.any;
    }
}

export function inferValueType(value: any): PineArrayType {
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return PineArrayType.int;
        } else {
            return PineArrayType.float;
        }
    } else if (typeof value === 'string') {
        return PineArrayType.string;
    } else if (typeof value === 'boolean') {
        return PineArrayType.bool;
    } else {
        // Objects (LineObject, LabelObject, BoxObject, etc.) get 'any' type
        return PineArrayType.any;
    }
}

export function isArrayOfType(array: any[], type: PineArrayType) {
    switch (type) {
        case PineArrayType.int:
            return array.every((value) => Number.isInteger(value));
        case PineArrayType.float:
            return array.every((value) => typeof value === 'number' && !isNaN(value));
        case PineArrayType.string:
            return array.every((value) => typeof value === 'string');
        case PineArrayType.bool:
            return array.every((value) => typeof value === 'boolean');
    }

    return false;
}

export function isValueOfType(value: any, type: PineArrayType) {
    // na (NaN or undefined) is compatible with all types in Pine Script.
    // Some namespace functions (e.g. color.from_gradient historically) may
    // represent an na value as undefined, so treat it exactly like NaN.
    if (value === undefined) return true;
    if (typeof value === 'number' && isNaN(value)) return true;
    // Untyped arrays (e.g. array.new<chart.point>()) accept any value
    if (type === PineArrayType.any) return true;
    switch (type) {
        case PineArrayType.int:
            return Number.isInteger(value) || isNaN(value);
        case PineArrayType.float:
            return typeof value === 'number';
        case PineArrayType.string:
            return typeof value === 'string';
        case PineArrayType.bool:
            return typeof value === 'boolean';
        // Drawing object types accept any object (or null for na)
        case PineArrayType.box:
        case PineArrayType.label:
        case PineArrayType.line:
        case PineArrayType.linefill:
        case PineArrayType.table:
        case PineArrayType.color:
            return value === null || typeof value === 'object' || typeof value === 'string';
    }
    return false;
}
