import { readFileSync } from 'node:fs'
import { beforeEach, expect, test, vi } from 'vitest'
import { runAction, type AgentHost } from '.'
import type { Cell, Notebook } from '../model'
import { violations, type Schema } from './schema-subset'

const manifest = JSON.parse(readFileSync('panel/panel.json', 'utf8')) as {
  agent: { actions: { name: string; kind: string; input: Schema; output: Schema }[] }
}
const action = (name: string) => manifest.agent.actions.find((a) => a.name === name)!

const PNG = btoa('not-a-real-png')
const cell = (id: string, over: Partial<Cell> = {}): Cell => ({ id, type: 'code', source: `${id} = 1`, outputs: [], ...over })
const notebook: Notebook = {
  cells: [
    cell('intro', { type: 'markdown', source: '# Title\n\nText and a **bold** word.' }),
    cell('run', { language: 'python', executionCount: 7, durationMs: 1200, source: 'print("hi")', outputs: [
      { type: 'stream', name: 'stdout', text: 'hi\n' },
      { type: 'mime_bundle', data: { 'image/png': PNG }, metadata: { 'image/png': { width: 640, height: 480 } } },
    ] }),
    cell('fail', { source: '1 / 0', outputs: [
      { type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: ['\u001b[0;31m---------------------------------------------------------------------------', 'ZeroDivisionError'] },
    ] }),
  ],
  metadata: {},
  format: { adapterId: 'jupyter', version: '4.5' },
}

let host: AgentHost
let changes: ReturnType<AgentHost['changes']>
let setView: AgentHost['setView']
beforeEach(() => {
  changes = null
  setView = vi.fn()
  host = { notebook: () => notebook, scrollTo: vi.fn(), highlight: vi.fn(), changes: () => changes, setView }
})

const run = async (name: string, input: unknown) => {
  const answer = await runAction(host, name, input)
  expect(violations(action(name).output ?? { type: 'object' }, answer)).toEqual([])
  return answer as Record<string, never>
}

test('get_cell by index returns type, language, counts, source and outputs, and fits the schema', async () => {
  host.putImage = vi.fn(async () => 'file-1')
  const answer = await run('get_cell', { index: 1 })
  expect(answer).toMatchObject({ found: true, id: 'run', index: 1, type: 'code', language: 'python', executionCount: 7, durationMs: 1200, source: 'print("hi")', truncated: false })
  expect(answer['outputs']).toEqual([
    { kind: 'stream', text: 'hi\n', name: 'stdout', ename: '', evalue: '', imageId: '', description: '' },
    { kind: 'image', text: '', name: '', ename: '', evalue: '', imageId: 'file-1', description: 'PNG image output, 640x480 px' },
  ])
  expect(host.putImage).toHaveBeenCalledWith(Uint8Array.from('not-a-real-png', (c) => c.charCodeAt(0)))
})

test('get_cell describes the PNG when there is nowhere to keep it', async () => {
  const answer = await run('get_cell', { id: 'run' })
  const image = (answer['outputs'] as { imageId: string; description: string }[])[1]!
  expect(image.imageId).toBe('')
  expect(image.description).toBe('PNG image output, 640x480 px')
})

test('get_cell returns the error traceback without ANSI codes', async () => {
  const answer = await run('get_cell', { id: 'fail' })
  expect(answer['outputs']).toEqual([
    { kind: 'error', text: '---------------------------------------------------------------------------\nZeroDivisionError', name: '', ename: 'ZeroDivisionError', evalue: 'division by zero', imageId: '', description: '' },
  ])
})

test('get_cell refuses ambiguous, missing and unknown targets, and no notebook', async () => {
  expect(await run('get_cell', { id: 'run', index: 1 })).toMatchObject({ found: false })
  expect(await run('get_cell', {})).toMatchObject({ found: false })
  expect(await run('get_cell', { id: 'nope' })).toMatchObject({ found: false, message: 'No cell with that id or index.' })
  host.notebook = () => null
  expect(await run('get_cell', { index: 0 })).toMatchObject({ found: false, message: 'No notebook is open.' })
})

test('get_cell cuts a long source and long outputs with a notice', async () => {
  host.notebook = () => ({ ...notebook, cells: [cell('big', { source: 'x'.repeat(9_000), outputs: Array.from({ length: 40 }, () => ({ type: 'stream', name: 'stdout', text: 'y'.repeat(4_000) })) })] })
  const answer = await run('get_cell', { id: 'big' })
  expect(answer['source']).toHaveLength(4_000)
  expect(answer['truncated']).toBe(true)
  expect(answer['message']).toContain('cut')
  expect((answer['outputs'] as unknown[]).length).toBeLessThan(40)
  expect(JSON.stringify(answer).length).toBeLessThanOrEqual(60_000)
})

test('get_outline lists the Markdown headings with level, id and index', async () => {
  const answer = await run('get_outline', {})
  expect(answer).toEqual({ total: 1, truncated: false, headings: [{ level: 1, title: 'Title', id: 'intro', index: 0 }] })
  host.notebook = () => null
  expect(await run('get_outline', {})).toEqual({ total: 0, truncated: false, headings: [] })
})

test('find_cells searches sources and outputs the way the panel does, with a fragment', async () => {
  const answer = await run('find_cells', { query: 'DIVISION' })
  expect(answer).toMatchObject({ total: 1, truncated: false })
  expect(answer['cells']).toEqual([{ id: 'fail', index: 2, fragment: expect.stringContaining('ZeroDivisionError') }])
  const bySource = await run('find_cells', { query: 'bold' })
  expect((bySource['cells'] as { id: string }[]).map((c) => c.id)).toEqual(['intro'])
  expect(await run('find_cells', { query: 'nope' })).toMatchObject({ total: 0, cells: [] })
})

test('find_cells caps the answer at max and says so', async () => {
  host.notebook = () => ({ ...notebook, cells: Array.from({ length: 5 }, (_, i) => cell(`m${i}`, { source: 'needle' })) })
  const answer = await run('find_cells', { query: 'needle', max: 2 })
  expect(answer).toMatchObject({ total: 5, truncated: true })
  expect((answer['cells'] as unknown[]).length).toBe(2)
})

test('list_errors returns the failing cells with ename and evalue', async () => {
  const answer = await run('list_errors', {})
  expect(answer).toEqual({ total: 1, truncated: false, cells: [{ id: 'fail', index: 2, ename: 'ZeroDivisionError', evalue: 'division by zero' }] })
  host.notebook = () => null
  expect(await run('list_errors', {})).toEqual({ total: 0, truncated: false, cells: [] })
})

test('set_view applies the filter and the mode, and refuses what it cannot do', async () => {
  expect(await runAction(host, 'set_view', { filter: 'all', mode: 'outputs' })).toEqual({ ok: true })
  expect(setView).toHaveBeenCalledWith('all', 'outputs')
  expect(await runAction(host, 'set_view', { mode: 'all' })).toEqual({ ok: true })
  expect(setView).toHaveBeenLastCalledWith(undefined, 'all')
  expect(await runAction(host, 'set_view', {})).toEqual({ ok: false, error: 'invalid' })
  expect(setView).toHaveBeenCalledTimes(2)
  // "changed" without a comparison, or with nothing changed: conflict, nothing applied.
  expect(await runAction(host, 'set_view', { filter: 'changed' })).toEqual({ ok: false, error: 'conflict' })
  changes = { changed: [], deleted: [] }
  expect(await runAction(host, 'set_view', { filter: 'changed' })).toEqual({ ok: false, error: 'conflict' })
  changes = { changed: [{ cell: cell('run'), index: 1 }], deleted: [] }
  expect(await runAction(host, 'set_view', { filter: 'changed' })).toEqual({ ok: true })
  expect(setView).toHaveBeenLastCalledWith('changed', undefined)
})

test('the manifest inputs accept what the actions accept and refuse the rest', () => {
  expect(violations(action('get_cell').input, { id: 'a' })).toEqual([])
  expect(violations(action('get_cell').input, { id: 'a', index: 1 }).length).toBe(0) // both given: refused by the action, not the schema
  expect(violations(action('find_cells').input, { query: 'x', max: 5 })).toEqual([])
  expect(violations(action('find_cells').input, { max: 5 }).length).toBeGreaterThan(0)
  expect(violations(action('set_view').input, { filter: 'changed', mode: 'outputs' })).toEqual([])
  expect(violations(action('set_view').input, { filter: 'nope' }).length).toBeGreaterThan(0)
  expect(violations(action('get_outline').input, {})).toEqual([])
  expect(violations(action('get_outline').input, { other: 1 }).length).toBeGreaterThan(0)
})
