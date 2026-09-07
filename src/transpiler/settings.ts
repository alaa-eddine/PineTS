// Known Pine Script namespaces that might be used as functions or objects
export const KNOWN_NAMESPACES = ['ta', 'math', 'request', 'array', 'input', 'color', 'ticker', 'strategy'];

// This is used to transform ns() calls to ns.any() calls
// Entries with a __value property also support dual-use as variables (e.g. time, na)
//
// Pine v6 type-cast pattern: `<TypeName>(value)` — most commonly `box(na)`,
// `line(na)` etc. inside UDT initializers — needs the namespace to be listed
// here so the call gets rewritten to `<TypeName>.any(value)` (each helper's
// `any` delegates to `new`, producing a typed-na/passthrough value).
export const NAMESPACES_LIKE = [
    'hline',
    'plot',
    'fill',
    'label',
    'line',
    'box',
    'linefill',
    'polyline',
    'table',
    'footprint',
    'volume_row',
    'na',
    'alert',
    'time',
    'time_close',
    'dayofmonth',
    'dayofweek',
    'hour',
    'minute',
    'month',
    'second',
    'weekofyear',
    'year',
];

// Async methods that require await keyword (format: 'namespace.method')
export const ASYNC_METHODS = ['request.security', 'request.security_lower_tf', 'request.footprint'];

// Host-bound Pine built-ins whose values come from the UI/host environment (viewport,
// theme, chart-type) rather than from market data. PineTS provides sensible defaults
// (e.g. visible range = full loaded marketData range), but a consumer can override
// them at runtime via PineTS.setVisibleRange() and similar setters.
//
// A script that references ANY of these is "host-dependent": its output may change
// when the host's state changes, so re-runs are required after setter calls.
// Scripts that don't reference these are unaffected — their re-run on setter changes
// can be skipped entirely (see PineTS.usesVisibleRange()).
//
// Detection: post-transpile regex scan of the function body string. Comments are
// stripped during pine2js, so this is comment-safe. Each entry is matched as a
// whole-word identifier-path (\b-anchored), so `chart.left_visible_bar_time` is a hit
// but a user identifier accidentally containing the substring is not.
export const VIEWPORT_DEPENDENT_BUILTINS = ['chart.left_visible_bar_time', 'chart.right_visible_bar_time'];

// Namespaces whose method calls receive a transpiler-injected trailing
// options object containing `{ __callsiteId }` to uniquely identify the
// AST call site at runtime. The runtime helper `extractCallsiteId(args)`
// (in src/namespaces/utils.ts) pops this sentinel off the args array
// before the normal arg-parsing runs.
//
// The pattern was introduced for plot/hline/fill to disambiguate calls
// with the same `title` (Pine allows this; the runtime keys plots by
// title, so without a callsite ID two `plot(x, "SMA")` calls would
// collide in `context.plots`). The runtime appends the callsite suffix
// only on collision — see `PlotHelper._resolvePlotKey`.
//
// FIXME (callsite-ID inconsistencies — known but not unified yet):
//   1. `alert` ALSO uses this trailing-options-object pattern but has
//      its own injection branch in ExpressionTransformer; it should be
//      moved into this list when alert's per-callsite frequency gating
//      is generalized.
//   2. `ta.*` uses a DIFFERENT pattern: a positional `_callId` last
//      argument injected by a separate branch in ExpressionTransformer
//      (and consumed by `(source, period, _callId?: string)` signatures
//      in each TA method). The positional form lets TA function calls
//      compose with `$$.id` inside user functions for nesting-correct
//      state, but it diverges from the trailing-options-object pattern
//      used here. Unification would require updating every TA method's
//      signature.
//   3. User function calls use yet another mechanism — rewritten as
//      `$.call(fn, "_fnN", ...)` wrapper at the expression level.
//      Used to push the callId onto a context stack for nested TA.
//   4. `strategy.*` uses this mechanism ONLY for `strategy.exit` (added
//      to enable cadence-detection — see runtime in exit.ts). Other
//      `strategy.*` methods are excluded to avoid forcing every strategy
//      handler to extractCallsiteId(); future unification could extend
//      the pattern to entry/order/close.
//
// Entries can be a bare namespace (e.g. `'plot'` → all plot.* methods get
// injection) OR a fully-qualified `'namespace.method'` (e.g.
// `'strategy.exit'` → only that method). The transpiler checks both
// forms.
export const CALLSITE_ID_NAMESPACES = [
    'plot',           // all plot methods (including plot, plotchar, plotshape, plotarrow, plotbar, plotcandle)
    'hline',          // all hline methods
    'fill',           // all fill methods
    'strategy.exit',  // cadence-detection for persistent vs ephemeral exit-parameter capture
];

// Factory methods that create objects with side effects (format: 'namespace.method')
// When used inside `var` declarations, these calls are wrapped in arrow functions
// so they are only evaluated on bar 0 (deferred evaluation via initVar thunk).
export const FACTORY_METHODS = [
    'line.new',
    'line.copy',
    'label.new',
    'label.copy',
    'polyline.new',
    'box.new',
    'box.copy',
    'table.new',
    'linefill.new',
];

// Names that function as namespaces — used as function calls (fill(...), plot(...))
// or member access (size.tiny, label.style_label_down). User variables with these
// names must be renamed during codegen to avoid shadowing the namespace binding
// injected by InjectionTransformer. Excludes pure built-in variables (second, hour,
// time, na, etc.) which are safely scoped by Phase 2 into $.let.glb1_* without collision.
export const NAMESPACE_COLLISION_NAMES = new Set([
    ...KNOWN_NAMESPACES,
    // NAMESPACES_LIKE that are actual function-call namespaces
    'fill',
    'plot',
    'hline',
    'label',
    'line',
    // Drawing/enum namespaces with member access
    'size',
    'extend',
    'display',
    'format',
    'location',
    'shape',
    'text',
    'xloc',
    'yloc',
    'linefill',
    'polyline',
    'box',
    'table',
    'map',
    'matrix',
    'chart',
    'alert',
    'barstate',
    'syminfo',
    'session',
    'timeframe',
    'strategy',
    'log',
    'str',
    'footprint',
    'volume_row',
    // Constant/enum namespaces (member access only). TradingView allows user
    // variables to share these names while namespace member access still
    // works (e.g. `position = 1` alongside `position.top_right`), so the
    // user variable must be renamed. `dayofweek` is dual-use (built-in
    // variable + enum) — renaming only triggers when the user DECLARES a
    // variable with the name, so bare built-in reads are unaffected.
    'position',
    'font',
    'order',
    'currency',
    'dayofweek',
    'adjustment',
    'barmerge',
]);

// JavaScript reserved keywords that ARE valid Pine identifiers but invalid as
// JS identifiers. When a user names a function/method/variable using one of
// these, we must rename it during codegen — otherwise the generated JS fails
// to parse (e.g. `function delete() {}` → `Unexpected keyword 'delete'`).
//
// Excludes words reserved in BOTH languages (break, case, class, const, continue,
// do, else, enum, export, for, if, import, in, return, switch, try, var, while)
// — those can't be Pine identifiers in the first place.
//
// Excludes `this` — special-cased elsewhere as the implicit first parameter
// of Pine `method` declarations.
export const JS_RESERVED_WORDS = new Set([
    'await',
    'debugger',
    'default',
    'delete',
    'extends',
    'finally',
    'function',
    'implements',
    'instanceof',
    'interface',
    'let',
    'new',
    'package',
    'private',
    'protected',
    'public',
    'static',
    'super',
    'throw',
    'typeof',
    'void',
    'with',
    'yield',
]);

// All known data variables in the context
export const CONTEXT_DATA_VARS = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'openTime', 'closeTime'];

// All known Pine variables in the context
export const CONTEXT_PINE_VARS = [
    //namespaces
    ...KNOWN_NAMESPACES,
    //plots
    'plotchar',
    'plotshape',
    'plotarrow',
    'plotbar',
    'plotcandle',
    'plot',
    'bgcolor',
    'barcolor',
    'hline',
    'fill',

    //declarations
    'indicator',
    'library',

    //
    'alertcondition',
    'alert',
    'error',
    'max_bars_back',
    'fixnan',
    'na',
    'nz',
    'timestamp',
    'str',
    'box',
    'line',
    'label',
    'table',
    'chart',
    'linefill',
    'polyline',
    'map',
    'matrix',
    'log',
    'runtime',
    // order-flow object namespaces (request.footprint)
    'footprint',
    'volume_row',
    //types
    'Type', //UDT
    'bool',
    'int',
    'float',
    'string',

    //market info
    'timeframe',
    'syminfo',
    'barstate',
    'session',

    //builtin variables
    'bar_index',
    'last_bar_index',
    'last_bar_time',
    'timenow',
    'inputs',
    'time',
    'time_close',
    'time_tradingday',
    'dayofmonth',
    'hour',
    'minute',
    'month',
    'second',
    'weekofyear',
    'year',

    // Pine Script enum types
    'order',
    'currency',
    'display',
    'shape',
    'location',
    'size',
    'format',
    'dayofweek',

    // Coordinate and alignment constants
    'xloc',
    'yloc',
    'text',
    'font',
    'extend',
    'position',

    // Merge constants (request.security)
    'barmerge',

    // Adjustment constants
    'adjustment',
    'backadjustment',

    // Financial data constants
    'earnings',
    'dividends',
    'splits',
];

// All known core variables in the context
//names exposed in legacy pine.core namespace
//this will be deprecated then removed
export const CONTEXT_CORE_VARS = ['na', 'nz', 'plot', 'plotchar', 'color', 'hline', 'fill'];
