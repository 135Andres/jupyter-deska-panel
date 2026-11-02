import { describe, expect, it } from 'vitest'
import databricksSource from '../../fixtures/notebooks/databricks-source.py?raw'
import jupytextPercent from '../../fixtures/notebooks/jupytext-percent.py?raw'
import marimoApp from '../../fixtures/notebooks/marimo-app.py?raw'
import { databricksAdapter, jupytextAdapter, marimoAdapter } from './py'
import { findAdapter } from './index'

const bytes = (text: string) => new TextEncoder().encode(text)
const opts = { yieldEvery: 2 }

async function read(adapter: typeof marimoAdapter, text: string) {
  const result = await adapter.parse(bytes(text), opts)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe('detection by content', () => {
  it.each([
    ['a.py', jupytextPercent, 'jupytext'],
    ['b.py', databricksSource, 'databricks-source'],
    ['c.py', marimoApp, 'marimo'],
  ])('%s is read by %s', (name, text, id) => {
    expect(findAdapter(name, bytes(text))?.id).toBe(id)
  })

  it('ignores plain scripts and other extensions', () => {
    expect(findAdapter('x.py', bytes('print(1)\n'))).toBeUndefined()
    expect(findAdapter('x.txt', bytes(jupytextPercent))).toBeUndefined()
  })
})

describe('Jupytext percent', () => {
  it('reads markdown, code and raw cells without the YAML header', async () => {
    const nb = await read(jupytextAdapter, jupytextPercent)
    expect(nb.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'code', 'raw'])
    expect(nb.cells[0]!.source).toBe('# Sales by region\n\nMonthly totals, with $\\bar{x}$ as the mean.')
    expect(nb.cells[1]!.source).toContain('import pandas as pd')
    expect(nb.cells[2]!.source).toBe('df.groupby("region")["sales"].sum()')
    expect(nb.cells[3]!.source).toBe('Not rendered: kept as raw text.')
    expect(nb.cells.every((c) => c.outputs.length === 0 && c.generatedId)).toBe(true)
    expect(nb.metadata).toMatchObject({ kernel: 'python3', language: 'python' })
    expect(nb.format).toEqual({ adapterId: 'jupytext', version: 'percent' })
  })

  it('keeps code before the first marker and rejects a file with no cells', async () => {
    const nb = await read(jupytextAdapter, 'x = 1\n# %%\ny = 2\n')
    expect(nb.cells.map((c) => c.source)).toEqual(['x = 1', 'y = 2'])
    const empty = await jupytextAdapter.parse(bytes('\n'), opts)
    expect(empty).toMatchObject({ ok: false, error: { code: 'not_a_notebook' } })
  })
})

describe('Databricks source', () => {
  it('splits on COMMAND lines and decodes MAGIC cells', async () => {
    const nb = await read(databricksAdapter, databricksSource)
    expect(nb.cells.map((c) => [c.type, c.language])).toEqual([
      ['markdown', undefined],
      ['code', 'python'],
      ['code', 'sql'],
      ['code', 'python'],
    ])
    expect(nb.cells[0]!.source).toBe('# Orders pipeline\nReads the raw orders and counts them per day.')
    expect(nb.cells[1]!.source).not.toContain('DBTITLE')
    expect(nb.cells[2]!.source).toBe(
      'SELECT order_date, COUNT(*) AS n\nFROM raw.orders\nGROUP BY order_date',
    )
    expect(nb.cells[3]!.source).toBe('%pip install requests')
    expect(nb.format.adapterId).toBe('databricks-source')
  })
})

describe('marimo', () => {
  it('turns each @app.cell function into a cell', async () => {
    const nb = await read(marimoAdapter, marimoApp)
    expect(nb.cells.map((c) => c.type)).toEqual(['code', 'markdown', 'code', 'code'])
    expect(nb.cells[0]!.source).toBe('import marimo as mo')
    expect(nb.cells[1]!.source).toBe('# Slider demo\n\nPick a value below.')
    expect(nb.cells[2]).toMatchObject({ id: 'data', source: 'values = [1, 2, 3]\ntotal = sum(values)\ntotal' })
    expect(nb.cells[2]!.generatedId).toBeUndefined()
    expect(nb.cells[3]!.source).toBe('print(total * 2)')
    expect(nb.cells[0]!.generatedId).toBe(true)
  })

  it('drops a multi-line return', async () => {
    const nb = await read(
      marimoAdapter,
      'import marimo\napp = marimo.App()\n\n@app.cell\ndef _():\n    a = 1\n    return (\n        a,\n    )\n',
    )
    expect(nb.cells[0]!.source).toBe('a = 1')
  })
})
