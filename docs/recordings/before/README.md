# Before the 0.5.1 fixes

The first run of `npm run record` on v0.5.0, kept as evidence of what it caught.
The red caption marks the step that failed.

| File | Bug | Fixed in |
| --- | --- | --- |
| `02-theme-bug.png`, `02-theme-bug.webm` | Deska switched to dark while a notebook was open: background and text followed, but code blocks and tables kept the light palette, so light text sat on light blocks. The panel did not listen to the `theme` event. | 0.5.1 (`e2e/theme.spec.ts`) |
| `01-header-missing.png` | The notebook header from PLAN.md 0.1 (title, kernel, language, cell count) did not exist. | 0.5.1 |
