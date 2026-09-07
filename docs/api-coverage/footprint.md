---
layout: default
title: Footprint
parent: API Coverage
---

## Footprint

Volume footprint objects come from [`request.footprint()`](request.html). Every `footprint.*()` and `volume_row.*()` function also works in method form (`fp.poc()`, `row.delta()`), and both types can be used in declarations (`footprint fp = …`, `volume_row r = …`, `array<volume_row>`), as history (`fp[1]`) and as type casts (`footprint(na)`).

### footprint

| Function                        | Status | Description                                                    |
| ------------------------------- | ------ | -------------------------------------------------------------- |
| `footprint()`                   | ✅     | Casts na to footprint                                          |
| `footprint.buy_volume()`        | ✅     | Total "buy" volume of the bar                                  |
| `footprint.sell_volume()`       | ✅     | Total "sell" volume of the bar                                 |
| `footprint.total_volume()`      | ✅     | Buy + sell volume of the bar                                   |
| `footprint.delta()`             | ✅     | Buy − sell volume of the bar                                   |
| `footprint.poc()`               | ✅     | Point of Control row (highest total volume; ties → lowest row) |
| `footprint.vah()`               | ✅     | Highest row of the value area                                  |
| `footprint.val()`               | ✅     | Lowest row of the value area                                   |
| `footprint.rows()`              | ✅     | New `array<volume_row>` of all rows, lowest first              |
| `footprint.get_row_by_price()`  | ✅     | Row whose `[down_price, up_price)` contains the price, else na |

### volume_row

| Function                          | Status | Description                                              |
| --------------------------------- | ------ | -------------------------------------------------------- |
| `volume_row()`                    | ✅     | Casts na to volume_row                                   |
| `volume_row.up_price()`           | ✅     | Upper price boundary of the row                          |
| `volume_row.down_price()`         | ✅     | Lower price boundary of the row                          |
| `volume_row.buy_volume()`         | ✅     | "Buy" volume of the row                                  |
| `volume_row.sell_volume()`        | ✅     | "Sell" volume of the row                                 |
| `volume_row.total_volume()`       | ✅     | Buy + sell volume of the row                             |
| `volume_row.delta()`              | ✅     | Buy − sell volume of the row                             |
| `volume_row.has_buy_imbalance()`  | ✅     | Buy volume ≥ ratio × sell volume of the row **below**    |
| `volume_row.has_sell_imbalance()` | ✅     | Sell volume ≥ ratio × buy volume of the row **above**    |

### Notes

- **Rows** are `ticks_per_row × syminfo.mintick` high, anchored at price 0 (so every bar shares one grid), and contiguous from the lowest to the highest level the data source reports for the bar — a row with no trades inside that span exists with zero volume.
- **Value area** grows outward from the POC one row at a time, always taking the adjacent row with the larger total volume (ties expand upward), until it holds `va_percent` (default 70) of the bar's volume. `vah()` / `val()` return the boundary rows; use `up_price()` / `down_price()` on them for the price levels.
- **Imbalances** are diagonal, as on the volume footprint chart: a row has a buy imbalance when its buy volume is at least `imbalance_percent / 100` (default 3×) times the sell volume of the row below it, and a sell imbalance when its sell volume is at least that multiple of the buy volume of the row above. A row with no volume on the tested side never flags; the lowest row has no buy imbalance and the highest row no sell imbalance.
- **Buy/sell attribution is the data source's** — PineTS sums whatever the provider classified (aggressor side for trade-level feeds).
