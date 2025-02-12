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
    '4H': '4h', // 4 hours
    '1D': '1d', // 1 day
    D: '1d', // 1 day
    '1W': '1w', // 1 week
    W: '1w', // 1 week
    '1M': '1M', // 1 month
    M: '1M', // 1 month
};

import { IProvider } from '@pinets/marketData/IProvider';

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

class CacheManager<T> {
    private cache: Map<string, CacheEntry<T>>;
    private readonly cacheDuration: number;

    constructor(cacheDuration: number = 5 * 60 * 1000) {
        // Default 5 minutes
        this.cache = new Map();
        this.cacheDuration = cacheDuration;
    }

    private generateKey(params: Record<string, any>): string {
        return Object.entries(params)
            .filter(([_, value]) => value !== undefined)
            .map(([key, value]) => `${key}:${value}`)
            .join('|');
    }

    get(params: Record<string, any>): T | null {
        const key = this.generateKey(params);
        const cached = this.cache.get(key);

        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.cacheDuration) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    set(params: Record<string, any>, data: T): void {
        const key = this.generateKey(params);
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });
    }

    clear(): void {
        this.cache.clear();
    }

    // Optional: method to remove expired entries
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.cacheDuration) {
                this.cache.delete(key);
            }
        }
    }
}

export class BinanceProvider implements IProvider {
    private cacheManager: CacheManager<any[]>;

    constructor() {
        this.cacheManager = new CacheManager(5 * 60 * 1000); // 5 minutes cache duration
    }

    async getMarketDataInterval(tickerId: string, timeframe: string, sDate: number, eDate: number): Promise<any> {
        try {
            const interval = timeframe_to_binance[timeframe.toUpperCase()];
            if (!interval) {
                console.error(`Unsupported timeframe: ${timeframe}`);
                return [];
            }

            const timeframeDurations = {
                '1m': 60 * 1000,
                '3m': 3 * 60 * 1000,
                '5m': 5 * 60 * 1000,
                '15m': 15 * 60 * 1000,
                '30m': 30 * 60 * 1000,
                '1h': 60 * 60 * 1000,
                '2h': 2 * 60 * 60 * 1000,
                '4h': 4 * 60 * 60 * 1000,
                '1d': 24 * 60 * 60 * 1000,
                '1w': 7 * 24 * 60 * 60 * 1000,
                '1M': 30 * 24 * 60 * 60 * 1000,
            };

            let allData = [];
            let currentStart = sDate;
            const endTime = eDate;
            const intervalDuration = timeframeDurations[interval];

            if (!intervalDuration) {
                console.error(`Duration not defined for interval: ${interval}`);
                return [];
            }

            while (currentStart < endTime) {
                const chunkEnd = Math.min(currentStart + 1000 * intervalDuration, endTime);

                const data = await this.getMarketData(
                    tickerId,
                    timeframe,
                    1000, // Max allowed by Binance
                    currentStart,
                    chunkEnd
                );

                if (data.length === 0) break;

                allData = allData.concat(data);

                // CORRECTED LINE: Remove *1000 since closeTime is already in milliseconds
                currentStart = data[data.length - 1].closeTime + 1;

                // Keep this safety check to exit when we get less than full page
                if (data.length < 1000) break;
            }

            return allData;
        } catch (error) {
            console.error('Error in getMarketDataInterval:', error);
            return [];
        }
    }
    //TODO : allow querying more than 1000 klines
    //TODO : immplement cache
    async getMarketData(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<any> {
        try {
            // Check cache first
            const cacheParams = { tickerId, timeframe, limit, sDate, eDate };
            const cachedData = this.cacheManager.get(cacheParams);
            if (cachedData) {
                console.log('cache hit', tickerId, timeframe, limit, sDate, eDate);
                return cachedData;
            }

            const interval = timeframe_to_binance[timeframe.toUpperCase()];
            if (!interval) {
                console.error(`Unsupported timeframe: ${timeframe}`);
                return [];
            }
            let url = `${BINANCE_API_URL}/klines?symbol=${tickerId}&interval=${interval}`;
            if (!limit && sDate && eDate) {
                return this.getMarketDataInterval(tickerId, timeframe, sDate, eDate);
            }

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

            // Cache the results
            this.cacheManager.set(cacheParams, data);

            return data;
        } catch (error) {
            console.error('Error in binance.klines:', error);
            return [];
        }
    }
}
