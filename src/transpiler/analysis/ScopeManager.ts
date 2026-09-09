// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * JavaScript global literals and objects that should never be treated as user variables
 */
const JS_GLOBAL_LITERALS = new Set(['Infinity', 'NaN', 'undefined', 'null', 'true', 'false']);

/**
 * JavaScript global objects that should not be transformed
 */
const JS_GLOBAL_OBJECTS = new Set([
    'Math',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Date',
    'RegExp',
    'Error',
    'JSON',
    'Promise',
    'Set',
    'Map',
    'WeakSet',
    'WeakMap',
    'Symbol',
    'BigInt',
    'Proxy',
    'Reflect',
    'console',
    'isNaN',
    'isFinite',
    'parseInt',
    'parseFloat',
    'encodeURI',
    'decodeURI',
    'encodeURIComponent',
    'decodeURIComponent',
]);

/**
 * Reduce a Pine type annotation to its BASE type name:
 *   'array<float>'        → 'array'
 *   'series table'        → 'table'
 *   'simple string'       → 'string'
 *   'matrix<int>'         → 'matrix'
 *   'MyType'              → 'MyType'
 * Generic arguments are stripped first, then qualifier prefixes
 * (series/simple/const/input/...) by taking the last whitespace token.
 */
export function normalizePineBaseType(pineType: string | undefined): string | undefined {
    if (!pineType || typeof pineType !== 'string') return undefined;
    let s = pineType.trim();
    const lt = s.indexOf('<');
    if (lt >= 0) s = s.slice(0, lt);
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

export class ScopeManager {
    private scopes: Map<string, string>[] = [];
    private scopeTypes: string[] = [];
    private scopeCounts: Map<string, number> = new Map();
    private contextBoundVars: Set<string> = new Set();
    private arrayPatternElements: Set<string> = new Set();
    private rootParams: Set<string> = new Set();
    private localSeriesVars: Set<string> = new Set();
    private varKinds: Map<string, string> = new Map();
    private loopVars: Set<string> = new Set();
    private loopVarNames: Map<string, string> = new Map(); // Map original names to transformed names
    private paramIdCounter: number = 0;
    private cacheIdCounter: number = 0;
    private tempVarCounter: number = 0;
    private taCallIdCounter: number = 0;
    private userCallIdCounter: number = 0;
    private plotCallIdCounter: number = 0;
    private alertCallIdCounter: number = 0;
    private loopGuardCounter: number = 0;
    private hoistingStack: any[][] = [];
    private suppressHoisting: boolean = false;
    private reservedNames: Set<string> = new Set();
    private userFunctions: Set<string> = new Set();
    private userMethods: Set<string> = new Set();
    /**
     * Regular user-declared functions (i.e. NOT methods). Tracked separately
     * from `userFunctions` so a UFCS-style direct call to a method-only
     * declaration (`foo(receiver, args)` where `foo` was declared as
     * `method foo(...)`) can be retargeted to the prefixed JS name.
     *
     * If a Pine name has both a regular function and a method form, the
     * regular function takes precedence for direct `name(args)` calls and
     * the method is reachable via dot-syntax `obj.name(args)`.
     */
    private regularUserFunctions: Set<string> = new Set();

    /**
     * Registry of user-defined UDT type names → their field map (fieldName → fieldType).
     * Populated from `const X = Type({fieldA: ['type', default], ...})` declarations
     * (which pine2js emits from Pine `type X` declarations).
     *
     * V2 data model: stores field-type metadata. V1 logic only consults
     * `isUdtTypeName` for now; field metadata is ready for future use-site
     * type-aware rewrites (nested UDT chains, mixed scalar/array fields, etc.).
     */
    private udtTypeNames: Map<string, Record<string, string>> = new Map();

    /**
     * Registry of user variables that hold UDT instances → the UDT type name.
     * Populated from `let bar = X.new(...)` / `bar = X.copy(...)` where
     * `X ∈ udtTypeNames`. Stores the type name (V2 shape) so future passes
     * can do typed-field lookups via `getUdtTypeFields(typeName)` without
     * a refactor. V1 logic only consults `isUdtInstance`.
     */
    private udtInstances: Map<string, string> = new Map();

    /**
     * Registry of user-defined function names → UDT type they return.
     * Populated by inspecting each FunctionDeclaration's return paths during
     * the UDT pre-pass. A function is registered only when ALL return paths
     * unambiguously produce the SAME UDT type.
     *
     * Used by the instance populator so that `bar = makeBar()` registers
     * `bar` as a UDT instance when `makeBar` is known to return one.
     */
    private functionReturnTypes: Map<string, string> = new Map();

    /**
     * Registry of user-defined function names → tuple of UDT type names they
     * return. Each slot holds either the UDT type name at that position, or
     * `undefined` when that position is not (unambiguously) a UDT instance.
     *
     * Populated when ALL return paths of a function are ArrayExpressions of
     * the SAME length and each position resolves to the SAME UDT (or to
     * something non-UDT, which becomes `undefined`).
     *
     * Used by the instance populator so that `[a, b] = makeBars()` registers
     * `a` and `b` as UDT instances at their respective tuple positions.
     */
    private functionReturnTupleTypes: Map<string, (string | undefined)[]> = new Map();

    /**
     * Registry of user-defined function names → map of {paramName → UDT type}.
     * Populated from `<funcName>.__pineParamTypes__ = {...}` markers emitted
     * by pine2js codegen for parameters that carried a Pine type annotation
     * (e.g. `readField(BAR b)`). Filtered to UDT-known types so non-UDT
     * annotations like `int` / `float` / `string` never enter the map.
     *
     * Consumed by `transformFunctionDeclaration`: when entering a function's
     * body, each typed param is temporarily registered as a UDT instance
     * (`markVariableAsUdtInstance`) so the use-site rewrite for `b.field[N]`
     * fires inside the body. The registration is removed when leaving the
     * function scope, keeping the global registry clean.
     */
    private functionParamUdtTypes: Map<string, Record<string, string>> = new Map();

    /**
     * Registry of variable names → static Pine BASE type ('table', 'array',
     * 'line', ...). Populated from `__pineTypedVar:` markers (explicit
     * annotations like `var table tb = ...`) and from built-in constructor
     * initializers (`tb = table.new(...)`, `eq = array.from(...)`).
     *
     * Consumed by the dot-call dispatch in `transformCallExpression`: a user
     * `method` declared on a built-in receiver type (e.g. `method cell(table
     * tb, ...)`) must win over the built-in member when the receiver's static
     * type matches the method's declared first-parameter type (TV semantics).
     */
    private varStaticTypes: Map<string, string> = new Map();

    /**
     * Registry of user `method` Pine names → declared receiver BASE type
     * (first-parameter type, e.g. 'table' for `method cell(table tb, ...)`).
     * Populated from `$M_<name>.__pineReceiverType__ = '...'` markers emitted
     * by pine2js codegen.
     */
    private methodReceiverTypes: Map<string, string> = new Map();

    /**
     * Registry of user-defined function names → map of {paramName → BASE
     * type} for ALL type-annotated params (unlike `functionParamUdtTypes`,
     * which is filtered to UDT types). Consumed by
     * `transformFunctionDeclaration` to scope-locally register built-in-typed
     * params (e.g. `f(table t)`) in `varStaticTypes` so dot-calls of user
     * methods on those params dispatch correctly inside the body.
     */
    private functionParamStaticTypes: Map<string, Record<string, string>> = new Map();

    public get nextParamIdArg(): any {
        return {
            type: 'Identifier',
            name: `'p${this.paramIdCounter++}'`,
        };
    }

    public get nextCacheIdArg(): any {
        return {
            type: 'Identifier',
            name: `'cache_${this.cacheIdCounter++}'`,
        };
    }

    public getNextTACallId(): any {
        return {
            type: 'Literal',
            value: `_ta${this.taCallIdCounter++}`,
        };
    }

    public getNextUserCallId(): any {
        return {
            type: 'Literal',
            value: `_fn${this.userCallIdCounter++}`,
        };
    }

    public getNextPlotCallId(): any {
        return {
            type: 'Literal',
            value: `#${this.plotCallIdCounter++}`,
        };
    }
    public getNextAlertCallId(): any {
        return {
            type: 'Literal',
            value: `alert_${this.alertCallIdCounter++}`,
        };
    }
    public getNextLoopGuardName(): string {
        return `__lg${this.loopGuardCounter++}`;
    }

    constructor() {
        // Initialize global scope
        this.pushScope('glb');
    }

    pushScope(type: string): void {
        // Add a new scope of the given type
        this.scopes.push(new Map());
        this.scopeTypes.push(type);
        this.scopeCounts.set(type, (this.scopeCounts.get(type) || 0) + 1);
    }

    popScope(): void {
        // Remove the current scope
        this.scopes.pop();
        this.scopeTypes.pop();
    }

    getCurrentScopeType(): string {
        return this.scopeTypes[this.scopeTypes.length - 1];
    }

    /**
     * True when any active scope on the stack is a function scope.
     * Different from `getCurrentScopeType() === 'fn'`, which only matches
     * the immediate scope — code inside a nested `if`/`for`/`while` inside
     * a function body still needs the function-scope context (e.g. for
     * call-path-keyed param/ta-callsite ids).
     */
    isInsideFunctionScope(): boolean {
        for (let i = this.scopeTypes.length - 1; i >= 0; i--) {
            if (this.scopeTypes[i] === 'fn') return true;
        }
        return false;
    }

    getCurrentScopeCount(): number {
        return this.scopeCounts.get(this.getCurrentScopeType()) || 1;
    }

    addLocalSeriesVar(name: string): void {
        this.localSeriesVars.add(name);
    }

    removeLocalSeriesVar(name: string): void {
        this.localSeriesVars.delete(name);
    }

    isLocalSeriesVar(name: string): boolean {
        return this.localSeriesVars.has(name);
    }

    // ── UDT registry ────────────────────────────────────────────────────
    // V2-shape data model populated up-front; V1 logic only uses the
    // boolean checks (`isUdtTypeName`, `isUdtInstance`) at use sites.
    // Field-type metadata and per-variable UDT-type lookups are ready
    // for future use (nested-field type discrimination, etc.).

    addUdtTypeName(typeName: string, fields: Record<string, string> = {}): void {
        this.udtTypeNames.set(typeName, fields);
    }

    isUdtTypeName(name: string): boolean {
        return this.udtTypeNames.has(name);
    }

    getUdtTypeFields(typeName: string): Record<string, string> | undefined {
        return this.udtTypeNames.get(typeName);
    }

    markVariableAsUdtInstance(varName: string, typeName: string): void {
        this.udtInstances.set(varName, typeName);
    }

    getVariableUdtType(varName: string): string | undefined {
        return this.udtInstances.get(varName);
    }

    isUdtInstance(varName: string): boolean {
        return this.udtInstances.has(varName);
    }

    /**
     * Record a user-defined function as returning a specific UDT type.
     * Idempotent — re-registering with the same type is a no-op; conflicting
     * registrations (different type) drop back to "unknown" by removing the
     * entry, so an ambiguous function never falsely promotes a caller.
     */
    setFunctionReturnType(funcName: string, typeName: string): void {
        const existing = this.functionReturnTypes.get(funcName);
        if (existing && existing !== typeName) {
            this.functionReturnTypes.delete(funcName);
            return;
        }
        this.functionReturnTypes.set(funcName, typeName);
    }

    getFunctionReturnType(funcName: string): string | undefined {
        return this.functionReturnTypes.get(funcName);
    }

    /**
     * Record a user-defined function as returning a tuple whose positions
     * carry specific UDT types (or `undefined` for non-UDT positions).
     * Idempotent — re-registering with the same shape is a no-op; conflicting
     * registrations (different length OR different type at any position) drop
     * the entry, so an ambiguous function never falsely promotes a caller.
     */
    setFunctionReturnTupleType(funcName: string, tupleTypes: (string | undefined)[]): void {
        const existing = this.functionReturnTupleTypes.get(funcName);
        if (existing) {
            if (existing.length !== tupleTypes.length ||
                existing.some((t, i) => t !== tupleTypes[i])) {
                this.functionReturnTupleTypes.delete(funcName);
                return;
            }
        }
        this.functionReturnTupleTypes.set(funcName, tupleTypes);
    }

    getFunctionReturnTupleType(funcName: string): (string | undefined)[] | undefined {
        return this.functionReturnTupleTypes.get(funcName);
    }

    /**
     * Record a user-defined function's UDT-typed parameters. The argument
     * is a `paramName → UDT type` map filtered down to UDT-known types only.
     */
    setFunctionParamUdtTypes(funcName: string, paramTypes: Record<string, string>): void {
        this.functionParamUdtTypes.set(funcName, paramTypes);
    }

    getFunctionParamUdtTypes(funcName: string): Record<string, string> | undefined {
        return this.functionParamUdtTypes.get(funcName);
    }

    /**
     * Remove a previously-registered UDT instance entry. Used to roll back
     * scope-local registrations (e.g. UDT-typed function parameters) when
     * leaving the function body, so the global registry stays clean.
     */
    unmarkVariableAsUdtInstance(varName: string): void {
        this.udtInstances.delete(varName);
    }

    // ── Static (built-in) type registry ─────────────────────────────────
    // Mirrors the UDT registry for BUILT-IN receiver types (table, array,
    // line, ...) so user `method`s declared on built-in types can be
    // dispatched by declared-receiver-type matching at dot-call sites.

    setVarStaticType(varName: string, pineType: string): void {
        const base = normalizePineBaseType(pineType);
        if (base) this.varStaticTypes.set(varName, base);
    }

    getVarStaticType(varName: string): string | undefined {
        return this.varStaticTypes.get(varName);
    }

    unsetVarStaticType(varName: string): void {
        this.varStaticTypes.delete(varName);
    }

    setMethodReceiverType(pineName: string, pineType: string): void {
        const base = normalizePineBaseType(pineType);
        if (base) this.methodReceiverTypes.set(pineName, base);
    }

    getMethodReceiverType(pineName: string): string | undefined {
        return this.methodReceiverTypes.get(pineName);
    }

    setFunctionParamStaticTypes(funcName: string, paramTypes: Record<string, string>): void {
        this.functionParamStaticTypes.set(funcName, paramTypes);
    }

    getFunctionParamStaticTypes(funcName: string): Record<string, string> | undefined {
        return this.functionParamStaticTypes.get(funcName);
    }

    addContextBoundVar(name: string, isRootParam: boolean = false): void {
        // Register a variable as context-bound, with optional root parameter flag
        this.contextBoundVars.add(name);
        if (isRootParam) {
            this.rootParams.add(name);
        }
    }
    removeContextBoundVar(name): void {
        // Remove a variable from the context-bound variables set
        if (this.contextBoundVars.has(name)) {
            this.contextBoundVars.delete(name);

            // If it's also a root parameter, remove it from there too
            if (this.rootParams.has(name)) {
                this.rootParams.delete(name);
            }
        }
    }
    addArrayPatternElement(name: string): void {
        this.arrayPatternElements.add(name);
    }

    isContextBound(name: string): boolean {
        // JavaScript global literals and objects should never be treated as context-bound
        if (JS_GLOBAL_LITERALS.has(name) || JS_GLOBAL_OBJECTS.has(name)) {
            return false;
        }
        // Check if a variable is context-bound
        return this.contextBoundVars.has(name);
    }
    isArrayPatternElement(name: string): boolean {
        return this.arrayPatternElements.has(name);
    }

    isRootParam(name: string): boolean {
        // Check if a variable is a root function parameter
        return this.rootParams.has(name);
    }

    addLoopVariable(originalName: string, transformedName: string): void {
        this.loopVars.add(originalName);
        this.loopVarNames.set(originalName, transformedName);
    }

    removeLoopVariable(originalName: string): void {
        this.loopVars.delete(originalName);
        this.loopVarNames.delete(originalName);
    }

    getLoopVariableName(name: string): string | undefined {
        return this.loopVarNames.get(name);
    }

    isLoopVariable(name: string): boolean {
        return this.loopVars.has(name);
    }

    addReservedName(name: string): void {
        this.reservedNames.add(name);
    }

    addUserFunction(name: string): void {
        this.userFunctions.add(name);
    }

    isUserFunction(name: string): boolean {
        return this.userFunctions.has(name);
    }

    addUserMethod(name: string): void {
        this.userMethods.add(name);
    }

    isUserMethod(name: string): boolean {
        return this.userMethods.has(name);
    }

    addRegularUserFunction(name: string): void {
        this.regularUserFunctions.add(name);
    }

    isRegularUserFunction(name: string): boolean {
        return this.regularUserFunctions.has(name);
    }

    addVariable(name: string, kind: string): string {
        // Regular variable handling
        if (this.isContextBound(name)) {
            return name;
        }
        const currentScope = this.scopes[this.scopes.length - 1];
        const scopeType = this.scopeTypes[this.scopeTypes.length - 1];
        const scopeCount = this.scopeCounts.get(scopeType) || 1;

        const newName = `${scopeType}${scopeCount}_${name}`;
        currentScope.set(name, newName);
        this.varKinds.set(newName, kind);
        return newName;
    }

    getVariable(name: string): [string, string] {
        // If it's a loop variable, return it as is
        if (this.loopVars.has(name)) {
            const transformedName = this.loopVarNames.get(name);
            if (transformedName) {
                return [transformedName, 'let'];
            }
        }

        // Regular variable handling
        if (this.isContextBound(name)) {
            return [name, 'let'];
        }
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const scope = this.scopes[i];
            if (scope.has(name)) {
                const scopedName = scope.get(name)!;
                const kind = this.varKinds.get(scopedName) || 'let';
                return [scopedName, kind];
            }
        }
        return [name, 'let'];
    }

    /**
     * Check if a variable (by original name) lives inside a function scope.
     * Walks the scope stack to find which scope owns the variable, then checks
     * whether any scope from the root up to (and including) that level is a
     * function scope ('fn').  This allows nested scopes (if, else, for, while)
     * inside functions to be correctly treated as function-local.
     */
    isVariableInFunctionScope(name: string): boolean {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].has(name)) {
                // Variable found at scope level i.
                // Check if any scope from root to i is a function scope.
                for (let j = 0; j <= i; j++) {
                    if (this.scopeTypes[j] === 'fn') {
                        return true;
                    }
                }
                return false;
            }
        }
        return false;
    }

    public generateTempVar(): string {
        return `temp_${++this.tempVarCounter}`;
    }

    // Hoisting Logic
    enterHoistingScope(): void {
        this.hoistingStack.push([]);
    }

    exitHoistingScope(): any[] {
        return this.hoistingStack.pop() || [];
    }

    addHoistedStatement(stmt: any): void {
        if (this.hoistingStack.length > 0 && !this.suppressHoisting) {
            this.hoistingStack[this.hoistingStack.length - 1].push(stmt);
        }
    }

    /**
     * Hoist a statement to the script body scope (inside the async IIFE).
     * Used for TA built-in variable auto-calls (e.g. ta.obv) that must run
     * every bar, even when referenced inside conditional blocks.
     *
     * hoistingStack layout for PineTS:
     *   [0] = Program level (outside IIFE — variables not in scope)
     *   [1] = IIFE body level (script's top-level — correct target)
     *   [2+] = inner scopes (if-blocks, loops, etc.)
     */
    addOuterHoistedStatement(stmt: any): void {
        // Deliberately ignores `suppressHoisting`: that flag keeps calls inline
        // in positions where they must be evaluated conditionally (while-loop
        // tests, lazy `?:` / `and` / `or` operands). Built-in TA *variables*
        // (ta.tr, ta.obv, ...) are the opposite case — they must run on every
        // bar regardless of where they are referenced — so they always go to
        // the script body scope. Dropping the statement here would leave the
        // generated code referencing an undeclared `temp_N`.
        if (this.hoistingStack.length > 0) {
            const targetIndex = Math.min(1, this.hoistingStack.length - 1);
            this.hoistingStack[targetIndex].push(stmt);
        }
    }

    getCurrentHoistingScope(): any[] | null {
        if (this.hoistingStack.length === 0) return null;
        return this.hoistingStack[this.hoistingStack.length - 1];
    }

    setSuppressHoisting(suppress: boolean): void {
        this.suppressHoisting = suppress;
    }

    shouldSuppressHoisting(): boolean {
        return this.suppressHoisting;
    }

    // Helper method to check if a variable exists in any scope
    hasVariableInScope(name: string): boolean {
        // Check reserved names (all user variables encountered in analysis pass)
        if (this.reservedNames.has(name)) {
            return true;
        }
        // Check regular scopes
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].has(name)) {
                return true;
            }
        }
        // Check context bound vars
        if (this.contextBoundVars.has(name)) {
            return true;
        }
        // Check loop vars
        if (this.loopVars.has(name)) {
            return true;
        }
        // Check local series vars
        if (this.localSeriesVars.has(name)) {
            return true;
        }
        return false;
    }

    // Param ID Generator Helper (for hoisting)
    public generateParamId(): string {
        let candidate = `p${this.paramIdCounter++}`;
        // Loop until we find a name that is NOT in the current scope
        while (this.hasVariableInScope(candidate)) {
            candidate = `p${this.paramIdCounter++}`;
        }
        // Reserve this name in the current scope to prevent future collisions
        // We use a dummy scope entry to mark it as taken
        const currentScope = this.scopes[this.scopes.length - 1];
        if (currentScope) {
            currentScope.set(candidate, candidate);
        }
        return candidate;
    }
}

export default ScopeManager;
