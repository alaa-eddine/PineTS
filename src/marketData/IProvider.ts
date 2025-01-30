// SPDX-License-Identifier: AGPL-3.0-only
export interface IProvider {
    getMarketData(tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number): Promise<any>;
}
