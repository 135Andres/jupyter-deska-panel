import { expect, test, type Page } from '@playwright/test'
import { generateMixedNotebook } from '../fixtures/notebooks/generate'

test.beforeEach(async ({ page }) => {
  await page.route('**/__deska/sdk.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.deska = {
      ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: 'light' } }),
      storage: { get: async () => null, set: async () => {}, remove: async () => {} },
      files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} }
    }`,
  }))
})

async function pick(page: Page, bytes: Uint8Array, name = 'navigation.ipynb') {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(bytes) })
}
const notebook = (cells: unknown[]) => new TextEncoder().encode(JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 }))
const code = (id: string, source: string, text = '') => ({ id, cell_type: 'code', metadata: {}, source, execution_count: null, outputs: text ? [{ output_type: 'stream', name: 'stdout', text }] : [] })

async function expectInViewport(page: Page, id: string) {
  const cell = page.locator(`.nb-cell[data-cell-id="${id}"]`)
  await expect(cell).toBeAttached()
  await expect.poll(() => cell.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const root = node.closest('.nb-root')?.getBoundingClientRect()
    if (!root) return false
    return box.top < root.bottom && box.bottom > root.top
  })).toBe(true)
}

test('outline jumps to an unmounted Markdown cell and clears the changed filter', async ({ page }) => {
  await page.goto('/')
  const cells = Array.from({ length: 500 }, (_, i) => code(`c${i}`, `value = ${i}`))
  const heading = { id: 'heading', cell_type: 'markdown', metadata: {}, source: '## **Far away**\n\nSubtitle\n---' }
  await pick(page, notebook([...cells, heading]))
  await expect(page.locator('.nb-cell').first()).toBeAttached()
  cells[0] = code('c0', 'changed')
  await pick(page, notebook([...cells, heading]))
  await page.getByRole('button', { name: 'Changed (1)', exact: true }).click()
  await expect(page.locator('[data-cell-id="heading"]')).toHaveCount(0)
  await page.getByText('Outline (2)', { exact: true }).click()
  await page.getByRole('button', { name: 'Far away', exact: true }).click()
  await expectInViewport(page, 'heading')
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.locator('.nb-cell').count()).toBeLessThan(100)
})

test('search navigates source and output matches in 10,000 virtualized cells without freezing', async ({ page }, info) => {
  await page.goto('/')
  await pick(page, generateMixedNotebook())
  const search = page.getByRole('searchbox', { name: 'Search cells' })
  await expect(search).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('0 / 0', { timeout: 15_000 })
  await page.evaluate(() => {
    const state = { tasks: [] as number[], ticks: 0 }
    Object.assign(window, { __searchPerformance: state })
    new PerformanceObserver(list => state.tasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' })
    const tick = () => { state.ticks++; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  const start = Date.now()
  await search.fill('cell 10000') // source plus stream, one matching cell
  await expect(page.getByRole('status')).toHaveText('0 / 1')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectInViewport(page, 'cell-10000')
  await expect(page.getByRole('status')).toHaveText('1 / 1')
  await search.fill('ran') // output-only matches
  await expect(page.getByRole('status')).toHaveText('0 / 5000')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectInViewport(page, 'cell-00002')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectInViewport(page, 'cell-00004')
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expectInViewport(page, 'cell-00002')
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expectInViewport(page, 'cell-10000') // wraps backwards
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectInViewport(page, 'cell-00002') // wraps forwards
  const record = await page.evaluate(() => {
    const state = (window as unknown as { __searchPerformance: { tasks: number[]; ticks: number } }).__searchPerformance
    return { worstLongTaskMs: Math.round(Math.max(0, ...state.tasks)), animationFrames: state.ticks }
  })
  console.log('search, 10,000 cells:', { ...record, elapsedMs: Date.now() - start })
  await info.attach('search-performance', { body: JSON.stringify(record), contentType: 'application/json' })
  expect(record.worstLongTaskMs).toBeLessThan(1000)
  expect(record.animationFrames).toBeGreaterThan(10)
  expect(await page.locator('.nb-cell').count()).toBeLessThan(300)
  await search.fill('no such result')
  await expect(page.getByRole('status')).toHaveText('0 / 0')
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await search.fill('ran')
  await search.fill('cell 10000')
  await expect(page.getByRole('status')).toHaveText('0 / 1')
  await pick(page, notebook([code('replacement', 'different')]), 'replacement.ipynb')
  await expect(search).toHaveValue('')
  await expect(page.getByRole('status')).toHaveText('0 / 0')
})
