import { expect, test } from 'vitest'
import { diffNotebook } from './diff'
import { jupyterAdapter } from '../adapters/jupyter'
import type { Cell, Notebook } from './types'

const cell = (id: string, over: Partial<Cell> = {}): Cell => ({ id, type: 'code', source: 'x', outputs: [], ...over })
const nb = (cells: Cell[]): Notebook => ({ cells, metadata: {}, format: { adapterId: 'jupyter', version: '4.5' } })
const changedCellIds = (prev: Notebook, next: Notebook) => diffNotebook(prev, next).changed
const out = (text: string) => ({ type: 'stream' as const, name: 'stdout', text })

test('marks cells whose source or outputs differ, matched by id', () => {
  const prev = nb([cell('a'), cell('b', { outputs: [out('1')] }), cell('c')])
  const next = nb([cell('c'), cell('a', { source: 'y' }), cell('b', { outputs: [out('2')] })])
  expect([...changedCellIds(prev, next)].sort()).toEqual(['a', 'b'])
})

test('identical copy has no changes; a new cell counts as changed', () => {
  const prev = nb([cell('a'), cell('b')])
  expect(changedCellIds(prev, nb([cell('a'), cell('b')])).size).toBe(0)
  expect([...changedCellIds(prev, nb([cell('a'), cell('b'), cell('n')]))]).toEqual(['n'])
})

test('falls back to position for generated ids', () => {
  const prev = nb([cell('old1', { source: 'same', generatedId: true }), cell('old2', { source: 'before', generatedId: true })])
  const next = nb([cell('new1', { source: 'same', generatedId: true }), cell('new2', { source: 'after', generatedId: true })])
  expect([...changedCellIds(prev, next)]).toEqual(['new2'])
})


test('matches source before position when a notebook without ids gains a cell', async () => {
  const parse = async (sources: string[]) => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      nbformat: 4, nbformat_minor: 4, metadata: {},
      cells: sources.map(source => ({ cell_type: 'code', source, outputs: [] })),
    }))
    const result = await jupyterAdapter.parse(bytes, { yieldEvery: 0 })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const diff = diffNotebook(await parse(['a', 'b', 'c']), await parse(['new', 'a', 'b', 'c']))
  expect([...diff.changed]).toEqual(['cell-0'])
  expect(diff.deleted).toEqual([])
})

test('groups deletions at the start, middle and end, without counting them as changes', () => {
  const diff = diffNotebook(nb(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => cell(id))), nb(['b', 'e'].map(id => cell(id))))
  expect(diff.changed.size).toBe(0)
  expect(diff.deleted).toEqual([{ before: 0, count: 1 }, { before: 1, count: 2 }, { before: 2, count: 2 }])
})
