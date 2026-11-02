import { jupyterAdapter } from './jupyter'
import { databricksAdapter, jupytextAdapter, marimoAdapter } from './py'
import { registerAdapter } from './registry'

registerAdapter(jupyterAdapter)
// A `.py` file is read by what it holds: Databricks and marimo first, as their
// markers are the most specific; Jupytext's `# %%` is the loosest.
registerAdapter(databricksAdapter)
registerAdapter(marimoAdapter)
registerAdapter(jupytextAdapter)

export * from './jupyter'
export * from './py'
export * from './registry'
