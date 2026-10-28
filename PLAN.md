# Notebook Viewer for Deska: plan

Status: PLAN, nothing built. Written 2026-10-27.

Notebook Viewer is a [Deska](https://deska.dev) community panel for **reading**
notebooks, starting with Jupyter's `.ipynb`. It is built only against Deska's
public panel documentation and public examples:

- Panel docs: https://deska.dev/docs/build-panels. See also the
  [manifest](https://deska.dev/docs/panel-manifest),
  [SDK](https://deska.dev/docs/panel-sdk),
  [sandbox](https://deska.dev/docs/panel-sandbox),
  [limits](https://deska.dev/docs/panel-errors),
  [debugging](https://deska.dev/docs/panel-debugging) and
  [publishing](https://deska.dev/docs/panel-publishing) pages.
- Examples, the preview host and the validator:
  https://github.com/0xPasho/deska-panels-examples (MIT).

Nothing in this repository comes from, or depends on, anything that is not
public.

## The ask

A data user in the Deska community works on `.ipynb` files with a coding agent:
the agent edits, runs and validates the notebook, and the person only reads the
result. Today they do that in VS Code. They want to do it in Deska.

Goals, in order:

1. The best **reading** experience for that person's data work.
2. Then other notebook tools, and other people.

**Input.** The user is writing a thread in the Deska community forum that
describes their real data workflow. That thread, and the notebooks shared in it,
decide the acceptance tests for the first versions and the order of what
follows. Link it here when it is up.

## Constraints from Deska's public docs

| Area | What the docs say | What it means here |
| --- | --- | --- |
| Package | 5 MB zipped, 20 MB unpacked, 500 files. Only `html js mjs css json svg png jpg jpeg webp gif woff2 md txt` | All renderers must be bundled and small. KaTeX fonts ship as `woff2`. |
| Code | No workers, no WebAssembly, no `eval` or `new Function`, scripts only from the package | Parsing and rendering run on the main thread in chunks. Every library must work without `eval`. |
| Network | `default-src 'none'`. Only the package and declared hosts | The panel declares no network. Everything is bundled. |
| Frames | `frame-src 'none'` | Interactive outputs that need their own frame (Plotly, Bokeh, widgets) cannot run. They show their static fallback. |
| Files | Drops, paste and `<input type="file">` reach the page. `deska.files` keeps up to 32 MB per file and 256 MB per package. `deska.storage` holds 256 KB | Today a notebook reaches the panel when the person drops it **onto the panel** or picks it. |

## What the panel does

### One cell model, many formats

Every format is read by an **adapter** into one model:

- An ordered list of cells. Each cell is `markdown`, `code` or `raw`, with its
  source, language, execution count, outputs as MIME bundles and a stable id.
- Notebook metadata: kernel, language and title.

Rendering, change detection, search and any later agent features work on the
model only. A new notebook tool means a new adapter, not a new panel.

| Adapter | Files | Outputs saved | Version |
| --- | --- | --- | --- |
| Jupyter | `.ipynb`, nbformat 4.0 to 4.5. Covers Jupyter, JupyterLab, Google Colab, Kaggle, VS Code notebooks, and exports from Deepnote, Hex and Databricks | Yes | 0.1 |
| Zeppelin | `.zpln` | Yes | 0.5 |
| Jupytext and Databricks source | `.py` with `# %%` or `# Databricks notebook source` | No | 0.5 |
| marimo | `.py` with `import marimo` and `@app.cell` | No | 0.5 |
| R Markdown and Quarto | `.Rmd`, `.qmd` | No | 0.5 |

nbformat 3 shows "Older notebook format", with the raw text. Invalid input shows
the parse error and the raw text.

### Rendering

- **Code:** syntax highlighting for Python, R, Julia, Scala and SQL.
- **Markdown:** rendered with LaTeX through KaTeX, and sanitized.
- **Outputs:** each one uses the first MIME type it carries, in this order:
  1. `text/html`, sanitized
  2. `image/svg+xml`, sanitized
  3. `image/png`
  4. `image/jpeg`
  5. `text/markdown`
  6. `text/latex`
  7. `text/plain`, with ANSI colors for tracebacks

  Streams and errors render too. An unknown or interactive MIME type falls back
  through the same order, then to an "Interactive output, not shown" row.
- **Untrusted input:** every notebook is treated as untrusted. HTML and SVG pass
  through DOMPurify. Nothing in the notebook runs as script, and the panel
  declares no network.
- **Large notebooks:** cells render virtualized (only what is on screen), and
  images decode lazily. Parsing yields to the browser between chunks.
- **Size warning:** over a recommended size (50 MB to start, tuned with real
  notebooks from the forum thread), the panel asks first. *Open anyway* opens
  it with no limit; *Cancel* opens nothing.
- **Theme:** Deska's theme tokens, light and dark
  ([docs](https://deska.dev/docs/panel-theming)).
- **Header:** file name, format, kernel and language, cell count, and when the
  notebook was loaded.
- **Languages:** English and Spanish.

### Getting the notebook in

The panel reads notebooks through one interface, `NotebookSource`:

```ts
interface NotebookSource {
  /** The current file, or null when none is open. */
  current(): Promise<{ name: string; size: number; modifiedAt?: number; bytes: Uint8Array } | null>
  /** Called when the file changes. Sources that cannot watch never call it. */
  onChange(listener: () => void): () => void
}
```

- **`DropSource` (0.1):** the person drops a notebook onto the panel or picks it
  with the file picker. The panel keeps the last notebook with `deska.files`
  (up to 32 MB) so it reopens after a restart. A larger notebook stays only for
  the session, and the panel says so. Dropping a newer copy replaces it.

## Roadmap

Each version ships when its acceptance tests pass. They run in the examples
repository's preview host and as a folder loaded into Deska. Once the forum
thread exists, they also run on its notebooks.

### 0.1: read a Jupyter notebook

- The repository: TypeScript, a bundler that emits one package folder,
  unit tests, lint, and a size budget check (5 MB zipped, 20 MB unpacked, 500
  files).
- The cell model and the Jupyter adapter.
- Rendering as above, with virtualization, the size warning, theme and the
  header.
- `DropSource`, drag and drop, the file picker, and reopening the last notebook.
- `panel.json` with no network and no permissions beyond what is needed.

Acceptance:

1. A pandas table, a matplotlib PNG, an SVG, LaTeX in Markdown, a stream and a
   traceback all render correctly, in light and dark.
2. A Plotly output shows its static fallback or the placeholder row.
3. A hostile notebook (script tags, event handlers, `javascript:` links, SVG
   with script) runs nothing. A test proves it.
4. A 10,000-cell notebook opens and scrolls without freezing. The time to first
   render is measured and recorded.
5. A notebook over the threshold asks first: *Cancel* opens nothing and *Open
   anyway* opens it.
6. Invalid JSON and nbformat 3 show their messages and the raw text.
7. The package passes the examples repository's `npm run validate` and
   `npm run check`, and stays within the size budget.
8. The last notebook reopens after the panel reloads.

### 0.2: reading the agent's work

The forum thread shapes this version. It starts with these candidates:

- **What changed:** when a newer copy of the same notebook is loaded, cells whose
  source or outputs changed are marked, and a "Changed" filter shows only them.
- An outline from the Markdown headings, search across cells, collapsing inputs
  or outputs, an "Outputs only" view, and copying a cell or an output image
  (`clipboard-write`, asked at install).
- The execution count and timing for each cell, when the notebook carries them.
- Large pandas tables scroll inside their own box.

### 0.3: Marketplace

- Screenshots, a description and the submission
  ([publishing docs](https://deska.dev/docs/panel-publishing)).
- The forum user tries it before it is submitted.

### 0.4: the agent points at cells

- Panel actions through the public `deska.agent` API
  ([docs](https://deska.dev/docs/panel-actions)): `scroll_to_cell`,
  `highlight_cell` and `summarize_changes`, so a connected agent can show the
  person where something failed.
- As the docs require, a package with `agent` declares no network.

### 0.5: notebook tools beyond Jupyter

- The Zeppelin, Jupytext, Databricks source, marimo, R Markdown and Quarto
  adapters, in the order people ask for them.

### Integration with Deska

- File integration will be considered when Deska documents it publicly.

### Not planned

- **Editing or running notebooks.** The person's agent does that.
- **Interactive outputs** (Plotly, Bokeh, ipywidgets). The public sandbox refuses
  the frames and the run-time code they need. They show their static fallback
  instead.
- **Mathematica `.nb`** and other formats without an open spec.

## Risks

- **Trademark.** "Jupyter" is a trademark of NumFOCUS and Project Jupyter. We use
  it only descriptively ("for Jupyter notebooks"), never as the product name,
  and we check their trademark guidelines before submitting.
- **Main-thread work.** With no workers, a huge notebook can stall the panel.
  Chunked parsing, virtualization and the size warning are the defense, and
  acceptance test 4 measures it.
- **Bundle size.** KaTeX, a highlighter, a Markdown renderer and DOMPurify must
  fit in 5 MB with room to spare. A highlighter with on-demand languages keeps
  it small.
- **The 32 MB `deska.files` limit.** Larger notebooks cannot be kept across
  restarts.

## Questions the forum thread should answer

1. Do their notebooks rely on interactive outputs?
2. Do they use Python only, or R, Julia or SQL too? Do they use other notebook
   tools (Colab, Databricks, marimo, Quarto)?
3. Does their agent write outputs into the same file or a copy?
4. What are their typical and largest notebook sizes?
5. What do they look at first after a run?
6. Would they test 0.1 before it is submitted?

## License

MIT. See [LICENSE](LICENSE).
