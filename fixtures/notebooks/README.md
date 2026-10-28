# Notebook fixtures

Small, synthetic Jupyter notebooks for the panel's tests. Every file here was
written by hand for this repository (MIT, see `LICENSE`): none was downloaded
from the internet, and none comes from a real person's work.

| File | What it holds |
| --- | --- |
| `rich-outputs.ipynb` | A pandas table in `text/html`, a matplotlib `image/png`, an `image/svg+xml`, and a Markdown cell with inline and display LaTeX. The PNG is a real 2×2 image; the SVG has no script. |
| `stream-and-traceback.ipynb` | A stdout stream, a stderr stream, and an error output whose traceback carries real ANSI escape sequences (`\u001b[0;31m` and friends). |
| `plotly-with-fallback.ipynb` | A Plotly output (`application/vnd.plotly.v1+json`) that also carries `image/png`, so the panel can show the static fallback. |
| `plotly-no-fallback.ipynb` | A Plotly output with no `image/png`, only `text/plain`, so the panel shows its placeholder row. |
| `nbformat3.ipynb` | A valid nbformat 3 notebook, with a `worksheets` list, to check the "older notebook format" path. |
| `invalid-json.ipynb` | Truncated JSON, to check the invalid-input path. |
| `generate.ts` | The generator for the notebooks too large to commit. |

Every valid `.ipynb` here is nbformat 4.5 and follows the public nbformat
specification (<https://nbformat.readthedocs.io/>). Hostile notebooks live in
`fixtures/hostile/`, not here.

## Using the generator

`generate.ts` is TypeScript and runs from the Vitest tests. It never writes to
disk and has no dependencies:

```ts
import {
  generateLargeNotebook,
  generateMixedNotebook,
} from '../../fixtures/notebooks/generate'

const mixed = generateMixedNotebook() // 10,000 cells, Uint8Array
const large = generateLargeNotebook() // over 50 MiB, Uint8Array
```

Both are deterministic: the same parameters give the same bytes. `mixed` mixes
Markdown and code cells, and the code cells carry stream, text and HTML outputs.
`large` repeats a fixed text block until the JSON passes 50 MiB, so no large
file is committed. A caller that needs a file writes the bytes to the system
temporary directory (`os.tmpdir()`), never inside the repository.

`src/adapters/fixtures.test.ts` reads the `.ipynb` files with Vite's `?raw`
imports and exercises the generator.
