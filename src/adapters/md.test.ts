import { describe, expect, it } from 'vitest'
import quarto from '../../fixtures/notebooks/quarto-doc.qmd?raw'
import rmarkdown from '../../fixtures/notebooks/rmarkdown-report.Rmd?raw'
import zeppelin from '../../fixtures/notebooks/zeppelin-note.zpln?raw'
import { findAdapter, rmarkdownAdapter, zeppelinAdapter } from './index'

const bytes = (text: string) => new TextEncoder().encode(text)
const opts = { yieldEvery: 2 }

async function read(adapter: typeof rmarkdownAdapter, text: string) {
  const result = await adapter.parse(bytes(text), opts)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe('detection', () => {
  it.each([
    ['a.Rmd', 'rmarkdown'],
    ['b.QMD', 'rmarkdown'],
    ['c.zpln', 'zeppelin'],
  ])('%s is read by %s', (name, id) => {
    expect(findAdapter(name, new Uint8Array())?.id).toBe(id)
  })
})

describe('R Markdown', () => {
  it('turns prose into Markdown cells and engine chunks into code cells', async () => {
    const nb = await read(rmarkdownAdapter, rmarkdown)
    expect(nb.cells.map((c) => [c.type, c.language])).toEqual([
      ['markdown', undefined],
      ['code', 'r'],
      ['markdown', undefined],
      ['code', 'r'],
      ['code', 'python'],
    ])
    expect(nb.metadata).toEqual({ language: 'r', title: 'Penguin report' })
    expect(nb.cells[0]!.source).toContain('$\\bar{x}$')
    expect(nb.cells[1]!.source).toBe('library(palmerpenguins)\nknitr::opts_chunk$set(echo = TRUE)')
    expect(nb.cells.every((c) => c.outputs.length === 0)).toBe(true)
  })

  it('does not take a ```{r} inside a longer fence for a chunk', async () => {
    const nb = await read(rmarkdownAdapter, rmarkdown)
    expect(nb.cells[2]!.source).toContain('````markdown\n```{r}\nsummary(penguins)\n```\n````')
  })

  it('reads Quarto chunk options as part of the code', async () => {
    const nb = await read(rmarkdownAdapter, quarto)
    expect(nb.cells.map((c) => [c.type, c.language])).toEqual([
      ['markdown', undefined],
      ['code', 'python'],
      ['markdown', undefined],
      ['code', 'r'],
    ])
    expect(nb.cells[1]!.source.startsWith('#| label: delays')).toBe(true)
    expect(nb.cells[2]!.source).toContain('callout-note')
    expect(nb.metadata.title).toBe('Flights')
  })

  it('keeps an unclosed chunk and rejects an empty file', async () => {
    const nb = await read(rmarkdownAdapter, '```{r}\nx <- 1\n')
    expect(nb.cells).toMatchObject([{ type: 'code', source: 'x <- 1' }])
    expect(await rmarkdownAdapter.parse(bytes('---\ntitle: x\n---\n'), opts)).toMatchObject({
      ok: false,
      error: { code: 'not_a_notebook' },
    })
  })
})

describe('Zeppelin', () => {
  it('reads paragraphs with their interpreters and outputs', async () => {
    const nb = await read(zeppelinAdapter, zeppelin)
    expect(nb.metadata).toEqual({ language: 'python', title: 'Sales exploration' })
    expect(nb.cells.map((c) => [c.type, c.language])).toEqual([
      ['markdown', undefined],
      ['code', 'python'],
      ['code', 'sql'],
      ['code', 'python'],
      ['code', 'scala'],
    ])
    expect(nb.cells[0]).toMatchObject({ id: 'paragraph_170931_1' })
    expect(nb.cells[0]!.source).toBe('# Sales exploration\nTotals by region, from the *orders* table.')
    expect(nb.cells[1]!.source).toBe("print('rows:', 2)\nprint(spark.version)")
    expect(nb.cells[1]!.durationMs).toBe(2500)
    expect(nb.cells[1]!.generatedId).toBeUndefined()
  })

  it('maps result types to the shared output model', async () => {
    const nb = await read(zeppelinAdapter, zeppelin)
    expect(nb.cells[1]!.outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'rows: 2\n3.5.0\n' }])
    const table = nb.cells[2]!.outputs[0]
    expect(table).toMatchObject({ type: 'mime_bundle' })
    expect((table as { data: Record<string, string> }).data['text/html']).toContain('<td>north</td><td>120</td>')
    expect(nb.cells[3]!.outputs[0]).toMatchObject({ type: 'mime_bundle' })
    expect(Object.keys((nb.cells[3]!.outputs[0] as { data: object }).data)).toEqual(['image/png'])
    expect(nb.cells[4]!.outputs[0]).toMatchObject({
      type: 'error',
      evalue: 'java.lang.ArithmeticException: / by zero',
    })
  })

  it('escapes table cells', async () => {
    const note = JSON.stringify({
      paragraphs: [{ text: '%sql\nx', results: { code: 'SUCCESS', msg: [{ type: 'TABLE', data: 'a\n<b>\n' }] } }],
    })
    const nb = await read(zeppelinAdapter, note)
    const out = nb.cells[0]!.outputs[0] as { data: Record<string, string> }
    expect(out.data['text/html']).toContain('&lt;b&gt;')
    expect(nb.cells[0]!.generatedId).toBe(true)
  })

  it('reports invalid JSON and non-notes', async () => {
    expect(await zeppelinAdapter.parse(bytes('{'), opts)).toMatchObject({ ok: false, error: { code: 'invalid_json' } })
    expect(await zeppelinAdapter.parse(bytes('{"a":1}'), opts)).toMatchObject({
      ok: false,
      error: { code: 'not_a_notebook' },
    })
  })
})
