import { readFileSync } from 'node:fs'
import { beforeEach, expect, test, vi } from 'vitest'
import { registerAgent, runAction, summarizeCell, type AgentHost } from '.'
import type { Cell, Notebook } from '../model'
import { violations, type Schema } from './schema-subset'

const manifest = JSON.parse(readFileSync('panel/panel.json', 'utf8')) as {
  permissions: string[]; sdk: number; network: unknown[]
  agent: { actions: { name: string; kind: string; input: Schema; output: Schema }[] }
}
const action = (name: string) => manifest.agent.actions.find((a) => a.name === name)!

const cell = (id: string, over: Partial<Cell> = {}): Cell => ({ id, type: 'code', source: `${id} = 1`, outputs: [], ...over })
const notebook: Notebook = { cells: [cell('a'), cell('b'), cell('c')], metadata: {}, format: { adapterId: 'jupyter', version: '4.5' } }

let host: AgentHost
let changes: ReturnType<AgentHost['changes']>
beforeEach(() => {
  changes = null
  host = { notebook: () => notebook, scrollTo: vi.fn(), highlight: vi.fn(), changes: () => changes }
})

test('manifest declares agent and clipboard-write with sdk 4, eight actions and no network', async () => {
  expect(manifest.permissions).toEqual(['agent', 'clipboard-write'])
  expect(manifest.sdk).toBe(4)
  expect(manifest.network).toEqual([])
  expect(manifest.agent.actions.map((a) => `${a.name}:${a.kind}`)).toEqual([
    'scroll_to_cell:write', 'highlight_cell:write', 'summarize_changes:read',
    'get_cell:read', 'get_outline:read', 'find_cells:read', 'list_errors:read', 'set_view:write',
  ])
})

test('scroll_to_cell works by id and by index', async () => {
  expect(await runAction(host, 'scroll_to_cell', { id: 'b' })).toEqual({ ok: true })
  expect(await runAction(host, 'scroll_to_cell', { index: 2 })).toEqual({ ok: true })
  expect(host.scrollTo).toHaveBeenNthCalledWith(1, 'b')
  expect(host.scrollTo).toHaveBeenNthCalledWith(2, 'c')
})

test('rejects a missing cell, an out-of-range index and ambiguous or empty targets', async () => {
  expect(await runAction(host, 'scroll_to_cell', { id: 'zzz' })).toEqual({ ok: false, error: 'not_found' })
  expect(await runAction(host, 'scroll_to_cell', { index: 3 })).toEqual({ ok: false, error: 'not_found' })
  expect(await runAction(host, 'highlight_cell', { id: 'a', index: 0 })).toEqual({ ok: false, error: 'invalid' })
  expect(await runAction(host, 'highlight_cell', {})).toEqual({ ok: false, error: 'invalid' })
  expect(await runAction(host, 'nope', {})).toEqual({ ok: false, error: 'invalid' })
  expect(host.scrollTo).not.toHaveBeenCalled()
  host.notebook = () => null
  expect(await runAction(host, 'scroll_to_cell', { index: 0 })).toEqual({ ok: false, error: 'not_found' })
})

test('highlight_cell scrolls, then marks for 3 s by default or the given seconds', async () => {
  await runAction(host, 'highlight_cell', { id: 'a' })
  await runAction(host, 'highlight_cell', { index: 1, seconds: 10 })
  expect(host.scrollTo).toHaveBeenCalledTimes(2)
  expect(host.highlight).toHaveBeenNthCalledWith(1, 'a', 3000)
  expect(host.highlight).toHaveBeenNthCalledWith(2, 'b', 10000)
})

test('summarize_changes without a previous diff says so, and fits the output schema', async () => {
  const answer = await runAction(host, 'summarize_changes', {})
  expect(answer).toMatchObject({ available: false, total: 0, cells: [] })
  expect(violations(action('summarize_changes').output, answer)).toEqual([])
})

test('summarize_changes lists changed and deleted cells with id, index, type and summary', async () => {
  changes = {
    changed: [{ cell: cell('b', { source: '\n\nprint("hi")\nmore', outputs: [{ type: 'error', ename: 'ValueError', evalue: 'x', traceback: [] }] }), index: 1 }],
    deleted: [{ cell: cell('old', { type: 'markdown', source: '# Title' }), index: 4 }],
  }
  const answer = await runAction(host, 'summarize_changes', {})
  expect(answer).toMatchObject({ available: true, total: 2, truncated: false })
  expect((answer as { cells: unknown[] }).cells).toEqual([
    { id: 'b', index: 1, type: 'code', status: 'changed', summary: 'print("hi") · error: ValueError' },
    { id: 'old', index: 4, type: 'markdown', status: 'deleted', summary: '# Title' },
  ])
  expect(violations(action('summarize_changes').output, answer)).toEqual([])
})

test('summarize_changes with no differences is available and empty; max truncates', async () => {
  changes = { changed: [], deleted: [] }
  expect(await runAction(host, 'summarize_changes', {})).toMatchObject({ available: true, total: 0, cells: [] })
  changes = { changed: [0, 1, 2].map((i) => ({ cell: cell(`n${i}`), index: i })), deleted: [] }
  const answer = await runAction(host, 'summarize_changes', { max: 2 }) as { cells: unknown[]; total: number; truncated: boolean }
  expect([answer.cells.length, answer.total, answer.truncated]).toEqual([2, 3, true])
})

test('every answer fits the schema, including 100+ long summaries', async () => {
  changes = { changed: Array.from({ length: 150 }, (_, i) => ({ cell: cell(`c${i}`, { source: 'x'.repeat(500) }), index: i })), deleted: [] }
  const answer = await runAction(host, 'summarize_changes', {}) as { cells: unknown[] }
  expect(answer.cells).toHaveLength(100)
  expect(violations(action('summarize_changes').output, answer)).toEqual([])
})

test('an action that throws answers with a failure instead of leaving the call waiting', async () => {
  host.notebook = () => { throw new Error('boom') }
  expect(await runAction(host, 'scroll_to_cell', { id: 'a' })).toEqual({ ok: false, error: 'failed' })
  host.changes = () => { throw new Error('boom') }
  const answer = await runAction(host, 'summarize_changes', {})
  expect(violations(action('summarize_changes').output, answer)).toEqual([])
})

test('inputs in the manifest accept what the actions accept and refuse the rest', async () => {
  const input = action('highlight_cell').input
  expect(violations(input, { id: 'a', seconds: 5 })).toEqual([])
  expect(violations(input, { seconds: 0 }).length).toBeGreaterThan(0)
  expect(violations(input, { other: 1 }).length).toBeGreaterThan(0)
})

test('summarizeCell keeps one short line', async () => {
  expect(summarizeCell(cell('a', { source: '' }))).toBe('(empty)')
  expect(summarizeCell(cell('a', { source: 'y'.repeat(200) }))).toHaveLength(80)
})

test('an agent call waits for the host to restore the notebook before it runs', async () => {
  let listener: (call: { callId: string; action: string; input: unknown }) => void = () => {}
  const respond = vi.fn(() => Promise.resolve(true))
  const on = vi.fn((_event: string, fn: typeof listener) => { listener = fn; return () => {} })
  let restore: () => void = () => {}
  const hostWithWait = {
    ...host,
    ready: () => new Promise<void>((resolve) => { restore = resolve }),
  }
  registerAgent({ on, agent: { respond } } as never, hostWithWait)
  listener({ callId: 'k1', action: 'scroll_to_cell', input: { id: 'a' } })
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(respond).not.toHaveBeenCalled()
  restore()
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith('k1', { ok: true }))
})

test('registerAgent answers each agent.action call, and does nothing without deska.agent', async () => {
  let listener: (call: { callId: string; action: string; input: unknown }) => void = () => {}
  const respond = vi.fn(() => Promise.resolve(true))
  const stop = vi.fn()
  const on = vi.fn((_event: string, fn: typeof listener) => { listener = fn; return stop })
  const off = registerAgent({ on, agent: { respond } } as never, host)
  listener({ callId: 'k1', action: 'scroll_to_cell', input: { id: 'a' } })
  await Promise.resolve()
  expect(on).toHaveBeenCalledWith('agent.action', expect.any(Function))
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith('k1', { ok: true }))
  off()
  expect(stop).toHaveBeenCalled()
  expect(() => registerAgent(undefined, host)()).not.toThrow()
  expect(() => registerAgent({ on } as never, host)()).not.toThrow()
})
