// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// PineScript Parser with Proper Indentation Support
// Uses INDENT/DEDENT tokens from lexer

import { Token, TokenType } from './tokens';
import {
    Program,
    ExpressionStatement,
    VariableDeclaration,
    VariableDeclarator,
    FunctionDeclaration,
    TypeDefinition,
    IfStatement,
    ForStatement,
    WhileStatement,
    BlockStatement,
    ReturnStatement,
    Identifier,
    Literal,
    BinaryExpression,
    UnaryExpression,
    AssignmentExpression,
    UpdateExpression,
    CallExpression,
    MemberExpression,
    ConditionalExpression,
    ArrayExpression,
    ObjectExpression,
    Property,
    ArrayPattern,
    AssignmentPattern,
    ArrowFunctionExpression,
    SwitchExpression,
    SwitchCase,
    VariableDeclarationKind,
} from './ast';

export class Parser {
    private tokens: Token[];
    private pos: number;
    private functionNames: Set<string> = new Set();
    // Stack of parameter-name sets for currently-being-parsed function bodies.
    // When the body of fn `f(x, y) =>` is being parsed, the top frame is {x, y}.
    // Used to suppress the `name → name_var` rewrite for identifiers that are
    // really parameters of the enclosing function and just happen to share a
    // name with some other user function.
    private paramScopes: Set<string>[] = [];
    // When true, peekOperatorEx does NOT cross NEWLINE boundaries at all.
    // Used inside single-line switch case bodies to prevent binary operator
    // continuation from absorbing the next case's negative test value.
    private noLineContinuation: boolean = false;
    constructor(tokens: Token[]) {
        this.tokens = tokens;
        this.pos = 0;
    }

    // Utility methods
    peek(offset = 0) {
        return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
    }

    // True if `name` is a parameter of any function whose body we're currently
    // parsing. Used to suppress the global `name → name_var` rewrite for
    // parameters that just happen to share a name with a user function.
    private isCurrentFunctionParam(name: string): boolean {
        for (const frame of this.paramScopes) {
            if (frame.has(name)) return true;
        }
        return false;
    }

    advance() {
        return this.tokens[this.pos++];
    }

    match(type, value = null) {
        const token = this.peek();
        if (token.type !== type) return false;
        if (value !== null && token.value !== value) return false;
        return true;
    }

    expect(type, value = null) {
        const token = this.peek();
        if (token.type !== type) {
            throw new Error(`Expected ${type} but got ${token.type} at ${token.line}:${token.column}`);
        }
        if (value !== null && token.value !== value) {
            throw new Error(`Expected '${value}' but got '${token.value}' at ${token.line}:${token.column}`);
        }
        return this.advance();
    }

    // Pine v5/v6 contextual keywords — reserved only in their declaration-introducing
    // position (e.g. `type Foo`, `method bar(...)`, `enum E`), but valid as identifiers
    // anywhere else (e.g. as a UDT field name, function parameter, variable).
    private static readonly CONTEXTUAL_KEYWORDS = new Set([
        'type', 'method', 'enum',
    ]);

    /**
     * Consume an identifier OR a contextual keyword used as an identifier.
     * Used in positions where Pine permits soft keywords as names — most notably
     * UDT field names like `int type = 0`.
     */
    expectIdentifierOrContextual(): Token {
        const token = this.peek();
        if (token.type === TokenType.IDENTIFIER) {
            return this.advance();
        }
        if (token.type === TokenType.KEYWORD && Parser.CONTEXTUAL_KEYWORDS.has(token.value)) {
            return this.advance();
        }
        throw new Error(`Expected ${TokenType.IDENTIFIER} but got ${token.type} at ${token.line}:${token.column}`);
    }

    // Match a token, optionally ignoring NEWLINE and INDENT (for line continuation)
    matchEx(type, value = null, allowLineContinuation = false) {
        if (!allowLineContinuation) {
            return this.match(type, value);
        }

        let offset = 0;
        let token = this.peek(offset);

        // In single-line switch case bodies, do NOT cross newlines
        if (token.type === TokenType.NEWLINE && this.noLineContinuation) {
            return false;
        }

        // Skip NEWLINE and subsequent INDENT
        if (token.type === TokenType.NEWLINE) {
            offset++;
            token = this.peek(offset);

            // Optional INDENT after NEWLINE
            if (token.type === TokenType.INDENT) {
                offset++;
                token = this.peek(offset);
            }
        }

        if (token.type !== type) return false;
        if (value !== null && token.value !== value) return false;

        // Consume skipped tokens
        for (let i = 0; i < offset; i++) {
            this.advance();
        }

        return true;
    }

    // Peek ahead for an operator, optionally ignoring NEWLINE and INDENT (non-consuming unless matched)
    // Returns the operator value if found, null otherwise
    // IMPORTANT: Does NOT match across NEWLINE+INDENT for ambiguous operators (+, -)
    // that could be unary, since NEWLINE+INDENT indicates a new indented block
    peekOperatorEx(validOps: string[]) {
        let offset = 0;
        let token = this.peek(offset);
        let crossedIndent = false;

        // Skip NEWLINE and subsequent INDENT
        if (token.type === TokenType.NEWLINE) {
            // In single-line switch case bodies, do NOT cross newlines at all
            if (this.noLineContinuation) return null;

            offset++;
            token = this.peek(offset);

            // Optional INDENT after NEWLINE
            if (token.type === TokenType.INDENT) {
                crossedIndent = true;
                offset++;
                token = this.peek(offset);
            }
        }

        if (token.type !== TokenType.OPERATOR) return null;
        if (!validOps.includes(token.value)) return null;

        // If we crossed an INDENT boundary and the operator is ambiguous (could be unary),
        // do NOT treat it as a binary operator continuation
        if (crossedIndent && (token.value === '+' || token.value === '-')) {
            return null;
        }

        // Only now consume the skipped NEWLINE/INDENT tokens
        for (let i = 0; i < offset; i++) {
            this.advance();
        }
        return token.value;
    }

    // Newline and comment tokens carry no syntax of their own.
    isLayoutToken() {
        return this.match(TokenType.NEWLINE) || this.match(TokenType.COMMENT);
    }

    skipNewlines(allowIndent = false) {
        while (this.isLayoutToken()) this.advance();
        if (allowIndent && this.match(TokenType.INDENT)) {
            this.advance();
        }
    }

    // Main parse method
    parse() {
        const body = [];

        while (!this.match(TokenType.EOF)) {
            this.skipNewlines();
            
            // Handle DEDENTs at top level (from line continuations)
            if (this.match(TokenType.DEDENT)) {
                this.advance();
                continue;
            }

            if (this.match(TokenType.EOF)) break;

            const stmt = this.parseStatement();
            if (stmt) body.push(stmt);

            this.skipNewlines();
        }

        return new Program(body);
    }

    // Parse statement
    parseStatement(handleCommas = true) {
        this.skipNewlines();

        const startLine = this.peek().line;

        // Skip comments
        if (this.match(TokenType.COMMENT)) {
            this.advance();
            return null;
        }

        let stmt;

        // Enum definition
        if (this.match(TokenType.KEYWORD, 'enum')) {
            stmt = this.parseEnumDefinition();
        }
        // Type definition
        else if (this.match(TokenType.KEYWORD, 'type')) {
            stmt = this.parseTypeDefinition();
        }
        // Variable declaration (var/varip)
        else if (this.match(TokenType.KEYWORD, 'var') || this.match(TokenType.KEYWORD, 'varip')) {
            stmt = this.parseVarDeclaration();
        }
        // Method declaration
        else if (this.match(TokenType.KEYWORD, 'method')) {
            stmt = this.parseMethodDeclaration();
        }
        // Function declaration
        else if (this.isFunctionDeclaration()) {
            stmt = this.parseFunctionDeclaration();
        }
        // If statement
        else if (this.match(TokenType.KEYWORD, 'if')) {
            stmt = this.parseIfStatement();
        }
        // For loop
        else if (this.match(TokenType.KEYWORD, 'for')) {
            stmt = this.parseForStatement();
        }
        // While loop
        else if (this.match(TokenType.KEYWORD, 'while')) {
            stmt = this.parseWhileStatement();
        }
        // Break/continue statements
        else if (this.match(TokenType.KEYWORD, 'break') || this.match(TokenType.KEYWORD, 'continue')) {
            const keyword = this.advance().value;
            stmt = new ExpressionStatement(new Identifier(keyword));
        }
        // Tuple destructuring [a, b] = ...
        else if (this.isTupleDestructuring()) {
            stmt = this.parseTupleDestructuring();
        }
        // Check for typed variable declaration (type identifier = ...)
        // Pattern: IDENTIFIER IDENTIFIER OPERATOR(=)
        // Also handles: IDENTIFIER IDENTIFIER IDENTIFIER OPERATOR(=) for multi-qualifier types
        // Also handles: IDENTIFIER[] IDENTIFIER OPERATOR(=) for array shorthand (float[] x = ...)
        // Also handles: IDENTIFIER<...> IDENTIFIER OPERATOR(=) for generic types (array<float> x = ...)
        else if (this.peek().type === TokenType.IDENTIFIER && this.isTypedVarDeclaration()) {
            stmt = this.parseTypedVarDeclaration();
        }

        if (!stmt) {
            // Expression or assignment
            const expr = this.parseExpression();

            // Check for assignment
            if (this.match(TokenType.OPERATOR)) {
                const op = this.peek().value;
                if (['=', ':=', '+=', '-=', '*=', '/=', '%='].includes(op)) {
                    this.advance();
                    this.skipNewlines(true);
                    const right = this.parseExpression();

                    // Simple assignment with = creates variable declaration
                    if (op === '=' && expr.type === 'Identifier') {
                        stmt = new VariableDeclaration([new VariableDeclarator(expr, right)], VariableDeclarationKind.LET);
                    } else {
                        // Other assignments
                        stmt = new ExpressionStatement(new AssignmentExpression(op === ':=' ? '=' : op, expr, right));
                    }
                } else {
                    stmt = new ExpressionStatement(expr);
                }
            } else {
                stmt = new ExpressionStatement(expr);
            }
        }

        // Attach line number to statement
        if (stmt) {
            stmt._line = startLine;
            
            // Handle comma-separated statements on the same line: a = high, b = low
            // Only handle commas at the top level (not in recursive calls)
            if (handleCommas && this.match(TokenType.COMMA) && this.peek().line === startLine) {
                const statements = [stmt];
                
                while (this.match(TokenType.COMMA) && this.peek().line === startLine) {
                    this.advance(); // consume comma
                    this.skipNewlines(true); // skip any whitespace after comma
                    
                    // Parse the next statement on the same line (don't handle commas recursively)
                    const nextStmt = this.parseStatement(false);
                    if (nextStmt) {
                        statements.push(nextStmt);
                    }
                }
                
                // Return a BlockStatement containing all comma-separated statements
                return new BlockStatement(statements);
            }
        }

        return stmt;
    }

    // Check if current position is function declaration
    isFunctionDeclaration() {
        const saved = this.pos;
        try {
            // Pattern: [type] identifier(...) =>
            let i = 0;

            // Optional return type
            if (this.peek(i).type === TokenType.IDENTIFIER && this.peek(i + 1).type === TokenType.IDENTIFIER) {
                i++; // Skip return type
            }

            // Function name
            if (this.peek(i).type !== TokenType.IDENTIFIER) {
                return false;
            }
            i++;

            // Opening paren
            if (this.peek(i).type !== TokenType.LPAREN) {
                return false;
            }
            i++;

            // Skip parameters
            let depth = 1;
            while (depth > 0 && this.peek(i).type !== TokenType.EOF) {
                if (this.peek(i).type === TokenType.LPAREN) depth++;
                if (this.peek(i).type === TokenType.RPAREN) depth--;
                i++;
            }

            // Skip newlines
            while (this.peek(i).type === TokenType.NEWLINE) i++;

            // Check for =>
            return this.peek(i).type === TokenType.OPERATOR && this.peek(i).value === '=>';
        } finally {
            this.pos = saved;
        }
    }

    // Parse type definition (v5: type X => fields, v6: type X\n fields)
    // Parse type expression with support for generics (e.g., array<float>, map<string, int>)
    parseTypeExpression() {
        // Parse base type (e.g., "array", "matrix", "map", "float", "chart.point")
        let baseType = this.expect(TokenType.IDENTIFIER).value;

        // Handle dotted type names: chart.point, line.style, etc.
        while (this.match(TokenType.DOT) && this.peek(1).type === TokenType.IDENTIFIER) {
            this.advance(); // consume .
            baseType += '.' + this.advance().value; // consume identifier
        }

        // Check for generic parameters: array<float>, map<string, float>
        if (this.match(TokenType.OPERATOR, '<')) {
            this.advance(); // consume '<'

            const typeArgs = [];

            // Parse first type argument (recursive for nested generics)
            typeArgs.push(this.parseTypeExpression());

            // Parse additional type arguments (for map<K, V>)
            while (this.match(TokenType.COMMA)) {
                this.advance();
                this.skipNewlines();
                typeArgs.push(this.parseTypeExpression());
            }

            this.expect(TokenType.OPERATOR, '>'); // consume '>'

            // Return as string representation: "array<float>"
            return baseType + '<' + typeArgs.join(', ') + '>';
        }

        // Handle shorthand array syntax: int[] or int [] (with optional space)
        // Pine Script allows both `int[]` and `int []` as array type notation
        if (this.match(TokenType.LBRACKET) && this.peek(1).type === TokenType.RBRACKET) {
            this.advance(); // consume '['
            this.advance(); // consume ']'
            return 'array<' + baseType + '>';
        }

        return baseType; // Simple type: "float", "int", etc.
    }

    // Parse enum definition. Supports both Pine v6 forms:
    //   enum X            (untitled — bare member names)
    //       a
    //       b
    //   enum Y            (titled — `member = "title"`)
    //       a = "Alpha"
    //       b = "Beta"
    //
    // Runtime value matches TradingView's str.tostring(EnumName.member):
    //   - titled: the title string verbatim (incl. empty `""`)
    //   - untitled: just the member name (e.g. "a", NOT "X.a")
    parseEnumDefinition() {
        this.expect(TokenType.KEYWORD, 'enum');
        const name = this.expect(TokenType.IDENTIFIER).value;

        this.skipNewlines();
        this.expect(TokenType.INDENT);

        const members: { name: string; title: string | null }[] = [];
        while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
            this.skipNewlines();
            if (this.match(TokenType.DEDENT)) break;
            if (this.match(TokenType.COMMENT)) {
                this.advance();
                continue;
            }

            const memberName = this.expectIdentifierOrContextual().value;
            let memberTitle: string | null = null;
            if (this.match(TokenType.OPERATOR, '=')) {
                this.advance(); // consume '='
                memberTitle = this.expect(TokenType.STRING).value;
            }
            members.push({ name: memberName, title: memberTitle });
            this.skipNewlines();
        }

        if (this.match(TokenType.DEDENT)) {
            this.advance();
        }

        // Generate: const Name = { member: title-or-name, ... }
        const props = members.map((m) =>
            new Property(new Identifier(m.name), new Literal(m.title !== null ? m.title : m.name)),
        );
        const objExpr = new ObjectExpression(props);
        return new VariableDeclaration(
            [new VariableDeclarator(new Identifier(name), objExpr)],
            VariableDeclarationKind.CONST
        );
    }

    parseTypeDefinition() {
        this.expect(TokenType.KEYWORD, 'type');
        const name = this.expect(TokenType.IDENTIFIER).value;

        // Check for => (v5 syntax)
        const hasArrow = this.match(TokenType.OPERATOR, '=>');
        if (hasArrow) {
            this.advance();
        }

        this.skipNewlines();
        this.expect(TokenType.INDENT);

        const fields = [];
        while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
            this.skipNewlines();
            if (this.match(TokenType.DEDENT)) break;

            // Parse field: type name [= defaultValue]
            const fieldType = this.parseTypeExpression(); // Now handles generics
            // Field names may be contextual keywords (e.g. `int type = 0`) — Pine
            // treats `type`/`method`/`enum` as identifiers outside their declaration context.
            const fieldName = this.expectIdentifierOrContextual().value;

            let defaultValue = null;
            if (this.match(TokenType.OPERATOR, '=')) {
                this.advance();
                this.skipNewlines();
                defaultValue = this.parseExpression();
            }

            fields.push({ type: fieldType, name: fieldName, defaultValue });
            this.skipNewlines();
        }

        if (this.match(TokenType.DEDENT)) {
            this.advance();
        }

        return new TypeDefinition(name, fields);
    }

    // Parse var/varip declaration
    parseVarDeclaration() {
        const keyword = this.advance();
        const kind = keyword.value; // 'var' or 'varip'

        let varType = null;
        let name = null;

        // Check for type: var type name = ... or var name = ...
        // Pattern 1: var IDENTIFIER IDENTIFIER = ... (typed)
        // Pattern 2: var IDENTIFIER [] IDENTIFIER = ... (typed with array syntax)
        // Pattern 3: var IDENTIFIER = ... (untyped)

        // Look ahead to determine if this is typed or untyped
        // If peek(0) is IDENTIFIER and peek(1) is [, it's typed with array syntax
        // If peek(0) is IDENTIFIER and peek(1) is <, it's typed with generic syntax
        // If peek(0) is IDENTIFIER and peek(1) is IDENTIFIER, it's typed
        // If peek(0) is IDENTIFIER and peek(1) is =, it's untyped

        if (this.peek().type === TokenType.IDENTIFIER && this.peek(1).type === TokenType.LBRACKET && this.peek(2).type === TokenType.RBRACKET) {
            // Pattern 2: var type[] name = ...
            varType = this.advance().value;
            this.advance(); // [
            varType += '[]';
            this.advance(); // ]
            name = this.expectIdentifierOrContextual().value;
        } else if (
            this.peek().type === TokenType.IDENTIFIER &&
            (this.peek(1).type === TokenType.DOT || this.peek(1).type === TokenType.IDENTIFIER || (this.peek(1).type === TokenType.OPERATOR && this.peek(1).value === '<'))
        ) {
            // Has type: var type name = ..., var type<generic> name = ..., or var ns.type name = ...
            varType = this.advance().value;

            // Handle dotted type names: chart.point, line.style, etc.
            while (this.match(TokenType.DOT) && this.peek(1).type === TokenType.IDENTIFIER) {
                this.advance(); // consume .
                varType += '.' + this.advance().value; // consume identifier
            }

            // Handle array shorthand after dotted type: chart.point[] name = ...
            if (this.match(TokenType.LBRACKET) && this.peek(1).type === TokenType.RBRACKET) {
                this.advance(); // consume [
                this.advance(); // consume ]
                varType += '[]';
                name = this.expectIdentifierOrContextual().value;
            }
            // Handle generic type syntax: array<float>, map<string, int>, etc.
            else if (this.match(TokenType.OPERATOR, '<')) {
                this.advance(); // consume <
                varType += '<';

                // Read generic type parameter(s)
                while (!this.match(TokenType.OPERATOR, '>')) {
                    if (this.match(TokenType.IDENTIFIER)) {
                        varType += this.advance().value;
                        // Handle dotted types inside generics: map<string, chart.point>
                        while (this.match(TokenType.DOT) && this.peek(1).type === TokenType.IDENTIFIER) {
                            varType += '.';
                            this.advance(); // consume .
                            varType += this.advance().value; // consume identifier
                        }
                    } else if (this.match(TokenType.COMMA)) {
                        varType += this.advance().value;
                        this.skipNewlines();
                    } else {
                        break;
                    }
                }

                if (this.match(TokenType.OPERATOR, '>')) {
                    varType += '>';
                    this.advance();
                }

                name = this.expectIdentifierOrContextual().value;
            } else {
                name = this.expectIdentifierOrContextual().value;
            }
        } else if (this.peek().type === TokenType.IDENTIFIER) {
            // No type: var name = ...
            name = this.advance().value;
        } else {
            throw new Error(`Expected identifier after ${kind} at ${this.peek().line}:${this.peek().column}`);
        }

        if (this.functionNames.has(name)) {
            name = name + '_var';
        }

        this.expect(TokenType.OPERATOR, '=');
        this.skipNewlines(true);
        const init = this.parseExpression();

        const id = new Identifier(name);
        if (varType) {
            id.varType = varType;
        }

        const declarators = [new VariableDeclarator(id, init, varType)];

        // Handle comma-separated var declarations on the same line:
        //   var int dir = na, var int x1 = na, var float y1 = na
        // Each segment after the comma is a full "var type name = expr".
        while (
            this.match(TokenType.COMMA) &&
            this.peek(1).type === TokenType.KEYWORD &&
            (this.peek(1).value === 'var' || this.peek(1).value === 'varip')
        ) {
            this.advance(); // consume ','
            // Recursively parse the next "var type name = expr" segment
            const extraDecl = this.parseVarDeclaration();
            // Merge declarators from the recursively parsed declaration
            declarators.push(...extraDecl.declarations);
        }

        return new VariableDeclaration(declarators, kind);
    }

    // Lookahead to detect typed variable declaration patterns:
    //   IDENTIFIER IDENTIFIER ... IDENTIFIER = (simple: int x =, series float x =)
    //   IDENTIFIER [] IDENTIFIER = (array shorthand: float[] x =)
    //   IDENTIFIER <...> IDENTIFIER = (generic: array<float> x =)
    //   IDENTIFIER.IDENTIFIER[] IDENTIFIER = (dotted array: chart.point[] x =)
    //   IDENTIFIER.IDENTIFIER<...> IDENTIFIER = (dotted generic: map<string, chart.point> x =)
    isTypedVarDeclaration() {
        let offset = 0;

        // First token must be IDENTIFIER (already checked by caller)
        if (this.peek(offset).type !== TokenType.IDENTIFIER) return false;
        offset++;

        // Skip dotted type name: chart.point, line.style, etc.
        while (this.peek(offset).type === TokenType.DOT && this.peek(offset + 1).type === TokenType.IDENTIFIER) {
            offset += 2; // skip . and IDENTIFIER
        }

        // Check for array shorthand: type[] name =
        if (this.peek(offset).type === TokenType.LBRACKET && this.peek(offset + 1).type === TokenType.RBRACKET) {
            offset += 2; // skip []
            // Now expect IDENTIFIER (name) then =
            if (this.peek(offset).type !== TokenType.IDENTIFIER) return false;
            offset++;
            return this.peek(offset).type === TokenType.OPERATOR && this.peek(offset).value === '=';
        }

        // Check for generic type: type<...> name =
        if (this.peek(offset).type === TokenType.OPERATOR && this.peek(offset).value === '<') {
            offset++; // skip <
            let depth = 1;
            // Skip until matching >
            while (depth > 0 && this.peek(offset).type !== TokenType.EOF) {
                if (this.peek(offset).type === TokenType.OPERATOR && this.peek(offset).value === '<') depth++;
                else if (this.peek(offset).type === TokenType.OPERATOR && this.peek(offset).value === '>') depth--;
                offset++;
            }
            // Now expect IDENTIFIER (name) then =
            if (this.peek(offset).type !== TokenType.IDENTIFIER) return false;
            offset++;
            return this.peek(offset).type === TokenType.OPERATOR && this.peek(offset).value === '=';
        }

        // Check for simple typed declaration: type name = or type qualifier name =
        if (this.peek(offset).type !== TokenType.IDENTIFIER) return false;
        offset++;
        // Skip additional type qualifiers (series float x, simple int y, etc.)
        while (this.peek(offset).type === TokenType.IDENTIFIER) {
            offset++;
        }
        return this.peek(offset).type === TokenType.OPERATOR && this.peek(offset).value === '=';
    }

    // Parse typed variable declaration (int x = ... or series float x = ...)
    // Also handles: type[] name = ..., type<generic> name = ..., ns.type[] name = ...
    parseTypedVarDeclaration() {
        let varType = this.advance().value;

        // Handle dotted type names: chart.point, line.style, etc.
        while (this.match(TokenType.DOT) && this.peek(1).type === TokenType.IDENTIFIER) {
            this.advance(); // consume .
            varType += '.' + this.advance().value; // consume identifier
        }

        // Handle array shorthand: type[] name = ...
        if (this.match(TokenType.LBRACKET) && this.peek(1).type === TokenType.RBRACKET) {
            this.advance(); // consume [
            this.advance(); // consume ]
            varType += '[]';
        }
        // Handle generic type: type<...> name = ...
        else if (this.match(TokenType.OPERATOR, '<')) {
            this.advance(); // consume <
            varType += '<';

            // Read generic type parameter(s)
            while (!this.match(TokenType.OPERATOR, '>')) {
                if (this.match(TokenType.IDENTIFIER)) {
                    varType += this.advance().value;
                    // Handle dotted types inside generics: array<chart.point>
                    while (this.match(TokenType.DOT) && this.peek(1).type === TokenType.IDENTIFIER) {
                        varType += '.';
                        this.advance(); // consume .
                        varType += this.advance().value; // consume identifier
                    }
                } else if (this.match(TokenType.COMMA)) {
                    varType += this.advance().value;
                    this.skipNewlines();
                } else {
                    break;
                }
            }

            if (this.match(TokenType.OPERATOR, '>')) {
                varType += '>';
                this.advance();
            }
        }
        // Handle multi-qualifier types (series float, simple int, etc.)
        else {
            while (this.peek().type === TokenType.IDENTIFIER && this.peek(1).type === TokenType.IDENTIFIER) {
                varType += ' ' + this.advance().value;
            }
        }

        let name = this.expectIdentifierOrContextual().value;
        if (this.functionNames.has(name)) {
            name = name + '_var';
        }

        this.expect(TokenType.OPERATOR, '=');
        this.skipNewlines(true);
        const init = this.parseExpression();

        const id = new Identifier(name);
        id.varType = varType;

        const declarators = [new VariableDeclarator(id, init, varType)];

        // Handle comma-separated typed declarations sharing the same type:
        //   float a = 0.0, b = 1.0, c = 2.0
        //   int x = 1, y = 2
        //   array<float> p = na, q = na
        // Each subsequent segment is `name = expr` with the leading type reapplied.
        // The guard requires `, IDENT =` so we don't greedily swallow commas
        // that belong to a separate full declaration on the same line, e.g.
        //   chart.point[] a = ..., chart.point[] b = ...
        // (`peek(2)` would be DOT/LBRACKET/IDENT, not `=`). Those flow up to
        // the multi-statement handler in parseStatement (Layer 2).
        while (
            this.match(TokenType.COMMA) &&
            this.peek(1).type === TokenType.IDENTIFIER &&
            this.peek(2).type === TokenType.OPERATOR &&
            this.peek(2).value === '='
        ) {
            this.advance(); // consume ','
            this.skipNewlines(true);
            let nextName = this.expectIdentifierOrContextual().value;
            if (this.functionNames.has(nextName)) {
                nextName = nextName + '_var';
            }
            this.expect(TokenType.OPERATOR, '=');
            this.skipNewlines(true);
            const nextInit = this.parseExpression();
            const nextId = new Identifier(nextName);
            nextId.varType = varType;
            declarators.push(new VariableDeclarator(nextId, nextInit, varType));
        }

        return new VariableDeclaration(declarators, VariableDeclarationKind.LET);
    }

    // Parse function declaration
    parseFunctionDeclaration() {
        let returnType = null;
        if (this.peek().type === TokenType.IDENTIFIER && this.peek(1).type === TokenType.IDENTIFIER) {
            returnType = this.advance().value;
        }

        const name = this.expect(TokenType.IDENTIFIER).value;
        this.functionNames.add(name);

        this.expect(TokenType.LPAREN);

        const params = [];
        while (!this.match(TokenType.RPAREN)) {
            this.skipNewlines();
            if (this.match(TokenType.RPAREN)) break;

            let paramType = null;

            // Handle type qualifiers (can be multiple: series float, simple int, etc.)
            while (
                this.peek().type === TokenType.IDENTIFIER &&
                this.peek(1).type === TokenType.IDENTIFIER &&
                this.peek(2).type !== TokenType.LPAREN
            ) {
                if (paramType) {
                    paramType += ' ';
                }
                paramType = (paramType || '') + this.advance().value;
            }

            // Handle generic type: array<float>, map<string, float>, etc.
            if (
                this.peek().type === TokenType.IDENTIFIER &&
                this.peek(1).type === TokenType.OPERATOR && this.peek(1).value === '<'
            ) {
                const genericType = this.parseTypeExpression();
                paramType = paramType ? paramType + ' ' + genericType : genericType;
            }

            // Handle array shorthand: int[], float[], line[], label[], etc.
            if (
                this.peek().type === TokenType.IDENTIFIER &&
                this.peek(1).type === TokenType.LBRACKET &&
                this.peek(2).type === TokenType.RBRACKET
            ) {
                const arrayType = this.parseTypeExpression();
                paramType = paramType ? paramType + ' ' + arrayType : arrayType;
            }

            const paramName = this.expectIdentifierOrContextual().value;
            const param = new Identifier(paramName);
            if (paramType) param.varType = paramType;

            // Handle default parameters
            if (this.match(TokenType.OPERATOR, '=')) {
                this.advance();
                this.skipNewlines();
                const defaultValue = this.parseExpression();
                params.push(new AssignmentPattern(param, defaultValue));
            } else {
                params.push(param);
            }

            if (this.match(TokenType.COMMA)) {
                this.advance();
            }
        }

        this.expect(TokenType.RPAREN);
        this.skipNewlines();
        this.expect(TokenType.OPERATOR, '=>');
        this.skipNewlines();

        const paramFrame = new Set<string>();
        for (const p of params) {
            const ident = p.type === 'AssignmentPattern' ? (p as any).left : p;
            if (ident && ident.name) paramFrame.add(ident.name);
        }
        this.paramScopes.push(paramFrame);
        let body: BlockStatement;
        try {
            body = this.parseFunctionBody();
        } finally {
            this.paramScopes.pop();
        }
        const id = new Identifier(name);
        if (returnType) id.returnType = returnType;

        return new FunctionDeclaration(id, params, body, returnType);
    }

    // Parse method declaration (method name(Type this, params) => ...)
    parseMethodDeclaration() {
        this.expect(TokenType.KEYWORD, 'method');

        let returnType = null;
        if (this.peek().type === TokenType.IDENTIFIER && this.peek(1).type === TokenType.IDENTIFIER && this.peek(2).type === TokenType.LPAREN) {
            returnType = this.advance().value;
        }

        const name = this.expectIdentifierOrContextual().value;
        this.expect(TokenType.LPAREN);

        const params = [];
        while (!this.match(TokenType.RPAREN)) {
            this.skipNewlines();
            if (this.match(TokenType.RPAREN)) break;

            let paramType = null;

            // Handle type qualifiers (can be multiple: series float, simple int, etc.)
            while (
                this.peek().type === TokenType.IDENTIFIER &&
                this.peek(1).type === TokenType.IDENTIFIER &&
                this.peek(2).type !== TokenType.LPAREN
            ) {
                if (paramType) {
                    paramType += ' ';
                }
                paramType = (paramType || '') + this.advance().value;
            }

            // Handle generic type: array<float>, map<string, float>, etc.
            if (
                this.peek().type === TokenType.IDENTIFIER &&
                this.peek(1).type === TokenType.OPERATOR && this.peek(1).value === '<'
            ) {
                const genericType = this.parseTypeExpression();
                paramType = paramType ? paramType + ' ' + genericType : genericType;
            }

            // Handle array shorthand: int[], float[], line[], label[], etc.
            if (
                this.peek().type === TokenType.IDENTIFIER &&
                this.peek(1).type === TokenType.LBRACKET &&
                this.peek(2).type === TokenType.RBRACKET
            ) {
                const arrayType = this.parseTypeExpression();
                paramType = paramType ? paramType + ' ' + arrayType : arrayType;
            }

            const paramName = this.expectIdentifierOrContextual().value;
            const param = new Identifier(paramName);
            if (paramType) param.varType = paramType;

            // Handle default parameters
            if (this.match(TokenType.OPERATOR, '=')) {
                this.advance();
                this.skipNewlines();
                const defaultValue = this.parseExpression();
                params.push(new AssignmentPattern(param, defaultValue));
            } else {
                params.push(param);
            }

            if (this.match(TokenType.COMMA)) {
                this.advance();
            }
        }

        this.expect(TokenType.RPAREN);
        this.skipNewlines();
        this.expect(TokenType.OPERATOR, '=>');
        this.skipNewlines();

        const paramFrame = new Set<string>();
        for (const p of params) {
            const ident = p.type === 'AssignmentPattern' ? (p as any).left : p;
            if (ident && ident.name) paramFrame.add(ident.name);
        }
        this.paramScopes.push(paramFrame);
        let body: BlockStatement;
        try {
            body = this.parseFunctionBody();
        } finally {
            this.paramScopes.pop();
        }
        const id = new Identifier(name);
        if (returnType) id.returnType = returnType;
        id.isMethod = true; // Mark as method

        return new FunctionDeclaration(id, params, body, returnType);
    }

    // Parse function body (handles both single expression and block)
    parseFunctionBody() {
        const statements = [];

        // Check if it's a single expression (no INDENT)
        if (!this.match(TokenType.INDENT)) {
            const expr = this.parseExpression();
            return new BlockStatement([new ReturnStatement(expr)]);
        }

        this.advance(); // consume INDENT

        while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
            this.skipNewlines();
            if (this.match(TokenType.DEDENT)) break;

            // Check for comma-separated sequence (inline tuple return)
            // Pattern: var = expr, var = expr, ..., finalExpr
            const stmts = this.parseStatementOrSequence();
            if (Array.isArray(stmts)) {
                statements.push(...stmts);
            } else if (stmts) {
                statements.push(stmts);
            }
        }

        if (this.match(TokenType.DEDENT)) {
            this.advance();
        }

        // Make last statement a return if it's an expression.
        // For if/else/switch as the last statement, recursively add return to each branch.
        if (statements.length > 0) {
            this._addImplicitReturn(statements);
        }

        return new BlockStatement(statements);
    }

    /**
     * Recursively convert the last expression in a statement list to a ReturnStatement.
     * Handles if/else chains by adding return to each branch's last expression.
     */
    private _addImplicitReturn(statements: any[]): void {
        const last = statements[statements.length - 1];
        if (last.type === 'ExpressionStatement') {
            statements[statements.length - 1] = new ReturnStatement(last.expression);
        } else if (last.type === 'IfStatement') {
            this._addImplicitReturnToIf(last);
        }
    }

    private _addImplicitReturnToIf(node: any): void {
        // Add return to the consequent branch
        if (node.consequent && node.consequent.type === 'BlockStatement' && node.consequent.body.length > 0) {
            this._addImplicitReturn(node.consequent.body);
        }
        // Add return to the alternate branch (else / else if)
        if (node.alternate) {
            if (node.alternate.type === 'IfStatement') {
                // else if — recurse
                this._addImplicitReturnToIf(node.alternate);
            } else if (node.alternate.type === 'BlockStatement' && node.alternate.body.length > 0) {
                // else block
                this._addImplicitReturn(node.alternate.body);
            }
        }
    }

    // Parse statement or comma-separated sequence
    parseStatementOrSequence() {
        const startPos = this.pos;
        const startLine = this.peek().line;

        // Check for control flow statements
        if (this.match(TokenType.KEYWORD, 'if')) {
            const stmt = this.parseIfStatement();
            if (stmt) stmt._line = startLine;
            return stmt;
        }

        if (this.match(TokenType.KEYWORD, 'for')) {
            return this.parseForStatement();
        }

        if (this.match(TokenType.KEYWORD, 'while')) {
            return this.parseWhileStatement();
        }

        if (this.match(TokenType.KEYWORD, 'break') || this.match(TokenType.KEYWORD, 'continue')) {
            const keyword = this.advance().value;
            return new ExpressionStatement(new Identifier(keyword));
        }

        // Check for var/varip declarations (can appear in function bodies)
        if (this.match(TokenType.KEYWORD, 'var') || this.match(TokenType.KEYWORD, 'varip')) {
            return this.parseVarDeclaration();
        }

        // Tuple destructuring [a, b] = ...
        if (this.isTupleDestructuring()) {
            return this.parseTupleDestructuring();
        }

        // Check for typed variable declaration (series float x = ...)
        // Also handles: type[] name = ... and type<generic> name = ...
        // Also handles comma-separated typed declarations: float num = 1.0, float den = 1.0
        if (this.peek().type === TokenType.IDENTIFIER && this.isTypedVarDeclaration()) {
            const firstDecl = this.parseTypedVarDeclaration();

            // Check for comma-separated typed declarations on the same line
            if (this.match(TokenType.COMMA) && this.peek(1).type === TokenType.IDENTIFIER) {
                const declarations: any[] = [firstDecl];
                while (this.match(TokenType.COMMA)) {
                    this.advance(); // consume comma
                    this.skipNewlines(true);
                    if (this.peek().type === TokenType.IDENTIFIER && this.isTypedVarDeclaration()) {
                        declarations.push(this.parseTypedVarDeclaration());
                    } else {
                        // Not a typed declaration after comma — parse as a regular statement
                        const expr = this.parseExpression();
                        if (this.match(TokenType.OPERATOR)) {
                            const op = this.peek().value;
                            if (['=', ':='].includes(op)) {
                                this.advance();
                                this.skipNewlines(true);
                                const right = this.parseExpression();
                                if (op === '=' && expr.type === 'Identifier') {
                                    declarations.push(new VariableDeclaration([new VariableDeclarator(expr, right)], VariableDeclarationKind.LET));
                                } else {
                                    declarations.push(new ExpressionStatement(new AssignmentExpression(op === ':=' ? '=' : op, expr, right)));
                                }
                            }
                        }
                        break;
                    }
                }
                return declarations; // Return array of statements
            }

            return firstDecl;
        }

        // Try to parse as sequence (assignment, assignment, ..., expression)
        // This handles: mean = ta.sma(...), sd = ta.stdev(...), (source - mean) / sd
        const sequenceItems = [];

        while (true) {
            // Parse one item (could be assignment or expression)
            const expr = this.parseExpression();

            // Check if it's an assignment
            if (this.match(TokenType.OPERATOR)) {
                const op = this.peek().value;
                if (['=', ':=', '+=', '-=', '*=', '/=', '%='].includes(op)) {
                    this.advance();
                    this.skipNewlines(true);
                    const right = this.parseExpression();

                    // Simple assignment with = creates variable declaration
                    if (op === '=' && expr.type === 'Identifier') {
                        sequenceItems.push(new VariableDeclaration([new VariableDeclarator(expr, right)], VariableDeclarationKind.LET));
                    } else {
                        sequenceItems.push(new ExpressionStatement(new AssignmentExpression(op === ':=' ? '=' : op, expr, right)));
                    }

                    // Check for comma (sequence continuation)
                    if (this.match(TokenType.COMMA)) {
                        this.advance();
                        this.skipNewlines();
                        continue; // Parse next item in sequence
                    }

                    break; // No comma, done with sequence
                } else {
                    // Not an assignment, just return expression
                    if (sequenceItems.length > 0) {
                        // We have sequence items already, add this as final expression
                        sequenceItems.push(new ExpressionStatement(expr));
                    } else {
                        // Just a single expression
                        return new ExpressionStatement(expr);
                    }
                    break;
                }
            } else {
                // No operator, check for comma
                if (this.match(TokenType.COMMA)) {
                    // Expression followed by comma - add to sequence
                    sequenceItems.push(new ExpressionStatement(expr));
                    this.advance();
                    this.skipNewlines();
                    continue;
                } else {
                    // Just a single expression
                    if (sequenceItems.length > 0) {
                        sequenceItems.push(new ExpressionStatement(expr));
                    } else {
                        return new ExpressionStatement(expr);
                    }
                    break;
                }
            }
        }

        // If we collected multiple items, return array
        if (sequenceItems.length > 1) {
            return sequenceItems; // Return array of statements
        } else if (sequenceItems.length === 1) {
            return sequenceItems[0];
        }

        return null;
    }

    // Parse if statement
    parseIfStatement() {
        this.expect(TokenType.KEYWORD, 'if');
        const test = this.parseExpression();
        this.skipNewlines();

        const consequent = this.parseBlock();
        let alternate = null;

        // An 'else' may follow the block after blank or comment-only lines.
        this.skipNewlines();

        if (this.match(TokenType.KEYWORD, 'else')) {
            this.advance();
            this.skipNewlines();

            if (this.match(TokenType.KEYWORD, 'if')) {
                alternate = this.parseIfStatement();
            } else {
                alternate = this.parseBlock();
            }
        }

        return new IfStatement(test, consequent, alternate);
    }

    // Parse for statement (both range-based and for-in)
    parseForStatement() {
        this.expect(TokenType.KEYWORD, 'for');

        // Check if loop variable is a destructuring pattern or simple identifier
        let loopVar = null;
        let isDestructuring = false;

        if (this.match(TokenType.LBRACKET)) {
            // Destructuring pattern: for [a, b] in array
            this.advance(); // consume [
            const elements = [];
            while (!this.match(TokenType.RBRACKET)) {
                this.skipNewlines();
                elements.push(new Identifier(this.expectIdentifierOrContextual().value));
                if (this.match(TokenType.COMMA)) {
                    this.advance();
                }
            }
            this.expect(TokenType.RBRACKET);
            loopVar = new ArrayPattern(elements);
            isDestructuring = true;
        } else {
            // Simple identifier: for i in array or for i = 0 to 10
            const varName = this.expectIdentifierOrContextual().value;
            loopVar = new Identifier(varName);
        }

        // Check if it's for-in loop (for item in array) or range loop (for i = 0 to 10)
        if (this.match(TokenType.KEYWORD, 'in')) {
            // for-in loop: for p in pivots or for [a, b] in array
            this.advance(); // consume 'in'
            const iterable = this.parseExpression();
            this.skipNewlines();
            const body = this.parseBlock();

            // Convert to: for (const p of iterable) { body }
            // Using ForStatement with null test to represent for-in
            const init = new VariableDeclaration([new VariableDeclarator(loopVar, iterable)], VariableDeclarationKind.CONST);

            // Mark this as a for-in loop by setting special properties
            const forStmt = new ForStatement(init, null, null, body);
            forStmt.isForIn = true; // Custom flag to indicate for-in
            return forStmt;
        } else {
            // Range-based for loop: for i = 0 to 10
            // Note: range-based loops don't support destructuring
            if (isDestructuring) {
                throw new Error(`Range-based for loops don't support destructuring at ${this.peek().line}:${this.peek().column}`);
            }

            this.expect(TokenType.OPERATOR, '=');
            const start = this.parseExpression();
            this.expect(TokenType.KEYWORD, 'to');
            const end = this.parseExpression();

            let step = null;
            if (this.match(TokenType.KEYWORD, 'by')) {
                this.advance();
                step = this.parseExpression();
            }

            this.skipNewlines();
            const body = this.parseBlock();

            // Build for loop with runtime direction detection.
            // Pine Script: `for i = start to end [by step]`
            // Direction is determined at runtime (start <= end → increment, else decrement).
            // Generated: for (let i = start; start <= end ? i <= end : i >= end; start <= end ? i++ : i--)
            const init = new VariableDeclaration([new VariableDeclarator(loopVar, start)], VariableDeclarationKind.LET);

            const directionCheck = new BinaryExpression('<=', start, end);
            const test = new ConditionalExpression(
                directionCheck,
                new BinaryExpression('<=', loopVar, end),
                new BinaryExpression('>=', loopVar, end)
            );

            let update;
            if (step) {
                // with step: start <= end ? i += step : i -= step
                update = new ConditionalExpression(
                    directionCheck,
                    new AssignmentExpression('+=', loopVar, step),
                    new AssignmentExpression('-=', loopVar, step)
                );
            } else {
                // no step: start <= end ? i++ : i--
                update = new ConditionalExpression(
                    directionCheck,
                    new UpdateExpression('++', loopVar),
                    new UpdateExpression('--', loopVar)
                );
            }

            return new ForStatement(init, test, update, body);
        }
    }

    // Parse while statement
    parseWhileStatement() {
        this.expect(TokenType.KEYWORD, 'while');
        const test = this.parseExpression();
        this.skipNewlines();
        const body = this.parseBlock();

        return new WhileStatement(test, body);
    }

    // Parse indented block
    parseBlock() {
        if (!this.match(TokenType.INDENT)) {
            // Single statement without indent (shouldn't happen in proper PineScript)
            const stmt = this.parseStatement();
            return new BlockStatement(stmt ? [stmt] : []);
        }

        const blockIndent = this.peek().indent;
        this.advance(); // consume INDENT

        const statements = [];
        while (!this.match(TokenType.EOF)) {
            this.skipNewlines();
            
            // Check for DEDENT
            if (this.match(TokenType.DEDENT)) {
                const dedentLevel = this.peek().indent;
                if (dedentLevel < blockIndent) {
                    // Dedenting out of this block
                    break;
                } else {
                    // Dedenting from a deeper level back to this block (or deeper)
                    // Consume spurious DEDENT
                    this.advance();
                    continue;
                }
            }

            if (this.match(TokenType.EOF)) break;

            const stmt = this.parseStatement();
            if (stmt) statements.push(stmt);
        }

        if (this.match(TokenType.DEDENT)) {
            const dedentLevel = this.peek().indent;
            if (dedentLevel < blockIndent) {
                this.advance();
            }
        }

        return new BlockStatement(statements);
    }

    // Check if current position looks like tuple destructuring
    isTupleDestructuring() {
        if (!this.match(TokenType.LBRACKET)) return false;

        let i = 1; // After [

        // Skip identifiers and commas
        while (true) {
            // Skip newlines
            while (this.peek(i).type === TokenType.NEWLINE) i++;

            // Expect identifier
            if (this.peek(i).type !== TokenType.IDENTIFIER) return false;
            i++;

            // Skip newlines
            while (this.peek(i).type === TokenType.NEWLINE) i++;

            // Check for comma (more elements) or ] (end of list)
            if (this.peek(i).type === TokenType.RBRACKET) {
                i++; // Skip ]
                break;
            } else if (this.peek(i).type === TokenType.COMMA) {
                i++; // Skip comma
                continue;
            } else {
                return false; // Unexpected token
            }
        }

        // Skip newlines after ]
        while (this.peek(i).type === TokenType.NEWLINE) i++;

        // Check for =
        return this.peek(i).type === TokenType.OPERATOR && this.peek(i).value === '=';
    }

    // Parse tuple destructuring
    parseTupleDestructuring() {
        this.expect(TokenType.LBRACKET);
        const elements = [];

        while (!this.match(TokenType.RBRACKET)) {
            this.skipNewlines();
            let name = this.expectIdentifierOrContextual().value;
            if (this.functionNames.has(name)) {
                name = name + '_var';
            }
            elements.push(new Identifier(name));

            if (this.match(TokenType.COMMA)) {
                this.advance();
            }
        }

        this.expect(TokenType.RBRACKET);
        this.skipNewlines();
        this.expect(TokenType.OPERATOR, '=');
        this.skipNewlines(true);
        const init = this.parseExpression();

        return new VariableDeclaration([new VariableDeclarator(new ArrayPattern(elements), init)], VariableDeclarationKind.CONST);
    }

    // Expression parsing (operator precedence)
    parseExpression() {
        return this.parseTernary();
    }

    parseTernary() {
        let expr = this.parseLogicalOr();

        if (this.matchEx(TokenType.OPERATOR, '?', true)) {
            this.advance();
            this.skipNewlines(true);
            const consequent = this.parseExpression();
            
            // Handle : with line continuation
            if (this.matchEx(TokenType.COLON, null, true)) {
                this.advance(); // Consume :
            } else {
                this.expect(TokenType.COLON);
            }
            
            this.skipNewlines(true);
            const alternate = this.parseExpression();
            return new ConditionalExpression(expr, consequent, alternate);
        }

        return expr;
    }

    parseLogicalOr() {
        let left = this.parseLogicalAnd();

        while (this.matchEx(TokenType.KEYWORD, 'or', true) || this.peekOperatorEx(['||'])) {
            this.advance();
            this.skipNewlines(true);
            const right = this.parseLogicalAnd();
            left = new BinaryExpression('||', left, right);
        }

        return left;
    }

    parseLogicalAnd() {
        let left = this.parseEquality();

        while (this.matchEx(TokenType.KEYWORD, 'and', true) || this.peekOperatorEx(['&&'])) {
            this.advance();
            this.skipNewlines(true);
            const right = this.parseEquality();
            left = new BinaryExpression('&&', left, right);
        }

        return left;
    }

    parseEquality() {
        let left = this.parseComparison();

        while (this.peekOperatorEx(['==', '!='])) {
            const op = this.advance().value;
            this.skipNewlines(true);
            const right = this.parseComparison();
            left = new BinaryExpression(op, left, right);
        }

        return left;
    }

    parseComparison() {
        let left = this.parseAdditive();

        while (this.peekOperatorEx(['<', '>', '<=', '>='])) {
            const op = this.advance().value;
            this.skipNewlines(true);
            const right = this.parseAdditive();
            left = new BinaryExpression(op, left, right);
        }

        return left;
    }

    parseAdditive() {
        let left = this.parseMultiplicative();

        while (this.peekOperatorEx(['+', '-'])) {
            const op = this.advance().value;
            this.skipNewlines(true);
            const right = this.parseMultiplicative();
            left = new BinaryExpression(op, left, right);
        }

        return left;
    }

    parseMultiplicative() {
        let left = this.parseUnary();

        while (this.peekOperatorEx(['*', '/', '%'])) {
            const op = this.advance().value;
            this.skipNewlines(true);
            const right = this.parseUnary();
            left = new BinaryExpression(op, left, right);
        }

        return left;
    }

    parseUnary() {
        if (this.match(TokenType.OPERATOR)) {
            const op = this.peek().value;
            if (['+', '-', '!'].includes(op)) {
                this.advance();
                this.skipNewlines();
                return new UnaryExpression(op, this.parseUnary());
            }
        }

        if (this.match(TokenType.KEYWORD, 'not')) {
            this.advance();
            this.skipNewlines();
            return new UnaryExpression('!', this.parseUnary());
        }

        return this.parsePostfix();
    }

    parsePostfix() {
        let expr = this.parsePrimary();

        while (true) {
            // Don't skip newlines at the start of the loop - newlines terminate expressions in PineScript
            // We'll skip them in specific contexts where they're allowed (like after `.`)

            // Generic type parameters followed by call: array.new<float>(...)
            // Capture the generic type and, for known types, rewrite
            // array.new<float> → array.new_float (same for matrix, etc.)
            if (this.match(TokenType.OPERATOR, '<')) {
                // Save position in case this isn't a generic
                const saved = this.pos;

                // Try to parse as generic type, capturing type name
                this.advance(); // consume <
                let depth = 1;
                let isGeneric = true;
                let genericType = '';

                // Known Pine types that have dedicated new_TYPE methods
                const KNOWN_GENERIC_TYPES = new Set([
                    'float', 'int', 'string', 'bool', 'color',
                    'line', 'label', 'box', 'linefill', 'table',
                ]);

                // Skip until matching >, capturing type identifiers
                while (depth > 0 && !this.match(TokenType.EOF)) {
                    if (this.match(TokenType.OPERATOR, '<')) {
                        depth++;
                        this.advance();
                    } else if (this.match(TokenType.OPERATOR, '>')) {
                        depth--;
                        this.advance();
                    } else if (this.match(TokenType.IDENTIFIER) || this.match(TokenType.COMMA) || this.match(TokenType.DOT)) {
                        // Capture only top-level, simple type names (depth === 1)
                        if (depth === 1 && this.match(TokenType.IDENTIFIER) && genericType === '') {
                            genericType = this.peek().value;
                        }
                        this.advance();
                    } else {
                        // Not a generic type, restore position
                        isGeneric = false;
                        this.pos = saved;
                        break;
                    }
                }

                // For known types, rewrite callee: array.new<float> → array.new_float
                // Only for array/matrix (not map, which uses map.new<K,V> with two type params)
                if (isGeneric && expr.type === 'MemberExpression'
                    && expr.property.name === 'new'
                    && (expr.object.name === 'array' || expr.object.name === 'matrix')
                    && KNOWN_GENERIC_TYPES.has(genericType)) {
                    expr.property = new Identifier('new_' + genericType);
                }

                // If we successfully parsed generic and next is (, parse call
                if (isGeneric && this.match(TokenType.LPAREN)) {
                    expr = this.parseCallExpression(expr);
                    continue;
                } else if (!isGeneric) {
                    // Not a generic, break and let comparison operator handle it
                    break;
                } else {
                    // Generic but no call - just continue
                    continue;
                }
            }
            // Call expression
            else if (this.match(TokenType.LPAREN)) {
                expr = this.parseCallExpression(expr);
            }
            // Member access
            else if (this.match(TokenType.DOT)) {
                this.advance();
                this.skipNewlines(); // Allow method chaining across lines
                // Accept both IDENTIFIER and KEYWORD after DOT — keywords like
                // 'type' can be valid property names (e.g., syminfo.type)
                const propToken = this.peek();
                if (propToken.type !== TokenType.IDENTIFIER && propToken.type !== TokenType.KEYWORD) {
                    throw new Error(`Expected property name but got ${propToken.type} at ${propToken.line}:${propToken.column}`);
                }
                this.advance();
                expr = new MemberExpression(expr, new Identifier(propToken.value), false);
            }
            // Index/history operator
            else if (this.match(TokenType.LBRACKET)) {
                // If this looks like tuple destructuring [a, b, c] = ..., it's a new
                // statement, not a postfix index on the previous expression.
                // This happens after block expressions like switch where DEDENT is
                // immediately followed by LBRACKET with no intervening NEWLINE.
                if (this.isTupleDestructuring()) {
                    break;
                }
                this.advance();
                this.skipNewlines();
                const index = this.parseExpression();
                this.expect(TokenType.RBRACKET);
                expr = new MemberExpression(expr, index, true);
            } else {
                break;
            }
        }

        return expr;
    }

    parseCallExpression(callee) {
        this.expect(TokenType.LPAREN);
        const args = [];
        const namedArgs = [];

        while (!this.match(TokenType.RPAREN)) {
            this.skipNewlines();
            if (this.match(TokenType.RPAREN)) break;

            // Check for named argument (name = value)
            // Note: 'name' can be an IDENTIFIER or KEYWORD (like 'type')
            if (
                (this.peek().type === TokenType.IDENTIFIER || this.peek().type === TokenType.KEYWORD) &&
                this.peek(1).type === TokenType.OPERATOR &&
                this.peek(1).value === '='
            ) {
                const name = this.advance().value;
                this.advance(); // =
                this.skipNewlines();
                const value = this.parseExpression();
                namedArgs.push(new Property(new Identifier(name), value));
            } else {
                args.push(this.parseExpression());
            }

            if (this.match(TokenType.COMMA)) {
                this.advance();
            }
            this.skipNewlines();
        }

        this.expect(TokenType.RPAREN);

        // If there are named arguments, add them as last argument (object literal)
        if (namedArgs.length > 0) {
            args.push(new ObjectExpression(namedArgs));
        }

        return new CallExpression(callee, args);
    }

    parsePrimary() {
        const token = this.peek();

        // Literals
        if (this.match(TokenType.NUMBER)) {
            const num = this.advance();
            return new Literal(num.value, num.raw);
        }

        if (this.match(TokenType.STRING)) {
            const str = this.advance();
            return new Literal(str.value);
        }

        if (this.match(TokenType.BOOLEAN)) {
            const bool = this.advance();
            return new Literal(bool.value);
        }

        // Identifier — also accept contextual keywords (method, type, enum) used as
        // value references, e.g. `switch method` where `method` is a parameter name.
        if (
            this.match(TokenType.IDENTIFIER) ||
            (token.type === TokenType.KEYWORD && Parser.CONTEXTUAL_KEYWORDS.has(token.value))
        ) {
            const id = this.advance();
            let name = id.value;
            if (
                this.functionNames.has(name) &&
                this.peek().type !== TokenType.LPAREN &&
                !this.isCurrentFunctionParam(name)
            ) {
                name = name + '_var';
            }
            return new Identifier(name);
        }

        // Array literal
        if (this.match(TokenType.LBRACKET)) {
            return this.parseArrayLiteral();
        }

        // Parenthesized expression
        if (this.match(TokenType.LPAREN)) {
            this.advance();
            this.skipNewlines();
            const expr = this.parseExpression();
            this.skipNewlines();
            this.expect(TokenType.RPAREN);
            return expr;
        }

        // If expression
        if (this.match(TokenType.KEYWORD, 'if')) {
            return this.parseIfExpression();
        }

        // Switch expression
        if (this.match(TokenType.KEYWORD, 'switch')) {
            return this.parseSwitchExpression();
        }

        // For expression (for loop as expression — returns last evaluated value)
        if (this.match(TokenType.KEYWORD, 'for')) {
            return this.parseForExpression();
        }

        // While expression (while loop as expression — returns last evaluated value)
        if (this.match(TokenType.KEYWORD, 'while')) {
            return this.parseWhileExpression();
        }

        throw new Error(`Unexpected token ${token.type} '${token.value}' at ${token.line}:${token.column}`);
    }

    parseArrayLiteral() {
        this.expect(TokenType.LBRACKET);
        const elements = [];

        while (!this.match(TokenType.RBRACKET)) {
            this.skipNewlines();
            if (this.match(TokenType.RBRACKET)) break;

            elements.push(this.parseExpression());

            if (this.match(TokenType.COMMA)) {
                this.advance();
            }
            this.skipNewlines();
        }

        this.expect(TokenType.RBRACKET);
        return new ArrayExpression(elements);
    }

    parseIfExpression() {
        this.expect(TokenType.KEYWORD, 'if');
        const test = this.parseExpression();
        this.skipNewlines();

        this.expect(TokenType.INDENT);
        const consequentStmts = [];
        while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
            this.skipNewlines();
            if (this.match(TokenType.DEDENT)) break;
            const stmt = this.parseStatement();
            if (stmt) consequentStmts.push(stmt);
        }
        this.advance(); // DEDENT

        let alternateStmts = [];
        if (this.match(TokenType.KEYWORD, 'else')) {
            this.advance();
            this.skipNewlines();

            if (this.match(TokenType.KEYWORD, 'if')) {
                // Recursive if expression
                const nestedIf = this.parseIfExpression();

                // Check if we need IIFE (has multiple statements or control flow)
                const needsIIFE = this.needsIIFE(consequentStmts, alternateStmts);

                if (needsIIFE) {
                    // Return a marked conditional that needs IIFE
                    const condExpr = new ConditionalExpression(test, new BlockStatement(consequentStmts), nestedIf);
                    condExpr.needsIIFE = true;
                    condExpr.consequentStmts = consequentStmts;
                    condExpr.alternateExpr = nestedIf;
                    return condExpr;
                } else {
                    return new ConditionalExpression(test, this.getBlockValue(consequentStmts), nestedIf);
                }
            } else {
                this.expect(TokenType.INDENT);
                while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
                    this.skipNewlines();
                    if (this.match(TokenType.DEDENT)) break;
                    const stmt = this.parseStatement();
                    if (stmt) alternateStmts.push(stmt);
                }
                this.advance(); // DEDENT
            }
        }

        // Check if we need IIFE (has multiple statements or control flow)
        const needsIIFE = this.needsIIFE(consequentStmts, alternateStmts);

        if (needsIIFE) {
            // Return a marked conditional that needs IIFE
            const condExpr = new ConditionalExpression(test, new BlockStatement(consequentStmts), new BlockStatement(alternateStmts));
            condExpr.needsIIFE = true;
            condExpr.consequentStmts = consequentStmts;
            condExpr.alternateStmts = alternateStmts;
            return condExpr;
        }

        // Simple case: convert to ternary
        const consequent = this.getBlockValue(consequentStmts);
        const alternate = alternateStmts.length > 0 ? this.getBlockValue(alternateStmts) : new Literal(null);
        return new ConditionalExpression(test, consequent, alternate);
    }

    // Check if if-expression needs IIFE (multi-statement or has control flow)
    needsIIFE(consequentStmts, alternateStmts) {
        // If either branch has multiple statements, need IIFE
        if (consequentStmts.length > 1 || alternateStmts.length > 1) {
            return true;
        }

        // If either branch has a control flow statement (if, for, while), need IIFE
        const hasControlFlow = (stmts) => {
            return stmts.some(
                (stmt) =>
                    stmt.type === 'IfStatement' || stmt.type === 'ForStatement' || stmt.type === 'WhileStatement' || stmt.type === 'BlockStatement'
            );
        };

        return hasControlFlow(consequentStmts) || hasControlFlow(alternateStmts);
    }

    parseSwitchExpression() {
        this.expect(TokenType.KEYWORD, 'switch');
        
        // Check if switch has no discriminant (switch without expression)
        // In this case, the next token will be NEWLINE or INDENT
        let discriminant = null;
        if (!this.match(TokenType.NEWLINE) && !this.match(TokenType.INDENT)) {
            discriminant = this.parseExpression();
        }
        
        this.skipNewlines();
        this.expect(TokenType.INDENT);

        const cases = [];
        while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
            this.skipNewlines();
            if (this.match(TokenType.DEDENT)) break;

            let test = null;
            if (!this.match(TokenType.OPERATOR, '=>')) {
                test = this.parseExpression();
            }

            this.expect(TokenType.OPERATOR, '=>');
            this.skipNewlines();

            const consequentStmts = [];
            if (this.match(TokenType.INDENT)) {
                this.advance();
                while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
                    this.skipNewlines();
                    if (this.match(TokenType.DEDENT)) break;
                    const stmt = this.parseStatement();
                    if (stmt) consequentStmts.push(stmt);
                }
                this.advance(); // DEDENT
            } else {
                // Single line: may be an expression or a statement (e.g., col := value)
                // Disable line continuation to prevent the expression parser from
                // absorbing the next case's negative test value (e.g., -1 =>) as
                // binary subtraction from the current case's body.
                this.noLineContinuation = true;
                const stmt = this.parseStatement();
                this.noLineContinuation = false;
                if (stmt) consequentStmts.push(stmt);
            }

            // Extract the value expression from statements (for backwards compatibility)
            const consequent = this.getBlockValue(consequentStmts);
            // Pass both the final value AND all statements to SwitchCase
            cases.push(new SwitchCase(test, consequent, consequentStmts));
            this.skipNewlines();
        }

        this.advance(); // DEDENT
        return new SwitchExpression(discriminant, cases);
    }

    // Parse for loop used as expression (returns last evaluated value)
    // Example: _result = for i = 0 to 4 \n close[i]
    parseForExpression() {
        const forStmt = this.parseForStatement();
        // Mark as expression-returning
        (forStmt as any).isExpression = true;
        return forStmt;
    }

    // Parse while loop used as expression (returns last evaluated value)
    // Example: _result = while condition \n expr
    parseWhileExpression() {
        const whileStmt = this.parseWhileStatement();
        // Mark as expression-returning
        (whileStmt as any).isExpression = true;
        return whileStmt;
    }

    getBlockValue(statements) {
        if (statements.length === 0) {
            return new Literal(null);
        }

        const last = statements[statements.length - 1];
        if (last.type === 'ExpressionStatement') {
            return last.expression;
        }
        if (last.type === 'VariableDeclaration' && last.declarations.length > 0) {
            return last.declarations[0].id;
        }

        return new Literal(null);
    }
}