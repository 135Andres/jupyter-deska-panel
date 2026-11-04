import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { violations, type Schema } from '../src/agent/schema-subset'

type Action = { name: string; input: Schema; output?: Schema }
const { agent } = JSON.parse(readFileSync('panel/panel.json', 'utf8')) as { agent: { actions: Action[] } }

// A double of deska.agent: listeners are kept, and respond() settles the pending call.
test.beforeEach(async ({ page }) => {
  await page.route('**/__deska/sdk.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `(() => {
      const listeners = {}
      const pending = new Map()
      let next = 0
      window.deska = {
        ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: 'light' }, agent: { tasks: 1 } }),
        on: (name, fn) => { listeners[name] = fn; return () => { delete listeners[name] } },
        agent: { respond: (callId, result) => { pending.get(callId)?.(result); pending.delete(callId); return Promise.resolve(true) } },
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
        files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} },
      }
      window.__listening = () => Boolean(listeners['agent.action'])
      window.__call = (action, input) => new Promise((resolve) => {
        const callId = 'call' + next++
        pending.set(callId, resolve)
        listeners['agent.action']({ callId, action, input })
      })
    })()`,
  }))
})

/** Like Deska: refuse an input that breaks the schema, and check a read's answer against its output schema. */
async function call(page: Page, name: string, input: unknown) {
  const action = agent.actions.find((a) => a.name === name)!
  const refused = violations(action.input, input)
  expect(refused, 'Deska would refuse this input').toEqual([])
  const answer = await page.evaluate(([n, i]) => (window as never as { __call(a: string, b: unknown): Promise<unknown> }).__call(n!, i), [name, input] as const)
  if (action.output) expect(violations(action.output, answer)).toEqual([])
  return answer as Record<string, unknown>
}

const code = (id: string, source: string, outputs: unknown[] = []) => ({ id, cell_type: 'code', metadata: {}, source, execution_count: null, outputs })
const notebook = (cells: unknown[]) => Buffer.from(JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 }))
const pick = (page: Page, cells: unknown[]) =>
  page.locator('input[type=file]').setInputFiles({ name: 'agent.ipynb', mimeType: 'application/json', buffer: notebook(cells) })

async function inViewport(page: Page, id: string) {
  const cell = page.locator(`.nb-cell[data-cell-id="${id}"]`)
  await expect(cell).toBeAttached()
  await expect.poll(() => cell.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const root = node.closest('.nb-root')!.getBoundingClientRect()
    return box.top < root.bottom && box.bottom > root.top
  })).toBe(true)
}

test('an agent scrolls to, highlights and summarizes changes in a notebook', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as never as { __listening(): boolean }).__listening())
  const cells = Array.from({ length: 400 }, (_, i) => code(`c${i}`, `value = ${i}`))
  await pick(page, cells)
  await expect(page.locator('.nb-cell').first()).toBeAttached()

  // No second copy yet: nothing to compare.
  expect(await call(page, 'summarize_changes', {})).toMatchObject({ available: false, cells: [] })

  // By id, then by index; the far cell is not mounted until the agent scrolls.
  expect(await call(page, 'scroll_to_cell', { id: 'c350' })).toEqual({ ok: true })
  await inViewport(page, 'c350')
  expect(await call(page, 'scroll_to_cell', { index: 5 })).toEqual({ ok: true })
  await inViewport(page, 'c5')

  expect(await call(page, 'highlight_cell', { id: 'c390', seconds: 1 })).toEqual({ ok: true })
  await inViewport(page, 'c390')
  const marked = page.locator('.nb-cell[data-cell-id="c390"]')
  await expect(marked).toHaveClass(/nb-highlight/)
  await expect(marked).not.toHaveClass(/nb-highlight/, { timeout: 4000 })

  expect(await call(page, 'scroll_to_cell', { id: 'nope' })).toEqual({ ok: false, error: 'not_found' })
  expect(await call(page, 'highlight_cell', { index: 400 })).toEqual({ ok: false, error: 'not_found' })
  expect(await call(page, 'highlight_cell', {})).toEqual({ ok: false, error: 'invalid' })

  // A second copy: one cell changed with an error output, one deleted.
  const failure = { output_type: 'error', ename: 'ZeroDivisionError', evalue: 'x', traceback: [] }
  cells[360] = code('c360', 'value = 1 / 0', [failure])
  cells.splice(10, 1)
  await pick(page, cells)
  await expect(page.getByRole('button', { name: 'Changed (1)', exact: true })).toBeVisible()
  const summary = await call(page, 'summarize_changes', {})
  expect(summary).toMatchObject({ available: true, total: 2, truncated: false })
  expect(summary['cells']).toEqual([
    { id: 'c360', index: 359, type: 'code', status: 'changed', summary: 'value = 1 / 0 · error: ZeroDivisionError' },
    { id: 'c10', index: 10, type: 'code', status: 'deleted', summary: 'value = 10' },
  ])

  // With the "Changed" filter on, scrolling to a hidden cell shows everything first.
  await page.getByRole('button', { name: 'Changed (1)', exact: true }).click()
  expect(await call(page, 'scroll_to_cell', { id: 'c5' })).toEqual({ ok: true })
  await inViewport(page, 'c5')
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('an agent reads cells, the outline, matches and errors, and sets the view', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as never as { __listening(): boolean }).__listening())
  const png = Buffer.from('iVBORw0KGgo=', 'base64').toString('base64')
  const md = (id: string, source: string) => ({ id, cell_type: 'markdown', metadata: {}, source })
  const cells = [
    md('h1', '# Sales review\n\nA **bold** intro.'),
    code('load', 'orders = pd.read_csv("sales_q3.csv")', [{ output_type: 'stream', name: 'stdout', text: 'Loaded 42 orders\n' }]),
    md('h2', '## Checks'),
    code('plot', 'ax = revenue.plot()', [{ output_type: 'display_data', metadata: { 'image/png': { width: 640, height: 480 } }, data: { 'image/png': png, 'text/plain': '<Axes>' } }]),
    code('fail', 'assert region_code', [{ output_type: 'error', ename: 'KeyError', evalue: "'region_code'", traceback: ['\u001b[0;31m---------------------------------------------------------------------------', 'KeyError                                 Traceback (most recent call last)'] }]),
  ]
  await pick(page, cells)
  await expect(page.locator('.nb-cell').first()).toBeAttached()

  // get_cell: by id, with stream, image and error outputs; the traceback carries no ANSI codes.
  const loaded = await call(page, 'get_cell', { id: 'load' })
  expect(loaded).toMatchObject({ found: true, id: 'load', index: 1, type: 'code', source: 'orders = pd.read_csv("sales_q3.csv")' })
  expect(loaded['outputs']).toEqual([
    { kind: 'stream', text: 'Loaded 42 orders\n', name: 'stdout', ename: '', evalue: '', imageId: '', description: '' },
  ])
  const chart = await call(page, 'get_cell', { index: 3 })
  expect(chart['outputs']).toEqual([
    { kind: 'text', text: '<Axes>', name: '', ename: '', evalue: '', imageId: '', description: '' },
    { kind: 'image', text: '', name: '', ename: '', evalue: '', imageId: 'saved', description: 'PNG image output, 640x480 px' },
  ])
  const failure = await call(page, 'get_cell', { id: 'fail' })
  expect(failure['outputs']).toEqual([
    { kind: 'error', text: '---------------------------------------------------------------------------\nKeyError                                 Traceback (most recent call last)', name: '', ename: 'KeyError', evalue: "'region_code'", imageId: '', description: '' },
  ])
  expect(await call(page, 'get_cell', { id: 'nope' })).toMatchObject({ found: false })
  expect(await call(page, 'get_cell', { id: 'a', index: 1 })).toMatchObject({ found: false })

  // get_outline: the Markdown headings with level, id and index.
  expect(await call(page, 'get_outline', {})).toEqual({
    total: 2,
    truncated: false,
    headings: [
      { level: 1, title: 'Sales review', id: 'h1', index: 0 },
      { level: 2, title: 'Checks', id: 'h2', index: 2 },
    ],
  })

  // find_cells: the panel's search, case-insensitive, in sources and outputs, with a fragment.
  const matches = await call(page, 'find_cells', { query: 'REGION_CODE' })
  expect(matches).toMatchObject({ total: 1, truncated: false })
  expect(matches['cells']).toEqual([{ id: 'fail', index: 4, fragment: expect.stringContaining('KeyError') }])
  expect(await call(page, 'find_cells', { query: 'bold' })).toMatchObject({ total: 1 })
  expect(await call(page, 'find_cells', { query: 'nothing matches this' })).toEqual({ total: 0, truncated: false, cells: [] })

  // list_errors: the failing cells with ename and evalue.
  expect(await call(page, 'list_errors', {})).toEqual({
    total: 1,
    truncated: false,
    cells: [{ id: 'fail', index: 4, ename: 'KeyError', evalue: "'region_code'" }],
  })

  // set_view: outputs-only hides inputs; "changed" without a comparison is a conflict.
  expect(await call(page, 'set_view', { mode: 'outputs' })).toEqual({ ok: true })
  await expect(page.getByRole('button', { name: 'Outputs only' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.nb-cell').first()).not.toContainText('pd.read_csv')
  expect(await call(page, 'set_view', { filter: 'changed' })).toEqual({ ok: false, error: 'conflict' })
  expect(await call(page, 'set_view', {})).toEqual({ ok: false, error: 'invalid' })
  expect(await call(page, 'set_view', { mode: 'all' })).toEqual({ ok: true })
  await expect(page.getByRole('button', { name: 'Outputs only' })).toHaveAttribute('aria-pressed', 'false')

  // A newer copy: set_view { filter: "changed" } shows only what the agent changed.
  cells[1] = code('load', 'orders = pd.read_csv("sales_q4.csv")', [{ output_type: 'stream', name: 'stdout', text: 'Loaded 42 orders\n' }])
  await pick(page, cells)
  await expect(page.getByRole('button', { name: 'Changed (1)' })).toBeVisible()
  expect(await call(page, 'set_view', { filter: 'changed' })).toEqual({ ok: true })
  await expect(page.locator('.nb-cell')).toHaveCount(1)
  await expect(page.locator('.nb-cell')).toContainText('sales_q4')
  expect(await call(page, 'set_view', { filter: 'all' })).toEqual({ ok: true })
  await expect(page.locator('.nb-cell')).toHaveCount(5)

  // Deska refuses inputs that break the manifest schemas before the panel hears them.
  const find = agent.actions.find((a) => a.name === 'find_cells')!
  expect(violations(find.input, {})).toContain('$.query: missing')
  const view = agent.actions.find((a) => a.name === 'set_view')!
  expect(violations(view.input, { filter: 'nope' })[0]).toContain('not in enum')
})
