import { describe, expect, it, vi } from 'vitest'
import { indexNavigation, searchCells } from './navigation'
import type { Cell, Notebook } from './types'

const cell = (id: string, source: string, type: Cell['type'] = 'code', outputs: Cell['outputs'] = []): Cell => ({ id, source, type, outputs })
const notebook = (cells: Cell[]): Notebook => ({ cells, metadata: {}, format: { adapterId: 'jupyter', version: '4.5' } })
const signal = () => new AbortController().signal

describe('outline', () => {
  it('keeps Markdown headings in order with levels, labels and cell ids, excluding fences and code cells', async () => {
    const index = await indexNavigation(notebook([
      cell('md', '# **Title** with [link](https://example.com)\n\nSubtitle\n---\n\n```md\n# fake\n```\n\n### Title', 'markdown'),
      cell('code', '# not a heading'),
      cell('raw', '# raw', 'raw'),
      cell('last', '# Title', 'markdown'),
    ]), signal())
    expect(index.headings).toEqual([
      { cellId: 'md', level: 1, title: 'Title with link' },
      { cellId: 'md', level: 2, title: 'Subtitle' },
      { cellId: 'md', level: 3, title: 'Title' },
      { cellId: 'last', level: 1, title: 'Title' },
    ])
  })
})

describe('cell search', () => {
  it('finds literal case-insensitive source, streams, errors and textual MIME outputs once per cell', async () => {
    const index = await indexNavigation(notebook([
      cell('source', 'Needle.* Needle.*'),
      cell('stream', '', 'code', [{ type: 'stream', name: 'stdout', text: 'NEEDLE.*' }]),
      cell('error', '', 'code', [{ type: 'error', ename: 'Error', evalue: 'bad', traceback: ['needle.*'] }]),
      cell('mime', '', 'code', [{ type: 'mime_bundle', metadata: {}, data: { 'text/plain': ['nee', 'dle.*'], 'image/png': 'ignored' } }]),
      cell('raw', 'needle.*', 'raw'),
      cell('miss', 'something else'),
    ]), signal())
    expect(await searchCells(index, ' NEEDLE.* ', signal())).toEqual(['source', 'stream', 'error', 'mime', 'raw'])
    expect(await searchCells(index, '', signal())).toEqual([])
    expect(await searchCells(index, 'ignored', signal())).toEqual([])
    expect(await searchCells(index, 'missing', signal())).toEqual([])
  })

  it('yields and can cancel indexing and searching a 10,000-cell model', async () => {
    // A clock that advances 20 ms per read makes the yield policy fire deterministically.
    let ticks = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (ticks += 20))
    try {
      const large = notebook(Array.from({ length: 10_000 }, (_, i) => cell(String(i), 'needle')))
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 0)
      const partial = await indexNavigation(large, controller.signal)
      expect(partial.cells.length).toBeGreaterThan(0)
      expect(partial.cells.length).toBeLessThan(large.cells.length)
      const searchController = new AbortController()
      setTimeout(() => searchController.abort(), 0)
      const found = await searchCells({ headings: [], cells: large.cells.map(c => ({ id: c.id, text: c.source })) }, 'needle', searchController.signal)
      expect(found.length).toBeGreaterThan(0)
      expect(found.length).toBeLessThan(large.cells.length)
    } finally {
      now.mockRestore()
    }
  })
})
