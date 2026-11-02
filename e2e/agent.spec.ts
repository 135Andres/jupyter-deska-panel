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
