// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Ala-eddine KADDOURI

export class ScopeManager {
    private scopes: Map<string, string>[] = [];
    private scopeTypes: string[] = [];
    private scopeCounts: Map<string, number> = new Map();
    private contextBoundVars: Set<string> = new Set();
    private arrayPatternElements: Set<string> = new Set();
    private rootParams: Set<string> = new Set();
    private varKinds: Map<string, string> = new Map();
    private loopVars: Set<string> = new Set();
    private loopVarNames: Map<string, string> = new Map(); // Map original names to transformed names
    private paramIdCounter: number = 0;
    private cacheIdCounter: number = 0;
    private tempVarCounter: number = 0;

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

    getCurrentScopeCount(): number {
        return this.scopeCounts.get(this.getCurrentScopeType()) || 1;
    }

    addContextBoundVar(name: string, isRootParam: boolean = false): void {
        // Register a variable as context-bound, with optional root parameter flag
        this.contextBoundVars.add(name);
        if (isRootParam) {
            this.rootParams.add(name);
        }
    }
    addArrayPatternElement(name: string): void {
        this.arrayPatternElements.add(name);
    }

    isContextBound(name: string): boolean {
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

    getLoopVariableName(name: string): string | undefined {
        return this.loopVarNames.get(name);
    }

    isLoopVariable(name: string): boolean {
        return this.loopVars.has(name);
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

    public generateTempVar(): string {
        return `temp_${++this.tempVarCounter}`;
    }
}

export default ScopeManager;
