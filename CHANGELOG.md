# Change Log

## [Unreleased]

### Added

- **`request.footprint()` and the `footprint` / `volume_row` types**: Pine v6's volume footprint API — `request.footprint(ticks_per_row, va_percent = 70, imbalance_percent = 300) → footprint`, the `footprint.*()` accessors (`buy_volume`, `sell_volume`, `total_volume`, `delta`, `poc`, `vah`, `val`, `rows`, `get_row_by_price`) and the `volume_row.*()` accessors (`up_price`, `down_price`, `buy_volume`, `sell_volume`, `total_volume`, `delta`, `has_buy_imbalance`, `has_sell_imbalance`), in both function form and method form (`fp.poc().up_price()`), with typed declarations, `array<volume_row>`, history access (`fp[1]`) and the `footprint(na)` / `volume_row(na)` casts. The order-flow data comes from the market data source through a new **optional provider surface, `IFootprintProvider.getFootprintData(tickerId, timeframe, limit?, sDate?, eDate?) → FootprintBar[]`** (`{ openTime, tick?, levels: [{ price, buyVolume, sellVolume }] }`, exported with `FootprintBar` / `FootprintLevel` / `hasFootprintData`) — the provider serves raw price levels at its own granularity and PineTS owns the Pine semantics: rows of `ticks_per_row × syminfo.mintick` anchored at price 0 and contiguous across the bar's levels, POC = largest total (ties → lowest row), value area grown from the POC taking the larger neighbour (ties upward) until `va_percent` of the volume is inside, diagonal imbalances (buy vs. the sell one row below, sell vs. the buy one row above) at `imbalance_percent / 100`. Streaming: the footprint of the forming bar is re-read from the source whenever the market data changes. A source without the surface, a bar it does not cover, a missing `mintick`, or a call inside a `request.security()` expression all yield `na` (never a throw); a non-positive `ticks_per_row` is a runtime error. Tests: `tests/namespaces/request-footprint.test.ts` (hand-computed reference footprint for aggregates, rows, POC/VA, imbalances at 300 % and 100 %, `get_row_by_price` edges, tie-breaks, `na` paths, live tail refresh, and two real Pine v6 scripts covering the reference manual's syntax). Docs: `docs/api-coverage/footprint.md`, `docs/data-providers.md` (provider contract), `docs/architecture/namespaces/request.md`.

---

## [v0.9.33]

### Fixed

- **Out-of-bounds array/matrix access no longer fails silently — TV parity restored**: `array.get/set/insert/remove` and `matrix.get/set/row/col` emitted a non-blocking `context.warn()` and returned `na`/no-op on an out-of-bounds index, so scripts like `array.new<float>(0)` + `a.get(2)` ran to completion instead of halting. TradingView raises a runtime error here ("Index xx is out of bounds. Array size is yy" — see the Pine docs on arrays). These methods now throw the catchable `PineRuntimeError` (with `method` set to the offending call, e.g. `'array.get'`); v6 negative-index normalization is unchanged, and the reported index is the one the script passed (not the normalized one). `stream()` consumers now receive an `'error'` event instead of a `'warning'` for these violations. New regression suite: `tests/namespaces/array/oob-runtime-error.test.ts` (includes the original report's script); `bounds-check`, `negative-index` and `runtime-error-capture` tests updated to expect the throw.

---

## [0.9.32] - 2026-08-24 - Session Support, `runtime.error` & Version-Accurate Integer Division

### Fixed

- **`int / int` truncation ignored the Pine version and the operands' qualifiers**: 0.9.28's integer-division pass truncated **every** division whose operands statically inferred as `int`. Real Pine truncates only in **v5**, and only when both operands are **`const`-qualified** ints — loop counters, mutable variables, `input.int` and int builtins keep the fractional remainder, and **v6 never truncates at all** (TradingView v6 migration guide, "Fractional division of constants"). The detected `//@version` is now threaded through **`transpile()`** and the pass is gated to v5 sources (v6+ and bare PineTS/JS input keep native float `/`). **`TypeInferencePass`** was reworked from a binary int/notint split to a **`constint` / `int` / `notint`** lattice with a mutated-names pre-scan, so only compile-time-constant int operands trigger the `math.__idiv` rewrite.
- **`runtime.error()` crashed with `ReferenceError: runtime is not defined`**: the `runtime` namespace did not exist, so any script _referencing_ it failed as soon as the call executed — instead of TV's behavior (no-op when the guarding branch is not taken, halt with the script's message when it is). New **`src/namespaces/Runtime.ts`**: `runtime.error(message)` throws the existing catchable `PineRuntimeError` (`method: 'runtime.error'`), registered on `$.pine` and added to `CONTEXT_PINE_VARS` so the transpiler injects the namespace binding.
- **`last_bar_index` tracked the running `bar_index` instead of the chart's constant last-bar index**: it was derived from the progressively-fed `data.close` window, so it returned the **current** bar's index on every bar — `bar_index < last_bar_index` was false everywhere, breaking every "not the last bar" guard. It now reads the length of the fully-preloaded `marketData` array: a constant across the whole historical run, as in TV (it only grows when realtime bars are appended). The window-based read remains as a best-effort fallback when `marketData` is unavailable.
- **`time(timeframe, session, timezone)` mis-parsed session specs**: any `:days` suffix failed the `HHMM-HHMM` regex, so **every bar was silently treated as in-session**. The new parser (**`src/namespaces/sessionSpec.ts`**) handles full Pine session strings — comma-separated `HHMM-HHMM` windows, the `:days` suffix (`1` = Sunday … `7` = Saturday), overnight sessions belonging to the day they **end**, `"0000"` as end-of-day, and `"24x7"` — and malformed strings now throw `PineRuntimeError` like TV instead of passing silently.
- **`timenow` crashed with a `ReferenceError`**: the runtime getter existed, but the identifier was never registered in the transpiler settings, so it was never injected into the generated code.
- **User variables named after a constant namespace crashed**: TV allows `position`, `font`, `order`, `currency`, `dayofweek`, `adjustment` and `barmerge` as user variable names while namespace member access still works. These seven were missing from `NAMESPACE_COLLISION_NAMES`, so the codegen rename pass never renamed the user variable and the namespace was no longer injected from `$.pine` → `ReferenceError: <name> is not defined`.

### Added

- **`session` namespace**: `session.regular` / `session.extended` constants, `session.isfirstbar` / `session.islastbar` (plus their `*_regular` variants), and `session.ismarket` / `session.ispremarket` / `session.ispostmarket`.
- **Tests**: `tests/namespaces/runtime.test.ts` (guarded call is a no-op, halts with the exact message, throws a catchable `PineRuntimeError`, PineTS-syntax path); `tests/core/last-bar-index.test.ts` (constant on every bar, equals the final `bar_index`, `bar_index < last_bar_index` true on all bars but the last); `tests/namespaces/time-session-spec.test.ts`, `tests/namespaces/session-namespace.test.ts` and `tests/core/timenow.test.ts`; `tests/transpiler/namespace-identifier-collision.test.ts` (each of the seven namespaces shadowed, plus non-shadowed usage); and a reworked `tests/transpiler/int-division.test.ts` with reference-correct v5/v6 expectations (the original repro kept as a guard).

---

## [0.9.31] - 2026-08-12 - Input Source Runtime Overrides

### Fixed

- **`input.source()` runtime overrides returned the source NAME string instead of the series**: An override — constructor `inputs` map, `.input[...]` write, or a host's input payload — reaches the runtime as the series **name** (`{ src: 'hlc3' }`): the only serializable encoding across a host / worker boundary. `resolveInput` returned that string verbatim, so the script computed `ta.sma("hlc3", …)` → `NaN` on every bar. Critically, hosts that echo **defaults** back as overrides (Vela's `EngineOrchestrator` sends the full input map on every start) broke every `input.source` script **on add**, without any setting being touched — only the no-override standalone path ever worked (its defval is unwrapped to the current-bar scalar by the transpiler's `input.param` wrapping, which masked the bug in PineTS-only usage and tests). New **`resolveSourceName(context, name)`** (`namespaces/input/utils.ts`) dereferences a builtin source name to the named series' **current-bar value** — `Series.from(context.data[name]).get(0)`, the exact read `input.param` performs for the un-overridden default, so both paths stay value-identical bar by bar. **`input.source()`** now dereferences any string resolution; an unknown name falls back to the declared default (= behaves as "no override"). The bare auto-typed form **`input(close, …)`** (→ `input.any`) dereferences only when the runtime defval is **numeric**, so genuine string inputs (`input("EMA", …)`) keep their overrides untouched.
- **`SOURCE_BUILTINS` unified**: the meta scanner (`Indicator/scanInputs.ts`) now imports the runtime's set (`open, high, low, close, hl2, hlc3, ohlc4, hlcc4, volume`) instead of keeping a private copy — the scanner's source-type detection and the runtime's override resolution can no longer drift apart.

### Added

- **Tests**: `tests/namespaces/input-source-override.test.ts` — synthetic bars with hand-computed expected values (independent reference): no-override baseline, varId-keyed and title-keyed (legacy) overrides, the default echoed back as an override (the host path), every builtin source name resolving to its own series, unknown-name fallback to the default, the bare `input(close, …)` auto-typed form, and string-input override preservation.

---

## [0.9.30] - 2026-08-01 - Streaming Strategy-Ledger Rollback

### Fixed

- **Strategy ledger not rolled back on streaming re-execution**: The live streaming path (`stream()` / paginated `run()` / `updateTail()`) re-executes the forming bar on every tick, and once more with its final OHLC when the next bar arrives. The rollback restored `var` Series, results, market-data series and drawings — but **not** `context.strategy`. Every discarded execution therefore leaked one pending order (`strategy.entry`/`strategy.order` push unconditionally, and the `order.bar >= context.idx` fill guard skips-without-consuming), and all leaked duplicates filled together at the next bar's open: **`position_size` inflated by ticks+2 per bar** instead of the scripted amount (2× even with zero intra-bar ticks, since the previously-forming bar is always re-executed once on new-candle arrival). The pyramiding cap could not catch it — it counts open trades, which stay flat while the duplicates are still queued. New **`snapshotStrategyState`/`restoreStrategyState`** (`namespaces/strategy/utils.ts`) ride the existing `_snapshotVarState`/`_restoreVarState` cycle, so all three restore points (paginated live loop, `updateTail`, `_runComplete` split-execute) are covered: the full ledger — `pending_orders`, `opentrades`, position/equity scalars, peaks/ratchets, win-loss counters, and internal fields written via `(strategy as any)` (`_ledger_entries`, `_mc_exit_lock`, `_pending_close_mc`, …) — is restored to its pre-last-bar state before each re-execution. `closedtrades` is snapshotted length-only (append-only array, O(open state) cost, not O(backtest length)); `config` is skipped (rebuilt by `strategy()` each evaluation); `context.strategy` is mutated **in place** (its identity is public API). Also prevents conditional exits queued on the forming bar from firing against that bar's own H/L via re-execution, and stops the monotonic ratchets (`equity_peak`, `max_drawdown`, `risk_halted`, …) latching intra-tick extremes that never existed as a closed bar. Static/closed-history backtests are unaffected (snapshots were already taken there; restore only runs on streaming re-execution).
- **Note for users**: `calc_on_every_tick` remains stored-but-unread. With this fix the streaming engine behaves as `calc_on_every_tick = true` (script evaluates every tick; ledger effects commit at bar close). Honoring `false` (evaluate on bar close only) is a separate planned feature.

### Added

- **Tests**: `tests/namespaces/strategy/streaming-rollback.test.ts` — offline scripted-provider streaming harness (one provider poll == one tick): streaming ≡ static ledger parity at T ∈ {0, 1, 4} ticks per forming bar (position, trades, netprofit, `equity_peak`, `max_drawdown`, `max_contracts_held_all`), single-pending-order invariant while forming, default-pyramiding "enter when flat" breakout (opens exactly 1 unit), exit-bracket no-fire-on-own-bar + no-duplicate-across-ticks, and structural guards (market-data series length parity, contiguous `bar_index`).

---

## [0.9.29] - 2026-07-11 - Heikin Ashi Chart Type & Extended Tickers

### Added

- **Extended tickers — THE CHART TYPE IS THE TICKER**: a host runs a Heikin Ashi chart by constructing PineTS with an extended ticker — `new PineTS(source, 'BTCUSDT;heikinashi', 'D', …)`. The chart type is a `";modifier"` suffix on the ticker id (the single source of truth; there is no separate setting), from which everything derives: `chart.is_heikinashi` / `chart.is_standard`, the `syminfo.tickerid` suffix (`"BINANCE:BTCUSDT;heikinashi"`; `syminfo.ticker` stays clean), and `request.security` routing. **PineTS never transforms bars** — the modifier is a routing marker: a data source that owns the transform (an embedding host) serves derived bars for the extended ticker and raw bars for the plain one; bundled providers (Binance/Alpaca/FMP/Mock) strip the modifier at their boundary (`BaseProvider.getMarketData` + each `getSymbolInfo`) and always serve standard candles.
- **`src/tickerModifier.ts`** (exported): `splitTickerModifier` / `stripTickerModifier` / `withTickerModifier` — the extended-ticker parser (recognized modifiers: `heikinashi`, `standard`; unknown suffixes stay part of the symbol).
- **`ticker.heikinashi()`** now returns the extended ticker (`"sym;heikinashi"`, idempotent) instead of the plain symbol; **`ticker.standard()`** strips the chart-type modifier (the standard-data opt-out); **`ticker.inherit()`** propagates the chart-type modifier from `from_tickerid` onto the new symbol.
- **`request.security` / `request.security_lower_tf` chart-type routing**: extended tickers pass through to the data source untouched; the empty-string symbol resolves to the chart's own ticker _modifier included_; the same-timeframe shortcut is chart-type aware — on a Heikin Ashi chart `security(syminfo.tickerid, <chart tf>, …)` shortcuts to the chart's series while `security(ticker.standard(…), <chart tf>, …)` builds a secondary that fetches standard data (previously indistinguishable).
- **Tests**: `tests/namespaces/heikinashi-chart-style.test.ts` — ticker-modifier helpers, `ticker.*` behavior, predicate derivation from the constructor ticker, provider-boundary stripping, chart-type-aware same-TF shortcut, and a real-Pine-source run locking the transpiler contract for bare `chart.is_*` access.

### Changed

- **`chart.is_standard` / `is_heikinashi` / `is_kagi` / `is_linebreak` / `is_pnf` / `is_range` / `is_renko` are now getters** on `pine.chart` (they are Pine _variables_ — bare member access), matching the `left/right_visible_bar_time` pattern; `is_standard`/`is_heikinashi` now answer truthfully from the chart ticker (the rest remain always-`false` stubs). ⚠️ Breaking only for JS-style consumers that called them as functions (`chart.is_standard()`); transpiled Pine source is unaffected. Documented as Case #4b in `src/namespaces/README.md`.

---

## [0.9.28] - 2026-07-07 - Integer Division & User-Function History Access

### Added

- **Pine integer division (`int / int → int`)**: New compile-time **`TypeInferencePass`** (pre-lowering) synthesizes a minimal `int` vs `notint` type for each expression. When **both** operands of `/` are provably int, the transpiler rewrites to **`$.pine.math.__idiv(l, r)`** — truncates toward zero (`11 / 2 === 5`, `-11 / 2 === -5`) instead of JS float division. Unknown / unresolved types default to `notint` (fail-safe: missed truncation acceptable, wrong truncation of a float is not). JOIN-on-reassignment: a variable stays `int` only if every value it holds is int. Float literals preserve raw text through lexer/codegen so `2.0` stays distinguishable from `2`.
- **`math.__idiv`**: Runtime helper for integer division — truncates toward zero, propagates `na`, preserves native div-by-zero semantics (`1/0 → Infinity`, `0/0 → NaN`).
- **Tests**: `tests/transpiler/int-division.test.ts` (19 cases — int-division applied vs float never truncated, pivot-price / na-initialized-float regressions, float-literal preservation, runtime truncation / div-by-zero).

### Fixed

- **Series history access inside user-defined functions**: `x[i]` on a built-in/captured series or function parameter, used in **return position**, was emitted as raw JS indexing (e.g. `bar_index[len]`) → `undefined` at runtime. Pivot/Fibonacci-style indicators that draw from a UDF rendered nothing (lines/labels at `(0,0)→(NaN,NaN)`). All return-position subscripts now route through the member-lowering path → **`$.get(series, idx)`** — tuple returns (`return [bar_index[len], c]`), builtin returns (`return close[n]`), and param returns (`return src[len]`). Enum and UDT-field returns unchanged.
- **Fractional history offsets**: History offsets must resolve to integer bars. **`Series.get`** / **`Context.get`** now truncate the combined lookback toward zero when non-integer (e.g. `src[depth/2]` before int-division rewrite yields `5.5` in JS) — boundary safety net alongside the transpiler fix.
- **Drawing plot serialization O(n²)**: Every create/mutate re-serialized the entire backing array; deleted objects were only flagged, never removed, so scans grew **O(bars × objects)** → quadratic overall. Removed redundant per-object **`syncToPlot()`** calls on create/mutate (per-bar sync already captures final state; rollback sync kept). **`syncToPlot()`** now compacts deleted objects out of the array in all drawing helpers (`line`, `label`, `box`, `polyline`, `linefill`, `table`) → linear scans. Emitted plot output unchanged; ~12–16× faster on drawing-heavy scripts at 800–1600 bars.

---

## [0.9.27] - 2026-06-29 - Buy-and-Hold Benchmark

### Added

- **`context.strategy.buy_and_hold_pnl` / `buy_and_hold_per_gain` / `strategy_outperformance`**: Report-only buy-and-hold benchmark (TV's "Buy & Hold Return"), computed once at end-of-run in `finalizeStrategyRun`. Models a single long position bought with the entire `initial_capital` at the first trade's (slippage-adjusted) entry price and held open through the last bar — affected by `initial_capital` and `slippage`, never by commissions (no exit leg). `strategy_outperformance = netprofit − buy_and_hold_pnl`. `NaN` until the first trade opens. Not Pine built-ins — available on `context.strategy` after the run only.
- **Docs**: `docs/strategy.md` Buy-and-hold return sections.

---

## [0.9.26] - 2026-06-24 - Strategy update, add context.strategy.cagr

### Added

- **`context.strategy.cagr`**: Report-only Compound Annual Growth Rate (%) of strategy equity over the backtest window, computed once at end-of-run in `finalizeStrategyRun`. Not a Pine built-in — available on `context.strategy` after the run only.
- **Tests**: `tests/namespaces/strategy/cagr.test.ts` — unit coverage of the CAGR formula and `NaN` edge cases, plus an integration run of the MACD strategy on BINANCE:BTCUSDT 1D (3235 bars) asserting a strategy CAGR of ≈ 2.12%.
- **Docs**: `docs/strategy.md` gains Compound Annual Growth Rate (CAGR).

---

## [0.9.25] - 2026-06-24 - Hotfix for strategy.entry reversal

### Fixed

- **Pyramiding reversal over-sizing (simultaneous opposite entries)**: Multiple opposite-direction **`strategy.entry`** calls queued on the **same bar** while a pyramided position is open each read the stale pre-fill **`strategy.position_size`** and were each classified as a reversal — so each added the full close-qty (**`|position| + baseQty`**) and bypassed the pyramiding cap. A short **-3** reversed by three long entries reached **+9** in PineTS vs **+3** in TradingView (only the first entry reverses — close 3 + open 1 — and the rest are plain pyramiding adds of qty 1). **`methods/entry.ts`** now **projects the position forward** over same-bar already-queued **market** entry orders (**`Δpos = direction × qty`**, exact even for reversal orders since their qty bakes in the close-qty) before classifying reversal/qty, so only the first opposite entry reverses. The queue-time qty freeze that the **`_base_qty`** margin-call overshoot-split depends on is preserved (a single reversal order is unchanged). (QA "Sim Pyramiding" xlsx, BTCUSDT 1D — **`strategy.position_size`** matches TV across full history; the bug only surfaces when an opposite signal fires while a pyramided position is still open.)

### Added

- **Tests**: **`tests/namespaces/strategy/pyramiding-reversal.test.ts`** — queue-level order sizing (first opposite entry reverses with qty **`|pos|+base`**, subsequent entries are adds of **`base`**), a full fill cycle to position **+3**, and regression guards for three-entries-from-flat and single-reversal (margin-call overshoot intact).

---

## [0.9.24] - 2026-06-22 - `na` Comparison Parity, History on Call Results & Drawing Coordinate Scalars

### Added

- **`math.__lt` / `__le` / `__gt` / `__ge`**: New na-aware relational helpers with TradingView's **1e-10** absolute tie tolerance. Transpiler rewrites `<`, `<=`, `>`, `>=` to these helpers (alongside existing **`__eq` / `__neq`** rewrites).
- **Tests**: **`tests/namespaces/math/na-comparison.test.ts`** — full Pine-source path for `na` propagation through `==`, `!=`, and relational ops plus float-equality tolerance probes; **`tests/transpiler/history-on-call.test.ts`** — characterization tests for **`EXPR[N]`** on call results (`ta.sma(close, 3)[1]`, reassignment, function return, lookback depth) with regression guards for identifier/var history and tuple destructure.

### Fixed

- **`na` propagation through comparisons**: Any comparison with an **`na`** operand now evaluates to **`na`** ( **`NaN`** ), not boolean **`false`** — matching TradingView (`na(x==x)`, `na(x<1)`, etc.). Observable via **`na()`** / **`nz()`** / arithmetic; branch/ternary outcomes unchanged because **`na`** is falsy. Lockstep with pine-vm-opti fix (commit dcf0531).
- **Float equality tolerance**: **`__eq` / `__neq`** epsilon tightened **1e-9 → 1e-10** absolute (TV: `1.0+5e-11 == 1.0` → true, `1.0+5e-10 == 1.0` → false).
- **History operator on call results (`func(...)[N]`)**: Pine **`[]`** on a function-call result is always the history reference, never a tuple index. Transpiler now lowers **`ta.sma(close, 3)[1]`** (and any **`CallExpression[N]`**) to **`$.get($.param(call, …), N)`** — accumulates the per-bar scalar into a series and reads N bars back. Previously the subscript was dropped or left as raw JS indexing on a scalar → **`NaN`**. Return-statement path in **`StatementTransformer`** routes call-result history refs through the same transform.
- **`chart.point.*` coordinate resolution**: **`ChartHelper`** resolves Series/function args to creation-bar scalars in **`new`**, **`from_index`**, **`from_time`**, and **`now`** — e.g. **`chart.point.from_index(bar_index, close)`** captures the bar's value instead of storing a live series handle.
- **`line.new()` / `label.new()` coordinate resolution**: **`x1`/`y1`/`x2`/`y2`** and **`x`/`y`** now pass through **`_resolve()`** at creation time, matching **`box.new()`** — bare-series args like **`line.new(x1 = bar_index, …)`** no longer read offset 0 on every bar.

---

## [0.9.23] - 2026-06-16 - Strategy Pyramiding Parity, Indicator Input varId & Sharpe/Sortino

### Added

- **`context.strategy.sharpe_ratio` / `sortino_ratio`**: Report-only risk-adjusted performance ratios computed once at end-of-run in `finalizeStrategyRun`, from the monthly equity curve accumulated across the bar loop. Matching TradingView's documented formula — simple monthly returns anchored at `initial_capital`, population SD / downside deviation, no annualization. Not Pine built-ins — available on `context.strategy` after the run only, not inside the run callback.
- **`risk_free_rate` strategy declaration option** (default `2`, annual %): Converted to a monthly figure (`rate / 100 / 12`) as the denominator input for Sharpe / Sortino.
- **`.input` keyed by `varId`**: The primary override key is now the variable each input is assigned to (`length = input.int(…)` → `"length"`). The input's **`title`** still resolves as a secondary alias. Recommended for scripts with empty or duplicated titles — `ind.input['slow']` targets the second `"Length"` input precisely while `ind.input['Length']` aliases the first.
- **`varId` in `getInputsMeta()` / `IPineInput`**: Every scanned input carries its assigned variable name; `Object.keys(ind.input)` enumerates varIds.
- **Transpiler `{ __varId }` injection**: `input.*(...)` calls in Pine source get a trailing varId sentinel so the runtime resolves overrides by varId before title.
- **Color default normalization in input scanner**: `color`-typed inputs report `defval` as a canonical **8-digit RGBA hex `#RRGGBBAA`** (uppercase) regardless of source form — hex literals, named constants (`color.red` → `#F23645FF`), or statically evaluable `color.new()` / `color.rgb()` calls. Gives UI color pickers a single parseable format.
- **Constant resolution in `scanInputs`**: When an input argument references a top-level constant or simple variable (`const DEF = 14; len = input.int(DEF, …)`), the scanner resolves `defval`, `group`, `inline`, `tooltip`, `options`, etc. to the declared value rather than the bare identifier.
- **Tests**: `indicator_inputs.test.ts` (varId keying, color normalization, constant resolution), `close-snapshot.test.ts`, `equity-peak-basis.test.ts`, `margin-call.test.ts`, `risk-adjusted.test.ts`, `trailing-parity.test.ts`.
- **Docs**: `docs/indicator.md` rewritten for varId-first `.input` API; `docs/strategy.md` gains Sharpe / Sortino section and `risk_free_rate` in the options table.

### Fixed

- **`strategy.close_all()` snapshot binding**: TV binds `close_all` / `close(id)` to the position at **call time**. When a reversal entry queued the same bar fills first on the next bar's open — implicitly closing the snapshotted trades — the pending `close_all` is now **cancelled** instead of catching the freshly-opened reversal trade at its entry price for **$0 PnL**. Implemented via `_intended_trade_ids` captured at queue time and re-checked in `processExitOrders`. (QA close_all xlsx, BTCUSDT 1D — trade #13's $5,512.65 divergence.)
- **`strategy.position_avg_price` ghost position after partial liquidation**: Fractional qty residuals from margin-call partial liquidations left `position_avg_price` alive on a near-zero position. Epsilon-snap to flat (`|newSize| < 1e-9 → 0`) now sets `position_avg_price = NaN` and clears `position_entry_name`, preventing phantom TP/SL exits at the next entry's own price. (QA pyramiding xlsx, 2021-11-09 BTCUSDC.)
- **Pyramiding tick-based exit brackets per trade**: When `strategy.exit()` matches multiple open trades, TP/SL levels in ticks are now computed from **each trade's own entry price**, not `strategy.position_avg_price`. Verified against QA pyramiding xlsx (BTCUSDC 1D).
- **Equity peak basis for `max_drawdown`**: Peak latch now uses realized equity **plus open entry commissions** (excludes the commission deduction from the peak side). Trough basis keeps commission deducted. Fixes a degeneracy that hid the bug on constant-commission QA data but diverged on reversal bars with different entry commissions. (QA margin_calls xlsx — matches TV to the cent.)
- **Margin-call partial liquidation (TV 4× rule)**: Intra-bar adverse movement now liquidates **4× the contracts needed to cover the deficit** (floored), not the entire position — remainder stays open.
- **Reversal close-leg margin semantics**: When a reversal entry's **open** leg fails the pre-trade margin check, the **close** leg of the reversal still executes.
- **Deferred close margin call (`applyPendingCloseMarginCall`)**: Phantom re-check scheduled on the previous bar fills at that bar's close, before entries — so a reversal queued at that close overshoots by exactly the deferred quantity, as TV does.
- **Intra-bar margin checkpoint ordering**: Margin checks now run at the bar **open** (after entries fill) and at the **adverse extreme** — before exit fills on adverse-first bars, after them on favorable-first bars (`isAdverseFirstBar`). Exit processing moved to an explicit `'intrabar'` phase in `processExitOrders`.
- **Trailing stop adverse-first segment model** (PR #213): On bars where the adverse extreme precedes the favorable move, an already-armed trail now checks segment 1 against the **old** peak's trigger, updates the peak, then checks segment 3 against the **new** trigger — keeping the order pending when both segments miss. Fill price remains the literal trigger level.

### Changed

- **`.input` override precedence**: Runtime resolves **varId before title**. A varId-keyed `.input['len'] = 3` write wins over a constructor-map `{ Length: 21 }` title override. Both keys coexist in `ctx.inputs`; the script picks up the varId one.
- **Bar-loop strategy processing order**: Entries → deferred close margin call → open checkpoint → (adverse-first extreme checkpoint) → intrabar exits → (favorable-first extreme checkpoint) → `finalizeStrategyBar` peak latch → end-of-run `finalizeStrategyRun` for Sharpe / Sortino.

---

## [0.9.22] - 2026-06-11 - Strategy Hotfix for Close-on-Flat and Margin calls

This is a hotfix release for v0.9.21 which did not include the right fixes

## [0.9.21] - 2026-06-10 - Strategy Broker Emulator — Close-on-Flat, 100% Margin, Trailing Stop & v6 Declaration Parsing

### Fixed

- **`strategy.close_all()` and `strategy.close(id)` no-op when nothing to close at queue time**: Both methods previously queued an exit order unconditionally. On the next bar the queued order survived (via `from_entry = ''` for `close_all` or matching `from_entry = id` for `close`) and caught a fresh entry at its entry price, closing it for **$0 PnL**. Hits common patterns like `if exit_signal: strategy.close_all("close")` — the exit signal can become true on a bar where the book is already flat (after a prior `close_all` fired), queuing a stale order that catches the next reversal entry. Both methods now early-return when `opentrades.length === 0` (close_all) or no matching `entry_id` exists (close).
- **Pre-trade margin rejection and `processMarginCall` now run for ALL `margin_long` / `margin_short` percentages, not only `< 100`**: Both were previously gated on `marginPct < 100` with the comment "No leverage → no margin call" — incorrect, since the broker still requires the trader to post full notional as collateral at 100% margin. Pre-trade check in `processStrategyOrders` and intra-bar adverse-extreme liquidation in `processMarginCall` now apply unconditionally. The underlying math (`requiredMargin = qty × price × pointvalue × marginPct/100`) was already correct — only the guards needed removal.
- **`strategy.exit(trail_points=N, trail_offset=M)` accumulates state across bars and fires per the intra-bar segment model**: Two coordinated fixes. (1) In `exit.ts`, `trail_armed` and `trail_peak` now carry over across same-id-replace — they're engine-accumulated state (running high for a long / running low for a short), not user-supplied parameters, and were previously reset to `false` / `NaN` every bar so the trail never accumulated past a single bar's range. (2) In `processExitOrders`, `checkTrail` replaces eager peak update + gap-fill at open with an intra-bar segment model. Four cases handled: favorable-first already-armed (update peak → check trigger), adverse-first already-armed (segment 1 with OLD peak's trigger → update → segment 3 close-vs-NEW-trigger), favorable-first arm-this-bar (peak set at arming → check phase-2 descent), adverse-first arm-this-bar (peak set after the adverse extreme → only phase-3 close-vs-trigger). Fill is the **literal trigger price** in all cases — gap-fill at bar open removed for trail because the open precedes any peak update relevant to this trade.
- **`parseStrategyOptions` handles Pine v6 `(title, shorttitle, opts)` signature**: Previously only recognized `strategy("title")` and `strategy("title", { opts })`. When the script used `strategy("title", "shorttitle", overlay=true, commission_type=..., commission_value=...)` — a common v6 pattern — the second arg was a string (shorttitle), so the parser returned just `{ title }` and silently dropped the trailing named-args object. Result: `commission_type` / `commission_value` / `overlay` and every other named arg were ignored. New implementation walks all positional string args (capturing `title` then `shorttitle`) and merges any trailing object as named args.

### Notes for users

- **`strategy.netprofit` during open trades**: Entry commission is deducted from `netprofit` at fill time (matching real-broker cash flow). Final aggregate values are unaffected; intermediate per-bar values during an open trade will differ from references that defer commission to close time by the open trade's entry commission. `strategy.opentrades.commission(i)` exposes the open trade's entry commission for inspection.
- **`strategy.max_drawdown` is the intrabar variant**: Uses bar H/L excursions of surviving positions in addition to realized equity peaks. Reference platforms may expose two drawdown fields (intrabar and close-to-close); only the intrabar is computed here, and it's the conservative number.

---

## [0.9.20] - 2026-06-08 - Indicator Class as SSOT — `.input` / `.prop` Runtime Overrides

### Added

- **`Indicator` becomes the single source of truth for every per-script artifact**: refactored from a 12-line tuple `{source, inputs}` into the owner of the transpiled function, AST, parsed input schema, parsed declaration-prop schema, viewport-detection flag, and LTF slices. All PineTS entry points (**`run`**, **`stream`**, **`update`**) now route through **`Indicator.from(arg).prepare()`** so raw strings and raw functions get auto-wrapped in a throwaway Indicator. **`prepare()`** is lazy and cached — re-using the same Indicator across multiple **`pine.run()`** calls compiles the script **once**.
- **`Indicator.input` — title-keyed Proxy for input overrides**: read or mutate `input.*` values per key (**`ind.input["Length"] = 50`**). The container itself is frozen (**`ind.input = {...}`** throws); per-key writes validate against the input's schema (type / options / minval / maxval) and throw tailored messages on violations or unknown titles. Constructor **`inputs`** map kept for back-compat; **`.input`** writes layer on top.
- **`Indicator.getInputsMeta(): IPineInput[]`**: parsed input schema for UI builders. Captures **`type`**, **`defval`**, **`title`**, **`tooltip`**, **`group`**, **`inline`**, **`display`**, **`active`**, **`confirm`**, **`options`**, **`minval`**, **`maxval`**, **`step`** for every **`input.*(...)`** declaration in the source.
- **`Indicator.prop` — name-keyed Proxy for `indicator()` / `strategy()` declaration overrides**: read or mutate declaration arguments (**`ind.prop["initial_capital"] = 75000`**, **`ind.prop["pyramiding"] = 5`**) before **`pine.run()`**. Same frozen-container + per-key validation semantics as **`.input`**. Excludes **`title`** / **`shorttitle`** from writes (still present in the meta with **`mutable: false`** so UIs can render them).
- **Source-code defaults seeded into `.prop`**: when reading **`ind.prop["X"]`**, the value is layered as **spec default ← source code value ← user override**. Pine source like **`strategy("X", initial_capital=50000, currency=currency.EUR)`** seeds **`ind.prop["initial_capital"]` → 50000** and **`ind.prop["currency"] → "EUR"`** before any user write. Enum constants (**`currency.EUR`**, **`strategy.percent_of_equity`**, **`strategy.commission.cash_per_order`**) resolve via the rightmost-identifier rule to match what TradingView's runtime sees.
- **`Indicator.getPropsMeta(): IPineProp[]`** & **`Indicator.getDeclarationType()`**: schema introspection filtered to props applicable to the detected script type (**`'indicator'`** vs **`'strategy'`**). Type detection falls back to **`'indicator'`** if no declaration call is found.
- **Top-level exports `INDICATOR_PROPS` / `STRATEGY_PROPS` / `propsForDeclaration(type)`**: complete prop schemas (17 / 33 entries respectively) for UI code that needs the full list independent of any Indicator instance. Each enum-typed entry has a one-line comment in [**`src/Indicator/propsSchema.ts`**](src/Indicator/propsSchema.ts) enumerating accepted values and pointing to the corresponding exported Pine enum in **`src/namespaces/Types.ts`**.
- **`scanDeclaration.ts`**: detects **`indicator()`** / **`strategy()`** in both Pine source (via existing **`pineToJS`** AST) and JS-function source (via **`acorn.parse`**). Decodes positional + named arguments and resolves namespace constants.
- **`keyedProxy.ts`**: shared backend for **`.input`** and **`.prop`** Proxies — single source of validation + custom error messages. Replaces the previous duplicate Proxy code in **`inputProxy.ts`**.
- **`Context._propOverrides`**: name-keyed map of user prop overrides populated in **`_initializeContext`** from **`ind.getRuntimePropOverrides()`**. Read by **`Core.indicator()`** and **`initializeStrategy()`** to merge on top of source-code declaration args (**`{ ...defaults, ...sourceArgs, ...userOverrides }`**).
- **`docs/indicator.md`** (new): dedicated page covering Quickstart, Constructor, **`Indicator.from()`**, visible-range detection, the full **`.input`** / **`getInputsMeta()`** surface, the full **`.prop`** / **`getPropsMeta()`** surface (incl. source-default seeding, enum resolution, validation), reuse across runs, JS-function source caveats, and backward compatibility with the constructor **`inputs`** map. Every code example verified end-to-end against the live bundle before inclusion.
- **Tests**: **`tests/Indicator/Indicator.test.ts`** (21 cases — input surface) and **`tests/Indicator/Indicator.props.test.ts`** (37 cases — prop surface including declaration detection, source-default seeding, indicator-vs-strategy cross-validation, enum/numeric bounds, end-to-end runtime override propagation).

### Changed

- **PineTS internals simplified**: **`_transpileCode`** and **`_detectViewportUsage`** moved off the **`PineTS`** class onto **`Indicator`** (where they conceptually belong — they're properties of the script, not the engine). **`_runComplete`** / **`_runPaginated`** now take an **`Indicator`** instance and call **`prepare()`** from inside their async bodies so transpile errors surface as Promise rejections (preserving the **`tests/transpiler/error-handling.test.ts`** contract).
- **`docs/initialization-and-usage.md` — "Running with Runtime Inputs"**: rewritten to show both the new per-key **`ind.input["Length"] = 50`** form (preferred) and the legacy constructor map (still supported). Cross-links to the new [**Indicator**](docs/indicator.md) page for the full surface.
- **`docs/strategy.md`**: Indicator-wrapper example now links to the dedicated [**Indicator**](docs/indicator.md) page in addition to **`initialization-and-usage.md`**.
- **`docs/index.md`** + nav: added an Indicator entry at slot 4; bumped Alerts / Pagination / Data Providers / Syntax Guide / Strategy / Language Coverage / API Coverage down one slot each. Resolves two prior nav_order collisions (Alerts and Pagination were both at 4).

---

## [0.9.19] - 2026-06-05 - Strategy Broker Emulator — Margin Calls, Drawdown/Runup & Exit Cadence

### Added

- **Margin-call liquidation (`processMarginCall`)**: After entries and user-defined exits each bar, the engine checks whether intra-bar adverse movement (low for longs, high for shorts) would push equity below required maintenance margin when **`margin_long` / `margin_short` < 100**. If so, all open positions are force-liquidated at the bar's adverse extreme with **`exit_id` / `exit_comment` = `"Margin call"`**. Skipped when no leverage is configured. Helpers **`computeRequiredMargin`**, **`computeEquityAtPrice`**, **`computeHeldMargin`** model collateral in account currency via **`syminfo.pointvalue`**.
- **Pre-trade margin rejection**: Entry orders that would require more margin than available equity at fill time are silently dropped
- **`finalizeStrategyBar()`**: End-of-bar hook latches **`strategy.max_drawdown`** / **`strategy.max_runup`** once, after all fills settle, so TP/SL closes contribute realized P&L instead of phantom intra-bar excursions against raw H/L.
- **`roundToMintick()`**: Stop/limit/trail prices on **`strategy.entry`** and **`strategy.exit`** snap to **`syminfo.mintick`** away from the reference close (broker placement convention).
- **`CALLSITE_ID_NAMESPACES`**: Centralized transpiler list for trailing **`{ __callsiteId }`** injection; **`strategy.exit`** added for per-call-site cadence detection (persistent vs ephemeral exit-parameter capture). Documented known unification gaps with **`plot`**, **`ta.*`**, and **`alert`** patterns in **`settings.ts`**.
- **Order qty truncation**: **`calculateOrderQty`** floors computed qty to **6 decimal places** (`floor(qty × 1e6) / 1e6`) matching TV's empirical sizing precision (independent of **`syminfo.mincontract`**).

### Fixed

- **`strategy.max_drawdown` / `max_runup` (account & per-trade)**: Equity peaks now latch after fills via **`updateEquityPeaks`** using realized equity + intra-bar H/L excursions of surviving positions. Per-trade peaks use **`syminfo.pointvalue`**; TP closes zero **`max_runup`**, SL closes set **`max_drawdown`** to entry commission only. Eliminates over-counting when stops fire before the bar's raw extreme.
- **`strategy.max_drawdown_percent` / `max_runup_percent`**: Now track the **running max** of `(latched_value / equity_at_that_latch) × 100` across all latch events — not a derived ratio from current peaks (matches TV when later drawdowns are larger in $ but smaller in %).
- **`strategy.margin_liquidation_price`**: Replaced simplified peak-loss formula with TradingView's documented formula using realized equity, **`pointvalue`**, direction, and margin%; result rounded to mintick (floor for longs, ceil for shorts).
- **`strategy.convert_to_account` / `convert_to_symbol`**: Return **`na`** when symbol and account currency strings differ (string equality, not economic equivalence — e.g. USDC vs USD); identity passthrough when they match; identity fallback when **`syminfo.currency`** is undefined.
- **`strategy.exit()` broker semantics**: Same **`id` + `from_entry`** replaces prior pending exit (dynamic TP/SL adjustment); **`strategy.close()` / `close_all()`** cancel pending conditional exits targeting the same entry/book to prevent double-close; stale-reversal absolute legs dropped for ephemeral captures but kept for persistent every-bar refreshes (call-cadence via **`__callsiteId`**); wrong-sided SL/TP legs dropped for ephemeral pattern; trailing stop cannot arm and trigger on the same bar; intra-bar TP/SL ordering uses open-proximity-to-H/L rule from TV broker docs.
- **Commission & P&L accounting**: Entry commission realized at fill (**`netprofit`** / **`grossloss`**); exit commission at close; incremental **`netprofit`** updates; **`grossprofit` / `grossloss`** roll back entry commission at close and partition by trade sign; **`cash_per_order`** flat fee split 50/50 across reversal close/open legs; percent commission uses **`qty × price × pointvalue`** notional.
- **`strategy.opentrades.profit`**: Deducts hypothetical exit commission; cost-basis denominators include **`pointvalue`** and entry commission; **`capital_held`** returns **`na`** when margin is not explicitly configured (defaults 100%).
- **`strategy.closedtrades.*` percent getters**: Cost basis = entry notional × **`pointvalue`** + approximated entry commission; **`entry_comment` / `exit_comment`** fall back to **`entry_id` / `exit_id`** when unset.
- **`strategy.avg_losing_trade_percent`**: Reports signed negative percents (loss convention), not positive magnitudes.
- **Reversal metadata**: Reversing orders stamp prior trade **`exit_id` / `exit_comment`** from the reversing order; new trade gets entry comment from order.

### Changed

- **`syminfo.pointvalue` threading**: Woven through P&L, commission, per-trade excursions, equity peaks, margin helpers, and trade-collection getters so futures-style point values convert correctly.
- **Package metadata**: Repository URL → **`LuxAlgo/PineTS`**, homepage → **`luxalgo.com`**.

---

## [0.9.17] - 2026-06-02 - Strategy Namespace, `updateTail` Var Snapshots & Drawing `color(na)` Semantics

### Added

- **`strategy.*` namespace (full surface)**: Complete Pine Script strategy runtime — **`strategy()`** declaration, order primitives (**`strategy.entry`**, **`strategy.exit`**, **`strategy.order`**, **`strategy.close`** / **`close_all`**, **`strategy.cancel`** / **`cancel_all`**), direction constants (**`strategy.long`**, **`strategy.short`**), qty types (**`strategy.fixed`**, **`strategy.cash`**, **`strategy.percent_of_equity`**), account/position getters (**`equity`**, **`netprofit`**, **`openprofit`**, **`position_size`**, **`position_avg_price`**, **`position_entry_name`**, drawdown/runup stats, win/loss trade counts, etc.), indexed trade collections (**`strategy.closedtrades.*`**, **`strategy.opentrades.*`**), nested **`strategy.risk.*`** pre-trade filters, and conversion helpers (**`convert_to_account`**, **`convert_to_symbol`**, **`default_entry_qty`**). Engine in **`utils.ts`** with order fill simulation, commission/slippage hooks, and post-run state on **`context.strategy`**.
- **Transpiler support for strategies**: **`strategy`** registered in **`KNOWN_NAMESPACES`** / **`NAMESPACE_COLLISION_NAMES`** so Pine `strategy()` calls and namespace members transpile correctly alongside indicators.
- **`docs/strategy.md`**: Developer reference (quickstart, order primitives, **`context.strategy`** inspection, trade collections, risk management, conversion helpers, known divergences). Doc examples kept in lock-step with **`PineTS/.scratchpad/strategy-doc-examples.cjs`**.
- **`docs/api-coverage/strategy.md`** & **`docs/api-coverage/pinescript-v6/strategy.json`**: Full API coverage checklist updated to ✅ across the namespace surface.
- **`docs/syntax-guide.md`**: Strategy-related syntax notes for transpiler consumers.
- **Tests**: **`tests/namespaces/strategy/basic.test.ts`**, **`order.test.ts`**; **`tests/core/updateTail-var-drift.test.ts`** for live-bar var stability.

### Fixed

- **`updateTail()` / `_runComplete()` var drift on live bar re-execution**: Replaced pop-based **`_removeLastResult`** rollback (which drifted when **`var`** accumulators were mutated in-place on re-execution) with **snapshot-restore** matching **`_runPaginated`**. **`_runComplete`** now splits execution — all bars except the last, **`_varSnapshot`**, then the last bar — so same-bar tick updates leave **`var`** state unchanged (e.g. a per-bar counter stays **N**, not **N+1**). **`updateTail()`** restores from snapshot when available, re-executes with the same split, and refreshes the snapshot; falls back to pop-based rollback only for contexts without a snapshot (contribution by [@NexusAlien](https://github.com/NexusAlien))

- **`color(na)` semantics in `LineHelper` + `LinefillHelper`**: **`LineHelper`** now uses **`_resolveColor`** (like Box/Polyline) so raw **`na`** → **`NaN`** and **`color(na)`** → **`null`** are preserved instead of collapsing to inconsistent sentinels. **`LinefillHelper`** removed **`this._resolve(color) || ''`**, which wiped both signals to an empty string and made “invisible” anchor drawings render with the consumer’s default colour (e.g. LuxAlgo liquidity scripts using a fully-**`na`** box as a coord anchor).
- **`polyline.new()` default / optional colours**: Named-options merging uses **`hasOwnProperty`** checks instead of **`??`**, so omitted keys no longer overwrite defaults; positional arity uses explicit length guards. **`line_color`** / **`fill_color`** on **`PolylineObject`** accept **`any`** so raw **`na`** (**`NaN`**) and **`color(na)`** (**`null`**) survive into plot payloads.
- **Parser — contextual keywords as identifiers**: Enum members, typed declarations, function params, destructuring, and primary expressions accept contextual keywords (**`method`**, **`type`**, **`enum`**, etc.) when used as value references — fixes scripts like **`switch method`** where **`method`** is a parameter name.

### Changed

- **`context.strategy` state naming**: Result object fields aligned with Pine Script conventions (**`closedtrades`**, **`opentrades`**, lowercase getters) instead of camelCase internals; scalar getters (**`strategy.closedtrades`**, etc.) return counts while the full trade arrays remain on **`ctx.strategy`** for indexed access.
- **API coverage badges**: Regenerated strategy / coverage SVG badges after the namespace landed.

### Notes (strategy vs TradingView)

The **`strategy.*`** surface is implemented 1:1. Numeric output may still diverge from TV in specific fields (tracked iteration items, not missing API): **`margin_liquidation_price`** approximation, same-currency **`convert_to_*`** passthrough vs TV **`na`**, OCA auto-cancel/reduce not yet enforced on fill, commission sub-cent rounding, and per-trade **`max_drawdown` / `max_runup`** accounting on adjacent-bar trades. See **`docs/strategy.md`** and **`docs/api-coverage/strategy.md`**.

---

## [0.9.16] - 2026-05-13 - `request.security*` Script Slicing, `ticker.*` Namespace & Chart Visible Range

### Added

- **`ticker.*` namespace**: Implemented **`ticker.new`**, **`ticker.modify`**, **`ticker.inherit`**, **`ticker.standard`**, plus the chart-type constructors (**`ticker.heikinashi`**, **`ticker.renko`**, **`ticker.kagi`**, **`ticker.linebreak`**, **`ticker.pointfigure`**). Output ticker-id strings match TradingView's exact log form for the plain "no-modifier" cases used by virtually every real-world script. Chart-type modifiers are accepted but silently dropped at the **`request.security`** boundary (PineTS data providers serve standard candles only — documented as a known divergence). Bound on `Context.pine.ticker` with the standard **`param()`** wrapper for series/scalar argument handling.
- **Chart visible range (host environment)**: New **`PineTS.setVisibleRange(left, right)`** setter and **`visibleRangeLeft`** / **`visibleRangeRight`** getters lets a host (chart UI) feed the user's current zoom/pan into the runtime. Pine built-ins **`chart.left_visible_bar_time`** and **`chart.right_visible_bar_time`** read from those values, falling back to **`marketData[0]/[last].openTime`** when the host never calls the setter.
- **`PineTS.update()` smart re-run**: New `update(pineTSCode?)` wraps **`run()`** with viewport-change-aware caching — returns the cached **`Context`** unless the script statically references a viewport-dependent built-in **AND** the viewport changed since the last cached run. `pineTSCode` is optional after the first call. Designed for event-driven flows fanning a viewport change across many indicators: non-viewport-dependent instances are free.
- **`usesVisibleRange()` static detection**: Flagged at transpile time by post-codegen scan against **`VIEWPORT_DEPENDENT_BUILTINS`** (`chart.left_visible_bar_time`, `chart.right_visible_bar_time`). Lets fan-out consumers skip **`update()`** entirely on indicators whose output cannot change with the viewport.
- **`docs/initialization-and-usage.md`**: New sections "**The update() Method**" and "**Host Environment (Visible Range)**" documenting the new APIs and behavior table.

### Changed

- **`request.security_lower_tf` — sliced secondary execution**: The transpiler emits a per-call **truncated AST slice** (statements up to and including the call) compiled into a standalone async function, stashed on the returned indicator function as **`_ltfSlices`** and propagated onto **`Context`**. At runtime the slow path now calls **`pineTS.runPretranspiled(slice)`** instead of re-running the full user script in the secondary context — large reduction in wasted work whenever the script does post-call processing. Falls back to the legacy full-script path when no slice is available (e.g. uncovered AST shapes). Disable with **`PINETS_DISABLE_LTF_SLICING=1`** for correctness comparisons.
- **Slicing through nested user functions**: The slice walker path-projects into single-level **`FunctionDeclaration`** bodies — when a `request.security*` call lives inside a user function, the emitted slice keeps the (truncated) function definition plus the earliest top-level **`$.call(fnRef, …)`** invocation. UDT type definitions and `var`-declared instance constructors come along as top-level statements before the call site. UFCS methods (compiled as **`$M_`**-prefixed FunctionDeclarations) are sliced by the same code path.
- **`request.security` — sliced secondary execution**: `request.security` now consumes the same `_ltfSlices` table as **`request.security_lower_tf`**. Slice keys are the bare static `pN`; the runtime strips the path-prefix from **`_expression_name`** (added in [0.9.15]) before slice lookup so calls nested inside user functions resolve correctly. Falls back to the full-script path when no slice is registered.
- **`for k, v in map` iteration**: **`Context.iter()`** and **`Context.entries()`** now recognize **`PineMapObject`** (data on **`.map`** — a JS `Map`) and yield `[key, value]` pairs. Previously the fallthrough returned an empty iterator and `for [k,v] in map` silently iterated 0 times.

---

## [0.9.15] - 2026-05-08 - Titled Enums, Call-Path Isolation & `request.security_lower_tf` Optimizations

### Added

- **Titled enums**: Support for enum declarations with explicit titles aligned with Pine Script (**transpiler / runtime**).

### Fixed

- **`transformFunctionArgument` + array expressions**: **`ArrayExpression`** arguments now recurse into non-**`Identifier`** elements (**`CallExpression`**, **`BinaryExpression`**, etc.) so nested identifiers (e.g. **`maLenInput`** inside **`request.security_lower_tf(..., [volume, ta.sma(volume, maLenInput)])`**) get proper scope rewrites instead of leaking bare names and throwing **`ReferenceError`** at runtime.
- **Transpiler “not defined” regressions**: Broader fixes for identifier / scope edge cases that surfaced as runtime **`ReferenceError`**s.
- **Per-call-path state for user functions**: **`Context.peekId()`** maintains a **cumulative path stack** so **`var`** / **`let`** slots and **`ta.*`** accumulators do not leak across different call paths through a shared parametrized wrapper.
- **`$.param(..., 'pN')` in nested calls**: Parameter slot ids inside function bodies are **path-prefixed with `$$.id`** so distinct call paths no longer share **`context.params[pN]`** (fixes wrong or missing internal lines in complex multi-path indicators).

### Changed

- **`request.security_lower_tf`**: Fetches a **bounded** number of lower-timeframe bars instead of over-fetching (**optimization**).
- **Secondary contexts**: **Drawing** helpers are **skipped** when running **`request.security`** / LTF evaluation so work and payload generation stay on the chart context.
- **`security_lower_tf` fast path**: When the expression only needs **market data** from the lower timeframe, execution takes a **lighter path** without full expression evaluation overhead.

---

## [0.9.14] - 2026-05-05 - UDT & Transpiler Hardening, `request.security`, Streaming & Drawing `na`

### Added

- **`str.format_time(time, format, timezone)`**: Full string-based time formatting aligned with Pine Script (`Str.ts`, tests in `str.test.ts`).
- **`for...of` runtime helpers**: Codegen uses **`$.iter`** / **`$.entries`** instead of brittle one-off special cases.
- **UDT registry pre-pass**: **`preProcessUdtRegistry`** runs before analysis so **`ScopeManager`** is populated consistently (5 dedicated tests).

### Fixed

- **Live streaming with `eDate`**: **`runLive`** / live mode now works when an end date is provided; previously the combination was incorrectly rejected or behaved as non-live (**`PineTS.class.ts`**).
- **`for...in` over `MemberExpression` iterables**: Destructuring in **`for...in`** when the iterable is a member expression (e.g. chained property access) is transformed correctly (**`MainTransformer`**).
- **`request.security`**: Named arguments resolve through **`parseArgsForPineParams`** with **array/tuple-aware** `remaining_options`; secondary-context **bar alignment** improved; **`calc_bars_count`** threaded through the security pipeline.
- **Callable drawing/table namespaces**: **`box`**, **`linefill`**, **`polyline`**, **`table`** — fixes for correct call vs instance dispatch in transpiled code.
- **Reserved words in generated JS**: Transpiler avoids invalid identifiers when Pine names collide with JavaScript reserved words.
- **Comma-separated typed declarations**: Multiple declarations on one line with shared type; guard tightened so **`chart.point[] a = ..., chart.point[] b = ...`** (dotted / repeated types) is split handled as separate statements instead of mis-parsing (**`parseTypedVarDeclaration`**).
- **Contextual Pine Script keywords**: Parser treats keywords contextually so valid identifiers / constructs are not broken by overly greedy keyword rules.
- **UDT field subscripts in call arguments**: Per-bar lookback (`seriesVar.field[1]`) inside function-call arguments is transformed correctly.
- **UDT field-subscript & method transpiler**: Broader fixes for member access and methods on UDT instances.
- **UDT `.new()` mixed positional + named args**: When the last argument is a plain object whose keys match UDT field names, it is stripped and applied as named fields instead of shifting positional slots (**`Core.ts` UDT constructor**).
- **UFCS `obj.method()`**: Method names that are JS reserved words keep correct **`$M_`** naming without double **`_$N`** renames; **`Holder r = arr.get(0)`** with an explicit UDT type registers **`r`** for instance dispatch; **`.delete()`** on built-in drawing objects is not retargeted as a user method.
- **Typed `na` for drawings**: **`box(na)`**, **`line(na)`**, **`label(na)`**, **`polyline(na)`**, **`linefill(na)`**, **`table(na)`** behave as Pine **typed `na`** / casts, not as calls that build empty drawing instances.
- **UDT registration across function parameters**: Exiting a function that took a UDT parameter no longer clears outer-scope UDT-instance bindings — prior registrations are **snapshotted and restored** so patterns like **`var T x = T.new(...)`** plus **`foo(T x)`** still resolve **`x.foo()`** later.
- **Plots & deleted drawings**: Deleted drawing objects are **omitted** from generated plot payloads so consumers do not see stale handles.
- **Default colors**: Restored sensible default stroke/fill styling for **`box`** and **`polyline`** when colors are omitted.
- **Documentation**: Various doc updates (merged with this release train).

---

## [0.9.12] - 2026-04-15 - FMP Provider: `mintick`, Forex vs Crypto & Resilient `getSymbolInfo`

### Added

- **FMP `mintick` estimation**: After fetching candles, **`FMPProvider`** derives **`mintick`** from OHLC / close-to-close diffs (bucketed to a sensible tick size) and caches it; **`pricescale`** / **`minmove`** are computed from **`mintick`** instead of hardcoded **`0.01` / 100 / 1**.
- **`mintick` cache & conditional `symbolInfo` cache**: Estimated **`mintick`** is stored per ticker after the first successful candle fetch; **`getSymbolInfo`** reuses a cached **`ISymbolInfo`** when **`mintick`** was derived from that data, avoiding redundant profile assembly with the same precision.

### Fixed

- **Forex vs crypto classification**: **Forex** is detected **before** crypto using a **6-letter pair** heuristic plus a **currency whitelist**, so pairs like **EURUSD** are no longer misclassified as crypto. Crypto suffix matching **excludes** known forex pairs and allows slightly longer tickers.
- **`getSymbolInfo` without a profile**: If the FMP profile call fails or returns nothing, **`getSymbolInfo`** still builds **`ISymbolInfo`** from the **ticker** (exchange / type / session / timezone heuristics) instead of returning **`null`**.
- **Forex session & timezone**: Forex symbols use **`Etc/UTC`** and session **`0000-0000`**; **base** / **quote** currency are parsed from the pair (**`EURUSD`** → EUR / USD).

---

## [0.9.11] - 2026-04-12 - `time()` HTF Semantics, `timeframe.change()` & Live-Stream `var` Snapshots

### Added

- **`time()` with a `timeframe` argument**: **`TimeHelper`** now aligns the active bar to the **higher timeframe** and returns the **opening timestamp** of the HTF bar that contains the current bar (intraday, daily, weekly, monthly). Empty or chart-matching timeframe still returns the bar’s own time. **`timeframe_bars_back`** handling was removed in favor of this alignment model (see TradingView-style HTF `time()`).
- **Session + HTF `time()`**: When **`session`** is set, the session test uses the **aligned HTF time**, not only the chart bar time.
- **`timeframe.change(timeframe)`**: Implemented on **`Timeframe`** — compares **previous vs current** bar open times aligned to the target TF and returns **`true`** on the **first bar of a new HTF period** (uses shared **`normalizeTimeframe`** / **`alignToTimeframe`** from **`Time.ts`**).
- **Tests**: **`time-function.test.ts`**, **`timeframe-change.test.ts`**.

### Fixed

- **Live stream (`runLive`) and `var` state**: Re-execution of the **last bar** no longer relies only on **`_removeLastResult`** for **`var`** persistence. The runtime **snapshots `var` / `let` / `const` / `params`** before the last bar, then **restores** that snapshot before refetch and re-run, so **`var`** entries stay consistent when the feed updates (avoids in-place drift across streaming ticks).

---

## [0.9.10] - 2026-04-07 - Drawing Caps, Linefill Dedupe & Live-Stream Throttle

### Added

- **`max_*_count` for drawing objects**: **Box**, **label**, **line**, and **polyline** helpers enforce **`max_boxes_count`**, **`max_labels_count`**, **`max_lines_count`**, and **`max_polylines_count`** from **`context.indicator`** (defaults **50**). When the active count exceeds the limit, the **oldest non-deleted** objects are marked deleted (**FIFO**), matching TradingView-style caps and avoiding unbounded growth.
- **`linefill.new()` pair deduplication**: If a **linefill** already exists between the **same two lines** (either order), the existing object is **updated in place** (color, bar) instead of appending another — same behavior as TradingView when `linefill.new()` runs every bar without deleting the previous fill.
- **`force_overlay` for linefills**: **`LinefillObject.toPlotData()`** sets **`force_overlay`** when **either** referenced line uses it; **`syncToPlot()`** emits **`__linefills_overlay__`** as a separate overlay plot (aligned with box/line/label splitting).
- **Plot colors from chart theme getters**: **`plot()`** resolves **`options.color`** when it is a **bound function** (e.g. **`chart.fg_color`**, **`chart.bg_color`**) by calling it, so theme-driven colors work like on TradingView.

### Fixed

- **Live stream / pagination loop**: When **`runLive`** is on the **last bar** (caught up to the feed), the per-iteration delay now **always runs**, even if **`closeTime`** is still in the past — avoids tight loops that ignore **`interval`**. When a fetch **only updates the last candle** (no new bars), adds a **minimum ~1 s** spacing between API calls after the request completes, reducing provider hammering while a candle is forming or the market is quiet.

---

## [0.9.9] - 2026-04-02 - Drawing Setters, NAMESPACES_LIKE Subscripts & force_overlay Sync

### Fixed

- **NAMESPACES_LIKE subscripts (transpiler)**: Subscripts on dual-use builtins (`time[1]`, `time_close[1]`, etc.) now emit **`$.get(name.__value, n)`** instead of **`name.__value[n]`**, so lookback matches Pine Script / forward-array Series semantics.
- **Box / line coordinate setters**: `set_lefttop`, `set_rightbottom`, `set_xy1`, `set_xy2`, `set_left`, `set_right`, and related setters on **box** and **line** helpers now call **`_resolve()`** so Series-derived coordinates unwrap the same way as **`new()`** constructors.
- **`force_overlay` on drawing objects**: **`syncToPlot()`** in **BoxHelper**, **LineHelper**, and **LabelHelper** routes **`force_overlay=true`** objects into **separate overlay plots** so chart integrations can place them on the main price pane.

### Added

- **Tests**: `box-setters-resolve`, namespace subscript transpiler coverage, and **gradient `fill()`** cases.

---

## [0.9.8] - 2026-03-27 - TA Cross/CrossUnder, Matrix·Vector, Plot Serialization & Input Fixes

### Fixed

- **`ta.crossover` / `ta.crossunder`**: Boundary comparison now uses inclusive `<=` / `>=` where TradingView expects equality at the crossing bar (replaces strict `<` / `>`). Verified against TradingView reference logs.
- **`matrix.mult` (vector operand)**: Multiplying a matrix by a row/column vector now returns a **`PineArrayObject`** instead of a **`PineMatrixObject`**, matching Pine Script semantics and fixing polyline-style indicators (e.g. Spline Quantile Regression).
- **`plotchar` Signature**: Corrected `PLOTCHAR_SIGNATURE` so the **`char`** argument is in the proper parameter slot for dynamic `plotchar` calls.
- **`TYPE_CHECK.color`**: Accepts **Series-wrapped** color values so colors passed through variables are not rejected and lost at runtime.
- **`color.new` / `color.rgb`**: NaN / invalid transparency no longer produces malformed hex strings (e.g. `#787b86NAN00`).
- **Bool `input`**: Fixed bool input default/coercion edge cases.
- **UDT Return from User Functions**: Fixed user-defined functions that return a UDT instance.
- **Drawing Object Serialization / `context.plot`**: Plot serialization avoids **circular references** when drawing objects are present.

---

## [0.9.7] - 2026-03-23 - Alerts, Fill & Drawing Fixes, OOB Warnings (TV-Aligned)

### Added

- **`alert()` / `alertcondition()`**: Full runtime support for `alert()` and `alertcondition()` — messages, frequencies, and event emission through the context. Transpiler injects **callsite IDs** on alert calls so multiple alerts with the same text or different frequencies are tracked independently (mirrors plot callsite IDs).
- **`Context.warnings` & `context.warn()`**: Non-fatal runtime warnings (e.g. array/matrix index out of range) are collected per bar instead of throwing. **`runLive()`** subscribers can listen for `'warning'` events alongside `'data'` and `'error'`.
- **Documentation**: New `docs/data-providers.md` (FMP, Alpaca, Binance, Mock, array-based data). Updates to precision docs, architecture overview, getting started, and initialization guides.

### Fixed

- **Array/Matrix Out-of-Bounds — TV Behavior**: Out-of-range `array.*` / `matrix.*` access no longer throws `PineRuntimeError` by default; it logs a warning via `context.warn()`, returns `na` / no-op, and keeps the script running (matches TradingView).
- **`fill()` & `force_overlay`**: `fill(plot1, plot2, ...)` now respects `force_overlay` so fills follow overlay vs sub-pane placement correctly.
- **Linefill Color Parsing**: Fixed incorrect parsing / application of linefill colors from Pine options. (fix issue #167)
- **Tuple Destructuring**: Fixed edge cases in tuple destructuring (transpiler / parser) that broke certain assignment patterns.
- **Drawing Object Default Overlay**: Label, line, linefill, box, and polyline helpers now default `overlay` from `context.indicator?.overlay` instead of hardcoded `true`, so drawings align with the hosting indicator’s pane.
- **Named Options vs `null`**: Added `arg !== null` guard when detecting named option objects — `null` from `color(na)` and similar no longer gets misclassified as a named-args object.
- **Numeric Precision & Equality Docs**: Tweaked `math.__eq` / `math.__neq` and serializer precision handling; documentation and examples updated for consistent decimal places.
- **Sourcemap Drift**: Fixed browser dev bundle sourcemaps so stack traces map reliably to TypeScript sources.

---

## [0.9.6] - 2026-03-14 - Runtime Error Handling, Loop Guard, Array Fixes & New Market Data Providers

### Added

- **`FMPProvider (beta)`** (Financial Modeling Prep): New provider for US equities, ETFs, crypto and forex via the FMP REST API. Supports daily (EOD) and intraday timeframes (1m–4h, paid plans). Configures with `Provider.FMP.configure({ apiKey: '...' })`.
- **`AlpacaProvider (beta)`**: New provider for US equities and ETFs via Alpaca Markets. Supports minute through monthly timeframes with cursor-based pagination (up to 10 000 bars/page). Configures with `Provider.Alpaca.configure({ apiKey: '...', secretKey: '...' })`.
- **`BaseProvider` Abstract Class**: New shared base class for all providers. Handles `closeTime` normalization, fail-early API key validation, and **automatic candle aggregation** — when a requested timeframe is not natively supported, `BaseProvider` selects the best available sub-timeframe, fetches sub-candles, and aggregates them transparently. `BinanceProvider` and `MockProvider` have been refactored to extend it.
- **Candle Aggregation Engine** (`src/marketData/aggregation.ts`): New module with `selectSubTimeframe()`, `aggregateCandles()`, and `getAggregationRatio()`. Supports fixed-ratio aggregation for intraday timeframes and calendar-based grouping for weekly/monthly bars.
- **`PineRuntimeError`**: New exported error class with a `method?: string` property. Thrown on Pine Script runtime violations (out-of-bounds access, loop limit exceeded). Distinguishable from general JS errors via `instanceof`.
- **`PineTS.setMaxLoops(n)`**: Configures the maximum iterations allowed per loop (default 500 000, matching TradingView's limit). Exceeding it throws a `PineRuntimeError`.
- **Loop Guard Injection**: The transpiler injects a counter + guard at the top of every `for`/`while` body, preventing runaway loops from hanging the runtime.
- **Negative Array Indices (Pine Script v6)**: `array.get`, `array.set`, `array.insert`, `array.remove`, `matrix.get`, `matrix.set` now accept negative indices (`-1` = last element).

### Fixed

- **Stored Numbers Precision**: `$.set()` now applies `context.precision()` when writing a number into a Series, preventing floating-point drift from accumulating across bars.
- **User Functions Returning Tuples with Complex Expressions**: `transformReturnStatement` was not walking into binary, unary, call, logical, or conditional expression nodes inside tuple arrays. Expressions like `_mid + _dev * mult` or `-_val` were left with bare identifiers, producing wrong values at runtime.
- **Array/Matrix Out-of-Bounds Reporting**: `array.get/set/insert/remove` and `matrix.get/set/row/col` now throw a `PineRuntimeError` when an index (after negative normalization) is still out of bounds, replacing the previous silent `NaN`/`undefined`.
- **Weak integer check fixed** previously using ((valus | 0) == value) now using Number.isInteger(value)

---

## [0.9.5] - 2026-03-12 - Time & Timezone Fixes

### Added

- **`PineTS.setTimezone(timezone)`**: Display-only chart timezone (like TradingView's timezone picker). Accepts IANA names, `UTC±N` offsets, or `'UTC'`. Only affects `log.*` timestamp formatting — computation functions (`timestamp()`, `hour`, `dayofmonth`, `time_tradingday`, etc.) always use the exchange timezone from `syminfo.timezone`.

### Fixed

- **`closeTime` Normalization**: `BinanceProvider` and `MockProvider` now normalize `closeTime` to the TradingView convention (`closeTime = nextBar.openTime`) instead of Binance's raw `nextBarOpen - 1ms`. `IProvider` docs updated to specify this convention. For array-based data missing `closeTime`, `PineTS` now estimates it as `openTime + timeframe duration` (falls back to 1D when unknown).
- **`time_tradingday` Uses Close Date**: Was returning midnight UTC of the bar's open date. Now correctly returns midnight UTC of the **close date** (matching TradingView). E.g. a weekly bar opening `2019-01-07` → closes `2019-01-14` → `time_tradingday = 2019-01-14 00:00 UTC`.
- **`timestamp(dateString)` Exchange Timezone**: Date strings like `"2019-06-10 00:00"` were parsed in the host system's local timezone. Now explicitly resolved in the exchange timezone (`syminfo.timezone`), matching TradingView behaviour. Strings with explicit offsets or `Z` are honoured as-is.
- **`TimeHelper` as `Series`** ([#156](https://github.com/LuxAlgo/PineTS/issues/156)): `Series.from()` now unwraps NAMESPACES_LIKE dual-use objects (`time`, `time_close`, etc.) by detecting the `.__value` Series property, instead of wrapping the object itself. Added a null-guard to prevent a crash when the source is `null`. (contribution by [@dcaoyuan](https://github.com/dcaoyuan))
- **`Log` Timestamps Use Chart Timezone**: `log.info/warning/error` hardcoded UTC for bar timestamp prefixes. They now respect the timezone set via `setTimezone()`, falling back to the exchange timezone.
- **`Etc/UTC` Alias**: Added `'Etc/UTC'` to the fast-path UTC check in `getDatePartsInTimezone()`, fixing date-part calculations for providers that use the canonical `Etc/UTC` identifier (common for crypto).
- **`ta.vwap` Session Timezone**: VWAP day-boundary detection now uses `getDatePartsInTimezone(openTime, syminfo.timezone)` instead of `toISOString().slice(0, 10)`, so session resets are correct for non-UTC exchanges.

---

## [0.9.4] - 2026-03-11 - Color Namespace, Transpiler Overhaul, request.security & Drawing Improvements

### Added

- **`color` Namespace Refactor**: Extracted the full color implementation from `Core.ts` into a dedicated `src/namespaces/color/PineColor.ts` module. Adds complete `COLOR_CONSTANTS` (all named palette colors), improved hex/rgb/rgba/`#RRGGBBAA` parsing, `color.from_gradient()` with NaN guard, and a full test suite.
- **`alert()` Stub**: Added the missing `alert()` function (previously only `alertcondition` existed). Emits to the context event bus so downstream code can subscribe without crashing.
- **`max_bars_back()` No-Op**: Added `max_bars_back(source, length)` as a compatibility stub. Returns its source argument unchanged (PineTS maintains full history, so there is no lookback cap to configure).
- **`linefill` Instance Methods**: `LinefillObject` now exposes `get_line1()`, `get_line2()`, and `set_color()` directly on the instance, enabling UDT field-chain patterns like `myStruct.fill.set_color(c)`.
- **UDT `.new()` Named Arguments**: `MyType.new(field1=val1, field2=val2)` now works correctly. The UDT constructor detects a named-argument object and maps keys to fields instead of positional assignment.
- **`linefill.new` Thunking**: Added `linefill.new` to `FACTORY_METHODS` so it receives the arrow-function thunk treatment in `var` declarations, preventing orphaned linefill objects from being created on every bar.
- **`math.__neq()` — Inequality Operator**: Added `math.__neq(a, b)` to handle Pine Script's `!=` / `<>` operator with proper NaN semantics (mirrors `math.__eq`).

### Fixed

#### Transpiler

- **For-Loop Init & Update `$.get()` Wrapping**: The for-loop init and update expressions lacked `addArrayAccess`, `MemberExpression`, and `CallExpression` handlers. Series variables appearing in loop bounds (e.g., `for i = 0 to bar_index - 1`) were left as raw Series objects, causing the update ternary to evaluate to `NaN` and producing infinite loops or bodies that never executed.
- **While-Loop Test Condition**: `while bar_index > cnt` and similar conditions with Series variables were not wrapped in `$.get()`, so the comparison always evaluated against a raw Series object (→ `NaN`). Fixed by adding missing `addArrayAccess` and namespace-object skip logic to `transformWhileStatement`.
- **Function-Scoped Variable Resolution**: Added `isVariableInFunctionScope()` to `ScopeManager`. `createScopedVariableReference()` now correctly resolves `var` declarations inside nested `if`/`for` blocks _within_ functions to the local context (`$$`) instead of the global context (`$`).
- **Optional Chaining for `na` UDT Drawing Fields**: `hasGetCallInChain()` now traverses `MemberExpression` _and_ intermediate `CallExpression` nodes to detect `$.get()` in deeper chains. Inserts `?.` on the final method call so `myStruct.line?.set_x2(x)` does not crash when the field is `na`/`undefined`.
- **User Function vs Method Call Disambiguation**: Added `isChainedPropertyMethod` guard — when the callee object is itself a `MemberExpression` (e.g., `myObj.x.set()`), the call is not mistakenly redirected through `$.call()` even if `set` happens to be a user-defined function name. Added `_skipTransformation = true` on function-reference identifiers inside `$.call()` to prevent them from resolving to same-named variables.
- **`hasGetCallInChain()` Chain Expression Traversal**: Extended to walk through `ChainExpression` wrapper nodes (`?.` optional chains) so already-wrapped intermediate nodes are also checked when determining whether to insert optional chaining.
- **`ReturnStatement` Walk-Through**: `MainTransformer`'s `ReturnStatement` handler now recurses into complex return arguments when not in function scope, preventing untransformed expressions in nested return statements.
- **`parseArgsForPineParams` NaN Handling**: Fixed dynamic Pine Script signatures passing `NaN` values through the argument normalizer, which caused downstream `isNaN` checks to misidentify valid numeric `0` values.
- **Await Propagation in User-Defined Functions**: Functions containing `request.security` calls (which are async internally) now correctly propagate `async`/`await` through the function declaration, preventing unresolved Promise objects from reaching callers.
- **Tuple Destructuring in User Functions**: Fixed the Pine Script parser emitting single-bracket `[a, b]` returns instead of the required double-bracket `[[a, b]]` tuple form when `=>` arrow functions ended with an `if/else` that returned a tuple.
- **Function Parameter Namespace Collision Renaming**: Parameters whose names collide with built-in namespaces (e.g., a parameter named `color`) were being looked up as namespace objects instead of local variables. The transpiler now renames such parameters to avoid the collision.
- **ArrayExpression Function Parameter Scoping**: Function parameters used inside array literal arguments (e.g., `[output, ...]`) were incorrectly resolved to the global scope (`$.let.output`) instead of the local raw identifier (`output`). Added `isLocalSeriesVar` check in `ExpressionTransformer`.
- **Switch Statement Tuple Destructuring**: IIFE array returns inside switch branches were not wrapped in the required `[[a, b, c]]` double-bracket form, causing `$.init()` to treat the tuple as a time-series and extract only the last element.
- **Array/Matrix Typed Declarations**: The Pine Script parser now correctly parses `array<float>`, `matrix<int>`, and other generic typed declarations in variable declarations and function signatures. Strong-typing tests cover all primitive and object element types.

#### Runtime

- **`plotcandle` and `barcolor`**: Fixed incorrect argument mapping and color resolution in both functions. `barcolor` now correctly applies per-bar color overrides to the candlestick series, and `plotcandle` produces properly structured OHLC plot data.
- **`request.security` Expression Handling**: Complex expressions passed as the `expression` argument (not just simple identifiers or plot references) now evaluate correctly in the secondary context. Also fixed user-defined method expressions being passed across context boundaries.
- **`request.security_lower_tf` Pine Script Behavior**: Rewrote lower-timeframe (LTF) aggregation to match TradingView's behavior — values are collected as intra-bar arrays, and the correct array element (first vs. last vs. all) is returned depending on `lookahead` / `gaps` settings.
- **Normalized Timeframes**: `timeframe.in_seconds()` and related utilities now correctly handle all non-canonical formats (`'1h'`→`'60'`, `'1d'`→`'D'`, `'1w'`→`'W'`) and return `NaN`/`0` when given `undefined` or an unrecognised string.
- **Plot Color Change Detection**: Fixed false positives in the plot color-change detector that caused unnecessary re-renders when the color value was numerically identical but represented by different intermediate Series wrappers.
- **`str.split()` Returns Pine Array**: `str.split()` was returning a plain JavaScript array. It now returns a `PineArrayObject` so array namespace methods (`.get()`, `.size()`, etc.) work on the result.
- **Label Colors & Backgrounds**: Fixed `label.set_textcolor()` and `label.set_bgcolor()` not applying when called after construction, and resolved parsing inconsistencies in `parseArgsForPineParams` that treated valid color `0` as `na`.
- **`color.from_gradient` NaN Guard**: Added `null`/`NaN`/`undefined` guards for all five arguments; previously a missing value produced `#NANNANNAN` hex strings.
- **Improved Color Parsing**: `PineColor` now handles all Pine Script color representations uniformly: 6-digit hex, 8-digit hex (`#RRGGBBAA`), `rgb()`, `rgba()`, named constants, and `color.new()` output.
- **Polyline Rendering Fixes**: Fixed `polyline.new()` crash when `points` contained `na` entries, incorrect `xloc` handling for bar-index vs. time coordinates, and missing default line/fill colors.
- **Array `new_*` Capacity Handling**: `array.new<T>(size, initial)` variants now clamp the requested capacity to `MAX_ARRAY_SIZE` and correctly initialise all elements to the provided default (was previously initialising to `undefined` in some typed constructors).
- **Table Cell Null Guard**: `table.cell()` now guards against `null`/`undefined` row or column indices, preventing a crash when table access patterns involve conditional creation.
- **`chart.fg_color`**: Fixed `chart.fg_color` returning the wrong value (`bg_color` was returned for both properties due to a copy-paste error).
- **Default Colors for Polyline and Table**: `polyline.new()` and `table.new()` no longer require explicit color arguments; sensible defaults are applied when colors are omitted or `na`.
- **User Functions Treated as Native Functions**: Fixed a regression where user-defined functions registered in `settings.ts` were forwarded through the native namespace dispatcher instead of the user function call path.
- **Sourcemap Generation for Browser Dev Build**: Fixed the rollup sourcemap pipeline for the `build:dev:browser` target so browser DevTools correctly resolve transpiled runtime errors to TypeScript source lines.

---

## [0.9.3] - 2026-03-06 - Streaming Support, request.security Fixes, Transpiler Robustness

### Added

- **`array.new_box` / `new_label` / `new_line` / `new_linefill` / `new_table` / `new_color`**: Added the six missing typed array factory methods so `array<box>`, `array<label>`, etc. can be created with a proper element type. The auto-generator (`scripts/generate-array-index.js`) now lists them as static factory functions (called with context) rather than instance delegates. `isValueOfType` in `array/utils.ts` was extended to accept object values for these types, allowing `array.push(label.new(...))` on typed arrays.
- **`request.security` — Live Streaming Support**: `request.security` now correctly handles live (streaming) bar updates. The secondary context is re-evaluated on each tick, and `findSecContextIdx` resolves the correct intra-bar index for the current live bar. Paired with drawing-object rollback (see below), streaming ticks no longer produce duplicate drawing objects.
- **`str.tostring` Format Patterns**: Added support for Pine Script's named and pattern-based format strings: `"#"`, `"#.#"`, `"#.##"`, `"0.00"`, and the `format.*` named constants. The formatter now applies these patterns before falling back to `toString()`.

### Fixed

- **While-Loop Test Condition Hoisting** (infinite-loop crash): `array.size()` and similar calls in a `while` condition were being hoisted to a temp variable _outside_ the loop by the default CallExpression walker, making them one-shot evaluations and causing an infinite loop followed by a crash. `MainTransformer` now registers a `WhileStatement` handler and `transformWhileStatement` was rewritten to use a recursive walker with hoisting suppressed throughout the entire test condition.
- **Array Pattern Scoping Crash**: `isArrayPatternVar` was determined using a global (non-scoped) set in `ScopeManager`. A local function variable whose name happened to match an outer-scope destructured tuple element was falsely treated as an array pattern, causing a runtime crash. Fixed by adding a shape guard: the flag is only set when `decl.init` is a computed `MemberExpression` (the `_tmp_0[0]` pattern produced by the AnalysisPass destructuring rewrite).
- **For-Loop Namespace Wrapping** (`math.min` → `$.get(math, 0).min`): In the for-loop test condition walker, `MemberExpression` nodes unconditionally recursed into their object, causing the `Identifier` handler to wrap context-bound namespace objects (`math`, `array`, `ta`, …) with `$.get()`. Fixed by skipping recursion and `addArrayAccess` for identifiers that are the object of a `MemberExpression` and are context-bound namespaces.
- **`request.security` Cross-Timeframe Value Alignment**: `barmerge.gaps_off` / `barmerge.lookahead_off` were passed as strings; their truthiness caused `findLTFContextIdx` to take the wrong branch (returning the first intra-bar instead of the last). Fixed by converting barmerge string enums to booleans. Added `normalizeTimeframe()` to map non-canonical formats (`'1h'`→`'60'`, `'1d'`→`'D'`) so `isLTF` determination is correct. Fixed secondary context date-range derivation to use `effectiveSDate` from `marketData` and extend `secEDate` to cover the last bar's intra-bars.
- **`barmerge` Missing from `CONTEXT_BOUND_VARS`**: `barmerge.gaps_off` / `barmerge.lookahead_off` (used in `request.security()`) were not in the transpiler's context-bound list, so they were left as bare identifiers instead of being mapped to the runtime context. Added `'barmerge'` to `settings.ts`.
- **`barstate.isconfirmed` Wrong Bar**: Was checking whether the last bar's close time equalled the session close via `closeTime[length-1]` (always the last bar in history) instead of the currently-executing bar. Fixed to use `closeTime.data[context.idx]` for correct per-bar evaluation.
- **`array.get()` Out-of-Bounds → NaN**: `array.get(arr, -1)` and other out-of-bounds accesses returned `undefined` (native JS), causing crashes when Pine Script code accessed properties (e.g., `.strength`) on the result. The method now returns `NaN` (Pine's `na`) for negative or out-of-range indices.
- **Drawing Helpers — `na` Color Resolution**: Drawing object helpers' `_resolve()` method now detects `NAHelper` instances and returns `NaN`, fixing cases where `border_color=na` (and similar `na` arguments) were silently ignored in `box.new()`, `line.new()`, etc. `BoxHelper` also gains a dedicated `_resolveColor()` that preserves `NaN` instead of letting it fall through an `||` fallback to the default color.
- **Streaming Rollback for Drawing Objects**: All five drawing types (`box`, `line`, `label`, `linefill`, `polyline`) now track a `_createdAtBar` property and expose a `rollbackFromBar(barIndex)` method. `Context.rollbackDrawings()` calls this during `_runPaginated` / `updateTail` to remove any drawing objects created on the current streaming bar before re-running it, preventing duplicate objects from accumulating across live ticks.

---

## [0.9.2] - 2026-03-06 - Drawing Object Method Syntax, Gradient Fill, Matrix & Array Improvements

### Added

- **Method-Call Syntax on Drawing Instances**: `LineObject`, `LabelObject`, and `BoxObject` now carry delegate setter/getter methods directly on the instance (e.g., `myLine.set_x2(x)`, `myBox.set_right(r)`, `myLabel.set_text(t)`). Each delegate forwards to the owning helper so the plot sync (`_syncToPlot`) fires correctly. Enables Pine Script patterns where drawing objects stored in UDTs or arrays are mutated via method syntax.
- **Gradient Fill (`fill()`)**: Added support for Pine Script's gradient fill signature — `fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color)`. The `FillHelper` detects the gradient form (third argument is a number) and stores per-bar `top_value`/`bottom_value`/`top_color`/`bottom_color` data for the renderer.
- **Typed Generic Function Parameters**: The Pine Script parser now correctly handles generic type annotations in function parameter lists (e.g., `array<float> src`, `map<string, float> data`). Previously these caused parse errors.

### Fixed

- **UDT Thunk Resolution for Drawing Object Fields**: When a `var` UDT instance contains fields initialised with factory calls (e.g., `line.new(...)`, `box.new(...)`), those fields are now correctly resolved as thunks on bar 0 inside `initVar`. Previously the thunk-wrapped factory results were stored as raw functions in the UDT field, causing the drawing object to never be created.
- **Typed Array Type Inference for Object Types**: `inferValueType()` no longer throws `"Cannot infer type from value"` when called with an object (e.g., a `LineObject` or `BoxObject`). It now returns `PineArrayType.any`, allowing `array<line>` and similar typed arrays to work correctly.
- **Non-Computed Namespace Property Access in `$.param()`**: Fixed `ExpressionTransformer` incorrectly wrapping namespace constant accesses (e.g., `label.style_label_down`, `line.style_dashed`) in `$.get()` calls when they appeared inside function arguments. The transformer now detects non-computed member access on `NAMESPACES_LIKE` identifiers and leaves them untransformed.
- **`histbase` Type in `PlotOptions`**: Fixed the `histbase` field in the `PlotOptions` TypeScript type from `boolean` to `number`, matching the actual Pine Script `plot(histbase=50)` signature.
- **For-Loop `MemberExpression` Recursion**: Fixed user variable identifiers inside method calls in `for` loops (e.g., `lineMatrix.rows()`) not being transformed. The `MemberExpression` visitor in `transformForStatement` now recurses into the object node after transformation so nested identifiers are correctly resolved.
- **Multiline `and` / Comparison Expressions**: Fixed the Pine Script parser dropping continuation lines in `and`/`&&` chains and comparison expressions spanning multiple lines. `skipNewlines(true)` is now called after the operator.
- **`matrix.inv()` — Full NxN Support**: Rewrote `matrix.inv()` from a 2×2-only implementation to Gauss-Jordan elimination with partial pivoting, supporting any square matrix. Singular matrices (pivot < 1e-14) return a NaN matrix.
- **`matrix.pinv()` — Real Pseudoinverse**: Rewrote `matrix.pinv()` from a placeholder stub to a correct Moore-Penrose pseudoinverse: square → `inv()`, tall (m > n) → `(AᵀA)⁻¹Aᵀ`, wide (m < n) → `Aᵀ(AAᵀ)⁻¹`.
- **`array.min()` / `array.max()` Performance**: Added an O(N) fast path for the common `nth=0` case instead of always sorting O(N log N).
- **`array.median()`, `percentile_linear_interpolation()`, `percentile_nearest_rank()` Performance**: Single-pass copy-and-validate optimizations.
- **`isPlot()` with Undefined Title**: Fixed `isPlot()` to accept plot objects that have `_plotKey` but no `title` property (e.g., fill plots created via callsite ID), preventing `fill()` from misidentifying its arguments (contribution by @dcaoyuan, [#142](https://github.com/LuxAlgo/PineTS/issues/142)).
- **Duplicate `map` in `CONTEXT_PINE_VARS`**: Removed an accidental duplicate `'map'` entry from `settings.ts`.

## [0.9.1] - 2026-03-04 - Enum Values, ATR/DMI/Supertrend Fixes, UDT & Transpiler Improvements

### Added

- **Enum Value Syntax (`Signal.Buy`)**: Full support for user-defined enum member access (e.g., `Signal.Buy`, `Direction.Long`). The transpiler now recurses into non-context-bound identifiers inside `MemberExpression` nodes, correctly resolving enum identifiers in return statements, if-test conditions, and operand positions.
- **Implicit Return for `=>` Arrow Functions with `if/else`**: The Pine Script parser now adds an implicit `return` when the last statement of a `=>` function body is an `if/else` block, matching Pine Script's expression-based semantics.

### Fixed

- **ATR Stale `prevClose`**: Fixed `ta.atr` using a stale previous close value when called conditionally. Replaced state-tracked `prevClose` with a direct `context.get(context.data.close, 1)` read, ensuring ATR always uses the actual previous bar's close.
- **ATR / DMI / Supertrend Backfill**: Fixed backfill for `ta.atr`, `ta.dmi`, and `ta.supertrend` when called inside conditional blocks. When `context.idx >= period` but the function hasn't accumulated enough calls (due to conditional execution), values are now computed from historical data directly — matching the backfill pattern used by other window-based TA functions.
- **`ta.param()` Hardcoded Index**: Fixed `ta.param()` functions across several TA methods that were using a hardcoded `0` index instead of the actual passed index, causing incorrect lookback reads.
- **`bar_index` as a Series**: Fixed `bar_index` to be handled correctly as a Series value throughout the runtime, ensuring lookback access (`bar_index[1]`) works as expected.
- **`array.new<UDT>(size)` Type Inference**: Fixed type inference for `array.new<UDT>(0)` when only a size argument is provided (no `initial_value`). The array element type was not being inferred in this case.
- **UDT Field Defaults in Codegen**: Fixed fields with expression defaults (e.g., `float upper = hl2`) not generating the correct `['type', default]` pair in the `Type()` constructor call, causing incorrect UDT instantiation.
- **Member Expression Chains on `var` Variables**: Fixed complex member expression chains like `holder.get(k).trend` not resolving correctly when `holder` is a `var`-declared variable.
- **`na()` Crash on UDT Objects**: Fixed `na()` crashing when called on UDT objects with circular references. `JSON.stringify` was replaced with a safer check.
- **UDT Defaults Lost by `$.param()` Wrapping**: Fixed `$.param(['float', 0])` wrapping the `[type, default]` array in a Series, causing `Type()` to fail to detect the pair structure.
- **`array.indexof(NaN)` Returns `-1`**: Fixed `array.indexof` returning `-1` for `NaN` values because JavaScript's `Array.indexOf` uses `===` which never matches `NaN`. The method now uses `Number.isNaN` for correct detection.
- **`MemberExpression` Missing `$.get()` in Call Args**: Fixed member expressions on Series variables (e.g., `get_spt.output`) inside binary expressions used as function arguments being transpiled as `$.let.glb1_get_spt.output` (a Series object) instead of `$.get($.let.glb1_get_spt, 0).output` (the current bar's value).
- **Table Fixes**: Fixed several issues in the `table.*` namespace implementation.
- **Polyline Named Arguments**: Fixed `polyline.new()` not correctly parsing named arguments.
- **Polyline Points from Series**: Fixed `polyline.new()` not correctly extracting `chart.point` values when points are stored in a Series.
- **Plot Default Color**: Fixed plots not falling back to a default color when no color is specified.
- **`hline` Options Consistency**: Fixed inconsistent evaluation of `hline()` options (contribution by @dcaoyuan, PR #134).
- **Missing `enum` Extend**: Fixed missing `extend` handling for enum declarations (contribution by @dcaoyuan, PR #137).

## [0.9.0] - 2026-02-27 - Box, Table & Polyline Namespaces, Pine Script Compliance & Critical Fixes

### Added

- **Box Namespace (`box.*`)**: Full implementation of the box drawing namespace — `box.new()`, `box.copy()`, `box.delete()`, and all setter/getter methods (`set_left`, `set_right`, `set_top`, `set_bottom`, `set_bgcolor`, `set_border_color`, `set_border_width`, `set_border_style`, `set_text`, `set_text_color`, `set_text_size`, `set_extend`, etc.).
- **Table Namespace (`table.*`)**: Full implementation of the table drawing namespace — `table.new()`, `table.cell()`, `table.delete()`, and cell/table setter methods. Tables are positioned at fixed screen locations (`position.top_left`, `position.bottom_center`, etc.) and rendered as DOM overlays in QFChart.
- **Polyline Namespace (`polyline.*`)**: Implementation of `polyline.new()` for rendering multi-point connected paths from arrays of `chart.point` objects, with support for curved lines, closed shapes, and fill color.
- **Primitive Type Declarations**: Added support for `int()`, `float()`, and `string()` cast/conversion expressions in Pine Script syntax (e.g., `x = int(someValue)`).
- **`enum` Keyword Support**: Added `enum` keyword handling in the transpiler for Pine Script v6 enum declarations.
- **Test Coverage**: Comprehensive new test suites — `box.test.ts`, `table.test.ts`, `polyline.test.ts`, `linefill.test.ts`, `fill.test.ts`, `hline.test.ts`, `line.test.ts`, `plot.test.ts`, `constants.test.ts`, `request.test.ts`, `ta-backfill.test.ts`, `parser-fixes.test.ts` (1000+ new test cases).

### Changed

- **Type Name Compliance**: Renamed internal type constant names to match Pine Script's naming convention exactly. Aligned string constants across label styles, line styles, shape types, and size presets so PineTS output is directly compatible with QFChart renderers without manual mapping.

### Fixed

- **`na == na` Equality**: Fixed `na == na` to correctly return `false` in Pine Script (unlike `NaN === NaN` in JavaScript which is also `false`, but the equality transpilation path was not applying `__eq()` consistently in all cases).
- **TA Backfill in Conditional Closures**: Fixed backfill logic for `ta.*` window-based functions (`sma`, `highest`, `lowest`, `stdev`, `variance`, `dev`, `wma`, `linreg`, `cci`, `median`, `roc`, `change`, `alma`) when the function call is inside a conditional block (e.g., `if someCondition => ta.sma(...)`). Previously, the source-series backfill would fail because the method wasn't being called on bars where the condition was false, leaving the window incomplete.
- **TA Function-Variable Hoisting**: Fixed `ta.obv`, `ta.tr`, and other TA function-variables that behave as both a function call and a variable. These must be evaluated on every bar — even when referenced inside a conditional block — to maintain accurate rolling state. They are now hoisted to the top of the context function.
- **RSI Fix**: Fixed RSI calculation accuracy for edge cases.
- **`math.round` Compliance**: Fixed `math.round` to match Pine Script's rounding behavior (rounds half away from zero, matching Pine's `math.round()` semantics rather than JavaScript's `Math.round()` which rounds half towards positive infinity).
- **`request.security` — `syminfo.tickerId`**: Fixed `request.security` to correctly parse `syminfo.tickerId` when it contains the provider prefix (e.g., `"BINANCE:BTCUSDT"`), stripping the provider ID before lookup.
- **`request.security` — Tuple Returns**: Fixed `request.security` to correctly unwrap and return tuple values from the secondary context.
- **Transpiler — Multi-Level Nested Conditions**: Fixed transpiler handling of deeply nested `if/else if/else` chains that span multiple indentation levels.
- **Transpiler — IIFE Statements**: Fixed handling of already-transformed IIFE (Immediately Invoked Function Expression) nodes to prevent double-transformation.
- **Transpiler — Switch/Case Edge Cases**: Fixed several edge cases in switch statement transpilation including missing default cases and complex multi-line case bodies.
- **`color.*` Fixes**: Fixed several `color.*` function edge cases for correct RGBA string generation.

## [0.8.12] - 2026-02-27 - Line & Linefill Namespaces, Plot Callsite IDs, Fill Support

### Added

- **Line Namespace (`line.*`)**: Full implementation of the line drawing namespace including `line.new()`, `line.copy()`, and all setter/getter methods (`set_x1`, `set_y1`, `set_x2`, `set_y2`, `set_color`, `set_width`, `set_style`, `set_extend`, etc.).
- **Linefill Namespace (`linefill.*`)**: Implementation of `linefill.new()` for filling the area between two line objects, with `set_color`, `get_color`, `delete`, and related methods.
- **Fill Support (`fill()`)**: Implementation of the `fill()` function for filling areas between plots and hlines.
- **Plot Callsite IDs**: Transpiler now injects unique callsite IDs (`{__callsiteId: "#N"}`) for every `plot()`/`hline()`/`fill()` call to handle duplicate plot titles ([#110](https://github.com/LuxAlgo/PineTS/issues/110)).
- **Transpiler Dotted Types**: Added support for dotted type annotations in Pine Script (e.g., `chart.point`, `line`).

### Fixed

- **Plot Title Collisions**: Multiple plots with the same title no longer overwrite each other; collisions are resolved with human-readable `title#N` keys ([#110](https://github.com/LuxAlgo/PineTS/issues/110)).
- **Var Declaration Side Effects**: Factory method calls (e.g., `line.new()`, `line.copy()`) in `var` declarations are now deferred via arrow function thunks to prevent orphan object creation on every bar.
- **Array Initialization**: Fixed `array.new<type>()` with no arguments (e.g., `array.new<chart.point>()`).
- **Label & Line Value Resolution**: Values passed to label and line setters can now be Series, bound functions, or plain scalars — all are correctly resolved.
- **For Loops Runtime Direction**: Added support for for loops where the iteration direction is determined at runtime.

## [0.8.11] - 2026-02-21 - Time Functions, Log Timezone, Transpiler & TA Window Fixes

### Added

- **Time Functions**: Added support for `time`, `time_close`, and `timestamp`, plus time component functions: `dayofmonth`, `dayofweek`, `weekofyear`, `year`, `month`, `hour`, `minute`, `second`.
- **Log Timezone**: Updated `log.*` namespace to support timezone; logs use UTC time (to be revisited later).
- **Automated Tests**: Prepared advanced automated test suite; updated `builtin.json` and related test data.

### Changed

- **Constant-Like Functions**: Refactored transpiler handling of functions that behave like constants (e.g. `time`, `time()`, `na`, `na()`). Previously only `na` was supported and hardcoded; the solution is now generalized for such built-ins.
- **Documentation**: Documentation updates.

### Fixed

- **Transpiler Array Access in Function Arguments**: Fixed a bug where inline array access inside function arguments (e.g., `nz(a[b], a)`) produced wrong results. The transpiler was passing the index as a Series reference instead of unwrapping it to a scalar value via `$.get()`. This caused `$.param()` to receive a Series object as the index, leading to incorrect offset calculations.
- **TA Rolling Window with Dynamic Lengths**: Fixed all window-based TA functions (`ta.lowest`, `ta.highest`, `ta.sma`, `ta.ema`, `ta.stdev`, `ta.bb`, `ta.bbw`, `ta.cci`, `ta.dev`, `ta.wma`, `ta.vwma`, `ta.alma`, `ta.swma`, `ta.hma`, `ta.linreg`, `ta.median`, `ta.variance`, `ta.change`, `ta.roc`) to correctly handle dynamic window lengths. Previously, the window trimming used `if` (single pop) instead of `while` (trim to target), leaving stale values when the length decreased by more than one between bars.
- **TA Rolling Window Recovery**: Added source-series backfill to all window-based TA functions. When a dynamic length shrinks then grows, the window now recovers missing historical values from the source series instead of returning NaN. Functions that intentionally exclude NaN from their windows (`ta.stdev`, `ta.bb`, `ta.bbw`, `ta.cci`) correctly stop backfilling at NaN boundaries.

## [0.8.10] - 2026-02-21 - Chart & Label Namespaces, For-Loop Fix

### Added

- **Chart and Label Namespaces**: Added support for `chart.*` and `label.*` namespaces (pull request #116).
- **Data Providers**: Added `configure` method to data providers for runtime configuration.

### Fixed

- **For-Loop Transpiler**: Fixed call expressions not being properly handled in for-loop contexts.

## [0.8.9] - 2026-02-15 - Pine Script Parser & Compatibility Fixes

### Fixed

- **Typed Variables Declaration**: Fixed typed variables declaration and untyped bracket arrays for Pine Script v5 compatibility.
- **TA highest/lowest**: Fixed `ta.highest` and `ta.lowest` so the first argument can be `_length` (contribution by @dcaoyuan).
- **Standard Colors**: Removed colors that are not in Pine's standard color list (contribution by @dcaoyuan).

## [0.8.8] - 2026-02-09 - Community Contributions & Fixes

### Fixed

- **Color Conversion**: Fixed color conversion for `color.new()` to correctly generate `rgba()` strings (contribution by @dcaoyuan).
- **Parser Comments**:
    - Fixed parser to allow comments between `if` block and `else` (contribution by @C9Bad).
    - Fixed parser to allow inline comments after type fields (contribution by @C9Bad).
- **TA Bollinger Bands**: Fixed `ta.bb` return order to be `[middle, upper, lower]` to match Pine Script behavior (contribution by @dcaoyuan).

## [0.8.7] - 2026-02-08 - Pine Script Transpiler Enhancements & Fixes

### Added

- **Tuple Support**: Added support for tuple destructuring in `for...in` syntax (e.g., `for [a, b] in array`).
- **Unit Tests**: Added comprehensive unit tests for switch statement transpilation and unary operator handling.

### Fixed

- **For Loops**: Fixed transpiler bugs with Pine Script array iteration:
    - Fixed `for...in` syntax when using Pine Script arrays.
    - Fixed `for...of` syntax handling in PineTS syntax, including destructuring support (e.g., `for [i, x] in arr`).
    - Fixed function/variable name collision issues in loop contexts.
- **Method Call Syntax**: Fixed method call syntax for user-defined functions (e.g., `obj.method()` where `method` is a user function). The transpiler now correctly transforms these into function calls `method(obj, ...args)`.
- **Method Chains**: Fixed AST traversal for method chains (e.g., `func(arg).method()`) to ensure arguments in the chain are correctly transformed.
- **Switch Statement**: Fixed multiple issues with switch statement transpilation:
    - Fixed switch expression when used outside of a function.
    - Fixed generated IIFE (Immediately Invoked Function Expression) for switch statements.
    - Fixed multi-line switch body handling.
    - Improved switch syntax conversion in Pine Script to PineTS transpiler.
- **Unary Operators**: Fixed transpiler to properly transform function calls within unary expressions (e.g., `!func()`). (contribution by @dcaoyuan)
- **Matrix Operations**: Fixed matrix operations transpilation issues.
- **Linter Fixes**: Resolved TypeScript linter errors in transformer code.

### Changed

- **Pine Script Parser**: Enhanced Pine Script to JavaScript transpiler phase with improved error handling and syntax support.

## [0.8.6] - 2026-01-27 - Binance Data Provider Hotfixes

### Fixed

- **Binance Provider** : Wrong handling of stream data when sDate and eDate are not provided

## [0.8.5] - 2026-01-27 - Transpiler Hotfixes

### Fixed

- **Deprecation Warnings**: Fixed wrong warning message appearing with valid code.
- **Pine Script Parser**: Fixed multiline Pine Script conditions parsing (indent error).
- **Transpiler**: Fixed `switch` statement syntax conversion.

## [0.8.4] - 2026-01-24 - Math Namespace Enhancements & Critical Fixes

### Added

- **Math Namespace**: Added `math.todegrees` and `math.toradians` functions. (contribution)

### Fixed

- **Math Namespace**: Fixed `math.precision` implementation and `math.round` precision parameter handling.
- **Variable Scope Collision**: Fixed critical issue where local variables (`var`, `let`, `const`) in user-defined functions were sharing state across different function calls. Implemented dynamic scoping using unique call IDs to ensure each function instance maintains isolated state and history.
- **SMA NaN Handling**: Improved `ta.sma` to correctly propagate `NaN` values and handle `NaN` contamination in the rolling window by falling back to full recalculation when necessary.
- **Transpiler Optimization**: Major optimization of user-defined function transpilation. Introduced local context (`$$`) for scoping variables, reducing transpiled code complexity and improving readability by removing redundant `_callId` argument passing.
- **Array Access in Expressions**: Fixed a bug in the transpiler where array access inside expressions (e.g. ternary operators) could use incorrect static scope keys.

## [0.8.3] - 2026-01-13 - Transpiler Critical Fixes

### Fixed

- **Scientific Notation Parsing**: Fixed Pine Script lexer to correctly parse scientific notation literals (e.g., `10e10`, `1.2e-5`, `1E+5`). Previously, these were incorrectly tokenized as separate tokens, causing syntax errors in transpiled code.
- **Namespace Function Calls in Return Statements**: Fixed critical bug where namespace function calls (e.g., `math.max()`, `ta.sma()`) in single-expression return statements were incorrectly transpiled with double parentheses (e.g., `math.max()()`), resulting in runtime errors. Removed redundant AST traversal in `transformReturnStatement`.

## [0.8.2] - 2026-01-13 - Plot Fill Method & Transpiler Fixes

### Added

- **Plot Fill Method**: Implemented `plot.fill()` method to fill the area between two plot lines with customizable colors and transparency.

### Fixed

- **Transpiler Variable Names Collision**: Fixed variable name collision issues in the transpiler that could cause incorrect variable renaming and scope conflicts.
- **Logical Expressions in Function Arguments**: Fixed handling of logical expressions (e.g., `&&`, `||`) when passed as arguments to functions, ensuring proper evaluation and transpilation.

## [0.8.1] - 2026-01-11 - Transpiler hotfix

### Fixed

- **Transpiler Math Operations**: Fixed operator precedence issue where parentheses were lost in complex arithmetic expressions (e.g., `(a + b) * c` becoming `a + b * c`).

## [0.8.0] - 2026-01-10 - Runtime Inputs & UDT Transpiler Fix

### Added

- **Runtime Indicator Inputs**: New `Indicator` class to pass custom input values at runtime. Create indicators with `new Indicator(source, inputs)` and pass them to `PineTS.run()`. Input values override default values from `input.*` declarations.
- **Input Resolution**: Enhanced `input.*` namespace methods to resolve values from runtime inputs via `context.inputs`, falling back to default values when not provided.

### Fixed

- **PineScript UDT Transpilation**: User-defined types (`type` keyword) now correctly transpile to `Type({...})` syntax instead of JavaScript classes, ensuring compatibility with PineTS runtime.

## [0.7.9] - 2026-01-06 - User Function Call ID Fix

### Fixed

- **Critical Transpiler Fix**: Resolved cache collision bug in user-defined functions containing `ta.*` calls. Implemented context stack mechanism (`$.pushId()`, `$.peekId()`, `$.popId()`) to manage unique call IDs without explicit arguments, preventing state corruption and argument shifting issues with default parameters.

## [0.7.7] - 2025-01-03 - Live Streaming Support

### Added

- **PineTS.stream() Method**: Event-driven wrapper of `PineTS.run()` to simplify handling live data and real-time updates
- Documentation updates for streaming functionality

### Fixed

- **Critical Fix**: Live data processing was producing wrong values in `ta.*` functions due to incorrect handling of current vs committed candles

## [0.7.6] - 2025-12-30 - Additional Plot Functions

### Added

- **Plot Functions**: Added support for additional Pine Script plot functions:
    - `plotbar()` - Renders OHLC data as traditional bar charts with horizontal ticks
    - `plotcandle()` - Renders OHLC data as candlesticks with filled bodies and wicks
    - `bgcolor()` - Fills the chart background with colors based on conditions
    - `barcolor()` - Colors the main chart candlesticks based on indicator conditions

### Changed

- Enhanced `Plots` namespace with support for OHLC array values and color application to main chart
- Updated API coverage documentation to reflect new plot functions

## [0.7.5] - 2025-12-29 - UDT Support

### Added

- Support for User defined types

## [0.7.4] - 2025-12-27 - Plot styles fix + PineScript transpiler coverage

### Added

- Unit-tests for PineToJS transpiler branch bringing the total coverage back to > 80%

### Fixed

- plot styles were missing in the generated code (e.g plot.style_columns ...etc )

## [0.7.3] - 2025-12-24 - Plot Functions & PineScript Types Enhancement

### Added

- **Plot Functions**: Added support for `plotshape` and `plotarrow` functions
- **PineScript Type Constants**: Full implementation of PineScript type namespaces:
    - `format.*` - Number format types
    - `plot.*` - Plot style types
    - `location.*` - Location constants for shapes
    - `size.*` - Size constants for shapes
    - `shape.*` - Shape style constants
    - `display.*` - Display mode constants

## [0.7.2] - 2025-12-22 - Binance Provider Hotfix

- Hotfix : Binance provider failing for USA users, implemented a fallback logic to use the default binance url and fallback to US local url if the first one fails.

## [0.7.0] - 2025-12-20 - Pine Script Parser & Build System Modernization

### Added

- **Pine Script Parser/Converter**: Initial implementation of native Pine Script parser that automatically detects and converts Pine Script v5 and v6 source code into PineTS executable code. PineTS.run(source) can now run a native PineScript source.
- **Async Statement Handling**: Graceful handling of async statements (e.g., `request.security`) declared in PineTS syntax without explicit `await`, bringing PineTS syntax closer to native Pine Script
- **Test Coverage**: New comprehensive unit tests covering the PineTS transpiler
- **Namespace Documentation**: Added detailed documentation for Namespaces folder

### Changed

- **Build Pipeline**: Updated build system to generate modern package supporting multiple formats and environments (ESM, CJS, UMD)
- **Plot Namespace**: Restructured Plot namespace for better organization and maintainability
- **Documentation**: Updated README with improved formatting and comprehensive project information

### Fixed

- **Critical TA bug** : Fixed a critical bug in atr, ema and stdev moving averages, the bug was affecting series that contain NaN values.
- **Equality Operator**: Fixed `__eq` method to properly handle string value comparisons
- **Transpiler Expression Handling**: Fixed wrong decomposition of expressions passed to JSON objects
- **TA Functions**: Fixed `ta.pivotlow` and `ta.pivothigh` when called without optional source argument
- **Matrix Build**: Fixed matrix namespace build issues

## [0.6.0] - 2025-12-15 - Array, Map, Matrix namespaces & API enhancements

### Added

- **Array namespace enhancements**:
    - Implementation of array strong typing
    - Array binary search functions
    - Additional array methods: `sum`, `avg`, `min`, `max`, `median`, `mode`, `stdev`, `variance`, `covariance`, `standardize`, `range`, `abs`, `percentrank`, `percentile_linear_interpolation`, `percentile_nearest_rank`
- **Map namespace**: Full support for `map` namespace operations
- **Matrix namespace**: Full support for `matrix` namespace operations
- **Timeframe namespace**: Complete implementation of timeframe-related functions
- **Request namespace**: Added `request.security_lower_tf` function
- **Syminfo namespace**: Fully implemented in Binance provider
- Better API coverage tracking with badges
- Progress on `math` methods implementations

### Changed

- Updated `input.*` namespace to fully support dynamic Pine Script parameters

### Fixed

- Map and Matrix initialization issues
- Array precision handling
- Array methods fixes to match exact PineScript logic: `slice`, `every`, `median`, `mode`, `percentile_nearest_rank`, `percentrank`, `some`, `sort_indices`, `sort`
- Array method fixes: `fill`, `new_float`, `push`, `set`, `unshift`
- Transpiler return statement for native data
- Binance provider cache handling
- Transpiler: passing native series to JSON objects

## [0.5.0] - 2025-12-04 - Extensive TA implementation & Transpiler enhancements

### Added

- Comprehensive implementation of `ta` namespace methods:
    - **Trend**: `supertrend`, `dmi`, `sar`, `falling`, `rising`, `cross`
    - **Volatility/Range**: `bb` (Bollinger Bands), `bbw`, `kc` (Keltner Channels), `kcw`, `range`, `tr` (True Range as method)
    - **Volume**: `accdist`, `cum`, `iii`, `nvi`, `pvi`, `pvt`, `wad`, `wvad`
    - **Oscillators**: `cci`, `cmo`, `cog`, `mfi`, `stoch`, `tsi`, `wpr`
    - **Statistical/Rank**: `correlation`, `barssince`, `valuewhen`, `percentrank`, `percentile_linear_interpolation`, `percentile_nearest_rank`, `mode`, `highestbars`, `lowestbars`
- Core `bar_index` variable support

### Changed

- **Unified Namespace Architecture**: All namespace members (e.g., `ta.tr`, `ta.obv`) are now implemented as methods. The transpiler automatically handles the conversion from property access to method call (e.g., `ta.tr` → `ta.tr()`)
- Updated `ta.tr` and `ta.obv` to align with the unified method pattern

### Fixed

- **`var` keyword semantics**: Implemented correct Pine Script behavior for `var` variables (initialize once, persist state across bars) via `$.initVar`
- `math.sum` handling of `NaN` values
- Transpiler handling of tertiary conditions involving Series access
- `ta.supertrend` calculation logic

## [0.4.0] - TBD - Request.security implementation and transpiler enhancements

### Added

- Full implementation of `request.security()` function with lookahead and gaps support
- New TA methods: `obv`, `alma`, `macd`, `swma`, `vwap`
- Architecture documentation for transpiler, runtime, and namespaces
- Support for handling raw .pine.ts indicator code (without context function wrapper)
- Ability to show original code lines in transpiled code as comments for debugging
- Comprehensive unit tests for `request.security()` functionality
- harmonization of Series logic accross the codebase

### Changed

- Restructured TA unit tests for better organization
- Improved Series handling for better performance and reliability
- Enhanced transpiler to handle implicit pine.ts imports and normalize native imports
- Namespaces import harmonization across the codebase

### Fixed

- Critical recursion bug in `request.security()` implementation
- Tuple return handling in functions
- Property type check issues

## [0.3.1] - 2025-11-26 - Code coverage

### Added

- Automatic code coverage badge generation

## [0.3.0] - 2025-11-26 - Major refactor + optimization

### Added

- Pagination and streaming mode support for processing large datasets
- Automatic regression tests generator for Pine Script compatibility testing
- Series class implementation for forward arrays optimization
- Support for checking transpiled code during development
- Added Pine Script language unit tests
- Added WillVixFix and SQZMOM indicators for compatibility tests
- Automatic code coverage badge

### Changed

- Major namespaces refactoring for better organization and maintainability
- Transpiler refactor for improved code generation
- Updated unit tests with new approach to compare to Pine Script data
- Updated documentation pages and build process
- Improved README readability and documentation links

### Fixed

- Fixed compound assignment operations
- Fixed history access in series
- Fixed index handling in forward arrays
- Fixed plot parameters
- Fixed arithmetic operations for native series
- Fixed browser build
- Fixed plot values and time indexes

## [0.2.1] - 2025-11-16 - Hotfix: floating point equality + performance optimization

### Fixed

- Missing math namespace for floating point equality check
- Small performance optimization (removed array slicing in the main loop)

### Changed

- Updated README and transpiler unit tests (added cache id)
- Documentation indicators update

## [0.2.0] - 2025-11-15 - Major TA performance optimization

### Changed

- Performance optimization: reimplementation of most TA functions to enhance performance (~x5 execution speed on average)
- Documentation updates

## [0.1.34] - 2025-04-24 - Documentation and bug fixes

### Fixed

- Fix issue #4 (https://github.com/alaa-eddine/PineTS/issues/4)
- Fix doc page chart

### Changed

- Documentation updates
- Added demo chart to the documentation
- Theme update: switching to just-the-docs theme
- GitHub pages layout updates
- Documentation layout fixes

## [0.1.33] - 2025-04-24 - Functions variables bug fix

### Fixed

- Functions variables bug fix

## [0.1.32] - 2025-04-23 - TA crossover functions

### Added

- Support for ta.crossover, ta.crossunder, ta.pivothigh, ta.pivotlow functions

## [0.1.31] - 2025-02-12 -

### Added

- Fix for math.avg function

## [0.1.3] - 2025-02-10 -

### Added

- Multiple transpiler fixes
- Fix Logical, Binary and unary expressions when passed as arguments to PineTS internal functions (e.g plot(close && open, ...))
- Support fo "na" as valid value (will be converted to NaN by the transpiler)
- Fix for Pine Script functions returning tupples
- Add partial support for color.rgb and color.new (these need to be completely rewritten)
- Experimenting a cache approach for TA functions (not yet ready, only tested with sma)
- Add Support for querying large time interval from MarketDataProvider by running multiple requests with a step, the requested market data is cached to prevent rate limiting and optimize performance
- Complete refactor of math.\* functions to ensure compatibility with time series for all functions using the same syntax as Pine Script

## [0.1.2] - 2025-02-05 - initial request.security() support

### Added

- Support for request.security() function : in this build we only support the security() function for timeframes higher than the current timeframe, also, gaps, ignore_invalid_symbol, currency and calc_bars_count parameters are supported yet

## [0.1.1] - 2025-02-01 - array namespace

### Added

- array namespace partial support. Ported functions : array.new_bool, array.new_float, array.new_int, array.new_string, array.new<type>, abs, avg, clear, concat, copy, covariance, every, fill, first, from, get, includes, indexof, insert, join, last, lastindexof, pop, push, range, remove, reverse, set, shift, slice, some, sort, sort_indices, standardize, stdev, sum.
- Documentation pages to track portage coverage of Pine Script API and Language features.

## [0.1.0] - 2025-01-29 - Initial release

This is the first release of PineTS, a TypeScript library that allows you to port Pine Script indicators to TypeScript.

### Added

- Support for Pine Script time series, if conditions, for loops, functions, and partial plot directives.
- Partial implementation of ta namespace. ported functions : ema, sma, vwma, wma, hma, rma, change, rsi, atr, mom, roc, dev, variance, highest, lowest, median, stdev, linreg, supertrend.
- Partial implementation of math namespace. ported functions : abs, pow, sqrt, log, ln, exp, floor, round, random, max, min, sin, cos, tan, asin, acos, atan, avg.
