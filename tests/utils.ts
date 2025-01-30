import { PineTS } from 'PineTS.class';
import { Context } from 'Context.class';

const BINANCE_API_URL = 'https://api.binance.com/api/v3'; //'https://testnet.binance.vision/api/v3';

export async function getKlines(symbol: string, interval: string, limit?: number, startTime?: number, endTime?: number) {
    try {
        let url = `${BINANCE_API_URL}/klines?symbol=${symbol}&interval=${interval}`;

        if (limit) {
            url += `&limit=${limit}`;
        }

        if (startTime) {
            url += `&startTime=${startTime}`;
        }
        if (endTime) {
            url += `&endTime=${endTime}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        const formattedData = data.map((item) => {
            return {
                openTime: parseInt(item[0]),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5]),
                closeTime: parseInt(item[6]),
                quoteAssetVolume: parseFloat(item[7]),
                numberOfTrades: parseInt(item[8]),
                takerBuyBaseAssetVolume: parseFloat(item[9]),
                takerBuyQuoteAssetVolume: parseFloat(item[10]),
                ignore: item[11],
            };
        });
        return formattedData;
    } catch (error) {
        console.log('Error in binance.klines:', error);
        return [];
    }
}

export function arrayPrecision(arr: number[], precision: number = 10) {
    return arr.map((e) => (typeof e === 'number' ? parseFloat(e.toFixed(precision)) : e));
}

export async function runNSFunctionWithArgs(klines: any[], ns: string, fn: string, ...args) {
    const pineTS = new PineTS(klines);

    let sourceCode = `(context) =>{ 
        const { close, open, high, low, hlc3, volume, hl2, ohlc4 } = context.data;
        const { plotchar, plot, na } = context.core;
        const ta = context.ta;
        const math = context.math;
        const input = context.input;
        

        const values = ${ns}.${fn}(${args.join(',')});

        return {
            values,
        };

     }`;

    const { result } = await pineTS.run(sourceCode);
    // //
    // const context = new Context(pineTS.data);
    // const namespace = context[ns];

    // let localArgs = [];

    // for (let i = 0; i < args.length; i++) {
    //     if (typeof args[i] === 'number') {
    //         localArgs.push(args[i]);
    //     } else {
    //         const source: any[] = pineTS[args[i]];
    //         if (source) {
    //             localArgs.push(source);
    //         } else {
    //             localArgs.push(args[i]);
    //         }
    //     }
    // }
    // const result = await namespace[fn](...localArgs);

    return result;
}
