// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// JavaScript Code Generator for PineScript AST
// Transforms ESTree-compatible AST into JavaScript code

import { CONTEXT_PINE_VARS, NAMESPACE_COLLISION_NAMES, JS_RESERVED_WORDS } from '../settings';

// Set of names that conflict with Pine context variables/namespaces.
// Function parameters with these names must be renamed to avoid Phase 2
// transpiler incorrectly treating them as namespace references (e.g., color.__value()).
const CONFLICTING_NAMES = new Set(CONTEXT_PINE_VARS);

export class CodeGenerator {
    private indent: number;
    private indentStr: string;
    private output: string[];
    private sourceCode: string | null;
    private sourceLines: string[];
    private lastCommentedLine: number;
    private includeSourceComments: boolean;
    private paramRenameCounter: number;
    // Maps user-defined function names to their ordered parameter names.
    // Used to resolve named arguments to correct positional slots.
    private functionParams: Map<string, string[]>;
    constructor(options: { indentStr?: string; sourceCode?: string; includeSourceComments?: boolean } = {}) {
        this.indent = 0;
        this.indentStr = options.indentStr || '  ';
        this.output = [];
        this.sourceCode = options.sourceCode || null;
        this.sourceLines = this.sourceCode ? this.sourceCode.split('\n') : [];
        this.lastCommentedLine = -1;
        this.includeSourceComments = options.includeSourceComments || false; // default false
        this.paramRenameCounter = 0;
        this.functionParams = new Map();
    }

    /**
     * Pine Script treats `_` as a write-only discard identifier: it may be
     * declared any number of times, in any scope, including several times in
     * the same scope (`[_, s, _] = ...` followed by `[_, t, _] = ...`, or a
     * plain `_ = expr` repeated). JavaScript forbids re-declaring a `let`/`var`
     * binding in one scope, so every `_` declaration target is renamed to a
     * fresh `_$N` placeholder. `$` is not a legal Pine identifier character,
     * so the placeholders can never collide with user variables.
     *
     * Non-`_` duplicates inside one tuple (invalid Pine, but tolerated) fall
     * back to a numeric suffix so the generated destructuring stays valid JS.
     */
    private renameDiscardTargets(elements: any[]) {
        const seen = new Set<string>();
        for (const el of elements) {
            if (!el || el.type !== 'Identifier') continue;
            if (el.name === '_') {
                el.name = this.freshDiscardName();
            } else if (seen.has(el.name)) {
                el.name = `${el.name}${this.paramRenameCounter++}`;
            }
            seen.add(el.name);
        }
    }

    private freshDiscardName(): string {
        return `_$${this.paramRenameCounter++}`;
    }

    generate(ast) {
        this.output = [];
        this.indent = 0;
        this.lastCommentedLine = -1;
        this.functionParams = new Map();

        if (ast.type === 'Program') {
            // Pre-scan: collect user-defined function parameter lists and
            // detect function names that collide with method call names.
            this.preProcessAST(ast);
            this.generateProgram(ast);
        } else {
            throw new Error(`Expected Program node, got ${ast.type}`);
        }

        return this.output.join('');
    }

    // Pre-scan AST to collect function parameter lists for named-arg resolution
    // and rename user variables that conflict with Pine namespace names.
    private preProcessAST(ast: any) {
        this.collectFunctionParams(ast);
        this.renameConflictingVariables(ast);
    }

    /**
     * Scan the program body for declarations whose names would collide with
     * either Pine namespaces or JavaScript reserved keywords. Rename them
     * with a `_$N` suffix.
     *
     * Two collision classes, one rename pass:
     *
     *  1. Pine namespace collisions (NAMESPACE_COLLISION_NAMES — e.g. `fill`,
     *     `size`, `color`, `line`): user variable would shadow the namespace
     *     destructured from `$.pine`. The CALL SITE `fill(...)` is the
     *     namespace, NOT the renamed variable, so callees are NOT renamed.
     *
     *  2. JS reserved keyword collisions (JS_RESERVED_WORDS — e.g. `delete`,
     *     `super`, `static`): the generated JS would fail to parse
     *     (`function delete()` → "Unexpected keyword 'delete'"). The CALL SITE
     *     `delete(arg)` IS the user function, so callees MUST be renamed.
     *
     * The walker checks the original name's source list at each call site to
     * pick the right behavior.
     *
     * Renaming rules (common):
     * - Variable declaration target (let fill = ...)  → renamed
     * - Function declaration name (function delete()) → renamed (class 2 only)
     * - Assignment target (fill := ...)               → renamed
     * - Bare identifier read (return fill)            → renamed
     * - MemberExpression object (size.tiny)           → NOT renamed
     * - MemberExpression property (obj.delete)        → NOT renamed
     * - Object property key ({size: ...})             → NOT renamed
     */
    private renameConflictingVariables(ast: any) {
        const renameMap = new Map<string, string>();

        // Collect conflicting variable names from the entire program
        this.collectConflictingVarNames(ast, renameMap);

        if (renameMap.size > 0) {
            // Apply context-aware renaming across the entire program body
            this.renameVariableRefsInAST(ast, renameMap);
        }
    }

    /**
     * True if `name` requires renaming — either a Pine namespace collision
     * or a JS reserved keyword (which would make the generated JS invalid).
     */
    private isReservedName(name: string | undefined): boolean {
        return !!name && (NAMESPACE_COLLISION_NAMES.has(name) || JS_RESERVED_WORDS.has(name));
    }

    /**
     * Walk the AST and collect declarations whose names conflict with either
     * Pine namespaces (NAMESPACE_COLLISION_NAMES) or JS reserved keywords
     * (JS_RESERVED_WORDS). Both collision classes are renamed with the same
     * `_$N` suffix scheme.
     */
    private collectConflictingVarNames(node: any, renameMap: Map<string, string>) {
        if (!node || typeof node !== 'object') return;

        if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id?.type === 'Identifier' && this.isReservedName(decl.id.name) && !renameMap.has(decl.id.name)) {
                    renameMap.set(decl.id.name, `${decl.id.name}_$${this.paramRenameCounter++}`);
                }
                if (decl.id?.type === 'ArrayPattern') {
                    for (const el of decl.id.elements) {
                        if (el?.type === 'Identifier' && this.isReservedName(el.name) && !renameMap.has(el.name)) {
                            renameMap.set(el.name, `${el.name}_$${this.paramRenameCounter++}`);
                        }
                    }
                }
            }
        }

        if (node.type === 'AssignmentExpression' || node.type === 'ReassignmentExpression') {
            if (node.left?.type === 'Identifier' && this.isReservedName(node.left.name) && !renameMap.has(node.left.name)) {
                renameMap.set(node.left.name, `${node.left.name}_$${this.paramRenameCounter++}`);
            }
        }

        // User-defined function/method names that collide with reserved identifiers.
        // The function body inherits the rename via the same renameMap pass.
        //
        // Skip methods (`method foo(...) =>`): their JS identifier already gets
        // a `$M_` prefix in `generateFunctionDeclaration` which is collision-
        // proof by construction. Adding `_$N` on top would change the Pine
        // name visible at the call site (`obj.delete()` looks up `delete`,
        // not `delete_$0`), breaking UFCS retargeting in ExpressionTransformer.
        if (node.type === 'FunctionDeclaration') {
            if (node.id?.type === 'Identifier' &&
                !node.id.isMethod &&
                this.isReservedName(node.id.name) &&
                !renameMap.has(node.id.name)) {
                renameMap.set(node.id.name, `${node.id.name}_$${this.paramRenameCounter++}`);
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const child of val) {
                    if (child && typeof child === 'object') {
                        this.collectConflictingVarNames(child, renameMap);
                    }
                }
            } else if (val && typeof val === 'object' && val.type) {
                this.collectConflictingVarNames(val, renameMap);
            }
        }
    }

    /**
     * Context-aware variable reference renaming.
     * Renames Identifiers that are user-variable references, but skips:
     * - CallExpression callees (namespace function calls)
     * - MemberExpression objects with non-computed property (namespace.member)
     * - MemberExpression non-computed properties (obj.namespace)
     * - Object property keys ({namespace: value})
     */
    private renameVariableRefsInAST(node: any, renameMap: Map<string, string>) {
        if (!node || typeof node !== 'object') return;

        // CallExpression: handle direct-Identifier callees specially.
        if (node.type === 'CallExpression') {
            if (node.callee?.type === 'Identifier' && renameMap.has(node.callee.name)) {
                // Two cases:
                //   - JS_RESERVED_WORDS rename (e.g. user `method delete` → `delete_$N`):
                //     the callee IS the user function — must be renamed.
                //   - NAMESPACE_COLLISION_NAMES rename (e.g. user `var fill = ...` while
                //     also calling the built-in `fill(...)`): the callee here refers to
                //     the namespace, not the renamed user variable — leave it alone.
                if (JS_RESERVED_WORDS.has(node.callee.name)) {
                    node.callee.name = renameMap.get(node.callee.name)!;
                }
                // else: skip callee
            } else {
                this.renameVariableRefsInAST(node.callee, renameMap);
            }
            if (node.arguments) {
                for (const arg of node.arguments) {
                    this.renameVariableRefsInAST(arg, renameMap);
                }
            }
            return;
        }

        // MemberExpression: skip object if it has a non-computed property access
        // (e.g., size.tiny — size is a namespace, not a variable)
        // Also skip non-computed property identifiers (e.g., array.size)
        if (node.type === 'MemberExpression') {
            if (!node.computed && node.object?.type === 'Identifier' && renameMap.has(node.object.name)) {
                // size.tiny → namespace access, skip object, skip property
                return;
            }
            if (!node.computed && node.property?.type === 'Identifier' && renameMap.has(node.property.name)) {
                // array.size → method name, recurse object only, skip property
                this.renameVariableRefsInAST(node.object, renameMap);
                return;
            }
            // For other MemberExpressions (computed or no match), recurse normally
            this.renameVariableRefsInAST(node.object, renameMap);
            if (node.computed) this.renameVariableRefsInAST(node.property, renameMap);
            return;
        }

        // Property: skip key, rename value
        if (node.type === 'Property') {
            // Key is a named argument or object literal key — never rename
            this.renameVariableRefsInAST(node.value, renameMap);
            return;
        }

        // Leaf: rename matching Identifier
        if (node.type === 'Identifier' && renameMap.has(node.name)) {
            node.name = renameMap.get(node.name);
            return;
        }

        // Recurse into all children
        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const child of val) {
                    if (child && typeof child === 'object') {
                        this.renameVariableRefsInAST(child, renameMap);
                    }
                }
            } else if (val && typeof val === 'object' && val.type) {
                this.renameVariableRefsInAST(val, renameMap);
            }
        }
    }

    // Pre-scan AST to collect function parameter names for named-arg resolution.
    private collectFunctionParams(node: any) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'FunctionDeclaration' && node.id?.name) {
            const paramNames: string[] = [];
            for (const p of node.params) {
                if (p.type === 'Identifier') paramNames.push(p.name);
                else if (p.type === 'AssignmentPattern' && p.left?.name) paramNames.push(p.left.name);
            }
            this.functionParams.set(node.id.name, paramNames);
        }
        // Recurse into body
        if (Array.isArray(node.body)) {
            for (const child of node.body) this.collectFunctionParams(child);
        } else if (node.body && typeof node.body === 'object') {
            this.collectFunctionParams(node.body);
        }
    }

    // Write source code comments
    writeSourceComment(startLine, endLine = null) {
        if (!this.sourceLines.length) return;

        const end = endLine || startLine;
        const linesToComment = [];

        for (let i = startLine - 1; i < end && i < this.sourceLines.length; i++) {
            if (i > this.lastCommentedLine) {
                const line = this.sourceLines[i].trim();
                // Skip empty lines and version directives
                if (line && !line.startsWith('//@') && !line.startsWith('//')) {
                    linesToComment.push(this.sourceLines[i]);
                }
            }
        }

        if (linesToComment.length > 0) {
            for (const line of linesToComment) {
                this.write(this.indentStr.repeat(this.indent));
                this.write('/// ');
                this.write(line.trimEnd());
                this.write('\n');
            }
            this.lastCommentedLine = Math.max(this.lastCommentedLine, end - 1);
        }
    }

    // Helper to add indentation
    write(str) {
        this.output.push(str);
    }

    writeLine(str = '') {
        if (str) {
            this.output.push(this.indentStr.repeat(this.indent) + str + '\n');
        } else {
            this.output.push('\n');
        }
    }

    increaseIndent() {
        this.indent++;
    }

    decreaseIndent() {
        this.indent--;
    }

    // Generate Program node
    generateProgram(node) {
        for (let i = 0; i < node.body.length; i++) {
            this.generateStatement(node.body[i]);

            // Add blank line between top-level declarations for readability
            if (i < node.body.length - 1) {
                const current = node.body[i];
                const next = node.body[i + 1];
                if (
                    (current.type === 'FunctionDeclaration' || current.type === 'TypeDefinition') &&
                    (next.type === 'FunctionDeclaration' || next.type === 'TypeDefinition')
                ) {
                    this.writeLine();
                }
            }
        }
    }

    // Generate any statement
    generateStatement(node) {
        // Emit source comment if line information is available and enabled
        if (this.includeSourceComments && node._line && this.sourceLines.length > 0) {
            this.writeSourceComment(node._line);
        }

        switch (node.type) {
            case 'FunctionDeclaration':
                return this.generateFunctionDeclaration(node);
            case 'VariableDeclaration':
                return this.generateVariableDeclaration(node);
            case 'ExpressionStatement':
                return this.generateExpressionStatement(node);
            case 'IfStatement':
                return this.generateIfStatement(node);
            case 'ForStatement':
                return this.generateForStatement(node);
            case 'WhileStatement':
                return this.generateWhileStatement(node);
            case 'ReturnStatement':
                return this.generateReturnStatement(node);
            case 'BlockStatement':
                return this.generateBlockStatement(node);
            case 'TypeDefinition':
                return this.generateTypeDefinition(node);
            default:
                throw new Error(`Unknown statement type: ${node.type}`);
        }
    }

    // Generate TypeDefinition (convert to Type(...) call)
    // Fields with defaults: { name: ['type', defaultExpr] }
    // Fields without defaults: { name: 'type' }
    generateTypeDefinition(node) {
        this.write(this.indentStr.repeat(this.indent));
        this.write(`const ${node.name} = Type({`);

        if (node.fields.length > 0) {
            this.write(' ');
            for (let i = 0; i < node.fields.length; i++) {
                const field = node.fields[i];
                if (field.defaultValue) {
                    this.write(`${field.name}: ['${field.type}', `);
                    this.generateExpression(field.defaultValue);
                    this.write(`]`);
                } else {
                    this.write(`${field.name}: '${field.type}'`);
                }
                if (i < node.fields.length - 1) {
                    this.write(', ');
                }
            }
            this.write(' ');
        }

        this.write('});\n');
    }

    // Rename Identifier nodes in an AST subtree (simple, non-context-aware).
    // Used for the `this → self` rewrite where every `this` refers to the
    // method receiver and must be rewritten unconditionally. Stops at
    // FunctionDeclaration boundaries.
    private renameIdentifiersInAST(node: any, renameMap: Map<string, string>) {
        if (!node || typeof node !== 'object') return;

        if (node.type === 'Identifier' && renameMap.has(node.name)) {
            node.name = renameMap.get(node.name);
            return;
        }

        // Don't recurse into nested function declarations (they have their own scope)
        if (node.type === 'FunctionDeclaration') return;

        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const child of val) {
                    if (child && typeof child === 'object') {
                        this.renameIdentifiersInAST(child, renameMap);
                    }
                }
            } else if (val && typeof val === 'object' && val.type) {
                this.renameIdentifiersInAST(val, renameMap);
            }
        }
    }

    // Rename Identifier nodes belonging to a function's parameters, when the
    // param name shadows a Pine namespace or built-in (e.g. param `color`
    // shadows the `color.new(...)` namespace). Context-aware:
    //   - MemberExpression objects with non-computed access (`color.new(...)`)
    //     are LEFT ALONE — those are namespace accesses, not the renamed param.
    //   - CallExpression callees that match the renamed name are LEFT ALONE
    //     for the same reason (`color(arg)` calls the namespace function).
    //   - Object literal property keys (`{ color: value }`) are LEFT ALONE.
    //   - Bare reads (`x = color`) and arguments (`color.new(color, 73)` —
    //     the inner one) ARE renamed.
    // Stops at nested FunctionDeclaration boundaries.
    private renameParamRefsInBody(node: any, renameMap: Map<string, string>) {
        if (!node || typeof node !== 'object') return;

        // Don't descend into nested functions — they have their own scope.
        if (node.type === 'FunctionDeclaration') return;

        // CallExpression: skip the callee Identifier when it matches a
        // renamed param (namespace function call: `color(arg)`).
        if (node.type === 'CallExpression') {
            if (node.callee?.type === 'Identifier' && renameMap.has(node.callee.name)) {
                // Skip callee — leave as namespace function reference.
            } else {
                this.renameParamRefsInBody(node.callee, renameMap);
            }
            if (node.arguments) {
                for (const arg of node.arguments) {
                    this.renameParamRefsInBody(arg, renameMap);
                }
            }
            return;
        }

        // MemberExpression: skip the object when it matches a renamed param
        // and the access is non-computed (namespace member access:
        // `color.new(...)`, `size.tiny`).
        if (node.type === 'MemberExpression') {
            if (!node.computed && node.object?.type === 'Identifier' && renameMap.has(node.object.name)) {
                // Skip the object; nothing else to rename here (property is
                // a static name on a namespace).
                return;
            }
            this.renameParamRefsInBody(node.object, renameMap);
            if (node.computed) this.renameParamRefsInBody(node.property, renameMap);
            return;
        }

        // Property: rename the value, never the key.
        if (node.type === 'Property') {
            this.renameParamRefsInBody(node.value, renameMap);
            return;
        }

        // Leaf: rename matching Identifier.
        if (node.type === 'Identifier' && renameMap.has(node.name)) {
            node.name = renameMap.get(node.name);
            return;
        }

        // Recurse into all children.
        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const child of val) {
                    if (child && typeof child === 'object') {
                        this.renameParamRefsInBody(child, renameMap);
                    }
                }
            } else if (val && typeof val === 'object' && val.type) {
                this.renameParamRefsInBody(val, renameMap);
            }
        }
    }

    // Generate FunctionDeclaration
    generateFunctionDeclaration(node) {
        this.write(this.indentStr.repeat(this.indent));

        // Methods are emitted as regular JS functions; the receiver is passed
        // explicitly as the first positional arg by the call-site rewrite
        // (see ExpressionTransformer's `obj.method(args)` → `$.call(method, id, obj, args)`).
        const isMethod = node.id.isMethod;

        // Detect function params that collide with Pine context names (namespaces, builtins, etc.)
        // and rename them to avoid Phase 2 transpiler misinterpreting them as namespace references.
        // e.g., parameter 'color' would be renamed to 'color_$0' to avoid color.__value() injection.
        // These renames must be applied context-aware in the body so namespace
        // usage (`color.new(...)`) is preserved while bare reads of the param
        // are rewritten.
        const paramRenameMap = new Map<string, string>();
        for (const param of node.params) {
            const paramName = param.type === 'AssignmentPattern' ? param.left.name : param.name;
            if (paramName && CONFLICTING_NAMES.has(paramName)) {
                const newName = `${paramName}_$${this.paramRenameCounter++}`;
                paramRenameMap.set(paramName, newName);
            }
        }

        // For methods whose first Pine param is `this` (the receiver), rename
        // it to `self` everywhere — `this` cannot survive as a JS param name
        // and the body's `this.x := y` mutations would otherwise leak onto
        // `globalThis` instead of the actual receiver. The call-site already
        // passes the receiver as the first positional arg, so renaming the
        // param keeps the calling convention consistent.
        // This rename is context-FREE (every `this` is the receiver), unlike
        // the param renames above.
        const isThisParam = (p: any) =>
            (p.type === 'Identifier' && p.name === 'this') ||
            (p.type === 'AssignmentPattern' && p.left?.name === 'this');
        const thisRenameMap = new Map<string, string>();
        if (isMethod && node.params.length > 0 && isThisParam(node.params[0])) {
            thisRenameMap.set('this', 'self');
        }

        // Apply renames to param nodes and function body.
        if (paramRenameMap.size > 0 || thisRenameMap.size > 0) {
            for (const param of node.params) {
                const target = param.type === 'AssignmentPattern' ? param.left : param;
                if (target?.type === 'Identifier') {
                    const newName = paramRenameMap.get(target.name) ?? thisRenameMap.get(target.name);
                    if (newName) target.name = newName;
                }
                if (param.type === 'AssignmentPattern' && param.right) {
                    // Default value expressions get the same treatment as the body.
                    if (paramRenameMap.size > 0) this.renameParamRefsInBody(param.right, paramRenameMap);
                    if (thisRenameMap.size > 0) this.renameIdentifiersInAST(param.right, thisRenameMap);
                }
            }
            // Body: namespace-shadowing param renames first (context-aware),
            // then the unconditional `this → self` rewrite.
            if (paramRenameMap.size > 0) this.renameParamRefsInBody(node.body, paramRenameMap);
            if (thisRenameMap.size > 0) this.renameIdentifiersInAST(node.body, thisRenameMap);
        }

        // Methods get a `$M_` prefix on their JS identifier so they can't
        // collide with a regular function of the same Pine name. Pine does
        // not allow `$` in identifiers, so this prefix is collision-proof.
        // The call-site rewrite (ExpressionTransformer) and the marker reader
        // (AnalysisPass) both know about the prefix.
        const jsFnName = isMethod ? `$M_${node.id.name}` : node.id.name;

        this.write('function ');
        this.write(jsFnName);
        this.write('(');

        // Parameters — render all of them, including the (now-renamed) `self`
        // receiver for methods. The receiver is passed explicitly by the
        // call-site rewrite, so it must appear in the param list.
        const params = node.params;

        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            if (param.type === 'Identifier') {
                this.write(param.name);
            } else if (param.type === 'AssignmentPattern') {
                this.write(param.left.name);
                this.write(' = ');
                this.generateExpression(param.right);
            }
            if (i < params.length - 1) {
                this.write(', ');
            }
        }

        this.write(') ');
        this.generateBlockStatement(node.body, false);
        this.write('\n');

        // Emit method marker so the transpile phase can distinguish Pine `method`
        // declarations from regular functions.  Regular functions must NOT be
        // callable via obj.func() dot-notation — only `method` declarations can.
        if (isMethod) {
            this.write(this.indentStr.repeat(this.indent));
            this.write(`${jsFnName}.__pineMethod__ = true;\n`);

            // Emit the declared receiver type (first-parameter type) so the
            // transpile phase can dispatch dot-calls on BUILT-IN receivers
            // (e.g. `method cell(table tb, ...)` called as `tb.cell(...)`)
            // to the user method by static type matching. Emitted separately
            // from __pineParamTypes__ because that marker skips the receiver
            // when it is named `this` (renamed to `self`).
            const recvParam = node.params[0];
            const recvType = recvParam?.type === 'AssignmentPattern' ? recvParam.left?.varType : recvParam?.varType;
            if (typeof recvType === 'string' && recvType.length > 0) {
                this.write(this.indentStr.repeat(this.indent));
                this.write(`${jsFnName}.__pineReceiverType__ = ${JSON.stringify(recvType)};\n`);
            }
        }

        // Emit param-type marker for any params that carried a Pine type
        // annotation (e.g. `readField(BAR b)`). The transpile phase reads
        // these to know which params are UDT instances, enabling correct
        // `b.field[N]` series-lookback rewriting inside the function body.
        // Inert at runtime; AnalysisPass filters to known UDT types.
        // Skip the method receiver (now renamed to `self`) — it's passed by
        // the caller, never a Series of UDT instances, so the rewrite would
        // be incorrect for it.
        const typedParams: Array<[string, string]> = [];
        for (let i = 0; i < node.params.length; i++) {
            const p = node.params[i];
            const paramName = p.type === 'AssignmentPattern' ? p.left?.name : p.name;
            if (isMethod && i === 0 && paramName === 'self') continue;
            const varType = p.type === 'AssignmentPattern' ? p.left?.varType : p.varType;
            if (paramName && varType) {
                typedParams.push([paramName, varType]);
            }
        }
        if (typedParams.length > 0) {
            this.write(this.indentStr.repeat(this.indent));
            const entries = typedParams
                .map(([n, t]) => `${JSON.stringify(n)}: ${JSON.stringify(t)}`)
                .join(', ');
            this.write(`${jsFnName}.__pineParamTypes__ = {${entries}};\n`);
        }
    }

    // Generate VariableDeclaration
    generateVariableDeclaration(node) {
        // PineScript var => JavaScript var (persistent state)
        // PineScript varip => JavaScript var (persistent intrabar state)
        // PineScript regular declarations => JavaScript let (re-initialized each bar)
        const kind = node.kind === 'var' || node.kind === 'varip' ? 'var' : 'let';

        for (let i = 0; i < node.declarations.length; i++) {
            const decl = node.declarations[i];

            // Pine's `_` discard identifier may be re-declared freely; give each
            // occurrence a unique JS name before any path below reads `decl.id`.
            if (decl.id?.type === 'Identifier' && decl.id.name === '_') {
                decl.id.name = this.freshDiscardName();
            } else if (decl.id?.type === 'ArrayPattern') {
                this.renameDiscardTargets(decl.id.elements);
            }

            // Check if init is a complex if expression that needs statement-based generation
            if (decl.init && decl.init.type === 'ConditionalExpression' && decl.init.needsIIFE) {
                // Generate: let varName;\n if (...) { varName = ... } else { varName = ... }
                const varName = decl.id.type === 'Identifier' ? decl.id.name : null;

                if (varName) {
                    // Declare variable without initialization
                    this.write(this.indentStr.repeat(this.indent));
                    this.write(kind);
                    this.write(' ');
                    this.write(varName);
                    this.write(';\n');

                    // Generate if statement that assigns to the variable
                    this.generateIfStatementWithAssignment(decl.init, varName);
                    continue;
                }
            }

            // Normal variable declaration
            this.write(this.indentStr.repeat(this.indent));
            this.write(kind);
            this.write(' ');

            if (decl.id.type === 'Identifier') {
                this.write(decl.id.name);
            } else if (decl.id.type === 'ArrayPattern') {
                // Tuple destructuring (`_` targets already renamed above)
                this.write('[');
                this.write(decl.id.elements.map((el) => el.name).join(', '));
                this.write(']');
            }

            if (decl.init) {
                this.write(' = ');
                this.generateExpression(decl.init);
            }

            this.write(';\n');

            // Preserve the explicit Pine type annotation so the AnalysisPass
            // can register the variable as a UDT instance even when the
            // initializer's type cannot be inferred from the expression alone
            // (e.g. `Holder r = arr.get(0)` or `Holder r = map.get(key)`).
            // Emit a bare string-literal expression statement — acorn keeps it
            // as `ExpressionStatement(Literal)` and it is a no-op at runtime.
            const declaredType = decl.id?.varType;
            const declaredName = decl.id?.type === 'Identifier' ? decl.id.name : null;
            if (
                declaredName &&
                typeof declaredType === 'string' &&
                /^[A-Za-z_$][\w$]*$/.test(declaredType) &&
                declaredType[0] === declaredType[0].toUpperCase()
            ) {
                this.write(this.indentStr.repeat(this.indent));
                this.write(`"__pineUdtVar:${declaredName}=${declaredType}";\n`);
            } else if (declaredName && typeof declaredType === 'string' && declaredType.length > 0) {
                // Built-in / generic type annotations (`table`, `array<float>`,
                // `series float`, ...) — preserved so the AnalysisPass can
                // register the variable's static type for user-method
                // dot-call dispatch on built-in receivers.
                this.write(this.indentStr.repeat(this.indent));
                this.write(`${JSON.stringify(`__pineTypedVar:${declaredName}=${declaredType}`)};\n`);
            }
        }
    }

    // Generate ExpressionStatement
    generateExpressionStatement(node) {
        // Special case: discriminant-less SwitchExpression used as a statement (not assigned to a variable)
        // should generate plain if/else, not IIFE. The IIFE is only needed in expression context.
        if (node.expression.type === 'SwitchExpression' && node.expression.discriminant === null) {
            this.write(this.indentStr.repeat(this.indent));
            this.generateSwitchAsIfElse(node.expression);
            this.write('\n');
            return;
        }
        this.write(this.indentStr.repeat(this.indent));
        this.generateExpression(node.expression);
        this.write(';\n');
    }

    // Generate IfStatement
    generateIfStatement(node) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('if (');
        this.generateExpression(node.test);
        this.write(') ');

        this.generateBlockStatement(node.consequent, false);

        if (node.alternate) {
            this.write(' else ');
            if (node.alternate.type === 'IfStatement') {
                // else if - don't add extra braces
                this.generateIfStatement(node.alternate);
            } else {
                this.generateBlockStatement(node.alternate, false);
            }
        } else {
            this.write('\n');
        }
    }

    // Generate if statement that assigns to a variable (for complex if expressions)
    generateIfStatementWithAssignment(condExpr, varName) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('if (');
        this.generateExpression(condExpr.test);
        this.write(') {\n');
        this.indent++;

        // Generate consequent statements with assignments
        if (condExpr.consequentStmts) {
            for (let i = 0; i < condExpr.consequentStmts.length; i++) {
                const stmt = condExpr.consequentStmts[i];
                const isLast = i === condExpr.consequentStmts.length - 1;

                if (isLast) {
                    // Last statement - assign to variable
                    if (stmt.type === 'ExpressionStatement') {
                        this.write(this.indentStr.repeat(this.indent));
                        this.write(varName);
                        this.write(' = ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        // Nested if statement - generate as proper if/else with assignments
                        this.generateNestedIfWithAssignments(stmt, varName);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }
        }

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('}');

        // Generate alternate
        if (condExpr.alternateExpr) {
            // Nested if expression
            this.write(' else {\n');
            this.indent++;
            this.write(this.indentStr.repeat(this.indent));
            this.write(varName);
            this.write(' = ');
            this.generateExpression(condExpr.alternateExpr);
            this.write(';\n');
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');
        } else if (condExpr.alternateStmts && condExpr.alternateStmts.length > 0) {
            // Alternate block
            this.write(' else {\n');
            this.indent++;
            for (let i = 0; i < condExpr.alternateStmts.length; i++) {
                const stmt = condExpr.alternateStmts[i];
                const isLast = i === condExpr.alternateStmts.length - 1;

                if (isLast) {
                    // Last statement - assign to variable
                    if (stmt.type === 'ExpressionStatement') {
                        this.write(this.indentStr.repeat(this.indent));
                        this.write(varName);
                        this.write(' = ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        // Nested if statement - generate as proper if/else with assignments
                        this.generateNestedIfWithAssignments(stmt, varName);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');
        } else {
            // No alternate
            this.write(' else {\n');
            this.indent++;
            this.write(this.indentStr.repeat(this.indent));
            this.write(varName);
            this.write(' = false;\n');
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');
        }

        this.write('\n');
    }

    // Helper to generate nested if statement with assignments (no IIFE)
    generateNestedIfWithAssignments(node, varName) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('if (');
        this.generateExpression(node.test);
        this.write(') {\n');
        this.indent++;

        // Generate consequent with assignments
        if (node.consequent.type === 'BlockStatement' && node.consequent.body.length > 0) {
            for (let i = 0; i < node.consequent.body.length; i++) {
                const stmt = node.consequent.body[i];
                const isLast = i === node.consequent.body.length - 1;

                if (isLast) {
                    // Last statement - assign
                    if (stmt.type === 'ExpressionStatement') {
                        this.write(this.indentStr.repeat(this.indent));
                        this.write(varName);
                        this.write(' = ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        // Recursively handle nested if
                        this.generateNestedIfWithAssignments(stmt, varName);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }
        }

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('}');

        // Generate alternate
        if (node.alternate) {
            if (node.alternate.type === 'IfStatement') {
                // else if
                this.write(' else ');
                this.write('if (');
                this.generateExpression(node.alternate.test);
                this.write(') {\n');
                this.indent++;

                // Handle consequent
                if (node.alternate.consequent.type === 'BlockStatement' && node.alternate.consequent.body.length > 0) {
                    for (let i = 0; i < node.alternate.consequent.body.length; i++) {
                        const stmt = node.alternate.consequent.body[i];
                        const isLast = i === node.alternate.consequent.body.length - 1;

                        if (isLast) {
                            if (stmt.type === 'ExpressionStatement') {
                                this.write(this.indentStr.repeat(this.indent));
                                this.write(varName);
                                this.write(' = ');
                                this.generateExpression(stmt.expression);
                                this.write(';\n');
                            } else if (stmt.type === 'IfStatement') {
                                this.generateNestedIfWithAssignments(stmt, varName);
                            } else {
                                this.generateStatement(stmt);
                            }
                        } else {
                            this.generateStatement(stmt);
                        }
                    }
                }

                this.indent--;
                this.write(this.indentStr.repeat(this.indent));
                this.write('}');

                // Recursively handle further alternates
                this.generateNestedIfAlternatesWithAssignments(node.alternate.alternate, varName);
            } else if (node.alternate.type === 'BlockStatement' && node.alternate.body.length > 0) {
                // else block
                this.write(' else {\n');
                this.indent++;

                for (let i = 0; i < node.alternate.body.length; i++) {
                    const stmt = node.alternate.body[i];
                    const isLast = i === node.alternate.body.length - 1;

                    if (isLast) {
                        // Last statement - assign
                        if (stmt.type === 'ExpressionStatement') {
                            this.write(this.indentStr.repeat(this.indent));
                            this.write(varName);
                            this.write(' = ');
                            this.generateExpression(stmt.expression);
                            this.write(';\n');
                        } else if (stmt.type === 'IfStatement') {
                            // Recursively handle nested if
                            this.generateNestedIfWithAssignments(stmt, varName);
                        } else {
                            this.generateStatement(stmt);
                        }
                    } else {
                        this.generateStatement(stmt);
                    }
                }

                this.indent--;
                this.write(this.indentStr.repeat(this.indent));
                this.write('}\n');
            } else {
                this.write(' else {\n');
                this.indent++;
                this.write(this.indentStr.repeat(this.indent));
                this.write(varName);
                this.write(' = false;\n');
                this.indent--;
                this.write(this.indentStr.repeat(this.indent));
                this.write('}\n');
            }
        } else {
            this.write('\n');
        }
    }

    // Helper to continue generating else if / else chain with assignments
    generateNestedIfAlternatesWithAssignments(alternate, varName) {
        if (!alternate) {
            return;
        }

        if (alternate.type === 'IfStatement') {
            // Continue else if chain
            this.write(' else ');
            this.write('if (');
            this.generateExpression(alternate.test);
            this.write(') {\n');
            this.indent++;

            // Handle consequent
            if (alternate.consequent.type === 'BlockStatement' && alternate.consequent.body.length > 0) {
                for (let i = 0; i < alternate.consequent.body.length; i++) {
                    const stmt = alternate.consequent.body[i];
                    const isLast = i === alternate.consequent.body.length - 1;

                    if (isLast) {
                        if (stmt.type === 'ExpressionStatement') {
                            this.write(this.indentStr.repeat(this.indent));
                            this.write(varName);
                            this.write(' = ');
                            this.generateExpression(stmt.expression);
                            this.write(';\n');
                        } else if (stmt.type === 'IfStatement') {
                            this.generateNestedIfWithAssignments(stmt, varName);
                        } else {
                            this.generateStatement(stmt);
                        }
                    } else {
                        this.generateStatement(stmt);
                    }
                }
            }

            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');

            // Continue recursively
            this.generateNestedIfAlternatesWithAssignments(alternate.alternate, varName);
        } else if (alternate.type === 'BlockStatement' && alternate.body.length > 0) {
            // Final else block
            this.write(' else {\n');
            this.indent++;

            for (let i = 0; i < alternate.body.length; i++) {
                const stmt = alternate.body[i];
                const isLast = i === alternate.body.length - 1;

                if (isLast) {
                    if (stmt.type === 'ExpressionStatement') {
                        this.write(this.indentStr.repeat(this.indent));
                        this.write(varName);
                        this.write(' = ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        this.generateNestedIfWithAssignments(stmt, varName);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }

            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}\n');
        } else {
            // No more alternates or empty else
            this.write(' else {\n');
            this.indent++;
            this.write(this.indentStr.repeat(this.indent));
            this.write(varName);
            this.write(' = false;\n');
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}\n');
        }
    }

    // Generate ForStatement
    generateForStatement(node) {
        this.write(this.indentStr.repeat(this.indent));

        // Check if this is a for-in loop (for item in array)
        if (node.isForIn) {
            // Generate: for (const item of array) { ... } or for (const [a, b] of array) { ... }
            this.write('for (');
            if (node.init && node.init.type === 'VariableDeclaration') {
                const decl = node.init.declarations[0];
                this.write(`${node.init.kind} `);

                // Handle both simple identifier and destructuring pattern
                if (decl.id.type === 'Identifier') {
                    this.write(decl.id.name);
                } else if (decl.id.type === 'ArrayPattern') {
                    // Destructuring: [a, b] — rename `_` discard placeholders
                    this.renameDiscardTargets(decl.id.elements);
                    this.write('[');
                    this.write(decl.id.elements.map((el) => el.name).join(', '));
                    this.write(']');
                }

                this.write(' of ');
                this.generateExpression(decl.init);
            }
            this.write(') ');
            this.generateBlockStatement(node.body, false);
            return;
        }

        // Regular range-based for loop
        this.write('for (');

        // Generate init
        if (node.init) {
            if (node.init.type === 'VariableDeclaration') {
                // Generate variable declaration inline
                const decl = node.init.declarations[0];
                this.write(`${node.init.kind} ${decl.id.name}`);
                if (decl.init) {
                    this.write(' = ');
                    this.generateExpression(decl.init);
                }
            } else {
                this.generateExpression(node.init);
            }
        }

        this.write('; ');

        // Generate test
        if (node.test) {
            this.generateExpression(node.test);
        }

        this.write('; ');

        // Generate update
        if (node.update) {
            if (node.update.type === 'AssignmentExpression') {
                this.generateExpression(node.update.left);
                this.write(` ${node.update.operator} `);
                this.generateExpression(node.update.right);
            } else {
                this.generateExpression(node.update);
            }
        }

        this.write(') ');
        this.generateBlockStatement(node.body, false);
    }

    // Generate WhileStatement
    generateWhileStatement(node) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('while (');
        this.generateExpression(node.test);
        this.write(') ');
        this.generateBlockStatement(node.body, false);
    }

    // Generate ReturnStatement
    generateReturnStatement(node) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('return');
        if (node.argument) {
            this.write(' ');
            this.generateExpression(node.argument);
        }
        this.write(';\n');
    }

    // Generate BlockStatement
    generateBlockStatement(node, addIndent = true) {
        this.write('{\n');
        if (addIndent) this.increaseIndent();
        else this.indent++;

        for (const stmt of node.body) {
            this.generateStatement(stmt);
        }

        if (addIndent) this.decreaseIndent();
        else this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('}');
        if (addIndent) this.write('\n');
    }

    // Generate any expression
    generateExpression(node) {
        switch (node.type) {
            case 'Identifier':
                return this.write(node.name);
            case 'Literal':
                return this.generateLiteral(node);
            case 'BinaryExpression':
            case 'LogicalExpression':
                return this.generateBinaryExpression(node);
            case 'UnaryExpression':
                return this.generateUnaryExpression(node);
            case 'AssignmentExpression':
                return this.generateAssignmentExpression(node);
            case 'UpdateExpression':
                return this.generateUpdateExpression(node);
            case 'CallExpression':
                return this.generateCallExpression(node);
            case 'MemberExpression':
                return this.generateMemberExpression(node);
            case 'ConditionalExpression':
                return this.generateConditionalExpression(node);
            case 'ArrayExpression':
                return this.generateArrayExpression(node);
            case 'ObjectExpression':
                return this.generateObjectExpression(node);
            case 'SwitchExpression':
                return this.generateSwitchExpression(node);
            case 'SequenceExpression':
                return this.generateSequenceExpression(node);
            case 'ForStatement':
                return this.generateLoopAsExpression(node, 'for');
            case 'WhileStatement':
                return this.generateLoopAsExpression(node, 'while');
            default:
                throw new Error(`Unknown expression type: ${node.type}`);
        }
    }

    // Generate Literal
    generateLiteral(node) {
        if (typeof node.value === 'string') {
            // Escape string and use single quotes
            const escaped = node.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
            this.write(`'${escaped}'`);
        } else if (node.value === null) {
            this.write('null');
        } else {
            // Numeric literal. Emit the NORMALIZED value (`.5` → `0.5`, `1e5` →
            // `100000`), but preserve float-ness for integer-valued float literals
            // (`2.0` → value 2 → "2" would read as an int). pine2js stores the raw
            // source text in node.raw; a `.` in it marks a float literal. This is
            // required so the int/float type inference can distinguish `2` from
            // `2.0` (`int / int` truncates in Pine, `int / float` does not).
            const s = String(node.value);
            if (typeof node.raw === 'string' && node.raw.includes('.') && !/[.eE]/.test(s)) {
                this.write(s + '.0');
            } else {
                this.write(s);
            }
        }
    }

    // Generate BinaryExpression
    generateBinaryExpression(node) {
        const currentPrecedence = this.getPrecedence(node);

        // Left child
        const leftPrecedence = this.getPrecedence(node.left);
        if (leftPrecedence < currentPrecedence) {
            this.write('(');
            this.generateExpression(node.left);
            this.write(')');
        } else {
            this.generateExpression(node.left);
        }

        this.write(' ');

        // Convert PineScript operators to JavaScript
        let op = node.operator;
        if (op === 'and') op = '&&';
        else if (op === 'or') op = '||';

        this.write(op);
        this.write(' ');

        // Right child
        const rightPrecedence = this.getPrecedence(node.right);
        let needsRightParens = rightPrecedence < currentPrecedence;

        // Handle associativity for same precedence
        if (rightPrecedence === currentPrecedence) {
            // Subtraction, division, modulo are non-associative (left-associative)
            // so we need parens for right operand
            if (op === '-' || op === '/' || op === '%') {
                needsRightParens = true;
            }
        }

        if (needsRightParens) {
            this.write('(');
            this.generateExpression(node.right);
            this.write(')');
        } else {
            this.generateExpression(node.right);
        }
    }

    // Generate UnaryExpression
    generateUnaryExpression(node) {
        let op = node.operator;
        if (op === 'not') op = '!';

        this.write(op);

        const argPrecedence = this.getPrecedence(node.argument);
        // Always wrap in parens if arg is also a unary with same operator to avoid --x or ++x
        const needsParens =
            argPrecedence < 15 ||
            (node.argument.type === 'UnaryExpression' && (op === '-' || op === '+') && (node.argument.operator === '-' || node.argument.operator === '+'));

        if (needsParens) {
            this.write('(');
            this.generateExpression(node.argument);
            this.write(')');
        } else {
            this.generateExpression(node.argument);
        }
    }

    // Generate AssignmentExpression
    generateAssignmentExpression(node) {
        this.generateExpression(node.left);
        this.write(' ');

        // Convert := to =
        let op = node.operator;
        if (op === ':=') op = '=';

        this.write(op);
        this.write(' ');
        this.generateExpression(node.right);
    }

    // Generate UpdateExpression
    generateUpdateExpression(node) {
        if (node.prefix) {
            this.write(node.operator);
            this.generateExpression(node.argument);
        } else {
            this.generateExpression(node.argument);
            this.write(node.operator);
        }
    }

    // Generate CallExpression
    generateCallExpression(node) {
        const calleePrecedence = this.getPrecedence(node.callee);
        if (calleePrecedence < 19) {
            this.write('(');
            this.generateExpression(node.callee);
            this.write(')');
        } else {
            this.generateExpression(node.callee);
        }

        this.write('(');

        // Check if this is a call to a user-defined function with named arguments.
        // Named args are collected into an ObjectExpression as the last argument by the parser.
        // For user-defined functions, we need to expand them into the correct positional slots.
        const calleeName = node.callee?.type === 'Identifier' ? node.callee.name : null;
        const paramList = calleeName ? this.functionParams.get(calleeName) : null;
        const lastArg = node.arguments.length > 0 ? node.arguments[node.arguments.length - 1] : null;
        const hasNamedArgs = lastArg?.type === 'ObjectExpression' && paramList;

        if (hasNamedArgs) {
            // Positional args (everything except the last ObjectExpression)
            const positionalArgs = node.arguments.slice(0, -1);
            // Named args from the ObjectExpression
            const namedArgMap = new Map<string, any>();
            for (const prop of lastArg.properties) {
                const key = prop.key?.name || prop.key?.value;
                if (key) namedArgMap.set(key, prop.value);
            }

            // Build the full argument list matching the function's parameter order.
            // Start with positional args, then fill in named args at their correct
            // parameter positions, using undefined for gaps.
            const fullArgs: any[] = [];
            let lastFilledIdx = -1;
            for (let i = 0; i < paramList.length; i++) {
                if (i < positionalArgs.length) {
                    fullArgs.push(positionalArgs[i]);
                    lastFilledIdx = i;
                } else if (namedArgMap.has(paramList[i])) {
                    fullArgs.push(namedArgMap.get(paramList[i]));
                    lastFilledIdx = i;
                } else {
                    fullArgs.push(null); // gap — will emit undefined
                }
            }

            // Trim trailing gaps (no need to emit trailing undefined args)
            const trimmedArgs = fullArgs.slice(0, lastFilledIdx + 1);

            for (let i = 0; i < trimmedArgs.length; i++) {
                if (trimmedArgs[i] === null) {
                    this.write('undefined');
                } else {
                    this.generateExpression(trimmedArgs[i]);
                }
                if (i < trimmedArgs.length - 1) {
                    this.write(', ');
                }
            }
        } else {
            for (let i = 0; i < node.arguments.length; i++) {
                const arg = node.arguments[i];

                // Handle named arguments (convert to object parameter)
                if (arg.type === 'AssignmentExpression' && arg.operator === '=') {
                    // For named args, we'll just pass the value
                    // The calling convention would need to be adjusted
                    this.generateExpression(arg.right);
                } else {
                    this.generateExpression(arg);
                }

                if (i < node.arguments.length - 1) {
                    this.write(', ');
                }
            }
        }

        this.write(')');
    }

    // Generate MemberExpression
    generateMemberExpression(node) {
        const objPrecedence = this.getPrecedence(node.object);
        if (objPrecedence < 19) {
            this.write('(');
            this.generateExpression(node.object);
            this.write(')');
        } else {
            this.generateExpression(node.object);
        }

        if (node.computed) {
            this.write('[');
            this.generateExpression(node.property);
            this.write(']');
        } else {
            this.write('.');
            this.generateExpression(node.property);
        }
    }

    // Generate ConditionalExpression (ternary or IIFE)
    generateConditionalExpression(node) {
        // Check if this needs to be an IIFE (multi-statement or control flow)
        if (node.needsIIFE) {
            this.generateIIFEConditional(node);
            return;
        }

        // Simple ternary
        this.write('(');
        this.generateExpression(node.test);
        this.write(' ? ');
        this.generateExpression(node.consequent);
        this.write(' : ');
        this.generateExpression(node.alternate);
        this.write(')');
    }

    // Generate IIFE for complex if expressions
    generateIIFEConditional(node) {
        this.write('(() => {\n');
        this.indent++;

        // Generate if statement with proper returns
        this.generateIIFEIfBlock(node);

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('})()');
    }

    // Helper to generate if block inside IIFE with returns
    generateIIFEIfBlock(node) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('if (');
        this.generateExpression(node.test);
        this.write(') {\n');
        this.indent++;

        // Generate consequent statements
        if (node.consequentStmts) {
            for (let i = 0; i < node.consequentStmts.length; i++) {
                const stmt = node.consequentStmts[i];
                const isLast = i === node.consequentStmts.length - 1;

                if (isLast) {
                    // Last statement - check if it needs special handling
                    if (stmt.type === 'ExpressionStatement') {
                        // Simple expression - add return
                        this.write(this.indentStr.repeat(this.indent));
                        this.write('return ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        // Nested if statement - generate as proper if/else with returns
                        this.generateNestedIfWithReturns(stmt);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }
        }

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('}');

        // Generate alternate
        if (node.alternateExpr) {
            // Nested if expression
            this.write(' else {\n');
            this.indent++;
            this.write(this.indentStr.repeat(this.indent));
            this.write('return ');
            this.generateExpression(node.alternateExpr);
            this.write(';\n');
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');
        } else if (node.alternateStmts && node.alternateStmts.length > 0) {
            // Alternate block
            this.write(' else {\n');
            this.indent++;
            for (let i = 0; i < node.alternateStmts.length; i++) {
                const stmt = node.alternateStmts[i];
                const isLast = i === node.alternateStmts.length - 1;

                if (isLast) {
                    // Last statement - check if it needs special handling
                    if (stmt.type === 'ExpressionStatement') {
                        // Simple expression - add return
                        this.write(this.indentStr.repeat(this.indent));
                        this.write('return ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        // Nested if statement - generate as proper if/else with returns
                        this.generateNestedIfWithReturns(stmt);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');
        } else {
            //No alternate
            this.write(' else {\n');
            this.indent++;
            this.write(this.indentStr.repeat(this.indent));
            this.write('return false;\n');
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');
        }

        this.write('\n');
    }

    // Helper to generate nested if statement with returns (for IIFE)
    generateNestedIfWithReturns(node) {
        this.write(this.indentStr.repeat(this.indent));
        this.write('if (');
        this.generateExpression(node.test);
        this.write(') {\n');
        this.indent++;

        // Generate consequent with returns
        if (node.consequent.type === 'BlockStatement' && node.consequent.body.length > 0) {
            for (let i = 0; i < node.consequent.body.length; i++) {
                const stmt = node.consequent.body[i];
                const isLast = i === node.consequent.body.length - 1;

                if (isLast) {
                    // Last statement - add return
                    if (stmt.type === 'ExpressionStatement') {
                        this.write(this.indentStr.repeat(this.indent));
                        this.write('return ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        // Recursively handle nested if
                        this.generateNestedIfWithReturns(stmt);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }
        }

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('}');

        // Generate alternate
        if (node.alternate) {
            if (node.alternate.type === 'IfStatement') {
                // else if - format properly without extra spaces
                this.write(' else ');
                // Don't call generateNestedIfWithReturns directly, manually generate to avoid indent
                this.write('if (');
                this.generateExpression(node.alternate.test);
                this.write(') {\n');
                this.indent++;

                // Handle consequent
                if (node.alternate.consequent.type === 'BlockStatement' && node.alternate.consequent.body.length > 0) {
                    for (let i = 0; i < node.alternate.consequent.body.length; i++) {
                        const stmt = node.alternate.consequent.body[i];
                        const isLast = i === node.alternate.consequent.body.length - 1;

                        if (isLast) {
                            if (stmt.type === 'ExpressionStatement') {
                                this.write(this.indentStr.repeat(this.indent));
                                this.write('return ');
                                this.generateExpression(stmt.expression);
                                this.write(';\n');
                            } else if (stmt.type === 'IfStatement') {
                                this.generateNestedIfWithReturns(stmt);
                            } else {
                                this.generateStatement(stmt);
                            }
                        } else {
                            this.generateStatement(stmt);
                        }
                    }
                }

                this.indent--;
                this.write(this.indentStr.repeat(this.indent));
                this.write('}');

                // Recursively handle further alternates
                this.generateNestedIfAlternates(node.alternate.alternate);
            } else if (node.alternate.type === 'BlockStatement' && node.alternate.body.length > 0) {
                // else block
                this.write(' else {\n');
                this.indent++;

                for (let i = 0; i < node.alternate.body.length; i++) {
                    const stmt = node.alternate.body[i];
                    const isLast = i === node.alternate.body.length - 1;

                    if (isLast) {
                        // Last statement - add return
                        if (stmt.type === 'ExpressionStatement') {
                            this.write(this.indentStr.repeat(this.indent));
                            this.write('return ');
                            this.generateExpression(stmt.expression);
                            this.write(';\n');
                        } else if (stmt.type === 'IfStatement') {
                            // Recursively handle nested if
                            this.generateNestedIfWithReturns(stmt);
                        } else {
                            this.generateStatement(stmt);
                        }
                    } else {
                        this.generateStatement(stmt);
                    }
                }

                this.indent--;
                this.write(this.indentStr.repeat(this.indent));
                this.write('}\n');
            } else {
                this.write(' else {\n');
                this.indent++;
                this.write(this.indentStr.repeat(this.indent));
                this.write('return false;\n');
                this.indent--;
                this.write(this.indentStr.repeat(this.indent));
                this.write('}\n');
            }
        } else {
            this.write('\n');
        }
    }

    // Helper to continue generating else if / else chain
    generateNestedIfAlternates(alternate) {
        if (!alternate) {
            return;
        }

        if (alternate.type === 'IfStatement') {
            // Continue else if chain
            this.write(' else ');
            this.write('if (');
            this.generateExpression(alternate.test);
            this.write(') {\n');
            this.indent++;

            // Handle consequent
            if (alternate.consequent.type === 'BlockStatement' && alternate.consequent.body.length > 0) {
                for (let i = 0; i < alternate.consequent.body.length; i++) {
                    const stmt = alternate.consequent.body[i];
                    const isLast = i === alternate.consequent.body.length - 1;

                    if (isLast) {
                        if (stmt.type === 'ExpressionStatement') {
                            this.write(this.indentStr.repeat(this.indent));
                            this.write('return ');
                            this.generateExpression(stmt.expression);
                            this.write(';\n');
                        } else if (stmt.type === 'IfStatement') {
                            this.generateNestedIfWithReturns(stmt);
                        } else {
                            this.generateStatement(stmt);
                        }
                    } else {
                        this.generateStatement(stmt);
                    }
                }
            }

            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');

            // Continue recursively
            this.generateNestedIfAlternates(alternate.alternate);
        } else if (alternate.type === 'BlockStatement' && alternate.body.length > 0) {
            // Final else block
            this.write(' else {\n');
            this.indent++;

            for (let i = 0; i < alternate.body.length; i++) {
                const stmt = alternate.body[i];
                const isLast = i === alternate.body.length - 1;

                if (isLast) {
                    if (stmt.type === 'ExpressionStatement') {
                        this.write(this.indentStr.repeat(this.indent));
                        this.write('return ');
                        this.generateExpression(stmt.expression);
                        this.write(';\n');
                    } else if (stmt.type === 'IfStatement') {
                        this.generateNestedIfWithReturns(stmt);
                    } else {
                        this.generateStatement(stmt);
                    }
                } else {
                    this.generateStatement(stmt);
                }
            }

            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}\n');
        } else {
            // No more alternates or empty else
            this.write(' else {\n');
            this.indent++;
            this.write(this.indentStr.repeat(this.indent));
            this.write('return false;\n');
            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}\n');
        }
    }

    // Helper to generate nested if as expression return
    generateNestedIfAsExpression(node) {
        if (node.type === 'IfStatement') {
            this.write('(');
            this.generateExpression(node.test);
            this.write(' ? ');

            // Get value from consequent
            if (node.consequent.type === 'BlockStatement' && node.consequent.body.length > 0) {
                const lastStmt = node.consequent.body[node.consequent.body.length - 1];
                if (lastStmt.type === 'ExpressionStatement') {
                    this.generateExpression(lastStmt.expression);
                } else if (lastStmt.type === 'IfStatement') {
                    this.generateNestedIfAsExpression(lastStmt);
                }
            }

            this.write(' : ');

            // Get value from alternate
            if (node.alternate) {
                if (node.alternate.type === 'IfStatement') {
                    this.generateNestedIfAsExpression(node.alternate);
                } else if (node.alternate.type === 'BlockStatement' && node.alternate.body.length > 0) {
                    const lastStmt = node.alternate.body[node.alternate.body.length - 1];
                    if (lastStmt.type === 'ExpressionStatement') {
                        this.generateExpression(lastStmt.expression);
                    }
                } else {
                    this.write('false');
                }
            } else {
                this.write('false');
            }

            this.write(')');
        }
    }

    // Generate ArrayExpression
    generateArrayExpression(node) {
        this.write('[');
        for (let i = 0; i < node.elements.length; i++) {
            this.generateExpression(node.elements[i]);
            if (i < node.elements.length - 1) {
                this.write(', ');
            }
        }
        this.write(']');
    }

    // Generate ObjectExpression
    generateObjectExpression(node) {
        this.write('{');
        for (let i = 0; i < node.properties.length; i++) {
            const prop = node.properties[i];

            if (prop.key.type === 'Identifier') {
                this.write(prop.key.name);
            } else {
                this.generateExpression(prop.key);
            }

            this.write(': ');
            this.generateExpression(prop.value);

            if (i < node.properties.length - 1) {
                this.write(', ');
            }
        }
        this.write('}');
    }

    // Generate SwitchExpression (convert to IIFE with switch statement or if/else if)
    generateSwitchExpression(node) {
        // If discriminant is null, it's a switch without expression - convert to IIFE with if/else if
        if (node.discriminant === null) {
            this.generateSwitchAsIfElseIIFE(node);
            return;
        }

        this.write('(() => {\n');
        this.indent++;
        this.write(this.indentStr.repeat(this.indent));

        this.write('switch (');
        this.generateExpression(node.discriminant);
        this.write(') {\n');

        this.indent++;

        for (const c of node.cases) {
            this.write(this.indentStr.repeat(this.indent));

            if (c.test) {
                this.write('case ');
                this.generateExpression(c.test);
                this.write(':\n');
            } else {
                this.write('default:\n');
            }

            this.indent++;

            // If case has multiple statements, generate all of them
            if (c.statements && c.statements.length > 0) {
                // Check if last statement is actually a value-producing statement
                const lastStmt = c.statements[c.statements.length - 1];
                const hasReturnValue = lastStmt.type === 'ExpressionStatement' || lastStmt.type === 'VariableDeclaration';

                if (hasReturnValue) {
                    // Generate all statements except the last one
                    for (let i = 0; i < c.statements.length - 1; i++) {
                        this.write(this.indentStr.repeat(this.indent));
                        this.generateStatement(c.statements[i]);
                    }
                    // Generate return with the last statement's value
                    this.write(this.indentStr.repeat(this.indent));
                    this.write('return ');
                    // If last statement is an ExpressionStatement, use its expression
                    if (lastStmt.type === 'ExpressionStatement') {
                        this.generateExpression(lastStmt.expression);
                    } else {
                        this.generateExpression(c.consequent);
                    }
                    this.write(';\n');
                } else {
                    // All statements are side-effect only (like IfStatement), generate all of them
                    for (let i = 0; i < c.statements.length; i++) {
                        this.write(this.indentStr.repeat(this.indent));
                        this.generateStatement(c.statements[i]);
                    }
                    // Add explicit return null
                    this.write(this.indentStr.repeat(this.indent));
                    this.write('return null;\n');
                }
            } else {
                // Single expression case
                this.write(this.indentStr.repeat(this.indent));
                this.write('return ');
                this.generateExpression(c.consequent);
                this.write(';\n');
            }

            this.indent--;
        }

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('}\n'); // end switch

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('})()');
    }

    // Generate switch without discriminant as IIFE with if/else if/else chain (for expression context)
    generateSwitchAsIfElseIIFE(node) {
        this.write('(() => {\n');
        this.indent++;

        this.write(this.indentStr.repeat(this.indent));
        for (let i = 0; i < node.cases.length; i++) {
            const c = node.cases[i];

            if (c.test) {
                if (i === 0) {
                    this.write('if (');
                } else {
                    this.write(' else if (');
                }
                this.generateExpression(c.test);
                this.write(') {\n');
            } else {
                if (i > 0) {
                    this.write(' else {\n');
                } else {
                    this.write('{\n');
                }
            }

            this.indent++;

            // Generate all statements except the last, then return the last value
            if (c.statements && c.statements.length > 0) {
                const lastStmt = c.statements[c.statements.length - 1];
                const hasReturnValue = lastStmt.type === 'ExpressionStatement' || lastStmt.type === 'VariableDeclaration';

                if (hasReturnValue) {
                    for (let j = 0; j < c.statements.length - 1; j++) {
                        this.write(this.indentStr.repeat(this.indent));
                        this.generateStatement(c.statements[j]);
                    }
                    this.write(this.indentStr.repeat(this.indent));
                    this.write('return ');
                    if (lastStmt.type === 'ExpressionStatement') {
                        this.generateExpression(lastStmt.expression);
                    } else {
                        this.generateExpression(c.consequent);
                    }
                    this.write(';\n');
                } else {
                    for (const stmt of c.statements) {
                        this.write(this.indentStr.repeat(this.indent));
                        this.generateStatement(stmt);
                    }
                    this.write(this.indentStr.repeat(this.indent));
                    this.write('return null;\n');
                }
            } else {
                this.write(this.indentStr.repeat(this.indent));
                this.write('return ');
                this.generateExpression(c.consequent);
                this.write(';\n');
            }

            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');

            if (i >= node.cases.length - 1) {
                this.write('\n');
            }
        }

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('})()');
    }

    // Generate switch without discriminant as if/else if/else chain (for statement context)
    generateSwitchAsIfElse(node) {
        for (let i = 0; i < node.cases.length; i++) {
            const c = node.cases[i];

            if (c.test) {
                // Regular case with a condition
                if (i === 0) {
                    this.write('if (');
                } else {
                    this.write(' else if (');
                }
                this.generateExpression(c.test);
                this.write(') {\n');
            } else {
                // Default case (no test)
                if (i > 0) {
                    this.write(' else {\n');
                } else {
                    // If default is the first (and only) case, just execute the statements
                    this.write('{\n');
                }
            }

            this.indent++;

            // Generate all statements in the case
            if (c.statements && c.statements.length > 0) {
                for (const stmt of c.statements) {
                    this.write(this.indentStr.repeat(this.indent));
                    this.generateStatement(stmt);
                }
            } else {
                // Single expression
                this.write(this.indentStr.repeat(this.indent));
                this.generateExpression(c.consequent);
                this.write(';\n');
            }

            this.indent--;
            this.write(this.indentStr.repeat(this.indent));
            this.write('}');

            // Add newline after closing brace, except for the last case
            if (i < node.cases.length - 1) {
                // No newline here, the next iteration will add 'else'
            } else {
                this.write('\n');
            }
        }
    }

    // Generate for/while loop used as expression (wrapped in IIFE)
    // The last expression in the loop body becomes the return value
    generateLoopAsExpression(node, loopType) {
        this.write('(() => {\n');
        this.indent++;

        // Declare result variable
        this.write(this.indentStr.repeat(this.indent));
        this.write('let __result;\n');

        // Modify the loop body: replace last expression statement with assignment to __result
        const body = node.body;
        if (body && body.body && body.body.length > 0) {
            const lastIdx = body.body.length - 1;
            const lastStmt = body.body[lastIdx];
            if (lastStmt.type === 'ExpressionStatement') {
                // Replace last expression with __result = expression
                body.body[lastIdx] = {
                    type: 'ExpressionStatement',
                    expression: {
                        type: 'AssignmentExpression',
                        operator: '=',
                        left: { type: 'Identifier', name: '__result' },
                        right: lastStmt.expression,
                    },
                    _line: lastStmt._line,
                };
            }
        }

        // Generate the loop statement
        if (loopType === 'for') {
            this.generateForStatement(node);
        } else {
            this.generateWhileStatement(node);
        }

        // Return result
        this.write(this.indentStr.repeat(this.indent));
        this.write('return __result;\n');

        this.indent--;
        this.write(this.indentStr.repeat(this.indent));
        this.write('})()');
    }

    // Generate SequenceExpression
    generateSequenceExpression(node) {
        this.write('(');
        for (let i = 0; i < node.expressions.length; i++) {
            this.generateExpression(node.expressions[i]);
            if (i < node.expressions.length - 1) {
                this.write(', ');
            }
        }
        this.write(')');
    }

    // Get operator precedence
    getPrecedence(node) {
        switch (node.type) {
            case 'Literal':
            case 'Identifier':
            case 'ArrayExpression':
            case 'ObjectExpression':
                return 20;
            case 'CallExpression':
            case 'MemberExpression':
                return 19;
            case 'UnaryExpression':
            case 'UpdateExpression':
                return 15; // !, +, -, ++, --
            case 'BinaryExpression':
            case 'LogicalExpression':
                switch (node.operator) {
                    case '*':
                    case '/':
                    case '%':
                        return 13;
                    case '+':
                    case '-':
                        return 12;
                    case '<':
                    case '<=':
                    case '>':
                    case '>=':
                        return 10;
                    case '==':
                    case '!=':
                        return 9;
                    case 'and': // PineScript 'and'
                    case '&&':
                        return 5;
                    case 'or': // PineScript 'or'
                    case '||':
                        return 4;
                    default:
                        return 0;
                }
            case 'ConditionalExpression':
                return 3;
            case 'AssignmentExpression':
            case 'AssignmentPattern':
                return 2;
            case 'SequenceExpression':
                return 1;
            default:
                return 0;
        }
    }
}
