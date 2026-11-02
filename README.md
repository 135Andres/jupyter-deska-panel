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

## Navigate a notebook

Open **Outline** to jump to a Markdown heading, including headings in cells
outside the rendered window. **Search cells** searches cell sources and saved
text outputs, ignoring case and treating the query as literal text. Each matching
cell counts once. **Previous** and **Next** wrap through the matching cells;
the counter shows the selected result and total. Navigation switches the
**Changed** filter back to **All** so the destination is visible.

Indexing and search yield between batches of 100 cells. A new query cancels the
previous search; opening a new copy resets navigation.

## Working on it

[AGENTS.md](AGENTS.md) lists the public sources this repository is built from,
the commands, how the folders fit together, and the rules a package lives under.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every library and its
license.

## License

MIT. See [LICENSE](LICENSE). "Jupyter" is a trademark of NumFOCUS and Project
Jupyter, used here only to say which notebooks the panel reads.
