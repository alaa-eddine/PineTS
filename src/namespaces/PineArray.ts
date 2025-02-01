// SPDX-License-Identifier: AGPL-3.0-only

class PineArrayObject {
    constructor(public array: any) {}
}

/**
 * This class implements an array port of PineScript's array functions.
 */
export class PineArray {
    private _cache = {};
    constructor(private context: any) {}

    param(source, index = 0) {
        if (Array.isArray(source)) {
            return source[index];
        }
        return source;
    }

    /**
     * This function simulates PineScript's array.get() function
     * @param id - the array object to get the value from
     * @param index - the index of the value to get
     * @returns the value at the given index
     */
    public get(id: PineArrayObject, index: number) {
        return id.array[index];
    }

    public set(id: PineArrayObject, index: number, value: any) {
        id.array[index] = value;
    }

    public push(id: PineArrayObject, value: any) {
        id.array.push(value);
    }

    // Basic statistics
    public sum(id: PineArrayObject): number {
        return id.array.reduce((a: number, b: any) => a + (isNaN(b) ? 0 : b), 0);
    }

    public avg(id: PineArrayObject): number {
        return this.sum(id) / id.array.length;
    }

    public min(id: PineArrayObject, nth: number = 0): number {
        const sorted = [...id.array].sort((a, b) => a - b);
        return sorted[nth] ?? this.context.NA;
    }

    public max(id: PineArrayObject, nth: number = 0): number {
        const sorted = [...id.array].sort((a, b) => b - a);
        return sorted[nth] ?? this.context.NA;
    }

    public size(id: PineArrayObject): number {
        return id.array.length;
    }

    // Array creation

    public new_bool(size: number, initial_value: boolean = false): PineArrayObject {
        return new PineArrayObject(Array(size).fill(initial_value));
    }

    public new_float(size: number, initial_value: number = NaN): PineArrayObject {
        return new PineArrayObject(Array(size).fill(initial_value));
    }

    public new_int(size: number, initial_value: number = 0): PineArrayObject {
        return new PineArrayObject(Array(size).fill(Math.round(initial_value)));
    }

    public new_string(size: number, initial_value: string = ''): PineArrayObject {
        return new PineArrayObject(Array(size).fill(initial_value));
    }

    public new<T>(size: number, initial_value: T): PineArrayObject {
        return new PineArrayObject(Array(size).fill(initial_value));
    }

    // Array operations
    public slice(id: PineArrayObject, start: number, end?: number): PineArrayObject {
        const adjustedEnd = end !== undefined ? end + 1 : undefined;
        return new PineArrayObject(id.array.slice(start, adjustedEnd));
    }

    public reverse(id: PineArrayObject): void {
        id.array.reverse();
    }

    public includes(id: PineArrayObject, value: any): boolean {
        return id.array.includes(value);
    }

    public indexof(id: PineArrayObject, value: any): number {
        return id.array.indexOf(value);
    }

    public lastindexof(id: PineArrayObject, value: any): number {
        return id.array.lastIndexOf(value);
    }

    // More complex functions
    public stdev(id: PineArrayObject, biased: boolean = true): number {
        const mean = this.avg(id);
        const deviations = id.array.map((x: number) => Math.pow(x - mean, 2));
        const divisor = biased ? id.array.length : id.array.length - 1;
        return Math.sqrt(this.sum(new PineArrayObject(deviations)) / divisor);
    }

    public variance(id: PineArrayObject, biased: boolean = true): number {
        const mean = this.avg(id);
        const deviations = id.array.map((x: number) => Math.pow(x - mean, 2));
        const divisor = biased ? id.array.length : id.array.length - 1;
        return this.sum(new PineArrayObject(deviations)) / divisor;
    }

    public covariance(arr1: PineArrayObject, arr2: PineArrayObject, biased: boolean = true): number {
        if (arr1.array.length !== arr2.array.length || arr1.array.length < 2) return NaN;
        const divisor = biased ? arr1.array.length : arr1.array.length - 1;

        const mean1 = this.avg(arr1);
        const mean2 = this.avg(arr2);
        let sum = 0;

        for (let i = 0; i < arr1.array.length; i++) {
            sum += (arr1.array[i] - mean1) * (arr2.array[i] - mean2);
        }

        return sum / divisor;
    }

    // Additional utility methods
    public first(id: PineArrayObject): any {
        return id.array.length > 0 ? id.array[0] : this.context.NA;
    }

    public last(id: PineArrayObject): any {
        return id.array.length > 0 ? id.array[id.array.length - 1] : this.context.NA;
    }

    public clear(id: PineArrayObject): void {
        id.array.length = 0;
    }

    public join(id: PineArrayObject, separator: string = ','): string {
        return id.array.join(separator);
    }

    /** Array Manipulation Functions */
    public abs(id: PineArrayObject): PineArrayObject {
        return new PineArrayObject(id.array.map((val) => Math.abs(val)));
    }

    public concat(id: PineArrayObject, other: PineArrayObject): PineArrayObject {
        id.array.push(...other.array);
        return id;
    }

    public copy(id: PineArrayObject): PineArrayObject {
        return new PineArrayObject([...id.array]);
    }

    public every(id: PineArrayObject, callback: (val: any) => boolean): boolean {
        return id.array.every(callback);
    }

    public fill(id: PineArrayObject, value: any, start: number = 0, end?: number): void {
        const length = id.array.length;
        const adjustedEnd = end !== undefined ? Math.min(end, length) : length;

        for (let i = start; i < adjustedEnd; i++) {
            id.array[i] = value;
        }
    }

    public from(source: any[]): PineArrayObject {
        return new PineArrayObject([...source]);
    }

    public insert(id: PineArrayObject, index: number, value: any): void {
        id.array.splice(index, 0, value);
    }

    public pop(id: PineArrayObject): any {
        return id.array.pop();
    }

    public range(id: PineArrayObject): number {
        return this.max(id) - this.min(id);
    }

    public remove(id: PineArrayObject, index: number): any {
        if (index >= 0 && index < id.array.length) {
            return id.array.splice(index, 1)[0];
        }
        return this.context.NA;
    }

    public shift(id: PineArrayObject): any {
        return id.array.shift();
    }

    public sort(id: PineArrayObject, order: 'asc' | 'desc' = 'asc'): void {
        id.array.sort((a, b) => (order === 'asc' ? a - b : b - a));
    }

    public sort_indices(id: PineArrayObject, comparator?: (a: any, b: any) => number): PineArrayObject {
        const indices = id.array.map((_, index) => index);
        indices.sort((a, b) => {
            const valA = id.array[a];
            const valB = id.array[b];
            return comparator ? comparator(valA, valB) : valA - valB;
        });
        return new PineArrayObject(indices);
    }

    public standardize(id: PineArrayObject): PineArrayObject {
        const mean = this.avg(id);
        const stdev = this.stdev(id);

        if (stdev === 0) {
            return new PineArrayObject(id.array.map(() => 0));
        }

        return new PineArrayObject(id.array.map((x) => (x - mean) / stdev));
    }

    public unshift(id: PineArrayObject, value: any): void {
        id.array.unshift(value);
    }

    public some(id: PineArrayObject, callback: (val: any) => boolean): boolean {
        return id.array.some(callback);
    }
}
