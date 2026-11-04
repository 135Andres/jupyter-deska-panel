# Changelog

Every version listed here is tagged in git.

## 0.6.0 — 2026-11-03

- **Added:** a compact toolbar with icons replaces the column of buttons: Open,
  file name and header, search with a counter, outline, **Changed**, fold and
  **Outputs only**. Under 560 px the secondary controls move into a menu. New
  panel icon.
- **Added:** keyboard shortcuts: `j`/`k` cells, `/` search, `n`/`N` results,
  `c` Changed, `o` Outputs only, `?` the list, `Esc` closes. They never fire
  while typing.
- **Added:** five agent actions, so the connected agent can read, not only
  point: `get_cell` (source and outputs as text; a PNG comes back as an image),
  `get_outline`, `find_cells`, `list_errors` and `set_view` (the **Changed**
  filter and **Outputs only**). There are now eight actions.
- **Faster:** opening 10,000 cells takes a median of 126 ms to the first cell
  (was 1081 ms) with no main-thread task over 50 ms (was 590 ms). The parser
  yields only after 30 ms of work, and the first render gets its own task.
- **Fixed:** a hidden panel pauses indexing and search until Deska shows it.
- **Fixed:** on a slow host the empty state shows at once, the last notebook
  reopens when the host answers, and an agent call that arrives early waits for
  it instead of answering "not found". Refreshes run in order.
- **Fixed:** the theme applies when the host sends no `visibility` state
  (found while taking the screenshots; the panel threw before reading the theme).
- New fixtures with the exact quirks of Colab, Kaggle, VS Code and JupyterLab.
- Two new recorded walkthroughs (13 toolbar and keys, 14 agent reads), 14 in all.

## 0.5.1 — 2026-11-02

Found by the new recorded walkthroughs (`npm run record`, `docs/recordings/`):

- **Fixed:** the panel now follows a live theme change from Deska. Before, code
  blocks, tables, tracebacks and ANSI colours kept the old palette. In dark
  theme that left light code blocks with light text on them
  ([before](docs/recordings/before/02-theme-bug.png)). The panel now listens to
  the `theme` event and sets `color-scheme` so native controls match.
- **Added:** the notebook header that PLAN.md 0.1 asked for: title, kernel,
  language and cell count.
- **Fixed:** a `#` heading in a notebook no longer gets the panel title's small
  style.
- **Fixed:** with one deleted cell, the row now says "1 deleted cell" (and
  "1 celda eliminada" in Spanish), not "1 deleted cells".
- The drop hint lists every supported format.
- New: `fixtures/notebooks/demo-sales.ipynb` (a synthetic sales review with every
  output type), `npm run record` (12 self-checking walkthroughs, recorded as
  video and animated PNG) and `npm run demo-notebook`. The Marketplace
  screenshots now use the demo notebook.
- README rewritten with the showcase.

## 0.5.0 — 2026-11-02

- New formats: Jupytext percent, Databricks source and marimo `.py`, R Markdown
  `.Rmd`, Quarto `.qmd`, and Zeppelin `.zpln` with saved outputs.
- "Copy source" on a cell and "Copy image" on a PNG output (`clipboard-write`).

## 0.4.0 — 2026-11-02

- Agent actions through `deska.agent`: `scroll_to_cell`, `highlight_cell` and
  `summarize_changes` (sdk 4, `agent` permission, no network).
- `validate:agent` checks the documented `agent` rules. `validate:deska` ignores
  the three errors that the outdated examples validator reports for sdk 4 and
  `agent`.
- The visible cell stays in place when folding or using "Outputs only".
- Tables stay readable when the panel has no height. Colab execution times are
  read. Labels are translated (English and Spanish).
- Marketplace listing, icon, colour and screenshots.

## 0.2.0 — 2026-11-02

- **What changed:** a newer copy of the same notebook marks changed cells and
  shows a row for deleted cells. The "Changed" filter shows only those. Cells
  without ids are matched by source before position.
- Outline from the Markdown headings, and search across cells, in yielding
  batches.
- Fold inputs and outputs, "Outputs only", tables that scroll in their own box,
  and the execution time of each cell.

## 0.1.0 — 2026-11-02

- Jupyter `.ipynb` reader: the cell model, the Jupyter adapter, and rendering of
  Markdown with KaTeX, highlighted code, MIME outputs sanitized with DOMPurify,
  ANSI tracebacks, and a virtualized list.
- Drag and drop, the file picker, a warning before opening large files, and
  reopening the last notebook.
- All 8 acceptance criteria of PLAN.md 0.1 are covered by Playwright e2e tests.
  First render of 10,000 cells: median 706 ms.
