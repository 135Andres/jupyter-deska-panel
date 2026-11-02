# Marketplace listing and submission checklist

Prepared for version 0.2.0, following the
[publishing docs](https://deska.dev/docs/panel-publishing). Nothing has been
submitted. The text below is what to paste on the _Submit for review_ page.

## Listing

**Name:** Notebook Viewer

**Short description** (`panel.json`, one line, at most 140 characters):

> Read Jupyter notebooks: rich outputs, changed cells, search and outline. Opens .ipynb files offline.

**Long description:**

> Notebook Viewer is a reader for Jupyter notebooks (`.ipynb`, nbformat 4.0 to
> 4.5). It is made for people whose coding agent edits and runs the notebook
> while they only read the result.
>
> - **Rich outputs.** HTML tables, PNG and JPEG images, SVG, Markdown, LaTeX
>   (KaTeX), streams, and colored tracebacks, with syntax-highlighted code.
> - **Changed cells.** Open the same notebook again and the cells that changed
>   are marked. Use the "Changed" filter to see only those.
> - **Search and outline.** Search source and output text across the whole
>   notebook, and jump to any heading from the outline.
> - **Outputs only.** Hide the code and read just the results, or fold all
>   cells.
> - **Big notebooks.** Cells are virtualized and images decode lazily.
> - **Private and read-only.** Everything is bundled. The panel makes no network
>   requests, never runs anything from the notebook, and sanitizes all HTML and
>   SVG. It cannot edit or run notebooks.
> - Available in English and Spanish, in light and dark themes.
>
> Drop a `.ipynb` file onto the panel, or choose one with the button.

**What changed** (0.2.0, at most 1,000 characters):

> Marks the cells that changed when you open a newer copy of the same notebook,
> with a "Changed" filter. Adds an outline and search across source and output
> text, "Outputs only" and "Fold all" modes, and Colab execution times.
> Keeps the visible cell in place when folding.

**Category:** dev. **Color:** `#2f6fed`. **Icon:** `icon.svg`. **Author:** Notebook Viewer contributors.

## Permissions

`panel.json` declares `"permissions": ["agent"]`, `"network": []` and `"sdk": 4`.
Nothing else is requested, on purpose:

| Permission | Requested | Why |
| --- | --- | --- |
| `agent` | **Yes** | Lets the coding agent of the task the person connects the panel to drive it. See below. |
| `notify` | No | The panel never shows notifications. |
| `open-url` | No | Links inside a notebook are not opened by the panel. Also forbidden with `agent`. |
| `clipboard-write` | No | Nothing is copied by the panel. Planned for a later version. |
| `account` | No | There is no sign-in. Also forbidden with `agent`. |
| Network hosts | None | All libraries, fonts and styles are inside the package. Forbidden with `agent`. |
| Embeds | None | No other site is shown. Forbidden with `agent`. |

The panel stores the last notebook with `deska.files` and `deska.storage` (no
permission needed) and works when that fails.

### The `agent` permission

**Why it is asked.** The panel exists for people whose coding agent edits and
runs a notebook while they read the result. With `agent`, that agent can point
the person at the right cell and ask what changed, instead of the person
scrolling to find out. Deska asks for it at first use, not at install, and only
after the person has done something in the panel first. Without it the panel
still opens and reads notebooks; only the three actions below go away.

**What each action does.** Every action works on the notebook open in the
panel and nothing else. None reads or writes a file, runs a cell, or changes the
notebook.

| Action | Kind | What it does |
| --- | --- | --- |
| `scroll_to_cell` | write | Scrolls the view to one cell, by id or by 0-based index (exactly one of them). Fails with `not_found` if the cell does not exist. It only moves the view. |
| `highlight_cell` | write | Scrolls to a cell and marks it for 1 to 30 seconds (3 by default), by id or by index. Fails with `not_found` if the cell does not exist. The mark is visual and goes away by itself. |
| `summarize_changes` | read | Lists the cells changed or deleted since the previous copy of the open notebook: id, index, type, status and a short summary, up to 100 cells (`max`). When there is no previous copy, `available` is `false` and `message` says why. It returns what the panel already shows in its "Changed" filter. |

The actions, their schemas and their descriptions are in `panel.json`; the
rules they must follow are in the
[panel actions docs](https://deska.dev/docs/panel-actions) and are checked by
`npm run validate:agent`, which `npm run validate:deska` runs.

### Rule: this ID never declares network

**`notebook-viewer` will never declare `network`, `embeds`, `signedInEmbeds`,
`account` or `open-url`, in any later version.** Deska's rule is that once any
version of an ID has declared `agent`, no later version of it may declare those
five: a submission that does is refused, and Deska refuses to install, update or
reload it on a computer that has run an agent version. The only way out is to
drop `agent` first, and the panel then stays offline. So a feature that needs
the network (fetching a remote notebook, a web font, a link opener) must not be
added to this ID; it would need a different panel with a different ID and
without `agent`. Check this before accepting any change that touches `network`
or the permissions.

### Validator note

The examples repository's validator (commit `7a6e7c7`) only knows sdk 1 and has
no `agent`. `validate:deska` and `check:deska` ignore exactly three of its
errors (`sdk must be 1`, `Unknown field "agent"`, `Unknown permission "agent"`),
and only for a manifest with sdk 4 and an `agent` object; they print a notice
with the docs link. Every other error still fails.

## Screenshots

Five images, 1200 x 800 px PNG, in `panel/screenshots/`. The build copies them
to `screenshots/` at the package root. Regenerate with `npm run screenshots`.

| File | Shows |
| --- | --- |
| `1-rich-outputs-light.png` | Rich outputs, light theme |
| `2-rich-outputs-dark.png` | Rich outputs, dark theme |
| `3-changed-light.png` | The "Changed" filter, light theme |
| `4-search-outline-dark.png` | Search and outline, dark theme |
| `5-outputs-only-light.png` | "Outputs only", light theme |

The docs allow at most 5 images, so the other three theme variants (changed
dark, search light, outputs only dark) are not shipped. Edit `shots` in
`scripts/screenshots.mjs` to swap them.

## Checklist

Package and manifest:

- [x] Zip is at most 5 MB (0.61 MB), 20 MB unpacked, 500 files (29), with screenshots counted. `npm run size`.
- [x] Deterministic zip (`fflate` zip, from `npm run package`). Not compared byte for byte across two builds.
- [x] Package checks pass (`npm run validate:deska`).
- [x] Screenshots: 1 to 5 files, PNG, at most 2 MB each, 320 to 4,096 px per side, in `screenshots/` beside `panel.json`.
- [x] `name` is at most 40 characters and has no "Dex" or "Deska" word.
- [x] `description` is one line, at most 140 characters (100).
- [x] `author` is at most 40 characters.
- [x] `icon` is an `.svg` file inside the package. `color` is `#rrggbb`.
- [x] `version` is 0.2.0, greater than any earlier submission (none).
- [x] Requests only the permissions and sites it uses: `agent`, no network.
- [x] No password form, sign-in page or Deska sign-in.
- [x] Three actions (`scroll_to_cell`, `highlight_cell`, `summarize_changes`); descriptions are plain text, one line, at most 300 characters (`npm run validate:agent`).
- [ ] "What changed" text is final. A draft is above. Review it.

Behavior (from the pre-submission checklist):

- [x] Looks right in light and dark (the preview check and the screenshots).
- [ ] Looks right with a different accent color. Not tried.
- [x] Works offline: `default-src 'none'`, no network.
- [ ] Slow host. Not tried.
- [x] Empty first run: shows the drop hint.
- [x] Full storage: shows a notice when the last notebook cannot be saved.
- [ ] Stops work while hidden and recovers after a reload. Not tried. Parsing and search run in chunks; hidden behavior is not verified.
- [ ] Loads in Deska itself with no problems (Panel Library, Community, Build a panel, Load a folder). Not done: needs the Deska app.
- [ ] Works when the person refuses `agent`. Not tried: needs the Deska app.
- [x] Credits for third-party code are in `THIRD_PARTY_NOTICES.md`.
- [x] Fixtures are synthetic. No data or media from other sources.
- [ ] Forum user tries it before submission (PLAN.md 0.3). Pending.
- [ ] Submit on the _Submit for review_ page. Not done on purpose.
