# Third-party notices

Notebook Viewer is MIT licensed; see [LICENSE](LICENSE). It bundles the
libraries below into the package. Each one is used under a license that allows
redistribution: MIT, BSD-3-Clause or Apache-2.0.

## Bundled into the panel

| Library | Version | License |
| --- | --- | --- |
| [preact](https://preactjs.com) | 11.0.2 | MIT |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.3 | MIT |
| [KaTeX](https://katex.org) | 0.19.1 | MIT |
| [highlight.js](https://highlightjs.org) | 11.12.0 | BSD-3-Clause |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.17 | MPL-2.0 OR Apache-2.0, used under Apache-2.0 |
| [ansi_up](https://github.com/drudru/ansi_up) | 6.0.6 | MIT |

KaTeX ships only its `woff2` fonts, because a package may not carry other font
files.

## Build and test tooling, not shipped in the package

| Tool | Version | License |
| --- | --- | --- |
| [TypeScript](https://www.typescriptlang.org) | 5.9.3 | Apache-2.0 |
| [Vite](https://vite.dev) | 8.3.5 | MIT |
| [Vitest](https://vitest.dev) | 5.0.5 | MIT |
| [happy-dom](https://github.com/capricorn86/happy-dom) | 21.0.4 | MIT |
| [Playwright](https://playwright.dev) | 1.64.1 | Apache-2.0 |
| [ESLint](https://eslint.org) | 10.13.0 | MIT |
| [@eslint/js](https://eslint.org) | 10.0.1 | MIT |
| [typescript-eslint](https://typescript-eslint.io) | 8.72.1 | MIT |
| [globals](https://github.com/sindresorhus/globals) | 17.13.0 | MIT |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | 22.20.5 | MIT |
| [@types/markdown-it](https://github.com/DefinitelyTyped/DefinitelyTyped) | 14.2.0 | MIT |
| [@types/katex](https://github.com/DefinitelyTyped/DefinitelyTyped) | 0.16.8 | MIT |

The examples repository, [0xPasho/deska-panels-examples](https://github.com/0xPasho/deska-panels-examples),
is MIT licensed and is used at build and check time only: its package checks and
its preview host are run from a clone, and nothing from it is copied into this
repository.
