import { afterEach, expect, test, vi } from 'vitest'
import type { Cell, Notebook } from '../model/types'
import { formatDuration } from './cells'
import { mountNotebook } from './index'

const cell = (id: string, over: Partial<Cell> = {}): Cell => ({
  id, type: 'code', source: 'x = 1', outputs: [], ...over,
})
const nb = (cells: Cell[]): Notebook => ({
  cells, metadata: { language: 'python' }, format: { adapterId: 'jupyter', version: '4.5' },
})
const opts = { theme: 'dark', locale: 'en' } as const

afterEach(() => document.body.replaceChildren())

function mount(cells: Cell[]) {
  const host = document.createElement('div')
  document.body.append(host)
  return { host, view: mountNotebook(host, nb(cells), opts) }
}

// Markdown and HTML output go through DOMPurify, which happy-dom cannot
// exercise correctly; those assertions live in e2e/render.spec.ts.

test('colours ANSI in errors and shows a placeholder for interactive output', () => {
  const { host } = mount([
    cell('e', {
      outputs: [
        { type: 'error', ename: 'E', evalue: 'v', traceback: ['\u001b[0;31mZeroDivisionError\u001b[0m'] },
        { type: 'mime_bundle', metadata: {}, data: { 'application/vnd.plotly.v1+json': {} } },
      ],
    }),
  ])
  expect(host.querySelector('.nb-error .ansi-red-fg')?.textContent).toBe('ZeroDivisionError')
  expect(host.querySelector('.nb-placeholder')?.textContent).toBe('Interactive output, not shown')
})

test('virtualizes large notebooks and supports update/scrollToCell/destroy', () => {
  const cells = Array.from({ length: 10_000 }, (_, i) => cell(`c${i}`))
  const { host, view } = mount(cells)
  expect(host.dataset['theme']).toBe('dark')
  const rendered = host.querySelectorAll('.nb-cell').length
  expect(rendered).toBeGreaterThan(0)
  expect(rendered).toBeLessThan(200)
  view.scrollToCell('c9000')
  expect(host.querySelector('[data-cell-id="c9000"]')).not.toBeNull()
  view.update(nb([cell('only')]))
  expect(host.querySelectorAll('.nb-cell').length).toBe(1)
  view.destroy()
  expect(host.children.length).toBe(0)
})

test('marks changed cells on update with compare and filters them', () => {
  const { host, view } = mount([cell('a'), cell('b')])
  view.update(nb([cell('a'), cell('b', { source: 'y = 2' })]), true)
  expect(view.changedCount()).toBe(1)
  expect(host.querySelectorAll('.nb-changed').length).toBe(1)
  view.setFilter('changed')
  expect(host.querySelectorAll('.nb-cell').length).toBe(1)
  view.setFilter('all')
  expect(host.querySelectorAll('.nb-cell').length).toBe(2)
  view.update(nb([cell('a')]))
  expect(view.changedCount()).toBe(0)
})


test('keeps deletion rows in place, including under the changed filter, and clears them on update', () => {
  const { host, view } = mount([cell('a'), cell('b'), cell('c'), cell('d')])
  view.update(nb([cell('a'), cell('d', { source: 'new' })]), true)
  const rows = () => [...host.querySelectorAll('.nb-cell, .nb-deleted')].map(node => node.classList.contains('nb-deleted') ? node.textContent : node.getAttribute('data-cell-id'))
  expect(rows()).toEqual(['a', '2 deleted cells', 'd'])
  expect(view.changedCount()).toBe(1)
  view.setFilter('changed')
  expect(rows()).toEqual(['2 deleted cells', 'd'])
  view.update(nb([]))
  expect(host.querySelector('.nb-deleted')).toBeNull()
})

test('shows execution count and duration when present', () => {
  const { host } = mount([cell('a', { executionCount: 7, durationMs: 1500 }), cell('b')])
  const [a, b] = host.querySelectorAll('.nb-prompt')
  expect(a?.querySelector('.nb-count')?.textContent).toBe('[7]')
  expect(a?.querySelector('.nb-duration')?.textContent).toBe('1.5 s')
  expect(b?.querySelector('.nb-duration')).toBeNull()
})

test('formats durations', () => {
  expect([40, 1500, 12_400, 65_000].map(formatDuration)).toEqual(['40 ms', '1.5 s', '12 s', '1 min 5 s'])
})

const streamOut = { type: 'stream', name: 'stdout', text: 'hi' } as const

test('folds the input or the output of one cell and keeps the other', () => {
  const { host } = mount([cell('a', { source: 'line1\nline2', outputs: [streamOut] })])
  host.querySelector<HTMLButtonElement>('.nb-fold-input')!.click()
  expect(host.querySelector('pre.nb-code.nb-folded')?.textContent).toBe('line1 …')
  expect(host.querySelector('.nb-output')).not.toBeNull()
  expect(host.querySelector('.nb-fold-input')?.getAttribute('aria-pressed')).toBe('true')
  host.querySelector<HTMLButtonElement>('.nb-fold-output')!.click()
  expect(host.querySelector('.nb-output')).toBeNull()
  expect(host.querySelector('.nb-outputs.nb-folded')?.textContent).toBe('Output hidden')
  host.querySelector<HTMLButtonElement>('.nb-fold-output')!.click()
  expect(host.querySelector('.nb-output')).not.toBeNull()
})

test('foldAll folds every code cell and unfolds again', () => {
  const { host, view } = mount([cell('a', { outputs: [streamOut] }), cell('b', { outputs: [streamOut] })])
  view.foldAll(true)
  expect(view.allFolded()).toBe(true)
  expect(host.querySelectorAll('pre.nb-code.nb-folded')).toHaveLength(2)
  expect(host.querySelectorAll('.nb-output')).toHaveLength(0)
  view.foldAll(false)
  expect(view.allFolded()).toBe(false)
  expect(host.querySelectorAll('.nb-output')).toHaveLength(2)
})

test('"outputs" mode hides inputs, markdown and cells with no output', () => {
  const { host, view } = mount([
    cell('a', { outputs: [streamOut] }),
    cell('b'),
    { id: 'm', type: 'markdown', source: 'hello', outputs: [] },
  ])
  expect(host.querySelectorAll('.nb-cell')).toHaveLength(3)
  view.setMode('outputs')
  expect(host.querySelectorAll('.nb-cell')).toHaveLength(1)
  expect(host.querySelector('pre.nb-code')).toBeNull()
  expect(host.querySelector('.nb-output')?.textContent).toBe('hi')
  view.setMode('all')
  expect(host.querySelectorAll('.nb-cell')).toHaveLength(3)
})

test('highlightCell marks a cell temporarily and changes() tracks the last comparison', () => {
  vi.useFakeTimers()
  const cell = (id: string, source = id): Cell => ({ id, type: 'code', source, outputs: [] })
  const nb = (cells: Cell[]): Notebook => ({ cells, metadata: {}, format: { adapterId: 'jupyter', version: '4.5' } })
  const container = document.createElement('div')
  document.body.append(container)
  const view = mountNotebook(container, nb([cell('a'), cell('b'), cell('c')]), { theme: 'light', locale: 'en' })
  expect(view.changes()).toBeNull()
  expect(view.highlightCell('missing', 1000)).toBe(false)
  expect(view.highlightCell('b', 1000)).toBe(true)
  expect(container.querySelector('[data-cell-id="b"]')?.classList.contains('nb-highlight')).toBe(true)
  vi.advanceTimersByTime(1000)
  expect(container.querySelector('[data-cell-id="b"]')?.classList.contains('nb-highlight')).toBe(false)
  view.update(nb([cell('a'), cell('b', 'new')]), true)
  const changes = view.changes()!
  expect(changes.changed.map((x) => [x.cell.id, x.index])).toEqual([['b', 1]])
  expect(changes.deleted.map((x) => [x.cell.id, x.index])).toEqual([['c', 2]])
  view.update(nb([cell('a')]))
  expect(view.changes()).toBeNull()
  view.destroy()
  container.remove()
  vi.useRealTimers()
})
