# Contributing to PineTS

First off, thank you for considering contributing to PineTS! 🎉

PineTS aims to bring Pine Script compatibility to JavaScript environments, and we welcome contributions that help us achieve this goal. Whether you're fixing bugs, adding missing functions, improving documentation, or suggesting features, your help is appreciated.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Development Workflow](#development-workflow)
- [Project Architecture](#project-architecture)
- [Testing Requirements](#testing-requirements)
- [Code Style](#code-style)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project follows a simple principle: **Be respectful and constructive**. We're all here to build something useful together.

---

## How Can I Contribute?

### 🐛 Reporting Bugs

- **Check existing issues** first to avoid duplicates
- Use the issue template if available
- Include:
  - Clear description of the bug
  - Steps to reproduce
  - Expected vs actual behavior
  - PineTS version and environment (Node.js version, browser, etc.)
  - Sample code that reproduces the issue

### 💡 Suggesting Features

- **Open a Discussion first** for significant features or architectural changes
- Explain the use case and why it would benefit the project
- Consider whether it aligns with PineTS's goal of Pine Script compatibility

### 📝 Improving Documentation

- Documentation improvements are always welcome!
- Fix typos, clarify confusing sections, or add examples
- Documentation PRs can be merged quickly

---

## Pull Request Guidelines

### 🎯 Keep PRs Small and Focused

**This is critical for maintainability and review efficiency.**

Large PRs (1000+ lines) are very difficult to review properly and can delay merging significantly. Instead:

#### ✅ Good PR Examples:

- **Bug Fix PR**: Fixes a specific bug without introducing new features
  - Example: "Fix ta.sma NaN handling"
  
- **Single Namespace Methods**: Add methods to one namespace at a time
  - Example: "Add math.todegrees and math.toradians functions"
  - Example: "Implement ta.supertrend indicator"

- **Documentation Update**: Improve docs or add examples
  - Example: "Add streaming examples to README"

#### ❌ Avoid These:

- **Mixed PRs**: Bug fixes + new features + refactoring in one PR
- **Multiple Namespaces**: Adding methods across `ta`, `math`, `strategy`, etc. simultaneously
- **Large Feature Dumps**: 10,000+ lines of code with missing tests

### 📋 PR Checklist

Before submitting, ensure:

- [ ] **Tests are included** for all new functionality
- [ ] **All tests pass**: Run `npm test -- --run`
- [ ] **Code follows project style** (see [Code Style](#code-style))
- [ ] **Documentation is updated** if you changed public APIs
- [ ] **Commit messages are clear** and describe what changed
- [ ] **PR description explains** what problem you're solving and how

### 🔄 PR Process

1. **Fork the repository** and create a feature branch
   ```bash
   git checkout -b fix/issue-description
   # or
   git checkout -b feature/new-functionality
   ```

2. **Make your changes** following our guidelines

3. **Test thoroughly**
   ```bash
   npm test -- --run
   ```

4. **Commit with clear messages**
   ```bash
   git commit -m "Fix: math.round precision parameter handling"
   ```

5. **Push and create PR**
   ```bash
   git push origin your-branch-name
   ```

6. **Wait for review** - We'll review as soon as possible!

### 🏗️ Architectural Changes

**Please open a Discussion before working on:**

- Changes to the transpiler
- New runtime features
- Modifications to the Series/Context classes
- Strategy backtesting implementation
- Drawing API implementation
- New data providers

These require upfront discussion to ensure alignment with project direction and architecture.

---

## Development Workflow

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/LuxAlgo/PineTS.git
cd PineTS

# Install dependencies
npm install

# Run tests to verify setup
npm test -- --run
```

### Adding New Functions

#### Example: Adding a `ta` namespace function

1. **Create the implementation**
   ```bash
   # Create file: src/namespaces/ta/methods/yourfunction.ts
   ```

2. **Follow the factory pattern**
   ```typescript
   export function yourfunction(context: any) {
       return (source: any, period: any, _callId?: string) => {
           const stateKey = _callId || `yourfunc_${period}`;
           // Implementation with incremental calculation
           // Return NaN during initialization
           // Use context.precision() for output
       };
   }
   ```

3. **Add tests**
   ```bash
   # Create: tests/compatibility/namespace/ta/methods/indicators/yourfunction.test.ts
   ```

4. **Regenerate barrel file** (only needed for some namespaces check package.json scripts)
   ```bash
   npm run generate:ta-index
   ```

5. **Run tests**
   ```bash
   npm test -- yourfunction.test.ts --run
   ```

#### For other namespaces:

- **Math**: `npm run generate:math-index`
- **Array**: `npm run generate:array-index`
- **Input**: `npm run generate:input-index`
- **Request**: `npm run generate:request-index`

### Running Tests

```bash
# Run all tests
npm test -- --run

# Run specific test file
npm test -- ta-sma.test.ts --run

# Run with coverage
npm run test:coverage

# Watch mode (during development)
npm test
```

**Important**: PineTS uses **Vitest**, not Jest. Don't use Jest-specific flags.

### Building

```bash
# Development build
npm run build:dev:all

# Production build
npm run build:prod:all
```
---

## Testing Requirements

**All code changes MUST include tests.** No exceptions.

### What to Test:

1. **Basic Functionality**: Correct calculation with known inputs
2. **Edge Cases**: 
   - NaN inputs
   - Single bar scenarios
   - Empty/insufficient data
3. **Multiple Calls**: Same function with different parameters
4. **State Isolation**: Verify independent state with different `_callId`s
5. **Initialization Period**: Ensure NaN is returned when appropriate

### Test Template:

```typescript
import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '@pinets/marketData/Provider.class';

describe('ta.yourfunction', () => {
    it('should calculate correctly', async () => {
        const pineTS = new PineTS(
            Provider.Mock,
            'BTCUSDC',
            '60',
            null,
            new Date('2024-01-01').getTime(),
            new Date('2024-01-10').getTime()
        );

        const { plots } = await pineTS.run(($) => {
            const { close } = $.data;
            const { ta, plotchar } = $.pine;

            const result = ta.yourfunction(close, 14);
            plotchar(result, 'result');
        });

        expect(plots['result']).toBeDefined();
        expect(plots['result'].data.length).toBeGreaterThan(0);

        // Verify specific values
        const lastValue = plots['result'].data[plots['result'].data.length - 1].value;
        expect(lastValue).toBeCloseTo(expectedValue, 8);
    });

    it('should handle NaN inputs gracefully', async () => {
        // Test with NaN inputs
    });

    it('should maintain independent state for multiple calls', async () => {
        // Test state isolation
    });
});
```

---

## Code Style

### TypeScript

- Use TypeScript for new code
- Properly type function signatures
- Document complex logic with comments

### Naming Conventions

- **TA/Math functions**: lowercase (e.g., `ema`, `sma`, `rsi`)
- **Classes**: PascalCase (e.g., `Series`, `Context`, `PineTS`)
- **Private methods**: prefix with `_` (e.g., `_initializeState`)
- **Constants**: UPPER_CASE (e.g., `MAX_ITERATIONS`)

### Comments

- Explain **WHY**, not **WHAT**
- Document non-obvious behavior
- Add warnings for critical sections
- Reference Pine Script documentation when relevant

### Formatting

We use Prettier for code formatting:

```bash
# Format is automatic on save, or run:
npx prettier --write .
```

---

## Getting Help

### Where to Ask:

- **General Questions**: [GitHub Discussions](https://github.com/LuxAlgo/PineTS/discussions)
- **Bug Reports**: [GitHub Issues](https://github.com/LuxAlgo/PineTS/issues)
- **Feature Proposals**: [GitHub Discussions](https://github.com/LuxAlgo/PineTS/discussions) first
- **Private Contact**: [QuantForge Contact Form](https://quantforge.org/contact/)

### Resources:

- [Documentation](https://quantforgeorg.github.io/PineTS/)
- [Architecture Guide](./docs/architecture/index.md)
- [API Coverage](https://quantforgeorg.github.io/PineTS/api-coverage/)

---

## License and CLA

By contributing to PineTS, you agree to the terms of the [CLA](https://github.com/LuxAlgo/cla-signatures/blob/main/CLA.md).

---

## Recognition

Contributors are recognized in:
- GitHub Contributors page
- Release notes (for significant contributions)
- Our hearts ❤️

---

Thank you for contributing to PineTS! Together, we're building the future of open algorithmic trading. 🚀
