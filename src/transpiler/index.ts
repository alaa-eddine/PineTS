// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Ala-eddine KADDOURI

//!!!Warning!!! this code is not clean, it was initially written as a PoC then used as transpiler for PineTS
//Future version will require major refactoring or full rewrite of the transpiler
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
import * as walk from 'acorn-walk';
import * as astring from 'astring';
import ScopeManager from './ScopeManager.class';
const CONTEXT_NAME = '$';
const UNDEFINED_ARG = {
    type: 'Identifier',
    name: 'undefined',
};

function transformArrayIndex(node: any, scopeManager: ScopeManager): void {
    //const isIfStatement = scopeManager.getCurrentScopeType() == 'if';
    //const isForStatement = scopeManager.getCurrentScopeType() == 'for';
    if (node.computed && node.property.type === 'Identifier') {
        // Skip transformation if it's a loop variable
        if (scopeManager.isLoopVariable(node.property.name)) {
            return;
        }

        // Only transform if it's not a context-bound variable
        if (!scopeManager.isContextBound(node.property.name)) {
            const [scopedName, kind] = scopeManager.getVariable(node.property.name);
            node.property = {
                type: 'MemberExpression',
                object: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: CONTEXT_NAME,
                    },
                    property: {
                        type: 'Identifier',
                        name: kind,
                    },
                    computed: false,
                },
                property: {
                    type: 'Identifier',
                    name: scopedName,
                },
                computed: false,
            };

            // Add [0] to the index
            node.property = {
                type: 'MemberExpression',
                object: node.property,
                property: {
                    type: 'Literal',
                    value: 0,
                },
                computed: true,
            };
        }
    }

    if (node.computed && node.object.type === 'Identifier') {
        if (scopeManager.isLoopVariable(node.object.name)) {
            return;
        }

        if (!scopeManager.isContextBound(node.object.name)) {
            const [scopedName, kind] = scopeManager.getVariable(node.object.name);

            //transform the object to scoped variable

            node.object = {
                type: 'MemberExpression',
                object: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: CONTEXT_NAME,
                    },
                    property: {
                        type: 'Identifier',
                        name: kind,
                    },
                    computed: false,
                },
                property: {
                    type: 'Identifier',
                    name: scopedName,
                },
                computed: false,
            };
        }

        if (node.property.type === 'MemberExpression') {
            const memberNode = node.property;
            if (!memberNode._indexTransformed) {
                transformArrayIndex(memberNode, scopeManager);
                memberNode._indexTransformed = true;
            }
        }
    }
}

function transformMemberExpression(memberNode: any, originalParamName: string, scopeManager: ScopeManager): void {
    // Skip transformation for Math object properties
    if (memberNode.object && memberNode.object.type === 'Identifier' && memberNode.object.name === 'Math') {
        return;
    }

    //if statment variables always need to be transformed
    const isIfStatement = scopeManager.getCurrentScopeType() == 'if';
    const isElseStatement = scopeManager.getCurrentScopeType() == 'els';
    const isForStatement = scopeManager.getCurrentScopeType() == 'for';
    // If the object is a context-bound variable (like a function parameter), skip transformation
    if (
        !isIfStatement &&
        !isElseStatement &&
        !isForStatement &&
        memberNode.object &&
        memberNode.object.type === 'Identifier' &&
        scopeManager.isContextBound(memberNode.object.name) &&
        !scopeManager.isRootParam(memberNode.object.name)
    ) {
        return;
    }

    // Transform array indices
    if (!memberNode._indexTransformed) {
        transformArrayIndex(memberNode, scopeManager);
        memberNode._indexTransformed = true;
    }
}

function transformVariableDeclaration(varNode: any, scopeManager: ScopeManager): void {
    varNode.declarations.forEach((decl: any) => {
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

        if (isArrowFunction) {
            // Register arrow function parameters as context-bound
            decl.init.params.forEach((param: any) => {
                if (param.type === 'Identifier') {
                    scopeManager.addContextBoundVar(param.name);
                }
            });
        }

        // Transform non-context variables to use the context object
        const newName = scopeManager.addVariable(decl.id.name, varNode.kind);
        const kind = varNode.kind; // 'const', 'let', or 'var'

        // Transform identifiers in the init expression
        if (decl.init && !isArrowFunction) {
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
                            const isConditional = node.parent && node.parent.type === 'ConditionalExpression';
                            if (node.type === 'Identifier' && (isBinaryOperation || isConditional)) {
                                Object.assign(node, {
                                    type: 'MemberExpression',
                                    object: {
                                        type: 'Identifier',
                                        name: node.name,
                                    },
                                    property: {
                                        type: 'Literal',
                                        value: 0,
                                    },
                                    computed: true,
                                });
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
                            transformCallExpression(node, scopeManager);
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
                        MemberExpression(node: any, state: any, c: any) {
                            // Set parent reference
                            if (node.object.type === 'Identifier') {
                                node.object.parent = node;
                            }
                            if (node.property.type === 'Identifier') {
                                node.property.parent = node;
                            }
                            // Transform array indices first
                            transformArrayIndex(node, scopeManager);
                            // Then continue with object transformation
                            if (node.object) {
                                c(node.object, { parent: node });
                            }
                        },
                    }
                );
            }
        }

        // Create the target variable reference
        const targetVarRef = {
            type: 'MemberExpression',
            object: {
                type: 'MemberExpression',
                object: {
                    type: 'Identifier',
                    name: CONTEXT_NAME,
                },
                property: {
                    type: 'Identifier',
                    name: kind,
                },
                computed: false,
            },
            property: {
                type: 'Identifier',
                name: newName,
            },
            computed: false,
        };

        const isArrayPatternVar = scopeManager.isArrayPatternElement(decl.id.name);
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
        // Create an assignment expression for the transformed variable
        const assignmentExpr = {
            type: 'ExpressionStatement',
            expression: {
                type: 'AssignmentExpression',
                operator: '=',
                left: targetVarRef,
                right: decl.init
                    ? isArrowFunction || isArrayPatternVar
                        ? decl.init // Keep arrow functions and array pattern variables as-is
                        : {
                              type: 'CallExpression',
                              callee: {
                                  type: 'MemberExpression',
                                  object: {
                                      type: 'Identifier',
                                      name: CONTEXT_NAME,
                                  },
                                  property: {
                                      type: 'Identifier',
                                      name: 'init',
                                  },
                                  computed: false,
                              },
                              arguments: isArrayInit ? [targetVarRef, decl.init.object, decl.init.property] : [targetVarRef, decl.init],
                          }
                    : {
                          type: 'Identifier',
                          name: 'undefined',
                      },
            },
        };

        if (isArrayPatternVar) {
            assignmentExpr.expression.right.object.property.name += '?.[0]';
        }

        if (isArrowFunction) {
            // Transform the body of arrow functions
            scopeManager.pushScope('fn');
            walk.recursive(decl.init.body, scopeManager, {
                BlockStatement(node: any, state: ScopeManager, c: any) {
                    //state.pushScope('block');
                    node.body.forEach((stmt: any) => c(stmt, state));
                    //state.popScope();
                },
                IfStatement(node: any, state: ScopeManager, c: any) {
                    state.pushScope('if');
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
            });
            scopeManager.popScope();
        }

        // Replace the original node with the transformed assignment
        Object.assign(varNode, assignmentExpr);
    });
}

function transformIdentifier(node: any, scopeManager: ScopeManager): void {
    // Transform identifiers to use the context object
    if (node.name !== CONTEXT_NAME) {
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

        // If it's a nested function parameter (but not a root parameter), skip transformation
        if (scopeManager.isContextBound(node.name) && !scopeManager.isRootParam(node.name)) {
            return;
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
        // Check if this identifier is an argument to a namespace function
        const isNamespaceFunctionArg =
            node.parent &&
            node.parent.type === 'CallExpression' &&
            node.parent.callee &&
            node.parent.callee.type === 'MemberExpression' &&
            scopeManager.isContextBound(node.parent.callee.object.name);

        // Check if this identifier is part of an array access
        const isArrayAccess = node.parent && node.parent.type === 'MemberExpression' && node.parent.computed;

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

        // Check if this identifier is a function being called
        const isFunctionCall = node.parent && node.parent.type === 'CallExpression' && node.parent.callee === node;

        if (isNamespaceMember || isParamCall || isNamespaceFunctionArg || isArrayIndexInNamespaceCall || isFunctionCall) {
            // For function calls, we should just use the original name without scoping
            if (isFunctionCall) {
                return;
            }
            // Don't add [0] for namespace function arguments or array indices
            const [scopedName, kind] = scopeManager.getVariable(node.name);
            Object.assign(node, {
                type: 'MemberExpression',
                object: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: CONTEXT_NAME,
                    },
                    property: {
                        type: 'Identifier',
                        name: kind,
                    },
                    computed: false,
                },
                property: {
                    type: 'Identifier',
                    name: scopedName,
                },
                computed: false,
            });
            return;
        }

        const [scopedName, kind] = scopeManager.getVariable(node.name);
        const memberExpr = {
            type: 'MemberExpression',
            object: {
                type: 'MemberExpression',
                object: {
                    type: 'Identifier',
                    name: CONTEXT_NAME,
                },
                property: {
                    type: 'Identifier',
                    name: kind,
                },
                computed: false,
            },
            property: {
                type: 'Identifier',
                name: scopedName,
            },
            computed: false,
        };

        // Check if parent node is already a member expression with computed property (array access)
        const hasArrayAccess = node.parent && node.parent.type === 'MemberExpression' && node.parent.computed && node.parent.object === node;

        if (!hasArrayAccess && !isArrayAccess) {
            // Add [0] array access if not already present and not part of array access
            Object.assign(node, {
                type: 'MemberExpression',
                object: memberExpr,
                property: {
                    type: 'Literal',
                    value: 0,
                },
                computed: true,
            });
        } else {
            // Just replace with the member expression without adding array access
            Object.assign(node, memberExpr);
        }
    }
}

function transformAssignmentExpression(node: any, scopeManager: ScopeManager): void {
    // Transform assignment expressions to use the context object
    if (node.left.type === 'Identifier') {
        const [varName, kind] = scopeManager.getVariable(node.left.name);
        const memberExpr = {
            type: 'MemberExpression',
            object: {
                type: 'MemberExpression',
                object: {
                    type: 'Identifier',
                    name: CONTEXT_NAME,
                },
                property: {
                    type: 'Identifier',
                    name: kind,
                },
                computed: false,
            },
            property: {
                type: 'Identifier',
                name: varName,
            },
            computed: false,
        };

        // Add [0] array access for assignment target
        node.left = {
            type: 'MemberExpression',
            object: memberExpr,
            property: {
                type: 'Literal',
                value: 0,
            },
            computed: true,
        };
    }

    // Transform identifiers in the right side of the assignment
    walk.recursive(
        node.right,
        { parent: node.right, inNamespaceCall: false },
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
                        addArrayAccess(node, scopeManager);
                    }
                }
            },
            MemberExpression(node: any, state: any, c: any) {
                // Transform array indices first
                transformArrayIndex(node, scopeManager);
                // Then continue with object transformation
                if (node.object) {
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

                // Then transform its arguments with the correct context
                node.arguments.forEach((arg: any) => c(arg, { parent: node, inNamespaceCall: isNamespaceCall || state.inNamespaceCall }));

                // Add [0] to the function call result if it's a namespace call and hasn't been wrapped yet
                // and it's not a param() call
                // if (!node._arrayWrapped && isNamespaceCall && node.callee.property.name !== 'param') {
                //     const wrappedNode = {
                //         type: 'MemberExpression',
                //         object: { ...node },
                //         property: {
                //             type: 'Literal',
                //             value: 0,
                //         },
                //         computed: true,
                //     };
                //     Object.assign(node, wrappedNode);
                //     node._arrayWrapped = true;
                // }
            },
        }
    );
}

function createWrapperFunction(arrowFunction: any): any {
    // Create a wrapper function with the context parameter
    return {
        type: 'FunctionDeclaration',
        id: null,
        params: [
            {
                type: 'Identifier',
                name: 'context',
            },
        ],
        body: {
            type: 'BlockStatement',
            body: [
                {
                    type: 'ReturnStatement',
                    argument: arrowFunction,
                },
            ],
        },
    };
}

function transformArrowFunctionParams(node: any, scopeManager: ScopeManager, isRootFunction: boolean = false): void {
    // Register arrow function parameters as context-bound
    node.params.forEach((param: any) => {
        if (param.type === 'Identifier') {
            scopeManager.addContextBoundVar(param.name, isRootFunction);
        }
    });
}

function transformWhileStatement(node: any, scopeManager: ScopeManager, c: any): void {
    // Transform the test condition of the while loop
    walk.simple(node.test, {
        Identifier(idNode: any) {
            transformIdentifier(idNode, scopeManager);
        },
    });

    // Process the body of the while loop
    scopeManager.pushScope('whl');
    c(node.body, scopeManager);
    scopeManager.popScope();
}

function transformReturnStatement(node: any, scopeManager: ScopeManager): void {
    const curScope = scopeManager.getCurrentScopeType();
    // Transform the return argument if it exists
    if (node.argument) {
        if (node.argument.type === 'ArrayExpression') {
            // Transform each element in the array
            node.argument.elements = node.argument.elements.map((element: any) => {
                if (element.type === 'Identifier') {
                    // Skip transformation if it's a context-bound variable
                    if (scopeManager.isContextBound(element.name) && !scopeManager.isRootParam(element.name)) {
                        // Only add [0] if it's not already an array access
                        return {
                            type: 'MemberExpression',
                            object: element,
                            property: {
                                type: 'Literal',
                                value: 0,
                            },
                            computed: true,
                        };
                    }

                    // Transform non-context-bound variables
                    const [scopedName, kind] = scopeManager.getVariable(element.name);
                    return {
                        type: 'MemberExpression',
                        object: {
                            type: 'MemberExpression',
                            object: {
                                type: 'MemberExpression',
                                object: {
                                    type: 'Identifier',
                                    name: CONTEXT_NAME,
                                },
                                property: {
                                    type: 'Identifier',
                                    name: kind,
                                },
                                computed: false,
                            },
                            property: {
                                type: 'Identifier',
                                name: scopedName,
                            },
                            computed: false,
                        },
                        property: {
                            type: 'Literal',
                            value: 0,
                        },
                        computed: true,
                    };
                } else if (element.type === 'MemberExpression') {
                    // If it's already a member expression (array access), leave it as is
                    if (
                        element.computed &&
                        element.object.type === 'Identifier' &&
                        scopeManager.isContextBound(element.object.name) &&
                        !scopeManager.isRootParam(element.object.name)
                    ) {
                        return element;
                    }
                    // Otherwise, transform it normally
                    transformMemberExpression(element, '', scopeManager);
                    return element;
                }
                return element;
            });

            node.argument = {
                type: 'ArrayExpression',
                elements: [node.argument],
            };
        } else if (node.argument.type === 'BinaryExpression') {
            // Transform both operands of the binary expression
            walk.recursive(node.argument, scopeManager, {
                Identifier(node: any, state: ScopeManager) {
                    transformIdentifier(node, state);
                    if (node.type === 'Identifier') {
                        addArrayAccess(node, state);
                    }
                },
                MemberExpression(node: any) {
                    transformMemberExpression(node, '', scopeManager);
                },
            });
        } else if (node.argument.type === 'ObjectExpression') {
            // Handle object expressions (existing code)
            node.argument.properties = node.argument.properties.map((prop: any) => {
                // Check for shorthand properties
                if (prop.shorthand) {
                    // Get the variable name and kind
                    const [scopedName, kind] = scopeManager.getVariable(prop.value.name);

                    // Convert shorthand to full property definition
                    return {
                        type: 'Property',
                        key: {
                            type: 'Identifier',
                            name: prop.key.name,
                        },
                        value: {
                            type: 'MemberExpression',
                            object: {
                                type: 'MemberExpression',
                                object: {
                                    type: 'Identifier',
                                    name: CONTEXT_NAME,
                                },
                                property: {
                                    type: 'Identifier',
                                    name: kind,
                                },
                                computed: false,
                            },
                            property: {
                                type: 'Identifier',
                                name: scopedName,
                            },
                            computed: false,
                        },
                        kind: 'init',
                        method: false,
                        shorthand: false,
                        computed: false,
                    };
                }
                return prop;
            });
        } else if (node.argument.type === 'Identifier') {
            // Handle identifier return values
            const [scopedName, kind] = scopeManager.getVariable(node.argument.name);
            node.argument = {
                type: 'MemberExpression',
                object: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: CONTEXT_NAME,
                    },
                    property: {
                        type: 'Identifier',
                        name: kind,
                    },
                    computed: false,
                },
                property: {
                    type: 'Identifier',
                    name: scopedName,
                },
                computed: false,
            };

            // Add [0] array access
            node.argument = {
                type: 'MemberExpression',
                object: node.argument,
                property: {
                    type: 'Literal',
                    value: 0,
                },
                computed: true,
            };
        }

        if (curScope === 'fn') {
            //for nested functions : wrap the return argument in a CallExpression with math._precision(<statement>)
            node.argument = {
                type: 'CallExpression',
                callee: {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: CONTEXT_NAME },
                    property: { type: 'Identifier', name: 'precision' },
                },
                arguments: [node.argument],
            };
        }
    }
}

function transformIdentifierForParam(node: any, scopeManager: ScopeManager): any {
    if (node.type === 'Identifier') {
        // Skip transformation for loop variables
        if (scopeManager.isLoopVariable(node.name)) {
            return node;
        }
        // If it's a root parameter, transform it with $.let prefix
        if (scopeManager.isRootParam(node.name)) {
            const [scopedName, kind] = scopeManager.getVariable(node.name);
            return {
                type: 'MemberExpression',
                object: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: CONTEXT_NAME,
                    },
                    property: {
                        type: 'Identifier',
                        name: kind,
                    },
                    computed: false,
                },
                property: {
                    type: 'Identifier',
                    name: scopedName,
                },
                computed: false,
            };
        }
        // If it's a nested function parameter or other context-bound variable, return as is
        if (scopeManager.isContextBound(node.name)) {
            return node;
        }
        // Otherwise transform with $.let prefix
        const [scopedName, kind] = scopeManager.getVariable(node.name);

        return {
            type: 'MemberExpression',
            object: {
                type: 'MemberExpression',
                object: {
                    type: 'Identifier',
                    name: CONTEXT_NAME,
                },
                property: {
                    type: 'Identifier',
                    name: kind,
                },
                computed: false,
            },
            property: {
                type: 'Identifier',
                name: scopedName,
            },
            computed: false,
        };
    }
    return node;
}

function transformOperand(node: any, scopeManager: ScopeManager, namespace: string = ''): any {
    if (node.type === 'BinaryExpression') {
        return transformBinaryExpression(node, scopeManager, namespace);
    }

    if (node.type === 'MemberExpression') {
        // Handle array access
        const transformedObject = node.object.type === 'Identifier' ? transformIdentifierForParam(node.object, scopeManager) : node.object;
        // Don't add [0] if this is already an array access
        return {
            type: 'MemberExpression',
            object: transformedObject,
            property: node.property,
            computed: node.computed,
        };
    } else if (node.type === 'Identifier') {
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

        return {
            type: 'MemberExpression',
            object: transformedObject,
            property: {
                type: 'Literal',
                value: 0,
            },
            computed: true,
        };
        //transformArrayIndex(node, scopeManager);
    }
    return node;
}

function transformBinaryExpression(node: any, scopeManager: ScopeManager, namespace: string): any {
    // Transform both operands
    const transformedLeft = transformOperand(node.left, scopeManager, namespace);
    const transformedRight = transformOperand(node.right, scopeManager, namespace);

    // if (transformedLeft?.property?.type === 'Identifier') {
    //     transformMemberExpression(transformedLeft, '', scopeManager);
    //     //transformIdentifier(transformedLeft.property, scopeManager);
    // }
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

    // Wrap the binary expression with namespace.param()
    return {
        type: 'CallExpression',
        callee: {
            type: 'MemberExpression',
            object: {
                type: 'Identifier',
                name: namespace,
            },
            property: {
                type: 'Identifier',
                name: 'param',
            },
            computed: false,
        },
        arguments: [binaryExpr, UNDEFINED_ARG, scopeManager.nextParamIdArg],
        _transformed: true,
        _isParamCall: true,
    };
}

function transformFunctionArgument(arg: any, namespace: string, scopeManager: ScopeManager): any {
    // Handle binary expressions (arithmetic operations)
    if (arg.type === 'BinaryExpression') {
        return transformBinaryExpression(arg, scopeManager, namespace);
    }

    // Check if the argument is an array access
    const isArrayAccess = arg.type === 'MemberExpression' && arg.computed && arg.property;

    if (isArrayAccess) {
        // Transform array access
        const transformedObject =
            arg.object.type === 'Identifier' && scopeManager.isContextBound(arg.object.name) && !scopeManager.isRootParam(arg.object.name)
                ? arg.object
                : transformIdentifierForParam(arg.object, scopeManager);

        // Transform the index if it's an identifier
        const transformedProperty =
            arg.property.type === 'Identifier' && !scopeManager.isContextBound(arg.property.name) && !scopeManager.isLoopVariable(arg.property.name)
                ? transformIdentifierForParam(arg.property, scopeManager)
                : arg.property;

        // const memberExpr = {
        //     type: 'MemberExpression',
        //     object: transformedObject,
        //     property: transformedProperty,
        //     computed: true,
        // };

        return {
            type: 'CallExpression',
            callee: {
                type: 'MemberExpression',
                object: {
                    type: 'Identifier',
                    name: namespace,
                },
                property: {
                    type: 'Identifier',
                    name: 'param',
                },
                computed: false,
            },
            arguments: [transformedObject, transformedProperty, scopeManager.nextParamIdArg],
            _transformed: true,
            _isParamCall: true,
        };
    }

    if (arg.type === 'ObjectExpression') {
        arg.properties = arg.properties.map((prop: any) => {
            // Get the variable name and kind
            if (prop.value.name) {
                const [scopedName, kind] = scopeManager.getVariable(prop.value.name);

                // Convert shorthand to full property definition
                return {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: prop.key.name,
                    },
                    value: {
                        type: 'MemberExpression',
                        object: {
                            type: 'MemberExpression',
                            object: {
                                type: 'Identifier',
                                name: CONTEXT_NAME,
                            },
                            property: {
                                type: 'Identifier',
                                name: kind,
                            },
                            computed: false,
                        },
                        property: {
                            type: 'Identifier',
                            name: scopedName,
                        },
                        computed: false,
                    },
                    kind: 'init',
                    method: false,
                    shorthand: false,
                    computed: false,
                };
            }
            return prop;
        });
    }
    // For non-array-access arguments
    if (arg.type === 'Identifier') {
        // If it's a context-bound variable (like a nested function parameter), use it directly
        if (scopeManager.isContextBound(arg.name) && !scopeManager.isRootParam(arg.name)) {
            return {
                type: 'CallExpression',
                callee: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: namespace,
                    },
                    property: {
                        type: 'Identifier',
                        name: 'param',
                    },
                    computed: false,
                },
                arguments: [arg, UNDEFINED_ARG, scopeManager.nextParamIdArg],
                _transformed: true,
                _isParamCall: true,
            };
        }
    }

    // For all other cases, transform normally

    if (arg?.type === 'CallExpression') {
        transformCallExpression(arg, scopeManager);
    }
    return {
        type: 'CallExpression',
        callee: {
            type: 'MemberExpression',
            object: {
                type: 'Identifier',
                name: namespace,
            },
            property: {
                type: 'Identifier',
                name: 'param',
            },
            computed: false,
        },
        arguments: [arg.type === 'Identifier' ? transformIdentifierForParam(arg, scopeManager) : arg, UNDEFINED_ARG, scopeManager.nextParamIdArg],
        _transformed: true,
        _isParamCall: true,
    };
}

function transformCallExpression(node: any, scopeManager: ScopeManager): void {
    // Skip if this node has already been transformed
    if (node._transformed) {
        return;
    }

    // Check if this is a namespace method call (e.g., ta.ema, math.abs)
    const isNamespaceCall =
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object &&
        node.callee.object.type === 'Identifier' &&
        (scopeManager.isContextBound(node.callee.object.name) || node.callee.object.name === 'math' || node.callee.object.name === 'ta');

    if (isNamespaceCall) {
        const namespace = node.callee.object.name;
        // Transform arguments using the namespace's param
        node.arguments = node.arguments.map((arg: any) => {
            // If argument is already a param call, don't wrap it again
            if (arg._isParamCall) {
                return arg;
            }
            return transformFunctionArgument(arg, namespace, scopeManager);
        });
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
        node._transformed = true;
    }

    // Transform any nested call expressions in the arguments
    node.arguments.forEach((arg: any) => {
        walk.recursive(arg, scopeManager, {
            CallExpression(node: any, state: ScopeManager) {
                if (!node._transformed) {
                    transformCallExpression(node, state);
                }
            },
            MemberExpression(node: any) {
                transformMemberExpression(node, '', scopeManager);
            },
        });
    });
}

function transformFunctionDeclaration(node: any, scopeManager: ScopeManager): void {
    // Register function parameters as context-bound (but not as root params)
    node.params.forEach((param: any) => {
        if (param.type === 'Identifier') {
            scopeManager.addContextBoundVar(param.name, false);
        }
    });

    // Transform the function body
    if (node.body && node.body.type === 'BlockStatement') {
        scopeManager.pushScope('fn');
        walk.recursive(node.body, scopeManager, {
            BlockStatement(node: any, state: ScopeManager, c: any) {
                //state.pushScope('block');
                node.body.forEach((stmt: any) => c(stmt, state));
                //state.popScope();
            },
            ReturnStatement(node: any, state: ScopeManager) {
                transformReturnStatement(node, state);
            },
            VariableDeclaration(node: any, state: ScopeManager) {
                transformVariableDeclaration(node, state);
            },
            Identifier(node: any, state: ScopeManager) {
                transformIdentifier(node, state);
            },
            CallExpression(node: any, state: ScopeManager) {
                // Transform the call expression itself
                transformCallExpression(node, state);

                // Also transform any nested call expressions in the arguments
                node.arguments.forEach((arg: any) => {
                    if (arg.type === 'BinaryExpression') {
                        walk.recursive(arg, state, {
                            CallExpression(node: any, state: ScopeManager) {
                                transformCallExpression(node, state);
                            },
                            MemberExpression(node: any) {
                                transformMemberExpression(node, '', state);
                            },
                        });
                    }
                });
            },
            MemberExpression(node: any) {
                transformMemberExpression(node, '', scopeManager);
            },
            AssignmentExpression(node: any, state: ScopeManager) {
                transformAssignmentExpression(node, state);
            },
            ForStatement(node: any, state: ScopeManager, c: any) {
                transformForStatement(node, state, c);
            },
            IfStatement(node: any, state: ScopeManager, c: any) {
                transformIfStatement(node, state, c);
            },
            BinaryExpression(node: any, state: ScopeManager, c: any) {
                // Transform both sides of binary expressions
                walk.recursive(node, state, {
                    CallExpression(node: any, state: ScopeManager) {
                        transformCallExpression(node, state);
                    },
                    MemberExpression(node: any) {
                        transformMemberExpression(node, '', state);
                    },
                });
            },
        });
        scopeManager.popScope();
    }
}
function addArrayAccess(node: any, scopeManager: ScopeManager): void {
    Object.assign(node, {
        type: 'MemberExpression',
        object: {
            type: 'Identifier',
            name: node.name,
            start: node.start,
            end: node.end,
        },
        property: {
            type: 'Literal',
            value: 0,
        },
        computed: true,
        _indexTransformed: true,
    });
}
function transformForStatement(node: any, scopeManager: ScopeManager, c: any): void {
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
        if (decl.init) {
            walk.recursive(decl.init, scopeManager, {
                Identifier(node: any, state: ScopeManager) {
                    if (!scopeManager.isLoopVariable(node.name)) {
                        scopeManager.pushScope('for');
                        transformIdentifier(node, state);
                        scopeManager.popScope();
                    }
                },
                MemberExpression(node: any) {
                    scopeManager.pushScope('for');
                    transformMemberExpression(node, '', scopeManager);
                    scopeManager.popScope();
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
                        node.computed = true;
                        addArrayAccess(node, state);
                    }
                    scopeManager.popScope();
                }
            },
            MemberExpression(node: any) {
                scopeManager.pushScope('for');
                transformMemberExpression(node, '', scopeManager);
                scopeManager.popScope();
            },
        });
    }

    // Transform update expression
    if (node.update) {
        walk.recursive(node.update, scopeManager, {
            Identifier(node: any, state: ScopeManager) {
                if (!scopeManager.isLoopVariable(node.name)) {
                    scopeManager.pushScope('for');
                    transformIdentifier(node, state);
                    scopeManager.popScope();
                }
            },
        });
    }

    // Transform the loop body
    scopeManager.pushScope('for');
    c(node.body, scopeManager);
    scopeManager.popScope();
}

function transformExpression(node: any, scopeManager: ScopeManager): void {
    walk.recursive(node, scopeManager, {
        MemberExpression(node: any) {
            transformMemberExpression(node, '', scopeManager);
        },

        CallExpression(node: any, state: ScopeManager) {
            transformCallExpression(node, state);
        },
        Identifier(node: any, state: ScopeManager) {
            transformIdentifier(node, state);

            //context bound variable was not transformed, but we still need to ensure array annotation
            const isIfStatement = scopeManager.getCurrentScopeType() === 'if';
            const isContextBound = scopeManager.isContextBound(node.name) && !scopeManager.isRootParam(node.name);
            if (isContextBound && isIfStatement) {
                addArrayAccess(node, state);
            }
        },
    });
}

function transformIfStatement(node: any, scopeManager: ScopeManager, c: any): void {
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

function transformNestedArrowFunctions(ast: any): void {
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

// Add new function for pre-processing context-bound variables
function preProcessContextBoundVars(ast: any, scopeManager: ScopeManager): void {
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

export function transpile(fn: string | Function): Function {
    let code = typeof fn === 'function' ? fn.toString() : fn;

    // Parse the code into an AST
    const ast = acorn.parse(code.trim(), {
        ecmaVersion: 'latest',
        sourceType: 'module',
    });

    // Pre-process: Transform all nested arrow functions
    transformNestedArrowFunctions(ast);

    const scopeManager = new ScopeManager();
    let originalParamName: string;

    // Pre-process: Identify context-bound variables
    preProcessContextBoundVars(ast, scopeManager);

    // First pass: register all function declarations and their parameters
    walk.simple(ast, {
        FunctionDeclaration(node: any) {
            transformFunctionDeclaration(node, scopeManager);
        },
        ArrowFunctionExpression(node: any) {
            const isRootFunction = node.start === 0;
            if (isRootFunction && node.params && node.params.length > 0) {
                originalParamName = node.params[0].name;
                node.params[0].name = CONTEXT_NAME;
            }
            transformArrowFunctionParams(node, scopeManager, isRootFunction);
        },
        VariableDeclaration(node: any) {
            node.declarations.forEach((decl: any) => {
                if (decl.id.type === 'ArrayPattern') {
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

    // Second pass: transform the code
    walk.recursive(ast, scopeManager, {
        BlockStatement(node: any, state: ScopeManager, c: any) {
            //state.pushScope('block');
            node.body.forEach((stmt: any) => c(stmt, state));
            //state.popScope();
        },
        ReturnStatement(node: any, state: ScopeManager) {
            transformReturnStatement(node, state);
        },
        VariableDeclaration(node: any, state: ScopeManager) {
            transformVariableDeclaration(node, state);
        },
        Identifier(node: any, state: ScopeManager) {
            transformIdentifier(node, state);
        },
        CallExpression(node: any, state: ScopeManager) {
            transformCallExpression(node, state);
        },
        MemberExpression(node: any) {
            transformMemberExpression(node, originalParamName, scopeManager);
        },
        AssignmentExpression(node: any, state: ScopeManager) {
            transformAssignmentExpression(node, state);
        },
        FunctionDeclaration(node: any, state: ScopeManager) {
            // Skip transformation since we already handled it in the first pass
            return;
        },
        ForStatement(node: any, state: ScopeManager, c: any) {
            transformForStatement(node, state, c);
        },
        IfStatement(node: any, state: ScopeManager, c: any) {
            transformIfStatement(node, state, c);
        },
    });

    const transformedCode = astring.generate(ast);

    const _wraperFunction = new Function('', `return ${transformedCode}`);
    return _wraperFunction(this);
}
