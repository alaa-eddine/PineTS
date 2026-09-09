// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import * as walk from 'acorn-walk';
import ScopeManager, { normalizePineBaseType } from '../analysis/ScopeManager';
import { ASTFactory, CONTEXT_NAME } from '../utils/ASTFactory';
import { KNOWN_NAMESPACES, NAMESPACES_LIKE, ASYNC_METHODS, CALLSITE_ID_NAMESPACES } from '../settings';

const UNDEFINED_ARG = {
    type: 'Identifier',
    name: 'undefined',
};

/**
 * Build the third argument to a `*.param(value, idx, name)` call. The
 * statically-allocated `pN` string is unique across the script, but
 * `Context.param` stores the resulting series in `context.params[name]` —
 * a globally-keyed map — so two distinct call paths through the same
 * function body would clobber each other (the function body bakes in
 * the same `pN`, but each call writes a different value). Mirroring the
 * existing ta-callsite-id convention (`$$.id + '_taN'`), we prefix the
 * static `pN` with the current call-path id when inside a fn scope so
 * each path writes to its own `params[path|pN]` slot. At top level
 * `$$` doesn't exist, so we fall back to the literal `pN`.
 */
function makeParamNameArg(scopeManager: ScopeManager, paramId: string): any {
    const literal = { type: 'Identifier', name: `'${paramId}'` };
    // Use any-fn-scope-on-stack rather than `getCurrentScopeType() === 'fn'`
    // — params can be emitted from inside if/for/while/switch nested inside
    // a function body, where the immediate scope is e.g. 'if' but `$$` is
    // still the function's local context.
    if (!scopeManager.isInsideFunctionScope()) return literal;
    const [localCtxName] = scopeManager.getVariable('$$');
    if (!localCtxName) return literal;
    return {
        type: 'BinaryExpression',
        operator: '+',
        left: ASTFactory.createMemberExpression(
            ASTFactory.createLocalContextIdentifier(),
            ASTFactory.createIdentifier('id'),
        ),
        right: literal,
    };
}

export function createScopedVariableReference(name: string, scopeManager: ScopeManager): any {
    const [scopedName, kind] = scopeManager.getVariable(name);

    // Check if function scoped (directly or in a nested scope within a function)
    // and not $$ itself.  Variables in nested scopes (if, else, for) inside
    // functions get names like `if4_nFibL` that don't start with `fn\d+_`,
    // so we also ask the ScopeManager whether the variable lives inside a
    // function scope.
    const isInFnScope = scopedName.match(/^fn\d+_/) || scopeManager.isVariableInFunctionScope(name);
    if (isInFnScope && name !== '$$') {
        const [localCtxName] = scopeManager.getVariable('$$');
        // Only if $$ is actually found (it should be in function scope)
        if (localCtxName) {
            return ASTFactory.createLocalContextVariableReference(kind, scopedName);
        }
    }
    return ASTFactory.createContextVariableReference(kind, scopedName);
}

export function createScopedVariableAccess(name: string, scopeManager: ScopeManager): any {
    const varRef = createScopedVariableReference(name, scopeManager);
    return ASTFactory.createGetCall(varRef, 0);
}

export function transformArrayIndex(node: any, scopeManager: ScopeManager): void {
    if (node.computed && node.property.type === 'Identifier') {
        // If index is a loop variable, we still need to transform the object to use $.get()
        if (scopeManager.isLoopVariable(node.property.name)) {
            // Transform the object if it's a context-bound variable
            if (node.object.type === 'Identifier' && !scopeManager.isLoopVariable(node.object.name)) {
                // Local series vars (e.g., function parameters) should be wrapped with $.get()
                // but stay as plain identifiers (not scoped to $.let.*)
                if (scopeManager.isLocalSeriesVar(node.object.name)) {
                    // Transform to $.get(paramName, index)
                    const plainIdentifier = ASTFactory.createIdentifier(node.object.name);
                    // Mark this identifier to skip further transformations
                    plainIdentifier._skipTransformation = true;
                    const getCall = ASTFactory.createGetCall(plainIdentifier, node.property);
                    Object.assign(node, getCall);
                    node._indexTransformed = true;
                    return;
                }

                if (!scopeManager.isContextBound(node.object.name)) {
                    // Transform to $.get($.kind.scopedName, loopVar)
                    const contextVarRef = createScopedVariableReference(node.object.name, scopeManager);
                    const getCall = ASTFactory.createGetCall(contextVarRef, node.property);
                    Object.assign(node, getCall);
                    node._indexTransformed = true;
                }
            }
            return;
        }

        // Only transform if it's not a context-bound variable
        if (!scopeManager.isContextBound(node.property.name)) {
            // Local series var (e.g. function parameter) used as an index:
            // keep as a bare identifier wrapped with $.get(param, 0). Mirrors
            // the same handling at the loop-variable case above and the
            // object-position case below. Without this branch, a function
            // param used as a history-lookback index (e.g. `high[size]` where
            // `size` is a fn param) is mis-scoped to `$.let.size_$0`, which
            // is undefined → resolves to 0 → `high[size]` returns the current
            // bar instead of the bar `size` ago, breaking pivot-detection
            // idioms like `high[size] > ta.highest(size)`.
            if (scopeManager.isLocalSeriesVar(node.property.name)) {
                const plainIdentifier = ASTFactory.createIdentifier(node.property.name);
                plainIdentifier._skipTransformation = true;
                node.property = ASTFactory.createGetCall(plainIdentifier, 0);
            } else {
                // Transform property to $.kind.scopedName
                node.property = createScopedVariableReference(node.property.name, scopeManager);

                // Add [0] to the index: $.get($.kind.scopedName, 0)
                node.property = ASTFactory.createGetCall(node.property, 0);
            }
        }
    }

    if (node.computed && node.object.type === 'Identifier') {
        if (scopeManager.isLoopVariable(node.object.name)) {
            return;
        }

        // Local series vars (e.g., function parameters) should be wrapped with $.get()
        // but stay as plain identifiers (not scoped to $.let.*)
        if (scopeManager.isLocalSeriesVar(node.object.name)) {
            // Transform to $.get(paramName, index)
            const plainIdentifier = ASTFactory.createIdentifier(node.object.name);
            // Mark this identifier to skip further transformations
            plainIdentifier._skipTransformation = true;
            const getCall = ASTFactory.createGetCall(plainIdentifier, node.property);
            Object.assign(node, getCall);
            node._indexTransformed = true;
            return;
        }

        if (!scopeManager.isContextBound(node.object.name)) {
            // Transform the object to scoped variable: $.kind.scopedName
            node.object = createScopedVariableReference(node.object.name, scopeManager);
        }

        if (node.property.type === 'MemberExpression') {
            const memberNode = node.property;
            if (!memberNode._indexTransformed) {
                transformArrayIndex(memberNode, scopeManager);
                memberNode._indexTransformed = true;
            }
        }
    }

    // Handle complex index expressions (BinaryExpression, UnaryExpression, etc.)
    // when neither block above matched — e.g. func()[expr * 2], close[a + b] with non-Identifier object.
    if (node.computed && node.property.type !== 'Identifier' && node.property.type !== 'MemberExpression'
        && !node._indexTransformed) {
        if (node.property.type === 'BinaryExpression' || node.property.type === 'UnaryExpression' ||
            node.property.type === 'LogicalExpression' || node.property.type === 'ConditionalExpression') {
            node.property = transformOperand(node.property, scopeManager);
        }
    }
}

export function addArrayAccess(node: any, scopeManager: ScopeManager): void {
    const memberExpr = ASTFactory.createGetCall(ASTFactory.createIdentifier(node.name), 0);
    // Preserve location info if available
    if (node.start !== undefined) memberExpr.start = node.start;
    if (node.end !== undefined) memberExpr.end = node.end;

    memberExpr._indexTransformed = true;
    Object.assign(node, memberExpr);
}

export function transformIdentifier(node: any, scopeManager: ScopeManager): void {
    // Skip if marked for no transformation (e.g., function parameters in $.get() calls)
    if (node._skipTransformation) {
        return;
    }

    // Transform identifiers to use the context object
    if (node.name !== CONTEXT_NAME) {
        // For NAMESPACES_LIKE entries with __value (e.g. na, time, time_close),
        // rewrite bare identifier access to identifier.__value
        if (NAMESPACES_LIKE.includes(node.name) && scopeManager.isContextBound(node.name)) {
            const isFunctionCall = node.parent && node.parent.type === 'CallExpression' && node.parent.callee === node;
            const isMemberAccess = node.parent && node.parent.type === 'MemberExpression' && node.parent.object === node && !node.parent.computed;
            if (!isFunctionCall && !isMemberAccess) {
                const originalName = node.name;
                const valueExpr = {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: originalName },
                    property: { type: 'Identifier', name: '__value' },
                    computed: false,
                };
                // Wrap in $.get() to extract current scalar value from Series
                const getCall = ASTFactory.createGetCall(valueExpr, 0);
                Object.assign(node, getCall);
                delete node.name;
                return;
            }
        }

        // Skip transformation for global and native objects
        if (
            node.name === 'Math' ||
            node.name === 'NaN' ||
            node.name === 'undefined' ||
            node.name === 'Infinity' ||
            node.name === 'null' ||
            (node.name.startsWith("'") && node.name.endsWith("'")) ||
            (node.name.startsWith('"') && node.name.endsWith('"')) ||
            (node.name.startsWith('`') && node.name.endsWith('`'))
        ) {
            return;
        }

        // Skip transformation for loop variables
        if (scopeManager.isLoopVariable(node.name)) {
            return;
        }

        // Determine if this identifier is a function argument that expects a Series object
        let isSeriesFunctionArg = false;
        if (node.parent && node.parent.type === 'CallExpression' && node.parent.arguments.includes(node)) {
            const callee = node.parent.callee;

            // Check for context methods $.get, $.set, $.init, $.param, $.call
            const isContextMethod =
                callee.type === 'MemberExpression' &&
                callee.object &&
                callee.object.name === CONTEXT_NAME &&
                ['get', 'set', 'init', 'param', 'call'].includes(callee.property.name);

            if (isContextMethod) {
                const argIndex = node.parent.arguments.indexOf(node);
                if (callee.property.name === 'call') {
                    // For .call(fn, id, ...args), arguments starting from index 2 are the function arguments
                    // and should be passed as Series objects (isSeriesFunctionArg = true)
                    if (argIndex >= 2) {
                        isSeriesFunctionArg = true;
                    }
                } else if (argIndex === 0) {
                    isSeriesFunctionArg = true;
                }
            } else {
                // For all other functions (including namespace and user-defined), pass Series
                // UNLESS it is a method call on a variable that is NOT a known namespace
                const isNamespaceCall =
                    callee.type === 'MemberExpression' &&
                    callee.object &&
                    callee.object.type === 'Identifier' &&
                    KNOWN_NAMESPACES.includes(callee.object.name);

                if (callee.type === 'MemberExpression' && !isNamespaceCall) {
                    // Method call on a local variable (e.g. array instance: a.indexof(val))
                    // Arguments should be unwrapped to values ($.get)
                    isSeriesFunctionArg = false;
                } else {
                    isSeriesFunctionArg = true;
                }
            }
        }

        // Check if this identifier is part of a namespace member access (e.g., ta.ema)
        const isNamespaceMember =
            node.parent && node.parent.type === 'MemberExpression' && node.parent.object === node && scopeManager.isContextBound(node.name);

        // Check if this identifier is part of a param() call
        const isParamCall =
            node.parent &&
            node.parent.type === 'CallExpression' &&
            node.parent.callee &&
            node.parent.callee.type === 'MemberExpression' &&
            node.parent.callee.property.name === 'param';

        const isInit = node.parent && node.parent.type === 'AssignmentExpression' && node.parent.left === node;

        // Check if this identifier is a function being called
        const isFunctionCall = node.parent && node.parent.type === 'CallExpression' && node.parent.callee === node;

        // Check if parent node is already a member expression with computed property (array access)
        const hasArrayAccess = node.parent && node.parent.type === 'MemberExpression' && node.parent.computed && node.parent.object === node;

        // Check if this identifier is part of an array access that's an argument to a namespace function
        const isArrayIndexInNamespaceCall =
            node.parent &&
            node.parent.type === 'MemberExpression' &&
            node.parent.computed &&
            node.parent.property === node &&
            node.parent.parent &&
            node.parent.parent.type === 'CallExpression' &&
            node.parent.parent.callee &&
            node.parent.parent.callee.type === 'MemberExpression' &&
            scopeManager.isContextBound(node.parent.parent.callee.object.name);

        if (isNamespaceMember || isParamCall || isSeriesFunctionArg || isArrayIndexInNamespaceCall || isFunctionCall) {
            // For function calls, we should just use the original name without scoping
            if (isFunctionCall) {
                return;
            }

            // FIX: Don't transform function identifier if it's the first argument to $.call(fn, id, ...)
            if (
                node.parent &&
                node.parent.type === 'CallExpression' &&
                node.parent.callee &&
                node.parent.callee.type === 'MemberExpression' &&
                node.parent.callee.object &&
                node.parent.callee.object.name === CONTEXT_NAME &&
                node.parent.callee.property.name === 'call' &&
                node.parent.arguments[0] === node
            ) {
                return;
            }

            // For local series variables (hoisted params), don't rename or wrap if they are args to a namespace function
            if (scopeManager.isLocalSeriesVar(node.name)) {
                return;
            }

            // If it's a nested function parameter or context bound variable (but not a root parameter), skip transformation
            // This protects built-ins like 'close' from being resolved to '$.let.close' when passed as arguments
            if (scopeManager.isContextBound(node.name) && !scopeManager.isRootParam(node.name)) {
                return;
            }

            // Don't add [0] for namespace function arguments or array indices
            const memberExpr = createScopedVariableReference(node.name, scopeManager);
            Object.assign(node, memberExpr);
            return;
        }

        const isContextBoundVar = scopeManager.isContextBound(node.name) && !scopeManager.isRootParam(node.name);

        if (isContextBoundVar) {
            const isFunctionArg = node.parent && node.parent.type === 'CallExpression' && node.parent.arguments.includes(node);
            const isSwitchDiscriminant = node.parent && node.parent.type === 'SwitchStatement' && node.parent.discriminant === node;
            const isSwitchCaseTest = node.parent && node.parent.type === 'SwitchCase' && node.parent.test === node;

            if (!isFunctionArg && !isSwitchDiscriminant && !isSwitchCaseTest) {
                // Return early if it's not a function arg or switch test that needs unwrapping
                return;
            }
        }

        // For local series variables used elsewhere (e.g. in plot() or binary ops), we MIGHT need to wrap them
        // But we definitely shouldn't rename them to $.let...
        if (scopeManager.isLocalSeriesVar(node.name)) {
            // If it's not an array access, we need to wrap it in $.get(node, 0) to get the value
            if (!hasArrayAccess) {
                const memberExpr = ASTFactory.createIdentifier(node.name);
                const accessExpr = ASTFactory.createGetCall(memberExpr, 0);
                Object.assign(node, accessExpr);
            }
            return;
        }

        const [scopedName, kind] = scopeManager.getVariable(node.name);

        let memberExpr;
        if (isContextBoundVar) {
            // Use identifier directly for context bound vars (avoid $.let)
            memberExpr = ASTFactory.createIdentifier(node.name);
        } else {
            if (scopedName === node.name && !scopeManager.isContextBound(node.name)) {
                return; // Global/unknown var, return as is
            }
            memberExpr = createScopedVariableReference(node.name, scopeManager);
        }

        if (!hasArrayAccess) {
            const accessExpr = ASTFactory.createGetCall(memberExpr, 0);
            Object.assign(node, accessExpr);
        } else {
            Object.assign(node, memberExpr);
        }
    }
}

export function transformMemberExpression(memberNode: any, originalParamName: string, scopeManager: ScopeManager): void {
    // Skip transformation for Math object properties
    if (memberNode.object && memberNode.object.type === 'Identifier' && memberNode.object.name === 'Math') {
        return;
    }

    // Pine history-reference operator `[]` on a CALL result, e.g.
    // `ta.sma(close, 3)[1]` (any function call, not only ta.*). A call returns
    // a scalar each bar, so `[N]` here is never a tuple/array index — in Pine
    // `[]` is always the history operator. Accumulate the per-bar result into a
    // `$.param` series and read N bars back with `$.get`, which yields a SCALAR
    // so it composes everywhere (arithmetic, $.init, return, argument). Without
    // this the subscript was either dropped (folded into $.init's ignored
    // lookbehind) or left as a raw JS index on a scalar (→ NaN).
    if (
        memberNode.computed &&
        memberNode.object &&
        memberNode.object.type === 'CallExpression' &&
        !memberNode._historyTransformed
    ) {
        if (!memberNode.object._transformed) {
            transformCallExpression(memberNode.object, scopeManager);
        }
        const paramId = scopeManager.generateParamId();
        const paramCall = {
            type: 'CallExpression',
            callee: ASTFactory.createMemberExpression(
                ASTFactory.createContextIdentifier(),
                ASTFactory.createIdentifier('param'),
            ),
            arguments: [memberNode.object, UNDEFINED_ARG, makeParamNameArg(scopeManager, paramId)],
            _transformed: true,
            _isParamCall: true,
        };
        const getCall: any = ASTFactory.createGetCall(paramCall, memberNode.property);
        getCall._transformed = true;
        getCall._historyTransformed = true;
        Object.assign(memberNode, getCall);
        delete memberNode.object;
        delete memberNode.property;
        delete memberNode.computed;
        return;
    }

    // Check if this is a direct namespace method access without parentheses (e.g., ta.tr, math.pi)
    // Only apply to known Pine Script namespaces: ta, math, request, array, input
    // If so, convert it to a call expression (e.g., ta.tr(), math.pi())
    const isDirectNamespaceMemberAccess =
        memberNode.object &&
        memberNode.object.type === 'Identifier' &&
        KNOWN_NAMESPACES.includes(memberNode.object.name) &&
        scopeManager.isContextBound(memberNode.object.name) &&
        !memberNode.computed;

    if (isDirectNamespaceMemberAccess) {
        // Check if this member expression is NOT already the callee of a CallExpression
        const isAlreadyBeingCalled = memberNode.parent && memberNode.parent.type === 'CallExpression' && memberNode.parent.callee === memberNode;

        // Check if this is part of a destructuring pattern (array or object destructuring)
        // We want to skip only for actual destructuring, not simple assignments
        const isInDestructuring =
            memberNode.parent &&
            ((memberNode.parent.type === 'VariableDeclarator' &&
                (memberNode.parent.id.type === 'ArrayPattern' || memberNode.parent.id.type === 'ObjectPattern')) ||
                (memberNode.parent.type === 'AssignmentExpression' &&
                    (memberNode.parent.left.type === 'ArrayPattern' || memberNode.parent.left.type === 'ObjectPattern')) ||
                memberNode.parent.type === 'Property');

        if (!isAlreadyBeingCalled && !isInDestructuring) {
            // Convert namespace.method to namespace.method()
            const callExpr: any = {
                type: 'CallExpression',
                callee: {
                    type: 'MemberExpression',
                    object: memberNode.object,
                    property: memberNode.property,
                    computed: false,
                },
                arguments: [],
                _transformed: false, // Allow further transformation of this call
            };

            // Preserve location info
            if (memberNode.start !== undefined) callExpr.start = memberNode.start;
            if (memberNode.end !== undefined) callExpr.end = memberNode.end;

            Object.assign(memberNode, callExpr);
            return;
        }
    }

    // Function parameters (local series vars) with non-computed property access (e.g. w.val)
    // need unwrapping: w.val → $.get(w, 0).val
    // The parameter is a Series wrapping a UDT; without $.get(), .val accesses the Series, not the UDT.
    if (
        !memberNode.computed &&
        memberNode.object &&
        memberNode.object.type === 'Identifier' &&
        scopeManager.isLocalSeriesVar(memberNode.object.name)
    ) {
        const plainId = ASTFactory.createIdentifier(memberNode.object.name);
        plainId._skipTransformation = true;
        memberNode.object = ASTFactory.createGetCall(plainId, 0);
        return;
    }

    //if statment variables always need to be transformed
    const isIfStatement = scopeManager.getCurrentScopeType() == 'if';
    const isElseStatement = scopeManager.getCurrentScopeType() == 'els';
    const isForStatement = scopeManager.getCurrentScopeType() == 'for';
    // If the object is a context-bound variable (like a function parameter), skip transformation
    // But if it's a computed access (array access), we must process it to use $.get()
    if (
        !isIfStatement &&
        !isElseStatement &&
        !isForStatement &&
        memberNode.object &&
        memberNode.object.type === 'Identifier' &&
        scopeManager.isContextBound(memberNode.object.name) &&
        !scopeManager.isRootParam(memberNode.object.name) &&
        !memberNode.computed // Allow computed properties to proceed
    ) {
        return;
    }

    // Transform array indices
    if (!memberNode._indexTransformed) {
        transformArrayIndex(memberNode, scopeManager);
        memberNode._indexTransformed = true;
    }

    // Convert to $.get(object, property) if it's a computed access on a context variable
    const isContextMemberAccess =
        memberNode.object &&
        memberNode.object.type === 'MemberExpression' &&
        memberNode.object.object &&
        memberNode.object.object.type === 'MemberExpression' &&
        memberNode.object.object.object &&
        (memberNode.object.object.object.name === CONTEXT_NAME || memberNode.object.object.object.name === '$$');

    const isContextBoundIdentifier =
        memberNode.object && memberNode.object.type === 'Identifier' && scopeManager.isContextBound(memberNode.object.name);

    if (memberNode.computed && (isContextMemberAccess || isContextBoundIdentifier)) {
        // Check if this is LHS of an assignment
        if (memberNode.parent && memberNode.parent.type === 'AssignmentExpression' && memberNode.parent.left === memberNode) {
            return;
        }

        // For NAMESPACES_LIKE entries (e.g. time[1], na[0]), access __value before $.get()
        if (
            memberNode.object.type === 'Identifier' &&
            NAMESPACES_LIKE.includes(memberNode.object.name) &&
            scopeManager.isContextBound(memberNode.object.name)
        ) {
            memberNode.object = {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: memberNode.object.name },
                property: { type: 'Identifier', name: '__value' },
                computed: false,
            };
        }

        const getCall = ASTFactory.createGetCall(memberNode.object, memberNode.property);

        // Preserve location
        if (memberNode.start) getCall.start = memberNode.start;
        if (memberNode.end) getCall.end = memberNode.end;

        Object.assign(memberNode, getCall);

        // Delete old MemberExpression properties to avoid accidental traversal
        delete memberNode.object;
        delete memberNode.property;
        delete memberNode.computed;
        return;
    }

    // Subscript on a UDT-field chain: `bar.low[N]` where `bar` is a user
    // variable known to hold a UDT instance.
    //
    // Pine semantics: `bar.low[N]` reads bar's `.low` from N bars ago.
    // Since `bar = BAR.new()` runs every bar, `$.let.glb1_bar` is a Series
    // of PineTypeObject instances → `$.get(glb1_bar, N).low` is correct.
    //
    // The rewrite is gated by `scopeManager.isUdtInstance(leafBaseName)` so it
    // does NOT fire for JS-style array indexing (e.g. `pl.points[0]` where
    // `pl` is initialized via `polyline.new(...)` — a built-in, not in the
    // UDT registry).
    if (memberNode.computed && memberNode.object && memberNode.object.type === 'MemberExpression') {
        // Walk down to find the leaf base of the chain.
        let cursor: any = memberNode.object;
        while (cursor.object && cursor.object.type === 'MemberExpression') {
            cursor = cursor.object;
        }
        if (
            cursor.object && cursor.object.type === 'Identifier' &&
            scopeManager.isUdtInstance(cursor.object.name)
        ) {
            const baseName = cursor.object.name;
            // For UDT-typed function parameters (Case 2), the leaf must stay a
            // plain identifier — the parameter is bound directly to the Series
            // of UDT instances passed in by the caller. For globally-scoped
            // UDT instances, fall through to the standard scoped reference.
            const baseRef = scopeManager.isLocalSeriesVar(baseName)
                ? (() => {
                      const id = ASTFactory.createIdentifier(baseName);
                      id._skipTransformation = true;
                      return id;
                  })()
                : createScopedVariableReference(baseName, scopeManager);
            // Replace leaf `bar` with `$.get(<base-ref>, lookback)` and drop
            // the outer `[N]` — the chain (`.low`) now reads from the previous
            // bar's UDT instance.
            cursor.object = ASTFactory.createGetCall(baseRef, memberNode.property);
            // Re-anchor memberNode to the (now-rewritten) inner MemberExpression.
            const inner = memberNode.object;
            Object.assign(memberNode, inner);
            delete memberNode.computed;
            return;
        }
    }
}

// Helper for transformFunctionArgument
function transformIdentifierForParam(node: any, scopeManager: ScopeManager): any {
    if (node.type === 'Identifier') {
        if (NAMESPACES_LIKE.includes(node.name) && scopeManager.isContextBound(node.name)) {
            const originalName = node.name;
            Object.assign(node, {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: originalName },
                property: { type: 'Identifier', name: '__value' },
                computed: false,
            });
            delete node.name;
            return node;
        }

        // Skip transformation for loop variables
        if (scopeManager.isLoopVariable(node.name)) {
            return node;
        }

        // If it's a root parameter, transform it with $.let prefix
        if (scopeManager.isRootParam(node.name)) {
            const [scopedName, kind] = scopeManager.getVariable(node.name);
            return ASTFactory.createContextVariableReference(kind, scopedName);
        }

        // If it's a nested function parameter or other context-bound variable, return as is
        // NOTE: isContextBound now returns false for JavaScript globals like Infinity, NaN, etc.
        if (scopeManager.isContextBound(node.name)) {
            return node;
        }

        // Check if there's a user-defined variable with this name before treating as local series
        // This handles the case where internal parameter names (p1, p2, etc.) collide with user variables
        const [scopedName, kind] = scopeManager.getVariable(node.name);
        const isUserVariable = scopedName !== node.name; // If renamed, it's a user variable

        // If it's a local series variable (hoisted parameter) AND NOT a user variable, return as is
        if (scopeManager.isLocalSeriesVar(node.name) && !isUserVariable) {
            return node;
        }

        // If it's a user variable, transform it
        if (isUserVariable) {
            return createScopedVariableReference(node.name, scopeManager);
        }

        // JavaScript global literals should never be transformed
        // Variable not found in scopes and not context-bound
        if (scopedName === node.name && !scopeManager.isContextBound(node.name)) {
            return node; // Return as-is to preserve JavaScript globals
        }

        // Otherwise transform with context variable reference (shouldn't reach here in normal cases)
        return createScopedVariableReference(node.name, scopeManager);
    }
    return node;
}

function transformOperand(node: any, scopeManager: ScopeManager, namespace: string = ''): any {
    switch (node.type) {
        case 'BinaryExpression': {
            return getParamFromBinaryExpression(node, scopeManager, namespace);
        }
        case 'LogicalExpression': {
            return getParamFromLogicalExpression(node, scopeManager, namespace);
        }
        case 'MemberExpression': {
            // For non-computed property access on NAMESPACES_LIKE identifiers (e.g. label.style_label_down),
            // leave as-is — these are namespace constant accesses, not series values.
            const isNamespacePropAccess = !node.computed &&
                node.object.type === 'Identifier' &&
                NAMESPACES_LIKE.includes(node.object.name) &&
                scopeManager.isContextBound(node.object.name);

            // For computed access on NAMESPACES_LIKE identifiers (e.g. time[1], close[2]),
            // produce $.get(identifier.__value, offset) instead of identifier.__value[offset].
            const isNamespaceSubscript = node.computed &&
                node.object.type === 'Identifier' &&
                NAMESPACES_LIKE.includes(node.object.name) &&
                scopeManager.isContextBound(node.object.name);

            if (isNamespaceSubscript) {
                const valueExpr = {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: node.object.name },
                    property: { type: 'Identifier', name: '__value' },
                    computed: false,
                };
                return ASTFactory.createGetCall(valueExpr, node.property);
            }

            // Handle array access
            const transformedObject = (node.object.type === 'Identifier' && !isNamespacePropAccess)
                ? transformIdentifierForParam(node.object, scopeManager)
                : node.object;

            // For non-computed property access on user variables (e.g. get_spt.output),
            // wrap the object in $.get() to extract the current bar's value.
            // Without this, `$.let.glb1_get_spt.output` accesses the Series object itself,
            // not the current bar value's property.
            let finalObject = transformedObject;
            if (!node.computed && node.object.type === 'Identifier' && !isNamespacePropAccess) {
                const [scopedName] = scopeManager.getVariable(node.object.name);
                const isUserVariable = scopedName !== node.object.name;
                if (isUserVariable && !scopeManager.isLoopVariable(node.object.name)) {
                    finalObject = ASTFactory.createGetCall(transformedObject, 0);
                }
            }

            // Don't add [0] if this is already an array access
            return {
                type: 'MemberExpression',
                object: finalObject,
                property: node.property,
                computed: node.computed,
            };
        }
        case 'Identifier': {
            // Skip transformation for loop variables
            if (scopeManager.isLoopVariable(node.name)) {
                return node;
            }
            // Check if this identifier is part of a member expression (array access)
            const isMemberExprProperty = node.parent && node.parent.type === 'MemberExpression' && node.parent.property === node;
            if (isMemberExprProperty) {
                return node;
            }
            const transformedObject = transformIdentifierForParam(node, scopeManager);

            // Skip $.get wrapping for specific constants/globals
            if (
                transformedObject.type === 'Identifier' &&
                (transformedObject.name === 'NaN' ||
                    transformedObject.name === 'undefined' ||
                    transformedObject.name === 'Infinity' ||
                    transformedObject.name === 'null' ||
                    transformedObject.name === 'Math')
            ) {
                return transformedObject;
            }

            return ASTFactory.createGetCall(transformedObject, 0);
        }
        case 'UnaryExpression': {
            return getParamFromUnaryExpression(node, scopeManager, namespace);
        }
        case 'ConditionalExpression': {
            // Transform test, consequent, and alternate
            const transformedTest = transformOperand(node.test, scopeManager, namespace);
            const transformedConsequent = transformOperand(node.consequent, scopeManager, namespace);
            const transformedAlternate = transformOperand(node.alternate, scopeManager, namespace);

            return {
                type: 'ConditionalExpression',
                test: transformedTest,
                consequent: transformedConsequent,
                alternate: transformedAlternate,
                start: node.start,
                end: node.end,
            };
        }
    }

    return node;
}

function getParamFromBinaryExpression(node: any, scopeManager: ScopeManager, namespace: string): any {
    // Transform both operands
    const transformedLeft = transformOperand(node.left, scopeManager, namespace);
    const transformedRight = transformOperand(node.right, scopeManager, namespace);

    // Create the binary expression
    const binaryExpr = {
        type: 'BinaryExpression',
        operator: node.operator,
        left: transformedLeft,
        right: transformedRight,
        start: node.start,
        end: node.end,
    };

    // Walk through the binary expression to transform any function calls
    walk.recursive(binaryExpr, scopeManager, {
        CallExpression(node: any, scopeManager: ScopeManager) {
            if (!node._transformed) {
                transformCallExpression(node, scopeManager);
            }
        },
        MemberExpression(node: any) {
            transformMemberExpression(node, '', scopeManager);
        },
    });

    return binaryExpr;
}

function getParamFromLogicalExpression(node: any, scopeManager: ScopeManager, namespace: string): any {
    // Transform both operands
    const transformedLeft = transformOperand(node.left, scopeManager, namespace);
    const transformedRight = transformOperand(node.right, scopeManager, namespace);

    const logicalExpr = {
        type: 'LogicalExpression',
        operator: node.operator,
        left: transformedLeft,
        right: transformedRight,
        start: node.start,
        end: node.end,
    };

    // Walk through the logical expression to transform any function calls
    walk.recursive(logicalExpr, scopeManager, {
        CallExpression(node: any, scopeManager: ScopeManager) {
            if (!node._transformed) {
                transformCallExpression(node, scopeManager);
            }
        },
    });

    return logicalExpr;
}

function getParamFromConditionalExpression(node: any, scopeManager: ScopeManager, namespace: string): any {
    // Transform identifiers in the right side of the assignment
    walk.recursive(
        node,
        { parent: node, inNamespaceCall: false },
        {
            Identifier(node: any, state: any, c: any) {
                if (node.name == 'NaN') return;
                if (NAMESPACES_LIKE.includes(node.name) && scopeManager.isContextBound(node.name)) {
                    // Skip wrapping when this identifier is the object of a non-computed
                    // member access (e.g. label.style_label_down) — it's a namespace
                    // constant access, not a series value.
                    const isMemberAccess = state.parent && state.parent.type === 'MemberExpression' &&
                        state.parent.object === node && !state.parent.computed;
                    if (isMemberAccess) return;

                    const originalName = node.name;
                    const valueExpr = {
                        type: 'MemberExpression',
                        object: { type: 'Identifier', name: originalName },
                        property: { type: 'Identifier', name: '__value' },
                        computed: false,
                    };
                    // Wrap in $.get() to extract current scalar value from Series
                    const getCall = ASTFactory.createGetCall(valueExpr, 0);
                    Object.assign(node, getCall);
                    delete node.name;
                    return;
                }
                node.parent = state.parent;
                transformIdentifier(node, scopeManager);
                const isBinaryOperation = node.parent && node.parent.type === 'BinaryExpression';
                const isConditional = node.parent && node.parent.type === 'ConditionalExpression';

                if (isConditional || isBinaryOperation) {
                    if (node.type === 'MemberExpression') {
                        transformArrayIndex(node, scopeManager);
                    } else if (node.type === 'Identifier') {
                        // Skip addArrayAccess if the identifier is already inside a $.get call
                        const isGetCall =
                            node.parent &&
                            node.parent.type === 'CallExpression' &&
                            node.parent.callee &&
                            node.parent.callee.object &&
                            node.parent.callee.object.name === CONTEXT_NAME &&
                            node.parent.callee.property.name === 'get';

                        if (!isGetCall) {
                            addArrayAccess(node, scopeManager);
                        }
                    }
                }
            },
            MemberExpression(node: any, state: any, c: any) {
                // Transform member expression (handles array index renaming AND
                // computed access conversion to $.get() for context variables)
                transformMemberExpression(node, '', scopeManager);
                // Then continue with object transformation
                if (node.object) {
                    c(node.object, { parent: node, inNamespaceCall: state.inNamespaceCall });
                }
            },
            ConditionalExpression(node: any, state: any, c: any) {
                // Traverse test, consequent, and alternate with correct parent
                const newState = { ...state, parent: node };
                if (node.test) {
                    c(node.test, newState);
                }
                if (node.consequent) {
                    c(node.consequent, newState);
                }
                if (node.alternate) {
                    c(node.alternate, newState);
                }
            },
            BinaryExpression(node: any, state: any, c: any) {
                const newState = { ...state, parent: node };
                c(node.left, newState);
                c(node.right, newState);
            },
            LogicalExpression(node: any, state: any, c: any) {
                const newState = { ...state, parent: node };
                c(node.left, newState);
                c(node.right, newState);
            },
            UnaryExpression(node: any, state: any, c: any) {
                const newState = { ...state, parent: node };
                c(node.argument, newState);
            },
            CallExpression(node: any, state: any, c: any) {
                const isNamespaceCall =
                    node.callee &&
                    node.callee.type === 'MemberExpression' &&
                    node.callee.object &&
                    node.callee.object.type === 'Identifier' &&
                    scopeManager.isContextBound(node.callee.object.name);

                // First transform the call expression itself
                transformCallExpression(node, scopeManager);

                if (isInlinedLazyCall(node)) return;

                // Then transform its arguments with the correct context
                node.arguments.forEach((arg: any) => c(arg, { parent: node, inNamespaceCall: isNamespaceCall || state.inNamespaceCall }));
            },
        }
    );

    const memberExpr = ASTFactory.createMemberExpression(ASTFactory.createIdentifier(namespace), ASTFactory.createIdentifier('param'));
    const nextParamId = scopeManager.generateParamId();
    const paramCall = {
        type: 'CallExpression',
        callee: memberExpr,
        arguments: [node, UNDEFINED_ARG, makeParamNameArg(scopeManager, nextParamId)],
        _transformed: true,
        _isParamCall: true,
    };

    if (!scopeManager.shouldSuppressHoisting()) {
        const tempVarName = nextParamId;
        scopeManager.addLocalSeriesVar(tempVarName);
        const variableDecl = ASTFactory.createVariableDeclaration(tempVarName, paramCall);
        scopeManager.addHoistedStatement(variableDecl);
        return ASTFactory.createIdentifier(tempVarName);
    }

    return paramCall;
}

function getParamFromUnaryExpression(node: any, scopeManager: ScopeManager, namespace: string): any {
    // Transform the argument
    const transformedArgument = transformOperand(node.argument, scopeManager, namespace);

    // Create the unary expression
    const unaryExpr = {
        type: 'UnaryExpression',
        operator: node.operator,
        prefix: node.prefix,
        argument: transformedArgument,
        start: node.start,
        end: node.end,
    };

    // Walk through the unary expression to transform any function calls
    walk.recursive(unaryExpr, scopeManager, {
        CallExpression(node: any, scopeManager: ScopeManager) {
            if (!node._transformed) {
                transformCallExpression(node, scopeManager);
            }
        },
        MemberExpression(node: any) {
            transformMemberExpression(node, '', scopeManager);
        },
    });

    return unaryExpr;
}

export function transformFunctionArgument(arg: any, namespace: string, scopeManager: ScopeManager): any {
    // Handle binary expressions (arithmetic operations)

    switch (arg?.type) {
        case 'BinaryExpression':
            arg = getParamFromBinaryExpression(arg, scopeManager, namespace);
            break;
        case 'LogicalExpression':
            arg = getParamFromLogicalExpression(arg, scopeManager, namespace);
            break;
        case 'ConditionalExpression':
            return getParamFromConditionalExpression(arg, scopeManager, namespace);
        case 'UnaryExpression':
            arg = getParamFromUnaryExpression(arg, scopeManager, namespace);
            break;
        case 'ArrayExpression':
            // Transform each element in the array. Non-Identifier elements
            // (e.g. nested calls like `ta.sma(volume, maLenInput)` inside a
            // `request.security_lower_tf(..., [open, close, ta.sma(...)])`
            // tuple) must also be transformed so their nested identifiers
            // get scoped — otherwise `maLenInput` leaks bare and throws
            // "ReferenceError: maLenInput is not defined" at runtime.
            arg.elements = arg.elements.map((element: any) => {
                if (element.type === 'Identifier') {
                    // Transform identifiers to use $.get(variable, 0)
                    if (scopeManager.isContextBound(element.name) && !scopeManager.isRootParam(element.name)) {
                        // It's a data variable like 'close', 'open' - use directly
                        return element;
                    }
                    // Function parameters should use raw identifier wrapped in $.get()
                    // (same pattern as non-array function param handling elsewhere)
                    if (scopeManager.isLocalSeriesVar(element.name)) {
                        const plainIdentifier = ASTFactory.createIdentifier(element.name);
                        return ASTFactory.createGetCall(plainIdentifier, 0);
                    }
                    // It's a user variable - transform to context reference
                    return createScopedVariableAccess(element.name, scopeManager);
                }
                // Recurse into non-Identifier elements using the same helpers
                // the outer switch uses when these shapes appear at top level.
                if (element.type === 'CallExpression') {
                    transformCallExpression(element, scopeManager);
                    return element;
                }
                if (element.type === 'BinaryExpression') {
                    return getParamFromBinaryExpression(element, scopeManager, namespace);
                }
                if (element.type === 'LogicalExpression') {
                    return getParamFromLogicalExpression(element, scopeManager, namespace);
                }
                if (element.type === 'ConditionalExpression') {
                    return getParamFromConditionalExpression(element, scopeManager, namespace);
                }
                if (element.type === 'UnaryExpression') {
                    return getParamFromUnaryExpression(element, scopeManager, namespace);
                }
                if (element.type === 'MemberExpression') {
                    transformMemberExpression(element, namespace, scopeManager);
                    return element;
                }
                return element;
            });
            break;
    }

    // Check if the argument is an array access (computed member expression)
    const isArrayAccess = arg.type === 'MemberExpression' && arg.computed && arg.property;

    // Check if the argument is a property access (non-computed member expression)
    const isPropertyAccess = arg.type === 'MemberExpression' && !arg.computed;

    if (isArrayAccess) {
        // UDT field subscript: `bar.field[N]` (and chained `bar.outer.inner[N]`)
        // where the leaf base is a registered UDT instance. Pine semantics:
        // `bar = BAR.new()` runs every bar, so `$.let.glb1_bar` is a Series of
        // PineTypeObject instances; `$.get(<scoped-bar>, N).field` returns the
        // field value at N bars ago.
        //
        // The default `$.param(scalar, N, name)` wrapping is WRONG for this
        // pattern when the call site is inside a conditional block — the
        // accumulated history is per-call, not per-bar, so lookback skips
        // over bars where the if-branch didn't fire and returns stale values
        // from the *previous firing* instead of from N bars ago in time.
        // Direct lookback on the bar series bypasses the param machinery
        // entirely and works correctly regardless of call-site conditionality.
        if (arg.object && arg.object.type === 'MemberExpression') {
            let cursor: any = arg.object;
            while (cursor.object && cursor.object.type === 'MemberExpression') {
                cursor = cursor.object;
            }
            if (cursor.object?.type === 'Identifier' &&
                scopeManager.isUdtInstance(cursor.object.name)) {
                const baseName = cursor.object.name;
                // Function-parameter UDT (Case 2): leaf must stay a plain
                // identifier — the param is already bound to the Series of
                // UDT instances passed in by the caller.
                const baseRef = scopeManager.isLocalSeriesVar(baseName)
                    ? (() => {
                          const id = ASTFactory.createIdentifier(baseName);
                          id._skipTransformation = true;
                          return id;
                      })()
                    : createScopedVariableReference(baseName, scopeManager);
                cursor.object = ASTFactory.createGetCall(baseRef, arg.property);
                // `arg.object` is now the rewritten `$.get(<base>, N).field…`
                // chain; it replaces the whole `arg` expression. The outer
                // `$.param(...)` wrapper that the rest of this branch would
                // have applied is intentionally skipped — the lookback is
                // already baked into `$.get(...)`.
                return arg.object;
            }
        }

        // Ensure complex objects are transformed before being used as array source
        if (arg.object.type === 'CallExpression') {
            transformCallExpression(arg.object, scopeManager);
        } else if (arg.object.type === 'MemberExpression') {
            transformMemberExpression(arg.object, '', scopeManager);
            // Regression: `transformMemberExpression` early-returns for non-computed
            // access on context-bound user variables (relying on a later top-level
            // identifier walker to scope the base). But here the result is about to
            // be wrapped in `$.param(...)` immediately, so the later walker never
            // runs and the base identifier ends up bare in the emitted code.
            // Pattern that hits this:  `bar.low[1]` where `bar` is a UDT instance.
            // Walk into the MemberExpression chain and scope the leaf base when it
            // is a user-declared variable (not a built-in / namespace / loop var /
            // function param / local series).
            let baseHolder: any = arg.object;
            while (baseHolder && baseHolder.type === 'MemberExpression' && baseHolder.object) {
                if (baseHolder.object.type === 'Identifier') {
                    const base = baseHolder.object;
                    const [scopedName] = scopeManager.getVariable(base.name);
                    const isUserVariable = scopedName !== base.name;
                    if (
                        isUserVariable &&
                        !scopeManager.isContextBound(base.name) &&
                        !scopeManager.isRootParam(base.name) &&
                        !scopeManager.isLoopVariable(base.name) &&
                        !scopeManager.isLocalSeriesVar(base.name) &&
                        !NAMESPACES_LIKE.includes(base.name) &&
                        !KNOWN_NAMESPACES.includes(base.name)
                    ) {
                        baseHolder.object = createScopedVariableAccess(base.name, scopeManager);
                    }
                    break;
                }
                baseHolder = baseHolder.object;
            }
        } else if (arg.object.type === 'BinaryExpression') {
            arg.object = getParamFromBinaryExpression(arg.object, scopeManager, namespace);
        } else if (arg.object.type === 'LogicalExpression') {
            arg.object = getParamFromLogicalExpression(arg.object, scopeManager, namespace);
        } else if (arg.object.type === 'ConditionalExpression') {
            arg.object = getParamFromConditionalExpression(arg.object, scopeManager, namespace);
        } else if (arg.object.type === 'UnaryExpression') {
            arg.object = getParamFromUnaryExpression(arg.object, scopeManager, namespace);
        }

        // Transform array access
        const transformedObject =
            arg.object.type === 'Identifier' && scopeManager.isContextBound(arg.object.name) && !scopeManager.isRootParam(arg.object.name)
                ? arg.object
                : transformIdentifierForParam(arg.object, scopeManager);

        // Transform the index expression and unwrap to scalar via $.get(..., 0)
        let transformedProperty: any;
        if (arg.property.type === 'Identifier' && !scopeManager.isContextBound(arg.property.name) && !scopeManager.isLoopVariable(arg.property.name)) {
            transformedProperty = ASTFactory.createGetCall(transformIdentifierForParam(arg.property, scopeManager), 0);
        } else if (arg.property.type === 'BinaryExpression' || arg.property.type === 'UnaryExpression' ||
                   arg.property.type === 'LogicalExpression' || arg.property.type === 'ConditionalExpression') {
            // Recursively transform identifiers inside complex index expressions
            // e.g. close[strideInput * 2] → ta.param(close, $.get($.let.glb1_strideInput, 0) * 2, 'p2')
            transformedProperty = transformOperand(arg.property, scopeManager, namespace);
        } else {
            transformedProperty = arg.property;
        }

        const memberExpr = ASTFactory.createMemberExpression(ASTFactory.createIdentifier(namespace), ASTFactory.createIdentifier('param'));

        const nextParamId = scopeManager.generateParamId();
        const paramCall = {
            type: 'CallExpression',
            callee: memberExpr,
            arguments: [transformedObject, transformedProperty, makeParamNameArg(scopeManager, nextParamId)],
            _transformed: true,
            _isParamCall: true,
        };

        if (!scopeManager.shouldSuppressHoisting()) {
            const tempVarName = nextParamId;
            scopeManager.addLocalSeriesVar(tempVarName); // Mark as local series
            const variableDecl = ASTFactory.createVariableDeclaration(tempVarName, paramCall);
            scopeManager.addHoistedStatement(variableDecl);
            return ASTFactory.createIdentifier(tempVarName);
        }

        return paramCall;
    }

    if (isPropertyAccess) {
        // Auto-call known namespace member accesses (e.g., ta.obv -> ta.obv())
        // These are built-in variables (like ta.obv, ta.tr) that PineTS implements as
        // functions. They must run on every bar (even inside conditional blocks) because
        // they are cumulative/stateful. We hoist the call to the outermost scope.
        if (
            arg.object.type === 'Identifier' &&
            KNOWN_NAMESPACES.includes(arg.object.name) &&
            scopeManager.isContextBound(arg.object.name) &&
            !arg.computed
        ) {
            const nsName = arg.object.name;

            // Build the call expression: e.g. ta.obv()
            const callExpr: any = {
                type: 'CallExpression',
                callee: {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: nsName },
                    property: { type: 'Identifier', name: arg.property.name },
                    computed: false,
                },
                arguments: [],
                _transformed: true,
            };

            // Inject TA call ID for state management (same as transformCallExpression does)
            if (nsName === 'ta') {
                callExpr.arguments.push(scopeManager.getNextTACallId());
            }

            // Hoist to outermost scope so it runs every bar
            const tempVarName = scopeManager.generateTempVar();
            scopeManager.addLocalSeriesVar(tempVarName);
            const variableDecl = ASTFactory.createVariableDeclaration(tempVarName, callExpr);
            scopeManager.addOuterHoistedStatement(variableDecl);

            // Replace the argument with a reference to the hoisted variable
            Object.assign(arg, ASTFactory.createIdentifier(tempVarName));
            return arg;
        }

        // Handle property access like trade.entry
        // Transform the object identifier if it's a user variable
        if (arg.object.type === 'Identifier') {
            const name = arg.object.name;
            const [varName, kind] = scopeManager.getVariable(name);
            const isRenamed = varName !== name;

            // Only transform if the variable has been renamed (i.e., it's a user-defined variable)
            // Context-bound variables that are NOT renamed (like 'display', 'ta', 'input') should NOT be transformed
            if (isRenamed && !scopeManager.isLoopVariable(name)) {
                // Transform object to $.get($.let.varName, 0) or $$.get($$.let.varName, 0) for function scope
                const contextVarRef = createScopedVariableReference(name, scopeManager);
                const getCall = ASTFactory.createGetCall(contextVarRef, 0);
                arg.object = getCall;
            }
            // Function parameters (local series vars) need $.get(w, 0).field unwrapping
            else if (scopeManager.isLocalSeriesVar(name)) {
                const plainId = ASTFactory.createIdentifier(name);
                plainId._skipTransformation = true;
                arg.object = ASTFactory.createGetCall(plainId, 0);
            }
        } else if (arg.object.type === 'MemberExpression') {
            // Recursively handle nested member expressions like obj.prop1.prop2
            transformFunctionArgument(arg.object, namespace, scopeManager);
        } else if (arg.object.type === 'CallExpression') {
            // Recursively handle call expression objects like arr.get(2).out
            // The call might contain user variable identifiers that need transformation
            if (!arg.object._transformed) {
                transformCallExpression(arg.object, scopeManager);
            }
        }
    }

    if (arg.type === 'ObjectExpression') {
        arg.properties = arg.properties.map((prop: any) => {
            // Get the variable name and kind
            if (prop.value.name) {
                // If it's a context-bound variable (like 'close', 'open'), a local series
                // var (non-root function parameter like 'col' in in_out()), or a loop
                // variable — use the raw identifier, not a scoped reference.
                if (scopeManager.isContextBound(prop.value.name) ||
                    scopeManager.isLocalSeriesVar(prop.value.name) ||
                    scopeManager.isLoopVariable(prop.value.name)) {
                    return {
                        type: 'Property',
                        key: {
                            type: 'Identifier',
                            name: prop.key.name,
                        },
                        value: ASTFactory.createIdentifier(prop.value.name),
                        kind: 'init',
                        method: false,
                        shorthand: false,
                        computed: false,
                    };
                }

                // Convert shorthand to full property definition
                return {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: prop.key.name,
                    },
                    value: createScopedVariableReference(prop.value.name, scopeManager),
                    kind: 'init',
                    method: false,
                    shorthand: false,
                    computed: false,
                };
            } else if (prop.value.type !== 'Literal') {
                // For complex expressions (CallExpression, BinaryExpression, etc.), recursively transform them
                prop.value = transformFunctionArgument(prop.value, namespace, scopeManager);
            }
            return prop;
        });
    }
    // For non-array-access arguments
    if (arg.type === 'Identifier') {
        // For NAMESPACES_LIKE entries, rewrite to .__value then fall through to param wrapping
        if (NAMESPACES_LIKE.includes(arg.name) && scopeManager.isContextBound(arg.name)) {
            const originalName = arg.name;
            Object.assign(arg, {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: originalName },
                property: { type: 'Identifier', name: '__value' },
                computed: false,
            });
            delete arg.name;
            // Fall through to param wrapping below
        }
        // If it's a context-bound variable (like a nested function parameter), use it directly
        else if (scopeManager.isContextBound(arg.name) && !scopeManager.isRootParam(arg.name)) {
            const memberExpr = ASTFactory.createMemberExpression(ASTFactory.createIdentifier(namespace), ASTFactory.createIdentifier('param'));
            const nextParamId = scopeManager.generateParamId();
            const paramCall = {
                type: 'CallExpression',
                callee: memberExpr,
                arguments: [arg, UNDEFINED_ARG, makeParamNameArg(scopeManager, nextParamId)],
                _transformed: true,
                _isParamCall: true,
            };

            if (!scopeManager.shouldSuppressHoisting()) {
                const tempVarName = nextParamId;
                scopeManager.addLocalSeriesVar(tempVarName); // Prevent transformation to $.let.pX
                const variableDecl = ASTFactory.createVariableDeclaration(tempVarName, paramCall);
                scopeManager.addHoistedStatement(variableDecl);
                return ASTFactory.createIdentifier(tempVarName);
            }

            return paramCall;
        }
    }

    // For all other cases, transform normally

    if (arg?.type === 'CallExpression') {
        transformCallExpression(arg, scopeManager, namespace);
    }

    const memberExpr = ASTFactory.createMemberExpression(ASTFactory.createIdentifier(namespace), ASTFactory.createIdentifier('param'));

    const transformedArg = arg.type === 'Identifier' ? transformIdentifierForParam(arg, scopeManager) : arg;
    const nextParamId = scopeManager.generateParamId();

    const paramCall = {
        type: 'CallExpression',
        callee: memberExpr,
        arguments: [transformedArg, UNDEFINED_ARG, makeParamNameArg(scopeManager, nextParamId)],
        _transformed: true,
        _isParamCall: true,
    };

    if (!scopeManager.shouldSuppressHoisting()) {
        const tempVarName = nextParamId;
        scopeManager.addLocalSeriesVar(tempVarName);
        const variableDecl = ASTFactory.createVariableDeclaration(tempVarName, paramCall);
        scopeManager.addHoistedStatement(variableDecl);
        return ASTFactory.createIdentifier(tempVarName);
    }

    return paramCall;
}

/** Check if a $.get() call exists anywhere in a MemberExpression/CallExpression chain */
function hasGetCallInChain(node: any): boolean {
    if (!node) return false;
    if (isDirectGetCall(node)) return true;
    if (node.type === 'MemberExpression') return hasGetCallInChain(node.object);
    // Traverse through ChainExpression wrappers created by earlier optional chaining passes
    if (node.type === 'ChainExpression') return hasGetCallInChain(node.expression);
    // Traverse through intermediate CallExpression nodes (e.g. aEW.get(0).b5.method())
    if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee?.type === 'MemberExpression') return hasGetCallInChain(callee.object);
        // Callee may already be wrapped in ChainExpression by a prior pass
        if (callee?.type === 'ChainExpression') return hasGetCallInChain(callee.expression);
    }
    return false;
}

/** Check if a node is directly a $.get(...) call (not nested in a chain) */
function isDirectGetCall(node: any): boolean {
    return node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.name === '$' &&
        node.callee.property?.name === 'get';
}

/**
 * Recursively resolves identifiers in a callee object chain.
 * Handles patterns like: obj.get(i).out.method() where obj is a user variable
 * that needs to be resolved to $.get($.var.xxx, 0).
 */
function resolveCalleeObject(node: any, parentNode: any, scopeManager: ScopeManager): void {
    if (!node) return;
    if (node.type === 'Identifier') {
        node.parent = parentNode;
        transformIdentifier(node, scopeManager);
    } else if (node.type === 'MemberExpression') {
        resolveCalleeObject(node.object, node, scopeManager);
    } else if (node.type === 'CallExpression') {
        if (node.callee && node.callee.type === 'MemberExpression') {
            resolveCalleeObject(node.callee.object, node.callee, scopeManager);
        }
        if (!node._transformed) {
            transformCallExpression(node, scopeManager);
        }
    }
}

/**
 * True when `transformCallExpression` kept a lazy-operand call inline (see
 * LazyOperandPass). Such a node is fully transformed — callee and arguments
 * included — and, unlike an eager call, was NOT replaced by a hoisted
 * `temp_N` identifier. Expression walkers that descend into a call's callee /
 * arguments after transforming it must stop here, otherwise they re-run
 * `transformMemberExpression` on `ns.method` / `ns.param` callees and turn
 * them into bogus `ns.method()(...)` auto-calls.
 */
export function isInlinedLazyCall(node: any): boolean {
    return !!node && node.type === 'CallExpression' && node._transformed === true && node._lazyOperand === true;
}

export function transformCallExpression(node: any, scopeManager: ScopeManager, namespace?: string): void {
    // Skip if this node has already been transformed
    if (node._transformed) {
        return;
    }

    // Calls sitting in a lazy operand (`?:` branch, or the right side of a
    // lazy `and`/`or` — see LazyOperandPass) must stay inline: hoisting them
    // into a `const temp_N = ...` ahead of the statement would evaluate them
    // unconditionally, e.g. running `array.get(a, 0)` even when the guard
    // `array.size(a) > 0` is false, or executing a stateful `ta.*` call on
    // bars where TradingView would skip it. Suppressing hoisting for the
    // duration of this call (arguments included) keeps every generated
    // `ns.param(...)` / nested call inside the branch expression.
    if (node._lazyOperand === true && !scopeManager.shouldSuppressHoisting()) {
        scopeManager.setSuppressHoisting(true);
        try {
            transformCallExpressionInner(node, scopeManager, namespace);
        } finally {
            scopeManager.setSuppressHoisting(false);
        }
        return;
    }

    transformCallExpressionInner(node, scopeManager, namespace);
}

function transformCallExpressionInner(node: any, scopeManager: ScopeManager, namespace?: string): void {
    if (node.callee && node.callee.name === 'kernel_matrix') {
        // console.log('Transforming kernel_matrix call');
        // console.log('Arguments before:', node.arguments.map((a: any) => a.name));
    }

    // Check if this is a direct call to a known namespace (e.g. input(...))
    if (
        node.callee &&
        node.callee.type === 'Identifier' &&
        (KNOWN_NAMESPACES.includes(node.callee.name) || NAMESPACES_LIKE.includes(node.callee.name)) &&
        scopeManager.isContextBound(node.callee.name)
    ) {
        // Transform to namespace.any(...)
        node.callee = ASTFactory.createMemberExpression(node.callee, ASTFactory.createIdentifier('any'));
        // Continue processing to handle arguments transformation
    }

    // Check if this is a namespace method call (e.g., ta.ema, math.abs)
    const isNamespaceCall =
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object &&
        node.callee.object.type === 'Identifier' &&
        (scopeManager.isContextBound(node.callee.object.name) || node.callee.object.name === 'math' || node.callee.object.name === 'ta');

    if (isNamespaceCall) {
        // Exclude internal context methods from parameter wrapping
        if (node.callee.object.name === CONTEXT_NAME && ['get', 'init', 'param'].includes(node.callee.property.name)) {
            return;
        }

        const namespace = node.callee.object.name;
        // Transform arguments using the namespace's param
        const newArgs: any[] = [];
        node.arguments.forEach((arg: any) => {
            // If argument is already a param call, don't wrap it again
            if (arg._isParamCall) {
                newArgs.push(arg);
                return;
            }
            newArgs.push(transformFunctionArgument(arg, namespace, scopeManager));
        });
        node.arguments = newArgs;

        // Inject a trailing `{ __callsiteId }` options object for calls that
        // opt in via CALLSITE_ID_NAMESPACES. Entries may be bare namespaces
        // ('plot' → matches plot.*) or fully-qualified namespace.method
        // ('strategy.exit' → that method only). The runtime helper
        // extractCallsiteId() pops the sentinel. See settings.ts for the
        // pattern's purpose and known unification gaps (alert, ta, etc).
        const methodNameForCallsite = node.callee.property.name;
        const fullPath = `${namespace}.${methodNameForCallsite}`;
        if (CALLSITE_ID_NAMESPACES.includes(namespace) || CALLSITE_ID_NAMESPACES.includes(fullPath)) {
            const callsiteId = scopeManager.getNextPlotCallId();
            node.arguments.push({
                type: 'ObjectExpression',
                properties: [{
                    type: 'Property',
                    key: { type: 'Identifier', name: '__callsiteId' },
                    value: callsiteId,
                    kind: 'init',
                    computed: false,
                    shorthand: false,
                }],
            });
        }

        // Inject a trailing `{ __varId }` sentinel on input.* calls that
        // initialize a variable (tagged by transformVariableDeclaration). The
        // runtime (parseInputOptions) pops it so `.input[varId]` overrides can
        // target this exact input — the primary override key, robust to empty
        // or duplicated titles. Added AFTER arg-wrapping so it stays a literal.
        if (namespace === 'input' && node._varId !== undefined) {
            node.arguments.push({
                type: 'ObjectExpression',
                properties: [{
                    type: 'Property',
                    key: { type: 'Identifier', name: '__varId' },
                    value: { type: 'Literal', value: node._varId },
                    kind: 'init',
                    computed: false,
                    shorthand: false,
                }],
            });
        }

        // Inject unique callsite ID for alert calls (per-callsite frequency gating)
        if (namespace === 'alert') {
            const callsiteId = scopeManager.getNextAlertCallId();
            node.arguments.push({
                type: 'ObjectExpression',
                properties: [{
                    type: 'Property',
                    key: { type: 'Identifier', name: '__callsiteId' },
                    value: callsiteId,
                    kind: 'init',
                    computed: false,
                    shorthand: false,
                }],
            });
        }

        // Inject unique call ID for TA functions to enable proper state management
        if (namespace === 'ta') {
            if (scopeManager.getCurrentScopeType() === 'fn') {
                // If inside a function, combine $$.id with the static ID
                const staticId = scopeManager.getNextTACallId();

                // Manually resolve $$ from scope to ensure it uses the scoped variable name
                const [localCtxName] = scopeManager.getVariable('$$');

                let leftOperand;
                if (localCtxName) {
                    // $$.id
                    leftOperand = ASTFactory.createMemberExpression(ASTFactory.createLocalContextIdentifier(), ASTFactory.createIdentifier('id'));
                } else {
                    // Fallback to empty string if not found (should not happen in valid PineTS)
                    leftOperand = ASTFactory.createLiteral('');
                }

                const callIdArg = {
                    type: 'BinaryExpression',
                    operator: '+',
                    left: leftOperand,
                    right: staticId,
                };
                node.arguments.push(callIdArg);
            } else {
                node.arguments.push(scopeManager.getNextTACallId());
            }
        }

        // Check if this is an async method call that needs await
        const methodName = node.callee.property.name;
        const methodPath = `${namespace}.${methodName}`;
        const isAsyncMethod = ASYNC_METHODS.includes(methodPath);

        // Check if already inside an await expression (marked by AwaitExpression handler)
        const isAlreadyAwaited = node._insideAwait === true;

        // If it's an async method and not already awaited, we need to wrap it
        if (isAsyncMethod && !isAlreadyAwaited) {
            // Create a copy of the current node state before wrapping
            const callExpressionCopy = Object.assign({}, node);
            // Wrap in AwaitExpression
            const awaitExpr = ASTFactory.createAwaitExpression(callExpressionCopy);
            // Replace the current node with the AwaitExpression
            Object.assign(node, awaitExpr);
        }

        if (!scopeManager.shouldSuppressHoisting()) {
            const tempVarName = scopeManager.generateTempVar();
            scopeManager.addLocalSeriesVar(tempVarName); // Mark as local series

            // Check if this CallExpression was inside an await expression
            const wasInsideAwait = node._insideAwait === true;

            // Create the variable declaration
            // If it was inside await, wrap the call in an AwaitExpression for the hoisted statement
            let initExpression = Object.assign({}, node);
            if (wasInsideAwait) {
                initExpression = ASTFactory.createAwaitExpression(initExpression);
            }

            const variableDecl = ASTFactory.createVariableDeclaration(tempVarName, initExpression);
            scopeManager.addHoistedStatement(variableDecl);

            // Replace the CallExpression with the temp variable identifier (no await here)
            const tempIdentifier = ASTFactory.createIdentifier(tempVarName);
            Object.assign(node, tempIdentifier);
            // Mark that this identifier came from hoisting AFTER Object.assign to ensure it's preserved
            node._wasHoisted = true;
            node._wasInsideAwait = wasInsideAwait; // Mark so parent AwaitExpression knows to remove itself
            // The original node is modified in place, so we don't need to return anything
            return;
        }

        node._transformed = true;
    }
    // Check if this is a regular function call (not a namespace method)
    else if (node.callee && node.callee.type === 'Identifier') {
        // Transform arguments using $.param
        node.arguments = node.arguments.map((arg: any) => {
            // If argument is already a param call, don't wrap it again
            if (arg._isParamCall) {
                return arg;
            }
            return transformFunctionArgument(arg, CONTEXT_NAME, scopeManager);
        });

        // Inject unique call ID for the function call only if it is a user-defined function
        // Built-in functions (like na, nz, bool) are context-bound and should not receive a call ID
        if (!scopeManager.isContextBound(node.callee.name)) {
            // Use $.call(fn, id, ...args) pattern
            const callId = scopeManager.getNextUserCallId();

            // Create $.call access
            const contextCall = ASTFactory.createMemberExpression(ASTFactory.createContextIdentifier(), ASTFactory.createIdentifier('call'));

            // Pine UFCS: a method `method foo(X this, ...)` can be called via
            // `foo(receiver, args)` as well as `obj.foo(args)`. When the Pine
            // name has NO regular function form (only the method), retarget
            // the direct-call callee to the `$M_` JS identifier — otherwise
            // `foo` is unbound at runtime ("foo is not defined"). When both
            // forms exist, the regular function takes precedence.
            const calleeName = node.callee.name;
            let fnRef: any = node.callee;
            if (scopeManager.isUserMethod(calleeName) && !scopeManager.isRegularUserFunction(calleeName)) {
                fnRef = ASTFactory.createIdentifier(`$M_${calleeName}`);
                fnRef._skipTransformation = true;
            }

            // Construct new arguments list: [originalFn, callId, ...originalArgs]
            const newArgs = [fnRef, callId, ...node.arguments];

            // Update node
            node.callee = contextCall;
            node.arguments = newArgs;
        }

        node._transformed = true;
    }

    // Handle method calls on local variables (e.g. arr.set())
    if (!isNamespaceCall && node.callee && node.callee.type === 'MemberExpression') {
        const methodName = node.callee.property.name;
        // Check if methodName is a user-defined function (and not a built-in property like push/pop/size unless shadowed?)
        const isUserFunction = scopeManager.isUserFunction(methodName);

        const _obj = node.callee.object;

        // Only allow obj.method(args) → method(obj, args) for functions declared
        // with the Pine `method` keyword.  Regular functions (without `method`)
        // must NOT be callable via dot-notation — obj.func() is always a built-in
        // method call on the object, never a call to a user-defined function.
        const isUserMethod = scopeManager.isUserMethod(methodName);

        // ── Receiver-type dispatch (TV semantics) ─────────────────────────
        // A user `method` wins over a built-in member when the receiver's
        // STATIC type matches the method's declared first-parameter type —
        // including name collisions with built-ins (`method cell(table tb,…)`
        // shadows `table.cell` for table receivers) and receivers that are
        // function params or UDT property chains.
        //
        // Static receiver type sources, in order:
        //   1. UDT instance registry (incl. scope-locally marked UDT params)
        //   2. Built-in static-type registry (explicit annotations via
        //      `__pineTypedVar:` markers, initializer inference like
        //      `table.new(...)`, scope-locally marked built-in-typed params)
        //   3. UDT field chains (`bs.is_equity.to_sparkline()`) via the UDT
        //      field-type metadata.
        //
        // The receiver may have already been wrapped into a `$.get(...)` call
        // by an earlier pass — but the original Identifier name is preserved
        // on the wrapper as `.name`, so a single lookup covers both shapes.
        let receiverBaseType: string | undefined;
        if (_obj.name) {
            receiverBaseType = scopeManager.getVariableUdtType(_obj.name) ?? scopeManager.getVarStaticType(_obj.name);
        } else if (_obj.type === 'MemberExpression' && !_obj.computed && _obj.property?.type === 'Identifier' && _obj.object?.name) {
            const baseUdtType = scopeManager.getVariableUdtType(_obj.object.name);
            if (baseUdtType) {
                const fieldType = scopeManager.getUdtTypeFields(baseUdtType)?.[_obj.property.name];
                receiverBaseType = normalizePineBaseType(fieldType);
            }
        }
        const methodReceiverType = scopeManager.getMethodReceiverType(methodName);
        const receiverTypeMatches = !!receiverBaseType && !!methodReceiverType && receiverBaseType === methodReceiverType;

        // UDT-instance dispatch (pre-existing rule, kept as a fallback for
        // methods whose declared receiver type could not be extracted): a
        // direct reference to a known UDT instance always dispatches to the
        // user method — UDT instances have no built-in members to call.
        // When neither rule applies (receiver type unknown/mismatched and
        // not a UDT instance), the call falls through to the built-in — a
        // name that merely collides with a user method must not hijack e.g.
        // `someLine.delete()`.
        const isReceiverUdtInstance = !!_obj.name && scopeManager.isUdtInstance(_obj.name);

        if (isUserFunction && isUserMethod && !scopeManager.isContextBound(methodName) && (receiverTypeMatches || isReceiverUdtInstance)) {
            // It's a user variable/function.
            // Transform obj.method(args) -> method(obj, args)
            // 1. Get the object (first arg)
            const obj = node.callee.object;
            // 2. Get the method name (function to call)
            const method = node.callee.property;
            
            // 3. Transform arguments
            const transformedArgs = node.arguments.map((arg: any) => {
                if (arg._isParamCall) return arg;
                return transformFunctionArgument(arg, CONTEXT_NAME, scopeManager);
            });

            // 4. Transform the object (it becomes the first argument)
            // We need to ensure it's properly scoped/wrapped if it's a variable
            // transformIdentifierForParam might be needed if it's an identifier
            let transformedObj = obj;
            if (obj.type === 'Identifier') {
                 // Use transformIdentifier logic but we need it as an argument
                 // transformFunctionArgument handles identifiers correctly
                 transformedObj = transformFunctionArgument(obj, CONTEXT_NAME, scopeManager);
            } else if (obj.type === 'CallExpression') {
                 // If object is a call expression, transform it first
                 transformCallExpression(obj, scopeManager);
                 transformedObj = transformFunctionArgument(obj, CONTEXT_NAME, scopeManager);
            } else if (obj.type === 'MemberExpression') {
                 // UDT field chain receiver (e.g. `bs.is_equity.to_sparkline()`)
                 transformedObj = transformFunctionArgument(obj, CONTEXT_NAME, scopeManager);
            }

            // 5. Construct the new call: method(obj, ...args)
            // We need to use $.call(method, id, obj, ...args) pattern because it's a user function
            
            // Create $.call access
            const contextCall = ASTFactory.createMemberExpression(ASTFactory.createContextIdentifier(), ASTFactory.createIdentifier('call'));
            const callId = scopeManager.getNextUserCallId();

            // The method identifier needs to be transformed to its scoped name if necessary
            // But here 'method' is just the property name node. We need an Identifier for the function.
            // Methods are emitted with a `$M_` prefix on their JS name to avoid
            // collision with regular functions of the same Pine name. Resolve
            // the call against the prefixed JS identifier.
            // Mark with _skipTransformation to prevent the identifier from being resolved
            // to a same-named variable (e.g. `isSame2` function vs `isSame2` variable).
            const functionRef = ASTFactory.createIdentifier(`$M_${methodName}`);
            functionRef._skipTransformation = true;

            const newArgs = [functionRef, callId, transformedObj, ...transformedArgs];

            node.callee = contextCall;
            node.arguments = newArgs;
            node._transformed = true;
            return;
        }

        if (node.callee.object.type === 'Identifier') {
            transformIdentifier(node.callee.object, scopeManager);
        } else {
            // For complex callee chains (e.g. obj.get(i).out.method()),
            // recursively resolve inner identifiers and calls
            resolveCalleeObject(node.callee.object, node.callee, scopeManager);
        }

    }

    // Transform any nested call expressions in the arguments
    node.arguments.forEach((arg: any) => {
        walk.recursive(
            arg,
            { parent: node },
            {
                Identifier(node: any, state: any, c: any) {
                    node.parent = state.parent;
                    transformIdentifier(node, scopeManager);
                    const isBinaryOperation = node.parent && node.parent.type === 'BinaryExpression';
                    const isConditional = node.parent && node.parent.type === 'ConditionalExpression';

                    if (isConditional || isBinaryOperation) {
                        if (node.type === 'MemberExpression') {
                            transformArrayIndex(node, scopeManager);
                        } else if (node.type === 'Identifier') {
                            // Skip addArrayAccess if the identifier is already inside a $.get call
                            const isGetCall =
                                node.parent &&
                                node.parent.type === 'CallExpression' &&
                                node.parent.callee &&
                                node.parent.callee.object &&
                                node.parent.callee.object.name === CONTEXT_NAME &&
                                node.parent.callee.property.name === 'get';

                            if (!isGetCall) {
                                addArrayAccess(node, scopeManager);
                            }
                        }
                    }
                },
                BinaryExpression(node: any, state: any, c: any) {
                    const newState = { ...state, parent: node };
                    c(node.left, newState);
                    c(node.right, newState);
                },
                LogicalExpression(node: any, state: any, c: any) {
                    const newState = { ...state, parent: node };
                    c(node.left, newState);
                    c(node.right, newState);
                },
                UnaryExpression(node: any, state: any, c: any) {
                    const newState = { ...state, parent: node };
                    c(node.argument, newState);
                },
                CallExpression(node: any, state: any, c: any) {
                    // Traverse callee chain to resolve inner identifiers (e.g. obj.get(i).out.avg())
                    if (node.callee && node.callee.type === 'MemberExpression' && node.callee.object) {
                        node.callee.object.parent = node.callee;
                        c(node.callee.object, { parent: node.callee });
                    }
                    if (!node._transformed) {
                        // First transform the call expression itself
                        transformCallExpression(node, scopeManager);
                    }
                },
                MemberExpression(node: any, state: any, c: any) {
                    transformMemberExpression(node, '', scopeManager);
                    // Then continue with object transformation
                    if (node.object) {
                        c(node.object, { parent: node });
                    }
                },
            }
        );
    });

    // ---------------------------------------------------------------------------
    // Optional chaining for method calls on values retrieved via $.get().
    //
    // In Pine Script, calling methods on `na` (e.g. `na.delete()`, `na.set_x1()`)
    // is a silent no-op. At runtime, `na` is represented as NaN. Since NaN is not
    // null/undefined, single optional chaining (`NaN?.method()`) still crashes
    // because `NaN.method` evaluates to `undefined`, then `undefined()` throws.
    // Double optional chaining (`NaN?.method?.()`) is needed:
    //   NaN?.method  → undefined  (NaN is not nullish, so .method is accessed → undefined)
    //   undefined?.() → undefined (short-circuits, no crash)
    //
    // Two cases are handled:
    //
    // 1) Direct: $.get(X, N).method()  →  $.get(X, N)?.method?.()
    //    Occurs when a `var` drawing variable is initialized to `na`:
    //      var polyline profilePoly = na   →  $.initVar($.var.glb1_profilePoly, NaN)
    //      profilePoly.delete()            →  $.get($.var.glb1_profilePoly, 0).delete()
    //    $.get() returns NaN, and .delete() on NaN throws without optional chaining.
    //
    // 2) Chained: $.get(X, N).field.method()  →  $.get(X, N).field?.method?.()
    //    Occurs when a UDT drawing field is `na`:
    //      myUDT.boxField.delete()  →  $.get(udt, 0).boxField.delete()
    //    The field resolves to NaN, same issue.
    //
    // NOTE: This must run AFTER argument transformation so that the callee is
    // still a MemberExpression when argument type checks inspect it.
    //
    // CRITICAL — DO NOT broaden this condition to `hasGetCallInChain(node.callee)`.
    // That matches intermediate calls (e.g. `$.get(arr,0).get(0)` in
    // `arr.get(0).field.method()`) instead of the LEAF method call. Once an
    // intermediate call is wrapped in ChainExpression, the leaf call can no
    // longer find $.get() in its chain and misses optional chaining entirely.
    // The two cases below are intentionally separated:
    //   Case 1: callee.object IS the $.get() call directly  (direct pattern)
    //   Case 2: callee.object is a MemberExpression with $.get() deeper in chain (chained pattern)
    // ---------------------------------------------------------------------------
    if (node.callee && node.callee.type === 'MemberExpression') {
        const calleeObj = node.callee.object;
        // Case 1 — Direct: $.get(X, N).method()
        //   callee.object is the $.get() CallExpression itself
        const isDirect = isDirectGetCall(calleeObj);
        // Case 2 — Chained: $.get(X, N).field.method()
        //   callee.object is a MemberExpression (the .field access), with $.get() deeper
        const isChained = calleeObj?.type === 'MemberExpression' && hasGetCallInChain(calleeObj);

        if (isDirect || isChained) {
            // Double optional chaining: obj?.method?.()
            // The node stays as a CallExpression (safe for AST walkers) but gets:
            //   1. optional: true on the CallExpression  → produces ?.()
            //   2. optional: true on the MemberExpression → produces ?.method
            //   3. callee wrapped in ChainExpression      → groups the chain for astring
            const innerCallee = Object.assign({}, node.callee, { optional: true });
            node.callee = { type: 'ChainExpression', expression: innerCallee };
            node.optional = true;
        }
    }
}
