# Manual test in Deska

A checklist to run by hand in the real Deska app, which the preview host and
the automated tests cannot replace. Run it before submitting. Use any notebook
from `fixtures/` (one with outputs, a table and an image is best).

Each step below is also recorded with an SDK double in
[docs/recordings](recordings/RESULTS.md) (`npm run record`). Those recordings
show the panel's side; this checklist confirms the real host. `demo-sales.ipynb`
is a good notebook to use.

Prepare: `npm run build`.

## 1. Load the package

1. In Deska, open _Build a panel_ and choose _Load a folder_.
2. Select `dist/notebook-viewer` (the folder that holds `panel.json`).

**Expected:** the panel loads with no error. It shows the empty state with the
drop hint. The name "Notebook Viewer" and the icon appear.

## 2. Open a notebook

1. Drag a `.ipynb` file onto the panel.

**Expected:** the header shows the file name, kernel, language and cell count.
Code is highlighted; tables, images, LaTeX, streams and tracebacks render. No
"Changed" marks appear (there is no previous copy).

## 3. Light and dark theme

1. Switch Deska to the dark theme, then back to light.

**Expected:** the panel follows the theme both ways. Text stays readable, and
images, tables and code keep contrast. Nothing is left white on dark.

## 4. Reload the panel

1. Reload the panel (or restart Deska).

**Expected:** the last notebook reopens by itself, at the top, with the same
content. If it was over 32 MB, the empty state shows instead and the panel had
said earlier that it would not be kept.

## 5. A new copy of the same notebook

1. Edit a copy of the notebook outside Deska: change one cell's source and one
   output, delete another cell. Keep the same file name.
2. Drag the edited copy onto the panel.
3. Turn on the "Changed" filter.

**Expected:** the edited cells are marked as changed and the deleted one is
listed as deleted. The filter shows only those cells. Turning it off shows all
cells again.

## 6. Connect an agent and use the three actions

Connect the panel to a task with a coding agent. The first time, Deska asks for
the `agent` permission: accept it. With the notebook from step 5 open, ask the
agent for each action:

| Ask the agent to | Expected |
| --- | --- |
| `scroll_to_cell`: scroll to cell 5 (by index), then to a cell by id | The view moves to that cell and nothing else changes. A cell that does not exist returns `not_found` and the view stays. |
| `highlight_cell`: highlight a cell for 5 seconds | The view scrolls to it and marks it. The mark disappears by itself after about 5 seconds. Without a duration it lasts 3 seconds. |
| `summarize_changes`: summarize the changes | It returns the cells changed or deleted (id, index, type, status, short summary), the same ones the "Changed" filter shows. With no previous copy loaded it returns `available: false` and a message. |

**Expected overall:** no file is written or read, no cell is run, and the
notebook is not changed.

## 7. Refuse the permission

1. Reset the panel's permissions (or install it fresh), connect an agent, and
   when Deska asks for `agent`, refuse.
2. Drop a notebook, switch the theme, search, fold cells, use the outline, open
   a new copy and use "Changed". Reload the panel.

**Expected:** the panel works as in steps 2 to 5. Only the three agent actions
are unavailable: the agent cannot call them and the panel shows no error.
