// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import * as walk from 'acorn-walk';
import ScopeManager from '../analysis/ScopeManager';
import { ASTFactory, CONTEXT_NAME } from '../utils/ASTFactory';
import { NAMESPACES_LIKE, FACTORY_METHODS } from '../settings';
import {
    transformIdentifier,
    transformCallExpression,
    isInlinedLazyCall,
    transformMemberExpression,
    transformArrayIndex,
    addArrayAccess,
    createScopedVariableReference,
    createScopedVariableAccess,
} from './ExpressionTransformer';

/**
 * Creates the AST nodes for a loop guard:
 * 1. A counter declaration: `let __lgN = 0;` (to be hoisted before the loop)
 * 2. A guard check: `if (++__lgN > __maxLoops) throw new Error("Loop exceeded maximum iterations (__lgN)");`
 *    (to be prepended to the loop body)
 */
export function createLoopGuardNodes(guardName: string): { counterDecl: any; guardCheck: any } {
    // let __lgN = 0;
    const counterDecl = {
        type: 'VariableDeclaration',
        kind: 'let',
        declarations: [{
            type: 'VariableDeclarator',
            id: { type: 'Identifier', name: guardName },
            init: { type: 'Literal', value: 0 },
        }],
    };

    // if (++__lgN > __maxLoops) throw new Error("Loop exceeded maximum iterations (__lgN)");
    const guardCheck = {
        type: 'IfStatement',
        test: {
            type: 'BinaryExpression',
            operator: '>',
            // Generated loop-counter guard: operands are never `na`, so keep it
            // a native `>` (transformEqualityChecks skips `_skipCompare` nodes).
            _skipCompare: true,
            left: {
                type: 'UpdateExpression',
                operator: '++',
                prefix: true,
                argument: { type: 'Identifier', name: guardName },
            },
            right: { type: 'Identifier', name: '__maxLoops' },
        },
        consequent: {
            type: 'ThrowStatement',
            argument: {
                type: 'NewExpression',
                callee: { type: 'Identifier', name: 'Error' },
                arguments: [{
                    type: 'Literal',
                    value: `Loop exceeded maximum iterations (${guardName})`,
                }],
            },
        },
        alternate: null,
    };

    return { counterDecl, guardCheck };
}

export function transformAssignmentExpression(node: any, scopeManager: ScopeManager): void {
    let targetVarRef = null;
    // Transform assignment expressions to use the context object
    if (node.left.type === 'Identifier') {
        targetVarRef = createScopedVariableReference(node.left.name, scopeManager);
    } else if (node.left.type === 'MemberExpression' && node.left.computed) {
        // Assignment to array element: series[0] = val
        if (node.left.object.type === 'Identifier') {
            const name = node.left.object.name;
            const [varName, kind] = scopeManager.getVariable(name);
            const isRenamed = varName !== name;
            const isContextBound = scopeManager.isContextBound(name);

            if ((isRenamed || isContextBound) && !scopeManager.isLoopVariable(name)) {
                // If index is 0 (literal), transform to $.set(target, value)
                if (node.left.property.type === 'Literal' && node.left.property.value === 0) {
                    targetVarRef = createScopedVariableReference(name, scopeManager);
                }
            }
        }
    } else if (node.left.type === 'MemberExpression' && !node.left.computed) {
        // Assignment to object property: obj.property = val  OR  obj.a.b = val (nested)
        // Walk the member expression chain to find the root Identifier and transform it
        let rootOwner: any = null; // the node whose .object is the root Identifier
        let cursor = node.left;
        while (cursor.type === 'MemberExpression' && !cursor.computed) {
            if (cursor.object.type === 'Identifier') {
                rootOwner = cursor;
                break;
            }
            cursor = cursor.object;
        }

        if (rootOwner) {
            const name = rootOwner.object.name;
            const [varName, kind] = scopeManager.getVariable(name);
            const isRenamed = varName !== name;

            // Only transform if the variable has been renamed (i.e., it's a user-defined variable)
            // Context-bound variables that are NOT renamed (like 'display', 'ta', 'input') should NOT be transformed
            if (isRenamed && !scopeManager.isLoopVariable(name)) {
                // Transform root object to scoped variable reference with [0] access
                // trade2.active = false       ->  $.get($.let.glb1_trade2, 0).active = false
                // _outer.inner.value = close  ->  $.get($.var.glb1__outer, 0).inner.value = close
                const contextVarRef = createScopedVariableReference(name, scopeManager);
                const getCall = ASTFactory.createGetCall(contextVarRef, 0);
                rootOwner.object = getCall;
            }
            // Function parameters (local series vars) also need unwrapping for UDT field assignment:
            // w.val = x  →  $.get(w, 0).val = x
            else if (scopeManager.isLocalSeriesVar(name)) {
                const plainId = ASTFactory.createIdentifier(name);
                plainId._skipTransformation = true;
                rootOwner.object = ASTFactory.createGetCall(plainId, 0);
            }
        }
    }

    // Transform identifiers in the right side of the assignment
    walk.recursive(
        node.right,
        { parent: node.right, inNamespaceCall: false },
        {
            Identifier(node: any, state: any, c: any) {
                // Don't unwrap when the identifier is a namespace base in a
                // constant access like `label.style_label_down`. NAMESPACES_LIKE
                // mixes Series-wrapper names (time, na, dayofweek, …) with
                // drawing namespaces (label, line, box, …); only the former
                // have a .__value Series. For a member access where this
                // identifier is the object, treat it as a plain namespace base.
                const isNamespaceBase =
                    state.parent &&
                    state.parent.type === 'MemberExpression' &&
                    !state.parent.computed &&
                    state.parent.object === node;

                // Rewrite NAMESPACES_LIKE entries (na, time, etc.) to $.get(__value, 0)
                if (NAMESPACES_LIKE.includes(node.name) && scopeManager.isContextBound(node.name) && !isNamespaceBase) {
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
                const isContextBound = scopeManager.isContextBound(node.name) && !scopeManager.isRootParam(node.name);
                const hasArrayAccess = node.parent && node.parent.type === 'MemberExpression' && node.parent.computed && node.parent.object === node;
                const isParamCall = node.parent && node.parent._isParamCall;
                const isMemberExpression = node.parent && node.parent.type === 'MemberExpression';
                const isReserved = node.name === 'NaN';
                const isGetCall =
                    node.parent &&
                    node.parent.type === 'CallExpression' &&
                    node.parent.callee &&
                    node.parent.callee.object &&
                    node.parent.callee.object.name === CONTEXT_NAME &&
                    node.parent.callee.property.name === 'get';

                if (isContextBound || isConditional || isBinaryOperation) {
                    if (node.type === 'MemberExpression') {
                        transformArrayIndex(node, scopeManager);
                    } else if (node.type === 'Identifier' && !isMemberExpression && !hasArrayAccess && !isParamCall && !isReserved && !isGetCall) {
                        addArrayAccess(node, scopeManager);
                    }
                }
            },
            MemberExpression(node: any, state: any, c: any) {
                transformMemberExpression(node, '', scopeManager);
                // Then continue with object transformation or arguments if transformed to CallExpression
                if (node.type === 'CallExpression') {
                    node.arguments.forEach((arg: any) => c(arg, { parent: node, inNamespaceCall: state.inNamespaceCall }));
                } else if (node.object) {
                    c(node.object, { parent: node, inNamespaceCall: state.inNamespaceCall });
                }
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

                if (node.type !== 'CallExpression' || isInlinedLazyCall(node)) return;

                // Traverse the callee if it's a MemberExpression (to handle obj.method())
                if (node.callee.type === 'MemberExpression') {
                    c(node.callee, { parent: node, inNamespaceCall: isNamespaceCall || state.inNamespaceCall });
                }

                // Then transform its arguments with the correct context
                node.arguments.forEach((arg: any) => c(arg, { parent: node, inNamespaceCall: isNamespaceCall || state.inNamespaceCall }));
            },
        }
    );

    if (targetVarRef) {
        let rightSide = node.right;

        // Handle compound assignment operators (+=, -=, *=, etc.)
        if (node.operator !== '=') {
            const operator = node.operator.replace('=', '');

            // Create a read access for the target variable: $.get(targetVarRef, 0)
            const readAccess = ASTFactory.createGetCall(targetVarRef, 0);

            // Create a binary expression: readAccess [op] node.right
            // Example: a += 10  ->  $.set(a, $.get(a, 0) + 10)
            rightSide = {
                type: 'BinaryExpression',
                operator: operator,
                left: readAccess,
                right: node.right,
                start: node.start,
                end: node.end,
            };
        }

        // Replace the whole assignment expression with $.set(targetVarRef, rightSide)
        const setCall = ASTFactory.createSetCall(targetVarRef, rightSide);

        // Preserve location
        if (node.start) setCall.start = node.start;
        if (node.end) setCall.end = node.end;

        Object.assign(node, setCall);
    }
}

export function transformVariableDeclaration(varNode: any, scopeManager: ScopeManager): void {
    if (varNode._skipTransformation) return;

    varNode.declarations.forEach((decl: any) => {
        // Tag `name = input.*(…)` / `name = input(…)` with the assigned
        // variable name, BEFORE any rename, so transformCallExpression can
        // inject it as a `{ __varId }` sentinel on the input call. This is the
        // runtime handle that lets `.input[varId]` overrides target a specific
        // input even when titles are empty or duplicated.
        if (decl.init?.type === 'CallExpression' && decl.id?.type === 'Identifier') {
            const c = decl.init.callee;
            const isInputCall =
                (c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && c.object.name === 'input') ||
                (c?.type === 'Identifier' && c.name === 'input');
            if (isInputCall) decl.init._varId = decl.id.name;
        }

        // Rewrite NAMESPACES_LIKE entries (na, time, etc.) to .__value in variable initializers
        if (decl.init && decl.init.type === 'Identifier' && NAMESPACES_LIKE.includes(decl.init.name) && scopeManager.isContextBound(decl.init.name)) {
            const originalName = decl.init.name;
            Object.assign(decl.init, {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: originalName },
                property: { type: 'Identifier', name: '__value' },
                computed: false,
            });
            delete decl.init.name;
        }

        // Check if this is a context property assignment

        // prettier-ignore
        const isContextProperty =
            decl.init &&
            decl.init.type === 'MemberExpression' &&
            decl.init.object &&            
                (decl.init.object.name === 'context' || 
                    decl.init.object.name === CONTEXT_NAME || 
                    decl.init.object.name === 'context2')

        // prettier-ignore
        const isSubContextProperty =
            decl.init &&
            decl.init.type === 'MemberExpression' &&
            decl.init.object?.object &&
            (decl.init.object.object.name === 'context' ||
                decl.init.object.object.name === CONTEXT_NAME ||
                decl.init.object.object.name === 'context2');

        // Check if this is an arrow function declaration
        const isArrowFunction = decl.init && decl.init.type === 'ArrowFunctionExpression';

        if (isContextProperty) {
            // For context properties, register as context-bound and update the object name
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
            decl.init.object.name = CONTEXT_NAME;
            return;
        }

        if (isSubContextProperty) {
            // For context properties, register as context-bound and update the object name
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
            decl.init.object.object.name = CONTEXT_NAME;
            return;
        }

        // Note: Arrow function parameters are already registered in AnalysisPass
        // No need to register them again here

        // Transform non-context variables to use the context object
        const newName = scopeManager.addVariable(decl.id.name, varNode.kind);
        const kind = varNode.kind; // 'const', 'let', or 'var'

        // Only treat as an array pattern variable when it actually has the destructured
        // MemberExpression shape (e.g. _tmp_0[0]) from the AnalysisPass rewrite.
        // The arrayPatternElements set is global (not scoped), so a same-named variable
        // inside a function body may be falsely flagged — guard with a shape check.
        const isArrayPatternVar =
            scopeManager.isArrayPatternElement(decl.id.name) &&
            decl.init &&
            decl.init.type === 'MemberExpression' &&
            decl.init.computed;

        // Transform identifiers in the init expression
        if (decl.init && !isArrowFunction && !isArrayPatternVar) {
            // Check if initialization is a namespace function call
            if (
                decl.init.type === 'CallExpression' &&
                decl.init.callee.type === 'MemberExpression' &&
                decl.init.callee.object &&
                decl.init.callee.object.type === 'Identifier' &&
                scopeManager.isContextBound(decl.init.callee.object.name)
            ) {
                // Transform the function call arguments
                transformCallExpression(decl.init, scopeManager);
            } else {
                // Add parent references for proper function call detection
                walk.recursive(
                    decl.init,
                    { parent: decl.init },
                    {
                        Identifier(node: any, state: any) {
                            node.parent = state.parent;
                            transformIdentifier(node, scopeManager);

                            const isBinaryOperation = node.parent && node.parent.type === 'BinaryExpression';
                            const isUnaryOperation = node.parent && node.parent.type === 'UnaryExpression';
                            const isConditional = node.parent && node.parent.type === 'ConditionalExpression';
                            const isGetCall =
                                node.parent &&
                                node.parent.type === 'CallExpression' &&
                                node.parent.callee &&
                                node.parent.callee.object &&
                                node.parent.callee.object.name === CONTEXT_NAME &&
                                node.parent.callee.property.name === 'get';

                            if (node.type === 'Identifier' && (isBinaryOperation || isUnaryOperation || isConditional) && !isGetCall) {
                                addArrayAccess(node, scopeManager);
                            }
                        },
                        CallExpression(node: any, state: any, c: any) {
                            // Set parent for the function name
                            if (node.callee.type === 'Identifier') {
                                node.callee.parent = node;
                            }
                            // Set parent for arguments
                            node.arguments.forEach((arg: any) => {
                                if (arg.type === 'Identifier') {
                                    arg.parent = node;
                                }
                            });

                            // If the callee is an IIFE (ArrowFunctionExpression or FunctionExpression), traverse it
                            if (node.callee.type === 'ArrowFunctionExpression' || node.callee.type === 'FunctionExpression') {
                                c(node.callee, { parent: node });
                            }

                            transformCallExpression(node, scopeManager);

                            if (node.type !== 'CallExpression' || isInlinedLazyCall(node)) return;

                            // Traverse the callee if it's a MemberExpression (to handle obj.method())
                            if (node.callee.type === 'MemberExpression') {
                                c(node.callee, { parent: node });
                            }

                            // Continue walking the arguments
                            node.arguments.forEach((arg) => c(arg, { parent: node }));
                        },
                        BinaryExpression(node: any, state: any, c: any) {
                            // Set parent references for operands
                            if (node.left.type === 'Identifier') {
                                node.left.parent = node;
                            }
                            if (node.right.type === 'Identifier') {
                                node.right.parent = node;
                            }
                            // Transform both operands
                            c(node.left, { parent: node });
                            c(node.right, { parent: node });
                        },
                        // LogicalExpression (`and`/`or`) and UnaryExpression
                        // (`not`/unary `-`) need explicit visitors here so the
                        // parent reference threaded into their children is the
                        // expression itself — not the surrounding decl.init.
                        // Without this, an Identifier inside `not a and not b`
                        // sees state.parent === LogicalExpression instead of
                        // UnaryExpression, the "unwrap as series-operand" path
                        // never fires, and the JS emits `!a && !b` (always
                        // false because `a`/`b` are Series objects).
                        LogicalExpression(node: any, state: any, c: any) {
                            if (node.left.type === 'Identifier') node.left.parent = node;
                            if (node.right.type === 'Identifier') node.right.parent = node;
                            c(node.left, { parent: node });
                            c(node.right, { parent: node });
                        },
                        UnaryExpression(node: any, state: any, c: any) {
                            if (node.argument.type === 'Identifier') node.argument.parent = node;
                            c(node.argument, { parent: node });
                        },
                        MemberExpression(node: any, state: any, c: any) {
                            // Set parent reference
                            if (node.object && node.object.type === 'Identifier') {
                                node.object.parent = node;
                            }
                            if (node.property && node.property.type === 'Identifier') {
                                node.property.parent = node;
                            }
                            // Transform array indices first
                            transformMemberExpression(node, '', scopeManager);
                            // Then continue with object transformation
                            if (node.type === 'CallExpression') {
                                node.arguments.forEach((arg: any) => c(arg, { parent: node }));
                            } else if (node.object) {
                                c(node.object, { parent: node });
                            }
                        },
                        AwaitExpression(node: any, state: any, c: any) {
                            // Mark the argument as being inside an await
                            if (node.argument) {
                                node.argument._insideAwait = true;

                                // Transform the argument
                                c(node.argument, { parent: node });

                                // After transformation, if the argument was hoisted and is now an identifier,
                                // remove the await since it's already in the hoisted statement
                                if (node.argument.type === 'Identifier' && node.argument._wasInsideAwait) {
                                    // Replace the AwaitExpression with just the identifier
                                    Object.assign(node, node.argument);
                                }
                            }
                        },
                        ArrowFunctionExpression(node: any, state: any, c: any) {
                            // For IIFE arrow functions, manage hoisting like BlockStatement does
                            // This prevents hoisted statements from escaping to the outer scope
                            if (node.body) {
                                if (node.body.type === 'BlockStatement') {
                                    // Process each statement with its own hoisting scope
                                    const newBody: any[] = [];
                                    node.body.body.forEach((stmt: any) => {
                                        scopeManager.enterHoistingScope();
                                        c(stmt, { parent: node.body, insideIIFE: true });
                                        const hoistedStmts = scopeManager.exitHoistingScope();
                                        newBody.push(...hoistedStmts);
                                        newBody.push(stmt);
                                    });
                                    node.body.body = newBody;
                                } else {
                                    // For expression body, traverse the expression
                                    c(node.body, { parent: node, insideIIFE: true });
                                }
                            }
                        },
                        FunctionExpression(node: any, state: any, c: any) {
                            // For IIFE function expressions, manage hoisting like BlockStatement does
                            if (node.body && node.body.type === 'BlockStatement') {
                                const newBody: any[] = [];
                                node.body.body.forEach((stmt: any) => {
                                    scopeManager.enterHoistingScope();
                                    c(stmt, { parent: node.body, insideIIFE: true });
                                    const hoistedStmts = scopeManager.exitHoistingScope();
                                    newBody.push(...hoistedStmts);
                                    newBody.push(stmt);
                                });
                                node.body.body = newBody;
                            }
                        },
                        BlockStatement(node: any, state: any, c: any) {
                            // Nested blocks inside an IIFE (the `if`/`else` bodies that a Pine
                            // `switch` or multi-line `if` expression compiles to) need their own
                            // per-statement hoisting scope, exactly like the IIFE body above and
                            // the BlockStatement handlers of the return-statement / arrow-body
                            // walkers. Without it, `if (c) { return array.get(a, 0) }` hoists the
                            // `array.get` temp to the IIFE body, ahead of the `if`, so the untaken
                            // branch is evaluated anyway (and throws on an empty array).
                            const newBody: any[] = [];
                            node.body.forEach((stmt: any) => {
                                scopeManager.enterHoistingScope();
                                c(stmt, { ...state, parent: node });
                                const hoistedStmts = scopeManager.exitHoistingScope();
                                newBody.push(...hoistedStmts);
                                newBody.push(stmt);
                            });
                            node.body = newBody;
                        },
                        SwitchStatement(node: any, state: any, c: any) {
                            // Traverse discriminant and all cases
                            if (node.discriminant) {
                                node.discriminant.parent = node;
                                c(node.discriminant, { parent: node });
                            }
                            if (node.cases) {
                                node.cases.forEach((caseNode: any) => {
                                    caseNode.parent = node;
                                    c(caseNode, { parent: node });
                                });
                            }
                        },
                        SwitchCase(node: any, state: any, c: any) {
                            // Traverse test (the case value)
                            if (node.test) {
                                node.test.parent = node;
                                c(node.test, { parent: node });
                            }
                            // Traverse all consequent statements with hoisting management
                            if (node.consequent) {
                                const newConsequent: any[] = [];
                                node.consequent.forEach((stmt: any) => {
                                    scopeManager.enterHoistingScope();
                                    stmt.parent = node;
                                    c(stmt, { parent: node });
                                    const hoistedStmts = scopeManager.exitHoistingScope();
                                    newConsequent.push(...hoistedStmts);
                                    newConsequent.push(stmt);
                                });
                                node.consequent = newConsequent;
                            }
                        },
                        AssignmentExpression(node: any, state: any, c: any) {
                            // Only transform assignment expressions inside IIFEs (e.g., while/for-as-expression)
                            // Don't transform assignments used as sub-expressions in normal initializers
                            // (e.g., let result = (val = 10) + 5 — the (val = 10) must remain a JS assignment)
                            if (!state.insideIIFE) return;

                            // Skip local IIFE variables (like __result) that aren't registered Pine Script vars
                            if (node.left.type === 'Identifier') {
                                const [scopedName] = scopeManager.getVariable(node.left.name);
                                if (scopedName === node.left.name && !scopeManager.isContextBound(node.left.name)) {
                                    // Unknown local variable — don't transform the assignment,
                                    // but still traverse the right-hand side for identifier transformations
                                    c(node.right, { parent: node });
                                    return;
                                }
                            }
                            transformAssignmentExpression(node, scopeManager);
                        },
                    }
                );
            }
        }

        // Create the target variable reference using ASTFactory
        const targetVarRef = createScopedVariableReference(decl.id.name, scopeManager);

        // Check if initialization is from array access
        const isArrayInit =
            !isArrayPatternVar &&
            decl.init &&
            decl.init.type === 'MemberExpression' &&
            decl.init.computed &&
            decl.init.property &&
            (decl.init.property.type === 'Literal' || decl.init.property.type === 'MemberExpression');

        if (decl.init?.property?.type === 'MemberExpression') {
            if (!decl.init.property._indexTransformed) {
                transformArrayIndex(decl.init.property, scopeManager);
                decl.init.property._indexTransformed = true;
            }
        }

        // For `var` declarations, wrap any hoisted factory method calls in arrow
        // functions so they are only evaluated on bar 0 (deferred via initVar thunk).
        // This prevents side effects (e.g. line.new() creating orphan objects) from
        // firing on every bar when the result is discarded by initVar on bars 1+.
        if (kind === 'var') {
            const hoistingScope = scopeManager.getCurrentHoistingScope();
            if (hoistingScope) {
                for (const stmt of hoistingScope) {
                    if (stmt.type !== 'VariableDeclaration') continue;
                    for (const d of stmt.declarations) {
                        if (!d.init || d.init.type !== 'CallExpression') continue;
                        const callee = d.init.callee;
                        if (callee?.type !== 'MemberExpression') continue;

                        let namespaceName: string | undefined;
                        const methodName = callee.property?.name;

                        // Match untransformed form: line.new(...)
                        // callee = MemberExpression(Identifier('line'), Identifier('new'))
                        if (callee.object?.type === 'Identifier') {
                            namespaceName = callee.object.name;
                        }
                        // Match transformed form: $.pine.line.new(...)
                        // callee = MemberExpression(MemberExpression(..., 'line'), Identifier('new'))
                        else if (callee.object?.type === 'MemberExpression' && callee.object.property?.name) {
                            namespaceName = callee.object.property.name;
                        }

                        if (namespaceName && methodName) {
                            const methodPath = `${namespaceName}.${methodName}`;
                            if (FACTORY_METHODS.includes(methodPath)) {
                                // Wrap: `const temp = call(...)` → `const temp = () => call(...)`
                                d.init = {
                                    type: 'ArrowFunctionExpression',
                                    params: [],
                                    body: d.init,
                                    expression: true,
                                    async: false,
                                };
                            }
                        }
                    }
                }
            }
        }

        // Prepare right side
        let rightSide;
        if (decl.init) {
            if (isArrowFunction || isArrayPatternVar) {
                rightSide = decl.init;
            } else if (kind === 'var') {
                rightSide = ASTFactory.createInitVarCall(targetVarRef, decl.init);
            } else {
                rightSide = ASTFactory.createInitCall(
                    targetVarRef,
                    isArrayInit ? decl.init.object : decl.init,
                    isArrayInit ? decl.init.property : undefined
                );
            }
        } else {
            rightSide = ASTFactory.createIdentifier('undefined');
        }

        // Create assignment
        const assignmentExpr = ASTFactory.createExpressionStatement(ASTFactory.createAssignmentExpression(targetVarRef, rightSide));

        if (isArrayPatternVar) {
            // For array pattern destructuring, we need to:
            // 1. Use $.get(tempVar, 0) to get the current value from the Series
            // 2. Then access the array element [index]

            const tempVarName = decl.init.object.name;
            const tempVarRef = createScopedVariableReference(tempVarName, scopeManager);
            const arrayIndex = decl.init.property.value;

            // Create $.get(tempVar, 0)[index]
            const getCall = ASTFactory.createGetCall(tempVarRef, 0);
            const arrayAccess = {
                type: 'MemberExpression',
                object: getCall,
                property: {
                    type: 'Literal',
                    value: arrayIndex,
                },
                computed: true,
            };

            // Wrap in $.init(targetVar, $.get(tempVar, 0)[index])
            assignmentExpr.expression.right = ASTFactory.createCallExpression(
                ASTFactory.createMemberExpression(ASTFactory.createContextIdentifier(), ASTFactory.createIdentifier('init')),
                [targetVarRef, arrayAccess]
            );
        }

        if (isArrowFunction) {
            // Transform the body of arrow functions
            scopeManager.pushScope('fn');
            walk.recursive(decl.init.body, scopeManager, {
                IfStatement(node: any, state: ScopeManager, c: any) {
                    state.pushScope('if');
                    // Transform the test condition. Without this, an if-test
                    // inside an arrow-function body never gets walked — the
                    // function-arg-unwrap path is skipped, and patterns like
                    // `if not a and not b` (very common in Pine) emit JS
                    // `if (!a && !b)` where `a`/`b` are Series objects (always
                    // truthy → `!Series === false` → branch never taken).
                    if (node.test) {
                        transformExpression(node.test, state);
                    }
                    c(node.consequent, state);
                    if (node.alternate) {
                        state.pushScope('els');
                        c(node.alternate, state);
                        state.popScope();
                    }
                    state.popScope();
                },
                VariableDeclaration(node: any, state: ScopeManager) {
                    transformVariableDeclaration(node, state);
                },
                Identifier(node: any, state: ScopeManager) {
                    transformIdentifier(node, state);
                },
                AssignmentExpression(node: any, state: ScopeManager) {
                    transformAssignmentExpression(node, state);
                },
                SwitchStatement(node: any, state: ScopeManager, c: any) {
                    node.discriminant.parent = node;
                    c(node.discriminant, state);
                    node.cases.forEach((caseNode: any) => {
                        caseNode.parent = node;
                        c(caseNode, state);
                    });
                },
                SwitchCase(node: any, state: ScopeManager, c: any) {
                    if (node.test) {
                        node.test.parent = node;
                        c(node.test, state);
                    }
                    const newConsequent: any[] = [];
                    node.consequent.forEach((stmt: any) => {
                        state.enterHoistingScope();
                        c(stmt, state);
                        const hoistedStmts = state.exitHoistingScope();
                        newConsequent.push(...hoistedStmts);
                        newConsequent.push(stmt);
                    });
                    node.consequent = newConsequent;
                },
                BlockStatement(node: any, state: ScopeManager, c: any) {
                    const newBody: any[] = [];
                    node.body.forEach((stmt: any) => {
                        state.enterHoistingScope();
                        c(stmt, state);
                        const hoistedStmts = state.exitHoistingScope();
                        newBody.push(...hoistedStmts);
                        newBody.push(stmt);
                    });
                    node.body = newBody;
                },
            });
            scopeManager.popScope();
        }

        // Replace the original node with the transformed assignment
        Object.assign(varNode, assignmentExpr);
    });
}

export function transformForStatement(node: any, scopeManager: ScopeManager, c: any): void {
    scopeManager.setSuppressHoisting(true);
    // Handle initialization
    if (node.init && node.init.type === 'VariableDeclaration') {
        // Keep the original loop variable name
        const decl = node.init.declarations[0];
        const originalName = decl.id.name;
        scopeManager.addLoopVariable(originalName, originalName);

        // Keep the original variable declaration
        node.init = {
            type: 'VariableDeclaration',
            kind: node.init.kind,
            declarations: [
                {
                    type: 'VariableDeclarator',
                    id: {
                        type: 'Identifier',
                        name: originalName,
                    },
                    init: decl.init,
                },
            ],
        };

        // Transform any identifiers in the init expression
        // Must wrap Series identifiers in $.get() so the loop variable receives
        // the concrete value, not a raw Series object (e.g. `for i = bar_index to 0`).
        if (decl.init) {
            walk.recursive(decl.init, scopeManager, {
                Identifier(node: any, state: ScopeManager) {
                    if (!scopeManager.isLoopVariable(node.name) && !node.computed) {
                        scopeManager.pushScope('for');
                        transformIdentifier(node, state);
                        if (node.type === 'Identifier') {
                            const isNamespaceObject =
                                scopeManager.isContextBound(node.name) &&
                                node.parent &&
                                node.parent.type === 'MemberExpression' &&
                                node.parent.object === node;
                            if (!isNamespaceObject) {
                                node.computed = true;
                                addArrayAccess(node, state);
                            }
                        }
                        scopeManager.popScope();
                    }
                },
                MemberExpression(node: any, state: ScopeManager, c: any) {
                    scopeManager.pushScope('for');
                    transformMemberExpression(node, '', scopeManager);
                    scopeManager.popScope();
                    if (node.type === 'MemberExpression' && node.object) {
                        if (node.object.type !== 'Identifier' || !scopeManager.isContextBound(node.object.name)) {
                            c(node.object, state);
                        }
                    }
                },
                CallExpression(node: any, state: ScopeManager, c: any) {
                    node.callee.parent = node;
                    c(node.callee, state);
                    for (const arg of node.arguments) {
                        c(arg, state);
                    }
                },
            });
        }
    }

    // Transform test condition
    if (node.test) {
        walk.recursive(node.test, scopeManager, {
            Identifier(node: any, state: ScopeManager) {
                if (!scopeManager.isLoopVariable(node.name) && !node.computed) {
                    scopeManager.pushScope('for');
                    transformIdentifier(node, state);
                    if (node.type === 'Identifier') {
                        // Skip $.get() wrapping for namespace objects used as MemberExpression
                        // objects (e.g. math in math.min(), array in array.size()).
                        // These are namespace objects, not series variables.
                        const isNamespaceObject =
                            scopeManager.isContextBound(node.name) &&
                            node.parent &&
                            node.parent.type === 'MemberExpression' &&
                            node.parent.object === node;
                        if (!isNamespaceObject) {
                            node.computed = true;
                            addArrayAccess(node, state);
                        }
                    }
                    scopeManager.popScope();
                }
            },
            MemberExpression(node: any, state: ScopeManager, c: any) {
                scopeManager.pushScope('for');
                transformMemberExpression(node, '', scopeManager);
                scopeManager.popScope();
                // If still a MemberExpression after transformation, recurse into the
                // object so user variable identifiers (e.g. lineMatrix in
                // lineMatrix.rows()) get transformed via the Identifier handler.
                // Skip recursion for context-bound namespace objects (math, array, ta, etc.)
                // — they are namespace objects, not series variables, and must not get $.get() wrapping.
                if (node.type === 'MemberExpression' && node.object) {
                    if (node.object.type !== 'Identifier' || !scopeManager.isContextBound(node.object.name)) {
                        c(node.object, state);
                    }
                }
            },
            CallExpression(node: any, state: ScopeManager, c: any) {
                // Set parent on callee so transformMemberExpression knows it's already being called
                // (prevents auto-call conversion: e.g. array.size -> array.size())
                node.callee.parent = node;
                c(node.callee, state);
                // Traverse arguments so identifiers get $.get() wrapping
                for (const arg of node.arguments) {
                    c(arg, state);
                }
            },
        });
    }

    // Transform update expression
    // Must mirror the test condition walker: wrap Series identifiers in $.get(),
    // handle MemberExpression chains and CallExpression arguments.
    // Without this, `for i = 0 to bar_index - X` produces raw Series objects
    // in the update ternary, causing NaN comparisons and infinite loops.
    if (node.update) {
        walk.recursive(node.update, scopeManager, {
            Identifier(node: any, state: ScopeManager) {
                if (!scopeManager.isLoopVariable(node.name) && !node.computed) {
                    scopeManager.pushScope('for');
                    transformIdentifier(node, state);
                    if (node.type === 'Identifier') {
                        const isNamespaceObject =
                            scopeManager.isContextBound(node.name) &&
                            node.parent &&
                            node.parent.type === 'MemberExpression' &&
                            node.parent.object === node;
                        if (!isNamespaceObject) {
                            node.computed = true;
                            addArrayAccess(node, state);
                        }
                    }
                    scopeManager.popScope();
                }
            },
            MemberExpression(node: any, state: ScopeManager, c: any) {
                scopeManager.pushScope('for');
                transformMemberExpression(node, '', scopeManager);
                scopeManager.popScope();
                if (node.type === 'MemberExpression' && node.object) {
                    if (node.object.type !== 'Identifier' || !scopeManager.isContextBound(node.object.name)) {
                        c(node.object, state);
                    }
                }
            },
            CallExpression(node: any, state: ScopeManager, c: any) {
                node.callee.parent = node;
                c(node.callee, state);
                for (const arg of node.arguments) {
                    c(arg, state);
                }
            },
        });
    }

    // Transform the loop body
    scopeManager.setSuppressHoisting(false);

    // Inject loop guard: hoist counter declaration before the loop
    const forGuardName = scopeManager.getNextLoopGuardName();
    const forGuard = createLoopGuardNodes(forGuardName);
    scopeManager.addHoistedStatement(forGuard.counterDecl);

    scopeManager.pushScope('for');
    c(node.body, scopeManager);
    scopeManager.popScope();

    // Prepend guard check as the first statement in the loop body
    if (node.body.type === 'BlockStatement') {
        node.body.body.unshift(forGuard.guardCheck);
    }

    // Clean up loop variable so it doesn't leak to outer scope
    // (prevents shadowing issues when the same name is reused later)
    if (node.init && node.init.type === 'VariableDeclaration') {
        const decl = node.init.declarations[0];
        scopeManager.removeLoopVariable(decl.id.name);
    }
}

export function transformWhileStatement(node: any, scopeManager: ScopeManager, c: any): void {
    // While-loop test conditions must NOT be hoisted — they're re-evaluated each iteration.
    // Suppress hoisting so namespace calls like array.size() stay inline.
    scopeManager.setSuppressHoisting(true);

    // Transform the test condition
    // Must wrap Series identifiers in $.get() so comparisons use concrete
    // values, not raw Series objects (e.g. `while bar_index > cnt`).
    if (node.test) {
        walk.recursive(node.test, scopeManager, {
            Identifier(node: any, state: ScopeManager) {
                if (!node.computed) {
                    transformIdentifier(node, state);
                    if (node.type === 'Identifier') {
                        const isNamespaceObject =
                            scopeManager.isContextBound(node.name) &&
                            node.parent &&
                            node.parent.type === 'MemberExpression' &&
                            node.parent.object === node;
                        if (!isNamespaceObject) {
                            node.computed = true;
                            addArrayAccess(node, state);
                        }
                    }
                }
            },
            MemberExpression(node: any, state: ScopeManager, c: any) {
                transformMemberExpression(node, '', scopeManager);
                // Recurse into non-namespace objects for user variable resolution
                if (node.type === 'MemberExpression' && node.object) {
                    if (node.object.type !== 'Identifier' || !scopeManager.isContextBound(node.object.name)) {
                        c(node.object, state);
                    }
                }
            },
            CallExpression(node: any, state: ScopeManager, c: any) {
                // Transform namespace method calls inline (no hoisting)
                node.callee.parent = node;
                c(node.callee, state);
                transformCallExpression(node, state);
                // Also traverse arguments
                if (node.arguments) {
                    for (const arg of node.arguments) {
                        c(arg, state);
                    }
                }
            },
        });
    }

    scopeManager.setSuppressHoisting(false);

    // Inject loop guard: hoist counter declaration before the loop
    const whileGuardName = scopeManager.getNextLoopGuardName();
    const whileGuard = createLoopGuardNodes(whileGuardName);
    scopeManager.addHoistedStatement(whileGuard.counterDecl);

    // Process the body of the while loop
    scopeManager.pushScope('whl');
    c(node.body, scopeManager);
    scopeManager.popScope();

    // Prepend guard check as the first statement in the loop body
    if (node.body.type === 'BlockStatement') {
        node.body.body.unshift(whileGuard.guardCheck);
    }
}

export function transformExpression(node: any, scopeManager: ScopeManager): void {
    walk.recursive(node, scopeManager, {
        MemberExpression(node: any, state: ScopeManager, c: any) {
            // Recurse into non-context-bound Identifier objects for DOT access only
            // (e.g. Signal.Buy where Signal is an enum). Skip computed/bracket access
            // (e.g. aa[0]) — those are handled by transformArrayIndex inside
            // transformMemberExpression, which needs the object as a raw Identifier.
            if (node.object && node.object.type === 'Identifier'
                && !scopeManager.isContextBound(node.object.name)
                && !node.computed) {
                node.object.parent = node;
                c(node.object, state);
            }
            transformMemberExpression(node, '', scopeManager);
        },

        CallExpression(node: any, state: ScopeManager) {
            transformCallExpression(node, state);
        },
        // BinaryExpression / LogicalExpression / UnaryExpression need explicit
        // visitors here so parent references are threaded into the operand
        // identifiers. Without this, an Identifier inside `not a and not b`
        // (a common Pine pattern in if-conditions) ends up with `node.parent`
        // pointing at the outer LogicalExpression — or at nothing at all —
        // and `transformIdentifier` skips its localSeriesVar unwrap because
        // the `is(NamespaceMember|ParamCall|SeriesFunctionArg|...)` guards
        // misclassify the node. The result is JS like `!a && !b`, which
        // always evaluates to `false` because `a`/`b` are Series objects.
        BinaryExpression(node: any, state: ScopeManager, c: any) {
            if (node.left.type === 'Identifier') node.left.parent = node;
            if (node.right.type === 'Identifier') node.right.parent = node;
            c(node.left, state);
            c(node.right, state);
        },
        LogicalExpression(node: any, state: ScopeManager, c: any) {
            if (node.left.type === 'Identifier') node.left.parent = node;
            if (node.right.type === 'Identifier') node.right.parent = node;
            c(node.left, state);
            c(node.right, state);
        },
        UnaryExpression(node: any, state: ScopeManager, c: any) {
            if (node.argument.type === 'Identifier') node.argument.parent = node;
            c(node.argument, state);
        },
        Identifier(node: any, state: ScopeManager) {
            // Capture parent BEFORE transformIdentifier mutates `node` in
            // place (Object.assign overwrites node.parent on rewrites such as
            // wrap-in-$.get).
            const parent = node.parent;
            const isUnary = parent && parent.type === 'UnaryExpression';
            const isBinary = parent && parent.type === 'BinaryExpression';
            const isLogical = parent && parent.type === 'LogicalExpression';
            const isConditional = parent && parent.type === 'ConditionalExpression';

            transformIdentifier(node, state);

            // After identifier rewrite, if the node still looks like a bare
            // Identifier sitting under a `not`/`and`/`or`/binary/conditional
            // expression, force-wrap it with `$.get(..., 0)` so function-
            // parameter Series get unwrapped to scalars before the operator
            // applies. Without this, `if not a and not b` (with `a`/`b` as
            // bool fn params) emits `!a && !b` — Series objects are truthy,
            // so `!Series === false` and the branch is never taken.
            if (node.type === 'Identifier' && (isUnary || isBinary || isLogical || isConditional)) {
                const isGetCall = parent && parent.type === 'CallExpression' && parent.callee &&
                    parent.callee.object && parent.callee.object.name === CONTEXT_NAME &&
                    parent.callee.property?.name === 'get';
                if (!isGetCall) {
                    addArrayAccess(node, state);
                }
            }

            //context bound variable was not transformed, but we still need to ensure array annotation
            const isIfStatement = scopeManager.getCurrentScopeType() === 'if';
            const isContextBound = scopeManager.isContextBound(node.name) && !scopeManager.isRootParam(node.name);
            if (isContextBound && isIfStatement) {
                addArrayAccess(node, state);
            }
        },
    });
}

export function transformIfStatement(node: any, scopeManager: ScopeManager, c: any): void {
    // Transform the test condition
    if (node.test) {
        scopeManager.pushScope('if');
        transformExpression(node.test, scopeManager);
        scopeManager.popScope();
    }

    // Transform the if branch (consequent)
    scopeManager.pushScope('if');
    c(node.consequent, scopeManager);
    scopeManager.popScope();

    // Transform the else branch (alternate) if it exists
    if (node.alternate) {
        scopeManager.pushScope('els');
        c(node.alternate, scopeManager);
        scopeManager.popScope();
    }
}

export function transformReturnStatement(node: any, scopeManager: ScopeManager): void {
    const curScope = scopeManager.getCurrentScopeType();
    // Transform the return argument if it exists
    if (node.argument) {
        if (node.argument.type === 'ArrayExpression') {
            // Transform each element in the array
            node.argument.elements = node.argument.elements.map((element: any) => {
                if (element.type === 'Identifier') {
                    // Skip transformation if it's a context-bound variable
                    if (scopeManager.isContextBound(element.name) && !scopeManager.isRootParam(element.name)) {
                        // Use $.get(element, 0) instead of element[0] for context-bound variables
                        return ASTFactory.createGetCall(element, 0);
                    }

                    // Transform non-context-bound variables
                    return createScopedVariableAccess(element.name, scopeManager);
                } else if (element.type === 'MemberExpression') {
                    // Check if this is a context variable reference ($.const.xxx, $.let.xxx, etc.)
                    const isContextVarRef =
                        element.object &&
                        element.object.type === 'MemberExpression' &&
                        element.object.object &&
                        element.object.object.type === 'Identifier' &&
                        element.object.object.name === '$' &&
                        element.object.property &&
                        ['const', 'let', 'var', 'params'].includes(element.object.property.name);

                    if (isContextVarRef) {
                        // Use $.get($.const.xxx, 0) instead of $.const.xxx[0]
                        return ASTFactory.createGetCall(element, 0);
                    }

                    // Context-bound computed subscripts (`bar_index[len]`,
                    // `close[n]`, ...) in a return tuple must be lowered to
                    // `$.get(series, idx)` like everywhere else. This block used
                    // to early-return them verbatim, leaving a raw JS subscript on
                    // a Series → undefined at runtime (RC1). Routing through
                    // transformMemberExpression also gives NAMESPACES_LIKE members
                    // (`time[1]`, `na[0]`) their `.__value` unwrap.
                    transformMemberExpression(element, '', scopeManager);
                    return element;
                } else if (
                    element.type === 'BinaryExpression' ||
                    element.type === 'LogicalExpression' ||
                    element.type === 'ConditionalExpression' ||
                    element.type === 'CallExpression' ||
                    element.type === 'UnaryExpression'
                ) {
                    // Walk into complex expressions and transform identifiers/members
                    walk.recursive(element, scopeManager, {
                        Identifier(node: any, state: ScopeManager) {
                            transformIdentifier(node, state);
                            if (node.type === 'Identifier' && !node._arrayAccessed) {
                                addArrayAccess(node, state);
                                node._arrayAccessed = true;
                            }
                        },
                        MemberExpression(node: any) {
                            transformMemberExpression(node, '', scopeManager);
                        },
                        CallExpression(node: any, state: ScopeManager, c: any) {
                            if (node.callee.type === 'ArrowFunctionExpression' || node.callee.type === 'FunctionExpression') {
                                c(node.callee, state);
                            }
                            transformCallExpression(node, state);
                            if (node.type === 'CallExpression') {
                                node.arguments.forEach((arg: any) => c(arg, state));
                            }
                        },
                        BinaryExpression(node: any, state: any, c: any) {
                            c(node.left, state);
                            c(node.right, state);
                        },
                    });
                    return element;
                }
                return element;
            });

            node.argument = {
                type: 'ArrayExpression',
                elements: [node.argument],
            };
        } else if (node.argument.type === 'ObjectExpression') {
            // Handle object expressions
            node.argument.properties = node.argument.properties.map((prop: any) => {
                // Check for shorthand properties
                if (prop.shorthand) {
                    // Check if it's a context-bound variable first
                    if (scopeManager.isContextBound(prop.value.name)) {
                        return prop;
                    }

                    // Get the variable name and kind
                    const [scopedName, kind] = scopeManager.getVariable(prop.value.name);

                    // Convert shorthand to full property definition
                    return {
                        type: 'Property',
                        key: ASTFactory.createIdentifier(prop.key.name),
                        value: createScopedVariableReference(prop.value.name, scopeManager),
                        kind: 'init',
                        method: false,
                        shorthand: false,
                        computed: false,
                    };
                }

                // Handle regular properties with identifier values
                if (prop.value && prop.value.type === 'Identifier') {
                    // Check if it's a context-bound variable (like 'close', 'open', etc.)
                    if (scopeManager.isContextBound(prop.value.name) && !scopeManager.isRootParam(prop.value.name)) {
                        // It's a data variable - use $.get(variable, 0)
                        // prop.value = ASTFactory.createGetCall(prop.value, 0);
                        // FIXED: Keep native data as Series (don't dereference to value)
                    } else if (!scopeManager.isContextBound(prop.value.name)) {
                        // It's a user variable - transform to context reference
                        prop.value = createScopedVariableReference(prop.value.name, scopeManager);
                    }
                }

                return prop;
            });
        } else if (node.argument.type === 'Identifier') {
            transformIdentifier(node.argument, scopeManager);
            if (node.argument.type === 'Identifier') {
                addArrayAccess(node.argument, scopeManager);
            }
        } else if (node.argument.type === 'MemberExpression') {
            // Handle non-context-bound member expressions (e.g. return Signal.Buy)
            // where the object is a user-defined variable (enum, struct, etc.)
            //
            // EXCEPTION: a computed subscript on a function-parameter series
            // (`return src[len]`, RC1 Site 3) must NOT be pre-processed here.
            // transformIdentifier would wrap `src` into `$.param(...)`, turning the
            // object into a CallExpression, which then routes to the `func()[N]`
            // fn-branch that leaves the variable offset raw → NaN. Leaving it as a
            // bare `src[len]` lets the fn-branch below route it through
            // transformMemberExpression (same path as `close[n]`), which lowers
            // both the object AND the offset. Enum returns (`Signal.Buy`) are
            // non-computed and still fall through to transformIdentifier.
            if (
                node.argument.object.type === 'Identifier' &&
                !scopeManager.isContextBound(node.argument.object.name) &&
                !scopeManager.isLoopVariable(node.argument.object.name) &&
                !(node.argument.computed && scopeManager.isLocalSeriesVar(node.argument.object.name))
            ) {
                transformIdentifier(node.argument.object, scopeManager);
            }
            // UDT-field subscript on a function parameter: `return b.field[N]`
            // where `b` is a UDT-typed parameter. The chain's leaf must be a
            // registered UDT instance for the rewrite to fire — see
            // `transformFunctionDeclaration` for scope-local registration.
            else if (
                node.argument.computed &&
                node.argument.object.type === 'MemberExpression'
            ) {
                let cursor: any = node.argument.object;
                while (cursor.object && cursor.object.type === 'MemberExpression') {
                    cursor = cursor.object;
                }
                if (cursor.object?.type === 'Identifier' &&
                    scopeManager.isUdtInstance(cursor.object.name)) {
                    transformMemberExpression(node.argument, '', scopeManager);
                }
            }
        }

        if (curScope === 'fn') {
            //for nested functions : wrap the return argument in a CallExpression with math._precision(<statement>)
            // Process different types of return arguments
            if (
                node.argument.type === 'Identifier' &&
                scopeManager.isContextBound(node.argument.name) &&
                !scopeManager.isRootParam(node.argument.name)
            ) {
                // For context-bound identifiers, add [0] array access if not already an array access
                node.argument = ASTFactory.createArrayAccess(node.argument, 0);
            } else if (node.argument.type === 'MemberExpression') {
                // `func(...)[N]` as a direct return value: route through
                // transformMemberExpression so the call-result history ref is
                // lowered to `$.get($.param(...), N)` (a scalar). Otherwise the
                // return path leaves a raw subscript on a scalar (→ NaN).
                if (node.argument.computed && node.argument.object.type === 'CallExpression') {
                    transformMemberExpression(node.argument, '', scopeManager);
                }
                // For member expressions, check if the object is context-bound
                else if (
                    node.argument.object.type === 'Identifier' &&
                    scopeManager.isContextBound(node.argument.object.name) &&
                    !scopeManager.isRootParam(node.argument.object.name)
                ) {
                    // A COMPUTED subscript (`return close[n]`, `return bar_index[len]`)
                    // must route through the main member handler so the OBJECT is
                    // wrapped as `$.get(series, idx)`. transformArrayIndex only
                    // rewrites the index and leaves a context-bound object raw →
                    // undefined at runtime (RC1). Non-computed members
                    // (`syminfo.ticker`) keep the index-only path (a no-op here).
                    if (node.argument.computed) {
                        transformMemberExpression(node.argument, '', scopeManager);
                    } else if (!node.argument._indexTransformed) {
                        transformArrayIndex(node.argument, scopeManager);
                        node.argument._indexTransformed = true;
                    }
                }
                // Site 3: computed subscript on a function-parameter series
                // (`return src[len]`). Phase-1 left this as a bare `src[len]`;
                // route it through the main member handler so BOTH the series
                // object and the offset are lowered to `$.get(src, $.get(len, 0))`
                // — mirrors the context-bound `close[n]` path above. Staying inside
                // this `MemberExpression` else-if means the chain is already
                // matched, so the CallExpression it becomes is not re-walked.
                else if (
                    node.argument.computed &&
                    node.argument.object.type === 'Identifier' &&
                    scopeManager.isLocalSeriesVar(node.argument.object.name)
                ) {
                    transformMemberExpression(node.argument, '', scopeManager);
                }
            } else if (
                node.argument.type === 'BinaryExpression' ||
                node.argument.type === 'LogicalExpression' ||
                node.argument.type === 'ConditionalExpression' ||
                node.argument.type === 'CallExpression' ||
                node.argument.type === 'UnaryExpression' ||
                node.argument.type === 'AssignmentExpression'
            ) {
                // For complex expressions, walk the AST and transform all identifiers and expressions
                walk.recursive(node.argument, scopeManager, {
                    Identifier(node: any, state: ScopeManager) {
                        transformIdentifier(node, state);
                        // Add array access if needed
                        if (node.type === 'Identifier' && !node._arrayAccessed) {
                            addArrayAccess(node, state);
                            node._arrayAccessed = true;
                        }
                    },
                    MemberExpression(node: any) {
                        transformMemberExpression(node, '', scopeManager);
                    },
                    // When an arrow function's last statement is an assignment
                    // (e.g. `tracker.field := …`), the parser folds it into the
                    // implicit return as an AssignmentExpression. Without this
                    // visitor, the default acorn-walk fall-through visits the
                    // LHS as a MemberExpression — which doesn't rewrite the
                    // root identifier of an assignment LHS — and `tracker`
                    // leaks bare → "ReferenceError: tracker is not defined".
                    AssignmentExpression(node: any, state: ScopeManager) {
                        transformAssignmentExpression(node, state);
                    },
                    // c is the callback function for recursion (acorn-walk)
                    CallExpression(node: any, state: ScopeManager, c: any) {
                        if (node.callee.type === 'ArrowFunctionExpression' || node.callee.type === 'FunctionExpression') {
                            c(node.callee, state);
                        }
                        transformCallExpression(node, state);
                        if (node.type === 'CallExpression') {
                            node.arguments.forEach((arg: any) => c(arg, state));
                        }
                    },
                    BinaryExpression(node: any, state: any, c: any) {
                        c(node.left, state);
                        c(node.right, state);
                    },
                    ArrowFunctionExpression(node: any, state: any, c: any) {
                        // For IIFE arrow functions, manage hoisting like BlockStatement does
                        if (node.body) {
                            if (node.body.type === 'BlockStatement') {
                                const newBody: any[] = [];
                                node.body.body.forEach((stmt: any) => {
                                    scopeManager.enterHoistingScope();
                                    c(stmt, state);
                                    const hoistedStmts = scopeManager.exitHoistingScope();
                                    newBody.push(...hoistedStmts);
                                    newBody.push(stmt);
                                });
                                node.body.body = newBody;
                            } else {
                                c(node.body, state);
                            }
                        }
                    },
                    FunctionExpression(node: any, state: any, c: any) {
                        // For IIFE function expressions, manage hoisting like BlockStatement does
                        if (node.body && node.body.type === 'BlockStatement') {
                            const newBody: any[] = [];
                            node.body.body.forEach((stmt: any) => {
                                scopeManager.enterHoistingScope();
                                c(stmt, state);
                                const hoistedStmts = scopeManager.exitHoistingScope();
                                newBody.push(...hoistedStmts);
                                newBody.push(stmt);
                            });
                            node.body.body = newBody;
                        }
                    },
                    SwitchStatement(node: any, state: ScopeManager, c: any) {
                        node.discriminant.parent = node;
                        c(node.discriminant, state);
                        node.cases.forEach((caseNode: any) => {
                            caseNode.parent = node;
                            c(caseNode, state);
                        });
                    },
                    SwitchCase(node: any, state: any, c: any) {
                        if (node.test) {
                            node.test.parent = node;
                            c(node.test, state);
                        }
                        const newConsequent: any[] = [];
                        node.consequent.forEach((stmt: any) => {
                            scopeManager.enterHoistingScope();
                            c(stmt, state);
                            const hoistedStmts = scopeManager.exitHoistingScope();
                            newConsequent.push(...hoistedStmts);
                            newConsequent.push(stmt);
                        });
                        node.consequent = newConsequent;
                    },
                    BlockStatement(node: any, state: ScopeManager, c: any) {
                        const newBody: any[] = [];
                        node.body.forEach((stmt: any) => {
                            state.enterHoistingScope();
                            c(stmt, state);
                            const hoistedStmts = state.exitHoistingScope();
                            newBody.push(...hoistedStmts);
                            newBody.push(stmt);
                        });
                        node.body = newBody;
                    },
                });
            }

            const precisionCall = ASTFactory.createCallExpression(
                ASTFactory.createMemberExpression(ASTFactory.createContextIdentifier(), ASTFactory.createIdentifier('precision')),
                [node.argument]
            );
            node.argument = precisionCall;
        }
    }
}

export function transformFunctionDeclaration(node: any, scopeManager: ScopeManager, c: any): void {
    // Note: We don't register parameters here anymore, that's done in the AnalysisPass.

    // Inject callId parameter for user-defined functions to allow unique state per call
    // CHANGED: Instead of adding a parameter, we inject a variable declaration at the start of the function body
    // which retrieves the current callId from the context stack.
    // node.params.push(ASTFactory.createIdentifier('_callId'));

    const callIdDecl = ASTFactory.createVariableDeclaration(
        '$$',
        ASTFactory.createCallExpression(
            ASTFactory.createMemberExpression(ASTFactory.createContextIdentifier(), ASTFactory.createIdentifier('peekCtx')),
            []
        )
    );
    // Mark as special to skip transformation and be treated as raw variable
    callIdDecl._skipTransformation = true;
    scopeManager.addLoopVariable('$$', '$$');

    // Transform the function body
    if (node.body && node.body.type === 'BlockStatement') {
        // Inject the _callId declaration at the start of the body
        node.body.body.unshift(callIdDecl);

        scopeManager.pushScope('fn');

        // Register function parameters as local series variables
        // This ensures they:
        // 1. Stay as plain identifiers (no renaming to $.let.scoped_name)
        // 2. Get $.get() wrapping when used (e.g., X1.size() → $.get(X1, 0).size())
        // Parameters with a default value are AssignmentPattern nodes — the
        // bound name is on `.left`. Skipping them made references to defaulted
        // params inside named-arg object literals resolve through the global
        // context (`$.let.<name>` → undefined) instead of the JS parameter.
        node.params.forEach((param: any) => {
            if (param.type === 'Identifier') {
                scopeManager.addLocalSeriesVar(param.name);
            } else if (param.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
                scopeManager.addLocalSeriesVar(param.left.name);
            }
        });

        // Scope-locally register any UDT-typed parameters (per
        // `funcName.__pineParamTypes__` markers populated by AnalysisPass)
        // so the use-site rewrite for `b.field[N]` fires inside the body.
        // The names get unmarked when leaving function scope below.
        // Methods carry a `$M_` JS-name prefix that's not used in the registry
        // (which is keyed by the Pine name) — strip it before lookup.
        const rawFnName = node.id?.name as string | undefined;
        const fnName = rawFnName?.startsWith('$M_') ? rawFnName.slice(3) : rawFnName;
        const paramTypes = fnName ? scopeManager.getFunctionParamUdtTypes(fnName) : undefined;
        // Snapshot prior bindings for parameter names that shadow outer-scope
        // UDT instances (e.g. `method touch(ZZ aZZ)` where `aZZ` is also a
        // global UDT variable). Without this, the unmark on function exit
        // would wipe the outer registration too, breaking later `aZZ.foo()`
        // dispatches at the call site.
        const savedUdtBindings: Record<string, string | undefined> = {};
        if (paramTypes) {
            for (const [paramName, typeName] of Object.entries(paramTypes)) {
                savedUdtBindings[paramName] = scopeManager.getVariableUdtType(paramName);
                scopeManager.markVariableAsUdtInstance(paramName, typeName);
            }
        }

        // Same scope-local registration for BUILT-IN-typed params (e.g.
        // `f(table t)`), from the unfiltered param-type registry, so dot-calls
        // of user methods on those params (`t.divider(0)`) dispatch by static
        // receiver-type matching inside the body.
        const rawParamTypes = fnName ? scopeManager.getFunctionParamStaticTypes(fnName) : undefined;
        const savedStaticBindings: Record<string, string | undefined> = {};
        if (rawParamTypes) {
            for (const [paramName, typeName] of Object.entries(rawParamTypes)) {
                savedStaticBindings[paramName] = scopeManager.getVarStaticType(paramName);
                scopeManager.setVarStaticType(paramName, typeName);
            }
        }

        // Just delegate to the callback to continue the recursion
        c(node.body, scopeManager);

        // Clean up: remove function parameters from local series vars after exiting function scope
        node.params.forEach((param: any) => {
            if (param.type === 'Identifier') {
                scopeManager.removeLocalSeriesVar(param.name);
            } else if (param.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
                scopeManager.removeLocalSeriesVar(param.left.name);
            }
        });
        if (paramTypes) {
            for (const paramName of Object.keys(paramTypes)) {
                scopeManager.unmarkVariableAsUdtInstance(paramName);
                const prev = savedUdtBindings[paramName];
                if (prev !== undefined) {
                    scopeManager.markVariableAsUdtInstance(paramName, prev);
                }
            }
        }
        if (rawParamTypes) {
            for (const paramName of Object.keys(rawParamTypes)) {
                scopeManager.unsetVarStaticType(paramName);
                const prev = savedStaticBindings[paramName];
                if (prev !== undefined) {
                    scopeManager.setVarStaticType(paramName, prev);
                }
            }
        }

        scopeManager.popScope();
    }
}
