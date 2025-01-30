// SPDX-License-Identifier: AGPL-3.0-only

type InputOptions =
    | {
          title?: string;
          group?: string;
      }
    | any;

//in the current implementation we just declare the input interfaces for compatibility
// in future versions this might be used for visualization
export class Input {
    constructor(private context: any) {}

    param(source, index = 0) {
        if (Array.isArray(source)) {
            return [source[index]];
        }
        return [source];
    }

    any(value: any, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }

    int(value: number, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }

    float(value: number, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }

    bool(value: boolean, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }

    string(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    timeframe(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    time(value: number, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    price(value: number, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    session(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    source(value: any, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    symbol(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    text_area(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    enum(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
    color(value: string, { title, group }: InputOptions = {}) {
        return Array.isArray(value) ? value[0] : value;
    }
}

export default Input;
