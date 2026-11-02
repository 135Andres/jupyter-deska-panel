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

test('renders markdown with KaTeX and sanitizes it', () => {
  const { host } = mount([
    cell('m', { type: 'markdown', source: '# Hi\n\n$x^2$ <script>alert(1)</script> [a](javascript:alert(1))\n\n$$\\frac{1}{2}$$' }),
  ])
  expect(host.querySelector('h1')?.textContent).toBe('Hi')
  expect(host.querySelectorAll('.katex').length).toBe(2)
  expect(host.innerHTML).not.toMatch(/<script|javascript:/i)
})

test('highlights code and picks the best MIME type', () => {
  const { host } = mount([
    cell('c', {
      source: 'def f(): pass',
      executionCount: 3,
      outputs: [{
        type: 'mime_bundle', metadata: {},
        data: { 'text/html': '<b onclick="x()">t</b><script>1</script>', 'text/plain': 'plain' },
      }],
    }),
  ])
  expect(host.querySelector('.hljs-keyword')).not.toBeNull()
  expect(host.querySelector('.nb-prompt')?.textContent).toBe('[3]')
  expect(host.querySelector('.nb-mime b')).not.toBeNull()
  expect(host.innerHTML).not.toMatch(/onclick|<script/i)
})

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
