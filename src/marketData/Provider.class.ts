// SPDX-License-Identifier: AGPL-3.0-only

import { BinanceProvider } from './Binance/BinanceProvider.class';

export const Provider = {
    Binance: new BinanceProvider(),
    //TODO : add other providers (polygon, etc.)
};
