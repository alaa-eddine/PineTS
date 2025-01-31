# PineTS Language Coverage

This document lists the features of the PineTS language and their status.

| Feature                | Status      | Comments                                                                |
| ---------------------- | ----------- | ----------------------------------------------------------------------- |
| Execution model        | done        | Core Pine Script language features, execution, and transpiler           |
| Time series            | done        | Variables behave like Pine Script time series (array annotation access) |
| Script structure       | done        | Syntax closely matches Pine Script where possible                       |
| Identifiers            | native      | Uses native JS/TS identifiers                                           |
| Operators              | native      | Uses native JS/TS operators                                             |
| Variables declarations | done        | Supports time series and variable syntaxes                              |
| Conditional structures | implemented | if implemented / switch needs testing                                   |
| Loops                  | partial     | for done / while missing / for in missing                               |
| Type system            | native      | Uses native JS/TS types                                                 |
| Builtins               | partial     | Implemented open, close, high, low, hl2, hlc3, ohlc4                    |
| Functions              | in progress | Check [api-coverage](api-coverage.md) for details                       |
| Objects                | in progress | Check [api-coverage](api-coverage.md) for details                       |
| Enums                  | in progress | Check [api-coverage](api-coverage.md) for details                       |
| Methods                | in progress | Check [api-coverage](api-coverage.md) for details                       |
| Arrays                 | in progress | Check [api-coverage](api-coverage.md) for details                       |
| Matrices               | not started | Check [api-coverage](api-coverage.md) for details                       |
| Maps                   | not started | Check [api-coverage](api-coverage.md) for details                       |
