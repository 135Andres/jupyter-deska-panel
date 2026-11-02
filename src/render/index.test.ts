import { afterEach, expect, test } from 'vitest'
import type { Cell, Notebook } from '../model/types'
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
