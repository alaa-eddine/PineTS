// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import * as walk from 'acorn-walk';
import ScopeManager from './ScopeManager';
import { CONTEXT_NAME } from '../utils/ASTFactory';

export function transformNestedArrowFunctions(ast: any): void {
    walk.recursive(ast, null, {
        VariableDeclaration(node: any, state: any, c: any) {
            // Only process if we have declarations
            if (node.declarations && node.declarations.length > 0) {
                const declarations = node.declarations;

                // Check each declaration
                declarations.forEach((decl: any) => {
                    // Check if it's an arrow function
                    if (decl.init && decl.init.type === 'ArrowFunctionExpression') {
                        const isRootFunction = decl.init.start === 0;

                        if (!isRootFunction) {
                            // Create a function declaration
                            const functionDeclaration = {
                                type: 'FunctionDeclaration',
                                id: decl.id, // Use the variable name as function name
                                params: decl.init.params,
                                body:
                                    decl.init.body.type === 'BlockStatement'
                                        ? decl.init.body
                                        : {
                                              type: 'BlockStatement',
                                              body: [
                                                  {
                                                      type: 'ReturnStatement',
                                                      argument: decl.init.body,
                                                  },
                                              ],
                                          },
                                async: decl.init.async,
                                generator: false,
                            };

                            // Replace the entire VariableDeclaration with the FunctionDeclaration
                            Object.assign(node, functionDeclaration);
                        }
                    }
                });
            }

            // Continue traversing
            if (node.body && node.body.body) {
                node.body.body.forEach((stmt: any) => c(stmt, state));
            }
        },
    });
}

/**
 * Pre-walk the AST to populate the UDT registry on the ScopeManager.
 *
 * Two registries are populated:
 *   1. UDT type names — collected from `const X = Type({field: ['type', default], ...})`
 *      which pine2js emits from Pine `type X` declarations. The field-type metadata
 *      is stored alongside (V2 data model) for future use-site type-aware rewrites.
 *
 *   2. UDT instance variables — variables initialized via `<X>.new(...)` or
 *      `<X>.copy(...)` where X ∈ udtTypeNames. Each instance is tagged with its
 *      UDT type name (V2 shape).
 *
 * The instance check intentionally consults `isUdtTypeName(X)` rather than just
 * "X is an Identifier", so built-in factory calls like `array.from(...)`,
 * `polyline.new(...)`, `chart.point.from_index(...)` are excluded — those are
 * handled by their own runtime layers and must NOT be treated as UDT instances.
 */
export function preProcessUdtRegistry(ast: any, scopeManager: ScopeManager): void {
    // Pass 1: collect UDT type names (and their field metadata) from `Type({...})` calls.
    walk.simple(ast, {
        VariableDeclaration(node: any) {
            for (const decl of node.declarations) {
                if (decl.id?.type !== 'Identifier' || !decl.init) continue;
                if (
                    decl.init.type === 'CallExpression' &&
                    decl.init.callee?.type === 'Identifier' &&
                    decl.init.callee.name === 'Type' &&
                    decl.init.arguments?.length === 1 &&
                    decl.init.arguments[0]?.type === 'ObjectExpression'
                ) {
                    const fields: Record<string, string> = {};
                    for (const prop of decl.init.arguments[0].properties) {
                        if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') continue;
                        // Each value is `['type', default]` (ArrayExpression) or `'type'` (Literal).
                        if (prop.value?.type === 'ArrayExpression' && prop.value.elements?.[0]?.type === 'Literal') {
                            fields[prop.key.name] = String(prop.value.elements[0].value);
                        } else if (prop.value?.type === 'Literal') {
                            fields[prop.key.name] = String(prop.value.value);
                        }
                    }
                    scopeManager.addUdtTypeName(decl.id.name, fields);
                }
            }
        },
    });

    // Pass 1.5: infer user-function return types iteratively.
    //
    // A function is recorded as returning a UDT when ALL of its return-path
    // expressions resolve (via `inferUdtTypeFromInit`) to the SAME UDT type.
    // It is recorded as returning a tuple when ALL return paths are
    // ArrayExpressions of the same length and each slot resolves to the
    // same UDT type (or undefined for non-UDT slots).
    //
    // Iteration handles call chains where one helper calls another:
    //   makeBarHelper() => BAR.new()
    //   makeBar()       => makeBarHelper()
    // The first iteration registers `makeBarHelper`; the second uses that
    // result to register `makeBar`. Loop until no new entries are added.
    let changed = true;
    while (changed) {
        changed = false;
        walk.simple(ast, {
            FunctionDeclaration(node: any) {
                if (!node.id?.name) return;
                const fnName = node.id.name;
                const alreadyKnown =
                    scopeManager.getFunctionReturnType(fnName) ||
                    scopeManager.getFunctionReturnTupleType(fnName);
                if (alreadyKnown) return;
                const returns = collectReturnArguments(node.body);
                if (returns.length === 0) return;

                // Tuple return: every return path is an ArrayExpression of the
                // same length, and each slot independently produces the same
                // UDT (or consistently non-UDT → undefined).
                if (returns.every((r: any) => r.type === 'ArrayExpression')) {
                    const len = returns[0].elements.length;
                    if (len > 0 && returns.every((r: any) => r.elements.length === len)) {
                        const slotTypes: (string | undefined)[] = [];
                        let ok = true;
                        for (let i = 0; i < len; i++) {
                            const slotPerReturn = returns.map((r: any) =>
                                inferUdtTypeFromInit(r.elements[i], scopeManager),
                            );
                            const first = slotPerReturn[0];
                            if (!slotPerReturn.every((t) => t === first)) {
                                ok = false;
                                break;
                            }
                            slotTypes.push(first);
                        }
                        // Only register if at least one slot is a UDT — otherwise
                        // there's nothing to gain.
                        if (ok && slotTypes.some((t) => !!t)) {
                            scopeManager.setFunctionReturnTupleType(fnName, slotTypes);
                            changed = true;
                            return;
                        }
                    }
                }

                // Scalar UDT return.
                const types = returns.map((arg: any) => inferUdtTypeFromInit(arg, scopeManager));
                const first = types[0];
                if (!first || !types.every((t) => t === first)) return;
                scopeManager.setFunctionReturnType(fnName, first);
                changed = true;
            },
        });
    }

    // Pass 2: collect variables initialized to a UDT instance.
    walk.simple(ast, {
        VariableDeclaration(node: any) {
            for (const decl of node.declarations) {
                if (!decl.init) continue;

                // Scalar binding: `let bar = <init>`.
                if (decl.id?.type === 'Identifier') {
                    const typeName = inferUdtTypeFromInit(decl.init, scopeManager);
                    if (typeName) {
                        scopeManager.markVariableAsUdtInstance(decl.id.name, typeName);
                        continue;
                    }
                    // Not a UDT — try built-in constructor inference
                    // (`table.new(...)`, `array.from(...)`, ...) so dot-calls
                    // of user methods on built-in receivers can be dispatched
                    // by static type matching.
                    const builtinType = inferBuiltinTypeFromInit(decl.init);
                    if (builtinType) {
                        scopeManager.setVarStaticType(decl.id.name, builtinType);
                    }
                    continue;
                }

                // Tuple destructuring: `let [a, b] = <userFunc>(...)` where the
                // user function has an inferred tuple return shape. Per-slot
                // UDT types from the tuple registry register each ArrayPattern
                // element independently — slots without a UDT are skipped.
                if (decl.id?.type === 'ArrayPattern' &&
                    decl.init.type === 'CallExpression' &&
                    decl.init.callee?.type === 'Identifier') {
                    const tupleTypes = scopeManager.getFunctionReturnTupleType(decl.init.callee.name);
                    if (!tupleTypes) continue;
                    decl.id.elements?.forEach((el: any, i: number) => {
                        if (!el || el.type !== 'Identifier') return;
                        const slotType = tupleTypes[i];
                        if (slotType) {
                            scopeManager.markVariableAsUdtInstance(el.name, slotType);
                        }
                    });
                }
            }
        },
        // Pass 2b: pick up explicit Pine type annotations preserved by codegen
        // as bare string-literal markers (`"__pineUdtVar:<varName>=<TypeName>"`).
        // This covers cases the expression-based inference can't reach — e.g.
        // `Holder r = arr.get(0)`, `Holder r = map.get(key)`, etc. — where the
        // Pine type is stated explicitly but the initializer is not directly
        // recognisable as UDT-producing.
        ExpressionStatement(node: any) {
            const expr = node.expression;
            if (
                expr?.type === 'Literal' &&
                typeof expr.value === 'string' &&
                expr.value.startsWith('__pineUdtVar:')
            ) {
                const m = expr.value.match(/^__pineUdtVar:([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)$/);
                if (m) {
                    const [, varName, typeName] = m;
                    if (scopeManager.isUdtTypeName(typeName)) {
                        scopeManager.markVariableAsUdtInstance(varName, typeName);
                    }
                }
            }
            // Explicit built-in / generic type annotations (`var table tb = ...`,
            // `array<float> eq = ...`) preserved by codegen as
            // `"__pineTypedVar:<varName>=<type>"` markers.
            else if (
                expr?.type === 'Literal' &&
                typeof expr.value === 'string' &&
                expr.value.startsWith('__pineTypedVar:')
            ) {
                const rest = expr.value.slice('__pineTypedVar:'.length);
                const eq = rest.indexOf('=');
                if (eq > 0) {
                    const varName = rest.slice(0, eq);
                    const typeName = rest.slice(eq + 1);
                    if (/^[A-Za-z_$][\w$]*$/.test(varName) && typeName) {
                        scopeManager.setVarStaticType(varName, typeName);
                    }
                }
            }
        },
    });

    // Pass 3: collect UDT-typed function parameters from the
    // `funcName.__pineParamTypes__ = {paramName: 'TypeName', ...}` markers
    // emitted by pine2js codegen. Only types that are themselves in the UDT
    // type registry are kept — primitives / qualifiers like `int`, `series
    // float` etc. are silently dropped. The registration tells
    // `transformFunctionDeclaration` which params to flag as UDT instances
    // (scope-locally) when entering the function body.
    walk.simple(ast, {
        ExpressionStatement(node: any) {
            const expr = node.expression;
            if (!expr || expr.type !== 'AssignmentExpression' || expr.operator !== '=') return;
            const left = expr.left;
            if (left?.type !== 'MemberExpression' ||
                left.computed ||
                left.property?.type !== 'Identifier' ||
                left.object?.type !== 'Identifier') return;
            const rawName = left.object.name;
            // Methods carry a `$M_` JS-name prefix; strip it so the registry
            // is keyed by the Pine name `transformFunctionDeclaration` will
            // look up at call time.
            const funcName = rawName.startsWith('$M_') ? rawName.slice(3) : rawName;

            // `$M_<name>.__pineReceiverType__ = '<type>'` — declared receiver
            // type of a user `method`, used for dot-call dispatch on built-in
            // receivers.
            if (left.property.name === '__pineReceiverType__') {
                if (expr.right?.type === 'Literal' && typeof expr.right.value === 'string') {
                    scopeManager.setMethodReceiverType(funcName, expr.right.value);
                }
                return;
            }

            if (left.property.name !== '__pineParamTypes__') return;
            if (expr.right?.type !== 'ObjectExpression') return;
            const paramTypes: Record<string, string> = {};
            const rawParamTypes: Record<string, string> = {};
            for (const prop of expr.right.properties) {
                if (prop.type !== 'Property') continue;
                // Codegen emits JSON-quoted keys (`"b"`) which acorn parses as
                // `Literal`; tolerate `Identifier` too in case the marker shape
                // ever changes.
                let paramName: string | undefined;
                if (prop.key?.type === 'Identifier') paramName = prop.key.name;
                else if (prop.key?.type === 'Literal' && typeof prop.key.value === 'string') paramName = prop.key.value;
                if (!paramName) continue;
                if (prop.value?.type !== 'Literal' || typeof prop.value.value !== 'string') continue;
                rawParamTypes[paramName] = prop.value.value;
                // varType may include qualifiers like 'series BAR' — the type
                // name is the last whitespace-delimited token.
                const typeName = prop.value.value.split(/\s+/).pop()!;
                if (scopeManager.isUdtTypeName(typeName)) {
                    paramTypes[paramName] = typeName;
                }
            }
            if (Object.keys(paramTypes).length > 0) {
                scopeManager.setFunctionParamUdtTypes(funcName, paramTypes);
            }
            // Unfiltered registry: built-in-typed params (e.g. `f(table t)`)
            // get scope-locally registered in the static-type registry when
            // entering the function body (see transformFunctionDeclaration).
            if (Object.keys(rawParamTypes).length > 0) {
                scopeManager.setFunctionParamStaticTypes(funcName, rawParamTypes);
            }
        },
    });
}

/**
 * Namespaces whose factory calls produce built-in instances that user
 * `method`s can be declared on. `chart.point` is intentionally absent (its
 * factories are nested member chains, handled conservatively as unknown).
 */
const BUILTIN_INSTANCE_NAMESPACES = new Set(['table', 'line', 'label', 'box', 'linefill', 'polyline', 'array', 'matrix', 'map']);

/**
 * Built-in calls that RETURN an instance of another built-in type without being
 * its constructor — the only way to obtain `footprint` / `volume_row` ids. Keyed
 * by `namespace.method`, valued by the produced BASE type name.
 */
const BUILTIN_PRODUCER_TYPES: Record<string, string> = {
    'request.footprint': 'footprint',
    'footprint.poc': 'volume_row',
    'footprint.vah': 'volume_row',
    'footprint.val': 'volume_row',
    'footprint.get_row_by_price': 'volume_row',
};

/**
 * Inspect an initializer expression and return the built-in BASE type name
 * ('table', 'array', ...) when it unambiguously constructs a built-in
 * instance — otherwise undefined. Mirrors `inferUdtTypeFromInit` for
 * built-in receivers.
 *
 * Recognized shapes: `<ns>.new(...)`, `<ns>.copy(...)`, `<ns>.from(...)`,
 * `<ns>.new_<type>(...)` (array typed constructors), the producer calls in
 * `BUILTIN_PRODUCER_TYPES`, plus ternaries where both branches resolve to the
 * same type.
 */
function inferBuiltinTypeFromInit(init: any): string | undefined {
    if (!init) return undefined;

    if (
        init.type === 'CallExpression' &&
        init.callee?.type === 'MemberExpression' &&
        !init.callee.computed &&
        init.callee.object?.type === 'Identifier' &&
        init.callee.property?.type === 'Identifier'
    ) {
        const namespace = init.callee.object.name;
        const method = init.callee.property.name;
        if (BUILTIN_INSTANCE_NAMESPACES.has(namespace) && (method === 'new' || method === 'copy' || method === 'from' || method.startsWith('new_'))) {
            return namespace;
        }
        const produced = BUILTIN_PRODUCER_TYPES[`${namespace}.${method}`];
        if (produced) return produced;
    }

    if (init.type === 'ConditionalExpression') {
        const consequentType = inferBuiltinTypeFromInit(init.consequent);
        const alternateType = inferBuiltinTypeFromInit(init.alternate);
        if (consequentType && consequentType === alternateType) {
            return consequentType;
        }
    }

    return undefined;
}

/**
 * Collect every ReturnStatement.argument inside a function body, but do NOT
 * descend into nested function declarations (those have their own returns).
 */
function collectReturnArguments(body: any): any[] {
    const out: any[] = [];
    if (!body) return out;
    function visit(node: any) {
        if (!node || typeof node !== 'object') return;
        // Don't descend into nested function bodies.
        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            return;
        }
        if (node.type === 'ReturnStatement' && node.argument) {
            out.push(node.argument);
            return;
        }
        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const val = (node as any)[key];
            if (Array.isArray(val)) val.forEach(visit);
            else if (val && typeof val === 'object' && val.type) visit(val);
        }
    }
    visit(body);
    return out;
}

/**
 * Inspect an initializer expression and return the UDT type name if it
 * unambiguously resolves to a UDT instance — otherwise undefined.
 *
 * Recognized shapes:
 *   - `<UDT>.new(...)`           — direct constructor call
 *   - `<UDT>.copy(...)`          — direct copy call
 *   - `cond ? <UDT-init> : <UDT-init>`  — ternary where BOTH branches
 *                                          resolve to the SAME UDT type
 *
 * The ternary case recurses, so nested conditionals like
 * `c1 ? BAR.new() : (c2 ? BAR.copy(s) : BAR.new())` are also recognized.
 *
 * Branches that don't unambiguously produce the same UDT (different types,
 * non-UDT calls, etc.) → undefined → variable not registered as UDT instance
 * (safer to skip than to misclassify).
 */
function inferUdtTypeFromInit(init: any, scopeManager: ScopeManager): string | undefined {
    if (!init) return undefined;

    // `<UDT>.new(...)` / `<UDT>.copy(...)`
    if (
        init.type === 'CallExpression' &&
        init.callee?.type === 'MemberExpression' &&
        !init.callee.computed &&
        init.callee.object?.type === 'Identifier' &&
        init.callee.property?.type === 'Identifier' &&
        (init.callee.property.name === 'new' || init.callee.property.name === 'copy') &&
        scopeManager.isUdtTypeName(init.callee.object.name)
    ) {
        return init.callee.object.name;
    }

    // `<userFunc>(...)` — when the function's return type has been inferred
    // as a UDT (see Pass 1.5 in preProcessUdtRegistry).
    if (
        init.type === 'CallExpression' &&
        init.callee?.type === 'Identifier'
    ) {
        const fnRetType = scopeManager.getFunctionReturnType(init.callee.name);
        if (fnRetType) return fnRetType;
    }

    // Conditional / ternary: both branches must resolve to the same UDT type.
    if (init.type === 'ConditionalExpression') {
        const consequentType = inferUdtTypeFromInit(init.consequent, scopeManager);
        const alternateType = inferUdtTypeFromInit(init.alternate, scopeManager);
        if (consequentType && consequentType === alternateType) {
            return consequentType;
        }
    }

    return undefined;
}

export function preProcessContextBoundVars(ast: any, scopeManager: ScopeManager): void {
    walk.simple(ast, {
        VariableDeclaration(node: any) {
            node.declarations.forEach((decl: any) => {
                // Check for context property assignments
                const isContextProperty =
                    decl.init &&
                    decl.init.type === 'MemberExpression' &&
                    decl.init.object &&
                    (decl.init.object.name === 'context' || decl.init.object.name === CONTEXT_NAME || decl.init.object.name === 'context2');

                const isSubContextProperty =
                    decl.init &&
                    decl.init.type === 'MemberExpression' &&
                    decl.init.object?.object &&
                    (decl.init.object.object.name === 'context' ||
                        decl.init.object.object.name === CONTEXT_NAME ||
                        decl.init.object.object.name === 'context2');

                if (isContextProperty || isSubContextProperty) {
                    if (decl.id.name) {
                        scopeManager.addContextBoundVar(decl.id.name);
                    }
                    if (decl.id.properties) {
                        decl.id.properties.forEach((property: any) => {
                            if (property.key.name) {
                                scopeManager.addContextBoundVar(property.key.name);
                            }
                        });
                    }
                }
            });
        },
    });
}

export function transformArrowFunctionParams(node: any, scopeManager: ScopeManager, isRootFunction: boolean = false): void {
    // Register arrow function parameters as context-bound ONLY if it's the root function
    // Non-root function parameters should NOT be globally context-bound
    node.params.forEach((param: any) => {
        if (param.type === 'Identifier') {
            if (isRootFunction) {
                scopeManager.addContextBoundVar(param.name, isRootFunction);
            }
            // For non-root functions, parameters are handled within their function scope
        }
    });
}

// Local helper to register function parameters without transforming body
function registerFunctionParameters(node: any, scopeManager: ScopeManager): void {
    // NOTE: Function parameters should NOT be registered as globally context-bound
    // as this prevents global variables with the same names from being scoped.
    // Parameters are handled correctly within their function scope during transformation.
    // This function is kept for backwards compatibility but does nothing now.
}

export function runAnalysisPass(ast: any, scopeManager: ScopeManager): string | undefined {
    let originalParamName: string | undefined;

    walk.ancestor(ast, {
        FunctionDeclaration(node: any) {
            registerFunctionParameters(node, scopeManager);
            if (node.id && node.id.name) {
                scopeManager.addReservedName(node.id.name);
                scopeManager.addUserFunction(node.id.name);
                // Track regular (non-method) user functions separately so
                // UFCS-style direct calls to method-only Pine declarations
                // (`foo(receiver, args)` where `foo` was declared as
                // `method foo(...)`) can be retargeted to the `$M_` JS name.
                // Methods are emitted with a `$M_` JS prefix; absence of
                // that prefix means it's a regular function.
                if (!node.id.name.startsWith('$M_')) {
                    scopeManager.addRegularUserFunction(node.id.name);
                }
            }
        },
        // Detect Pine `method` markers emitted by codegen: name.__pineMethod__ = true;
        // These mark user functions declared with the `method` keyword, which ARE
        // allowed to be called with obj.method() dot-notation.  Regular functions
        // (without `method`) must NOT be callable via dot-notation.
        //
        // Methods are emitted with a `$M_` prefix on their JS identifier so they
        // never collide with a regular function of the same Pine name. The
        // marker is on the prefixed name; we strip it to register the Pine name
        // in `userMethods` and `userFunctions` so the call-site lookup
        // (`obj.methodName(...)`) resolves cleanly.
        ExpressionStatement(node: any) {
            const expr = node.expression;
            if (expr && expr.type === 'AssignmentExpression' && expr.operator === '=' &&
                expr.left?.type === 'MemberExpression' &&
                expr.left.property?.name === '__pineMethod__' &&
                expr.left.object?.type === 'Identifier' &&
                expr.right?.value === true) {
                const jsName = expr.left.object.name;
                const pineName = jsName.startsWith('$M_') ? jsName.slice(3) : jsName;
                scopeManager.addUserMethod(pineName);
                // Also expose the Pine name as a "user function" so the call-site
                // check `isUserFunction(methodName) && isUserMethod(methodName)`
                // passes for methods that exist only in `method` form (no
                // sibling regular function).
                scopeManager.addUserFunction(pineName);
            }
        },
        ArrowFunctionExpression(node: any) {
            const isRootFunction = node.start === 0;
            if (isRootFunction && node.params && node.params.length > 0) {
                originalParamName = node.params[0].name;
                node.params[0].name = CONTEXT_NAME;
            }
            transformArrowFunctionParams(node, scopeManager, isRootFunction);
        },
        VariableDeclaration(node: any, ancestors: any[]) {
            const parent = ancestors.length > 1 ? ancestors[ancestors.length - 2] : null;
            const isForLoop = parent && (parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') && parent.left === node;

            node.declarations.forEach((decl: any) => {
                if (decl.id.type === 'Identifier') {
                    scopeManager.addReservedName(decl.id.name);
                } else if (decl.id.type === 'ObjectPattern') {
                    decl.id.properties.forEach((prop: any) => {
                        if (prop.key && prop.key.type === 'Identifier') {
                            scopeManager.addReservedName(prop.key.name);
                        }
                    });
                } else if (decl.id.type === 'ArrayPattern') {
                    // Register array pattern elements as reserved
                    decl.id.elements?.forEach((element: any) => {
                        if (element && element.type === 'Identifier') {
                            scopeManager.addReservedName(element.name);
                        }
                    });

                    if (isForLoop) return;

                    // Generate a unique temporary variable name
                    const tempVarName = scopeManager.generateTempVar();

                    // Create a new variable declaration for the temporary variable
                    const tempVarDecl = {
                        type: 'VariableDeclaration',
                        kind: node.kind,
                        declarations: [
                            {
                                type: 'VariableDeclarator',
                                id: {
                                    type: 'Identifier',
                                    name: tempVarName,
                                },
                                init: decl.init,
                            },
                        ],
                    };

                    // If the init is an IIFE (switch/if-else expression), wrap its
                    // array returns in an extra level so $.init() preserves the tuple.
                    // Without this, $.init() treats flat arrays as time-series and
                    // takes only the last element, destroying the tuple values.
                    const initExpr = tempVarDecl.declarations[0].init;
                    if (initExpr && initExpr.type === 'CallExpression' &&
                        (initExpr.callee.type === 'ArrowFunctionExpression' ||
                         initExpr.callee.type === 'FunctionExpression')) {
                        walk.simple(initExpr.callee.body, {
                            ReturnStatement(ret: any) {
                                if (ret.argument && ret.argument.type === 'ArrayExpression') {
                                    ret.argument = {
                                        type: 'ArrayExpression',
                                        elements: [ret.argument],
                                    };
                                }
                            },
                        });
                    }

                    decl.id.elements?.forEach((element: any) => {
                        if (element.type === 'Identifier') {
                            scopeManager.addArrayPatternElement(element.name);
                        }
                    });
                    // Create individual variable declarations for each destructured element
                    const individualDecls = decl.id.elements.map((element: any, index: number) => ({
                        type: 'VariableDeclaration',
                        kind: node.kind,
                        declarations: [
                            {
                                type: 'VariableDeclarator',
                                id: element,
                                init: {
                                    type: 'MemberExpression',
                                    object: {
                                        type: 'Identifier',
                                        name: tempVarName,
                                    },
                                    property: {
                                        type: 'Literal',
                                        value: index,
                                    },
                                    computed: true,
                                },
                            },
                        ],
                    }));

                    // Replace the original declaration with the new declarations
                    Object.assign(node, {
                        type: 'BlockStatement',
                        body: [tempVarDecl, ...individualDecls],
                    });
                }
            });
        },
        ForStatement(node: any) {
            // Skip registering loop variables in the first pass
        },
    });

    return originalParamName;
}
