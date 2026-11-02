# Working on this repository

Notebook Viewer is a [Deska](https://deska.dev) community panel that reads
notebooks, starting with Jupyter's `.ipynb`. [PLAN.md](PLAN.md) says what it does
and why; this file says how to work on it.

## Sources you may use

Everything in this repository comes from public material. Read only:

- [PLAN.md](PLAN.md) and the Deska panel docs:
  [build panels](https://deska.dev/docs/build-panels),
  [panel.json](https://deska.dev/docs/panel-manifest),
  [SDK](https://deska.dev/docs/panel-sdk),
  [sandbox](https://deska.dev/docs/panel-sandbox),
  [error codes and limits](https://deska.dev/docs/panel-errors),
  [theme tokens](https://deska.dev/docs/panel-theming),
  [testing and debugging](https://deska.dev/docs/panel-debugging) and
  [publishing](https://deska.dev/docs/panel-publishing).
- The examples repository, [0xPasho/deska-panels-examples](https://github.com/0xPasho/deska-panels-examples)
  (MIT): its panels, its preview host and its package checks.
- npm, and each library's own documentation.

Copy no code whose license is not MIT, BSD, ISC or Apache-2.0. Do not add a
dependency without agreeing it first: every one of them has to fit in the
package budget and be bundleable without `eval`.

## Stack

TypeScript and Vite; the UI is Preact. Tests are Vitest on happy-dom, and
Playwright is installed for the browser tests. Markdown is markdown-it with
KaTeX, code is highlighted with highlight.js, HTML and SVG are sanitized with
DOMPurify, and ANSI output is rendered with ansi_up. Lint is ESLint.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install the toolchain. Node 22.12 or newer. |
| `npm run build` | Build the package folder: `dist/notebook-viewer/`, with `panel.json` at its root. |
| `npm run test` | Unit tests (Vitest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run size` | The size budget: 5 MB zipped, 20 MB unpacked, 500 files, and only the file types a package may carry. |
| `npm run csp-lint` | Fails when the bundle holds something the sandbox refuses: `eval(`, `new Function`, `importScripts`, `new Worker` or `WebAssembly`. |
| `npm run validate:deska` | Runs the examples repository's package checks over `dist/notebook-viewer/`. |
| `npm run preview:deska` | Serves the built package in the examples repository's preview host. |
| `npm run package` | Builds, then writes the zip to upload: `dist/notebook-viewer.zip`. |

`size`, `csp-lint` and `validate:deska` take an optional package folder:
`npm run size -- some/folder`. That is also how to try them on a folder that
should fail.

## Where things live

```
panel/panel.json     the manifest; the build copies it to the package root
src/app/             the page: entry HTML, Preact components, styles
src/agent/           the actions a connected agent can call (`deska.agent`), free of the DOM
src/source/          where a notebook comes from (drop, file picker, later the host)
src/model/           the cell model every format is read into
src/adapters/        one adapter per notebook format
src/render/          cells, outputs, Markdown, LaTeX and highlighting
src/i18n/            the panel's own words, English and Spanish
src/styles/          shared CSS
scripts/             the package scripts (build helpers, size, csp-lint, validate, preview, zip)
fixtures/            notebooks to test against, including hostile ones
e2e/                 Playwright tests against the preview host
```

Every folder under `src/` has an `index.ts` that says what it offers. Keep the
model free of DOM and of Deska: rendering, search and later agent features work
on the model alone, and a new notebook format is a new adapter, not a new panel.

## The package rules the scripts check

A package is at most 5 MB zipped, 20 MB unpacked and 500 files, and may only
carry `html js mjs css json svg png jpg jpeg webp gif woff2 md txt`. The page
runs under `default-src 'none'`: no network, no frames, no `eval`, no workers,
no WebAssembly. Ship every library inside the package, and declare no host in
`panel.json` unless the panel really fetches from it.

## Validating and previewing with the examples repository

Clone the examples repository next to this one (any path will do; a sibling
folder is the default):

```sh
git clone https://github.com/0xPasho/deska-panels-examples
cd deska-panels-examples && npm install
```

Then, from this repository:

```sh
npm run build
npm run validate:deska   # the package checks, over dist/notebook-viewer/
npm run preview:deska    # the preview host, at http://127.0.0.1:5170/
```

Both scripts find the clone at `../deska-panels-examples`; set
`DESKA_PANELS_EXAMPLES_DIR` to point somewhere else. The preview host takes the
package folder as an argument, so the package stays in this repository and
nothing is copied into the examples repository.

The examples repository's own browser check works on our folder too, because it
passes its argument through to the preview host. Install its browser once, then
run it from the examples repository, with the path to our package:

```sh
cd deska-panels-examples
npx playwright install chromium-headless-shell
node tools/check.mjs ../../<this repository>/dist/notebook-viewer
```

It loads the page in the preview host under Deska's policy, in the light and the
dark theme, and fails on a console error or a policy violation. It writes its
screenshots under the examples repository's `docs/screenshots/preview/`.

Before publishing, load `dist/notebook-viewer/` in Deska itself (Panel Library,
Community, Build a panel, Load a folder): that is the runtime the panel ships to.

## Writing rules

- Write English in the code, the comments and the docs, and Spanish and English
  in the panel's own words (`src/i18n/`).
- Never write a local path, a user name, a machine name or an internal project
  name in a tracked file. Paths in the repository are relative, and the
  scripts take folders as arguments or from environment variables.
- Never write a model or provider name either. Nothing here depends on one.
- `PLAN.md` and `LICENSE` are not edited by hand as part of a change; if a
  change contradicts the plan, say so instead of quietly rewriting it.
- No absolute paths, no `..` and no backslashes inside the package: Deska
  refuses them.
