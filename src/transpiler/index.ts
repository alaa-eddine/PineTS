// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * PineTS Transpiler
 *
 * What is PineTS ?
 * -----------------
 * PineTS is an open-source intermediate language designed to bridge the gap between Pine Script and JavaScript.
 * It provides a way to simulate Pine Script-like behavior in a JavaScript environment by representing Pine Script code
 * in a JavaScript-compatible format.
 *
 * Important Notes:
 * -----------------
 * 1. **Independence from Pine Script**: PineTS is not officially affiliated with, endorsed by, or associated with TradingView or Pine Script.
 *    It is an independent open-source initiative created to enable developers to replicate Pine Script indicators in JavaScript environments.
 * 2. **Purpose**: PineTS uses JavaScript syntax and semantics but should not be confused with standard JavaScript code.
 *    It acts as a representation of Pine Script logic that requires transpilation to be executed in JavaScript.
 * 3. **Open Source**: This project is developed and maintained as an open-source initiative. It is intended to serve as a tool for
 *    developers to bridge Pine Script concepts into JavaScript applications.
 *
 * What Does PineTS Transpiler Do?
 * --------------------------------
 * PineTS cannot be executed directly in a JavaScript environment. It requires transpilation into standard JavaScript to handle
 * Pine Script's unique time-series data processing. The PineTS Transpiler facilitates this process by transforming PineTS code
 * into executable JavaScript at runtime, making it possible to execute Pine Script-inspired logic in JavaScript applications.
 *
 * Key Features of the Transpiler:
 * --------------------------------
 * 1. **Context Management**: Transforms code to use a context object (`$`) for variable storage, ensuring all variables are
 *    accessed through this context to prevent scope conflicts.
 * 2. **Variable Scoping**: Renames variables based on their scope and declaration type (`const`, `let`, `var`) to avoid naming issues.
 * 3. **Function Handling**: Converts arrow functions while maintaining parameters and logic. Parameters are registered in the context
 *    to prevent accidental renaming.
 * 4. **Loop and Conditional Handling**: Adjusts loops and conditionals to ensure proper scoping and handling of variables.
 *
 * Usage:
 * -------
 * - The `transpile` function takes a JavaScript function or code string, applies transformations, and returns the transformed
 *   code or function.
 * - The transformed code uses a context object (`$`) to manage variable storage and access.
 *
 * Disclaimer:
 * -----------
 * PineTS is independently developed and is not endorsed by or affiliated with TradingView, the creators of Pine Script. All
 * trademarks and registered trademarks mentioned belong to their respective owners.
 */

import * as acorn from 'acorn';
import * as astring from 'astring';
import ScopeManager from './analysis/ScopeManager';
import { injectImplicitImports } from './transformers/InjectionTransformer';
import { normalizeNativeImports } from './transformers/NormalizationTransformer';
import { wrapInContextFunction } from './transformers/WrapperTransformer';
import { transformNestedArrowFunctions, preProcessContextBoundVars, preProcessUdtRegistry, runAnalysisPass } from './analysis/AnalysisPass';
import { runTypeInferencePass } from './analysis/TypeInferencePass';
import { markLazyOperands } from './analysis/LazyOperandPass';
import { runTransformationPass, transformEqualityChecks, propagateAsyncAwait } from './transformers/MainTransformer';
import { extractPineScriptVersion, pineToJS } from './pineToJS/pineToJS.index';
import { buildLtfSlices } from './slicing/buildLtfSlices';

/**
 * Resolve the input into PineTS code plus the Pine Script version it came from.
 * `version` is null for PineTS-syntax / function input (no //@version marker):
 * such code is JavaScript-like and follows JS semantics, not a Pine version.
 */
function getPineTSFromSource(source: string | Function): { code: string; version: number | null } {
    if (typeof source === 'function') {
        return { code: source.toString(), version: null };
    } else {
        const pineScriptVersion = extractPineScriptVersion(source);
        if (pineScriptVersion === null) {
            //assume it's PineTS syntax ==> use it as is
            return { code: source, version: null };
        }
        if (pineScriptVersion >= 5) {
            //assume it's Pine Script syntax ==> use pineToJS to transpile it
            const pineToJSResult = pineToJS(source);
            if (pineToJSResult.success) {
                return { code: pineToJSResult.code, version: pineScriptVersion };
            } else {
                throw new Error(`Failed to transpile Pine Script version ${pineScriptVersion}: ${pineToJSResult.error}`);
            }
        } else {
            throw new Error(`Unsupported Pine Script version ${pineScriptVersion}. Only version 5 and above are supported.`);
        }
    }
}

export function transpile(source: string | Function, options: { debug: boolean; ln?: boolean } = { debug: false, ln: false }): Function {
    // Handle backward compatibility if a boolean is passed (though signature changed)
    if (typeof options === 'boolean') {
        options = { debug: options, ln: true };
    }

    const { debug } = options;

    const { code: sourceCode, version: pineVersion } = getPineTSFromSource(source);
    let code = sourceCode;

    // Pre-process: Wrap in context function if not already wrapped
    code = wrapInContextFunction(code);

    const sourceLines = debug ? code.split('\n') : [];

    // Parse the code into an AST
    const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: debug,
    });

    // Pre-process: Transform all nested arrow functions
    transformNestedArrowFunctions(ast);

    // Pre-process: Normalize native imports (prevent renaming of standard symbols)
    normalizeNativeImports(ast);

    // Pre-process: Inject implicit imports for missing context variables
    injectImplicitImports(ast);

    const scopeManager = new ScopeManager();

    // Pre-process: Identify context-bound variables
    preProcessContextBoundVars(ast, scopeManager);

    // Pre-process: Build the UDT registry (type names + their field maps,
    // and user variables that hold UDT instances). Enables type-aware
    // rewrites at use sites — e.g. distinguishing Pine series-lookback
    // (`bar.field[N]` on a UDT instance) from JS array indexing.
    preProcessUdtRegistry(ast, scopeManager);

    // First pass: register all function declarations and their parameters
    // Returns the original parameter name of the root function if any
    const originalParamName = runAnalysisPass(ast, scopeManager) || '';

    // Type inference: replicate Pine v5 `const int / const int → int` truncation.
    // Runs on the clean pre-lowering AST (operands still bare identifiers /
    // literals) and rewrites provably-const-int `/` to `$.pine.math.__idiv(...)`;
    // the main pass below then lowers the operand subtrees inside the call args.
    //
    // Version-gated: only Pine v5 truncates, and only when BOTH operands are
    // 'const'-qualified ints. Pine v6+ always performs fractional division
    // (see TradingView's v6 migration guide, "Fractional division of constants"),
    // and PineTS-syntax / function input (pineVersion === null) is JavaScript,
    // where `/` is always float division.
    if (pineVersion !== null && pineVersion < 6) {
        runTypeInferencePass(ast, scopeManager);
    }

    // Lazy operands: tag nodes inside `?:` branches (every version) and the
    // right operand of `and`/`or` (Pine v6+, and JS `&&`/`||` for PineTS
    // syntax) so the call transformer keeps their namespace calls inline
    // instead of hoisting them into unconditional temps. Pine v5 evaluates
    // `and`/`or` strictly (see TradingView's v6 migration guide, "Lazy
    // evaluation of conditions"), so v5 keeps the eager right operand.
    markLazyOperands(ast, { lazyLogical: pineVersion === null || pineVersion >= 6 });

    // Second pass: transform the code
    runTransformationPass(ast, scopeManager, originalParamName, options, sourceLines);

    // Post-process: transform equality checks to math.__eq calls
    transformEqualityChecks(ast);

    // Post-process: propagate async/await through user-defined function call chains
    // Functions containing await (e.g., from request.security) must be async,
    // and their callers (via $.call) must await them.
    propagateAsyncAwait(ast);

    // Post-process: inject __maxLoops local variable at the top of the function body.
    // This caches $.__maxLoops (from Context) in a local variable so loop guards
    // don't access the context object on every iteration. Falls back to 500000.
    if (ast.type === 'Program' && ast.body.length > 0) {
        const firstStmt = ast.body[0] as any;
        const fn = firstStmt?.expression || firstStmt;
        if (fn.body?.type === 'BlockStatement') {
            fn.body.body.unshift({
                type: 'VariableDeclaration',
                kind: 'const',
                declarations: [{
                    type: 'VariableDeclarator',
                    id: { type: 'Identifier', name: '__maxLoops' },
                    init: {
                        type: 'LogicalExpression',
                        operator: '||',
                        left: {
                            type: 'MemberExpression',
                            object: { type: 'Identifier', name: '$' },
                            property: { type: 'Identifier', name: '__maxLoops' },
                            computed: false,
                        },
                        right: { type: 'Literal', value: 500000 },
                    },
                }],
            });
        }
    }

    // Generate final code
    // astring exports baseGenerator (camelCase) in this version/build
    const baseGenerator = astring.baseGenerator || astring.GENERATOR || ((astring as any).default && (astring as any).default.BASE_GENERATOR);

    const customGenerator = Object.assign({}, baseGenerator, {
        LineComment(node: any, state: any) {
            state.write('//' + node.value);
        },
    });

    const transformedCode = astring.generate(ast, {
        generator: customGenerator,
        comments: debug,
    });

    // Slice every `request.security_lower_tf` call site. Each slice is a
    // pre-built async Function whose body is the user-script prefix up
    // through and including the call. Stashed on the returned function
    // (PineTS picks them up at run time and propagates onto the
    // Context). Slicing is read-only over the AST and is safe to do
    // alongside / after the main code-generation pass.
    //
    // Disabled via the PINETS_DISABLE_LTF_SLICING env var (used in
    // tooling that needs to exercise the legacy full-script slow path,
    // e.g. correctness comparisons).
    const slicingDisabled = (typeof process !== 'undefined') && process?.env?.PINETS_DISABLE_LTF_SLICING === '1';
    const slices = slicingDisabled ? {} : buildLtfSlices(ast);

    const _wraperFunction = new Function('', `var _r = ${transformedCode}\n; return _r;`);
    const mainFn = _wraperFunction(this);
    if (slices && Object.keys(slices).length > 0) {
        (mainFn as any)._ltfSlices = slices;
    }
    return mainFn;
}
