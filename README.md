# Notebook Viewer for Deska

A [Deska](https://deska.dev) community panel for reading notebooks, starting with
Jupyter `.ipynb`. [PLAN.md](PLAN.md) says what it does, why, and in which order.

Today the repository builds a package that loads: a page that says hello, a
`panel.json` with no network and no permissions, and the scripts that measure,
check and preview it. The notebook model, the adapters and the rendering come
next.

## Try it

```sh
npm install
npm run build          # → dist/notebook-viewer/, with panel.json at its root
npm run size           # 5 MB zipped, 20 MB unpacked, 500 files
npm run csp-lint       # nothing the sandbox refuses
npm run validate:deska # the examples repository's package checks
npm run preview:deska  # the examples repository's preview host, on this folder
```

`npm run test`, `npm run lint` and `npm run typecheck` run the unit tests, the
linter and the type check. `npm run package` writes the zip to upload:
`dist/notebook-viewer.zip`.

## Working on it

[AGENTS.md](AGENTS.md) lists the public sources this repository is built from,
the commands, how the folders fit together, and the rules a package lives under.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every library and its
license.

## License

MIT. See [LICENSE](LICENSE). "Jupyter" is a trademark of NumFOCUS and Project
Jupyter, used here only to say which notebooks the panel reads.
