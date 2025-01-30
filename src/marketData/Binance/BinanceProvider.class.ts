// SPDX-License-Identifier: AGPL-3.0-only

const BINANCE_API_URL = 'https://api.binance.com/api/v3'; //'https://testnet.binance.vision/api/v3';
const timeframe_to_binance = {
    '1': '1m', // 1 minute
    '3': '3m', // 3 minutes
    '5': '5m', // 5 minutes
    '15': '15m', // 15 minutes
    '30': '30m', // 30 minutes
    '45': null, // 45 minutes (not directly supported by Binance, needs custom handling)
    '60': '1h', // 1 hour
    '120': '2h', // 2 hours
    '180': null, // 3 hours (not directly supported by Binance, needs custom handling)
    '240': '4h', // 4 hours
    '1D': '1d', // 1 day
    D: '1d', // 1 day
    '1W': '1w', // 1 week
    W: '1w', // 1 week
    '1M': '1M', // 1 month
    M: '1M', // 1 month
};

import { IProvider } from '@pinets/marketData/IProvider';

export class BinanceProvider implements IProvider {
    async getMarketData(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<any> {
        try {
            const interval = timeframe_to_binance[timeframe.toUpperCase()];
            if (!interval) {
                console.error(`Unsupported timeframe: ${timeframe}`);
                return [];
            }
            let url = `${BINANCE_API_URL}/klines?symbol=${tickerId}&interval=${interval}`;

            //example https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000
            if (limit) {
                url += `&limit=${limit}`;
            }

            if (sDate) {
                url += `&startTime=${sDate}`;
            }
            if (eDate) {
                url += `&endTime=${eDate}`;
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();
            const data = result.map((item) => {
                return {
                    openTime: parseInt(item[0]) / 1000,
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5]),
                    closeTime: parseInt(item[6]) / 1000,
                    quoteAssetVolume: parseFloat(item[7]),
                    numberOfTrades: parseInt(item[8]),
                    takerBuyBaseAssetVolume: parseFloat(item[9]),
                    takerBuyQuoteAssetVolume: parseFloat(item[10]),
                    ignore: item[11],
                };
            });
            return data;
        } catch (error) {
            console.error('Error in binance.klines:', error);
            return [];
        }
    }
}
