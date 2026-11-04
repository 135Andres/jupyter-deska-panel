import { expect, test } from '@playwright/test'
import { generateMixedNotebook } from '../fixtures/notebooks/generate'

// Deska tells a hidden panel `visible: false` and keeps it running. The panel
// must pause the work that only serves reading — the search index and the
// search itself — and take it up again when it is shown. The double keeps the
// `visibility` listeners and exposes a switch, like the host's own event.

test('a hidden panel pauses indexing and search, and catches up when shown', async ({ page }) => {
  await page.route('**/__deska/sdk.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `(() => {
      const listeners = {}
      window.deska = {
        ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: 'light' },
          visibility: { visible: true, idle: false } }),
        on: (name, fn) => { listeners[name] = fn; return () => { delete listeners[name] } },
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
        files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} },
      }
      window.__setVisibility = (visible) => listeners.visibility?.({ visible, idle: false })
    })()`,
  }))
  await page.goto('/')
  await page.getByRole('button', { name: /open notebook|abrir notebook/i }).waitFor()

  // Hidden before the notebook arrives: nothing is indexed while it is hidden,
  // so the search stays in its busy state instead of answering.
  await page.evaluate(() => (window as never as { __setVisibility(v: boolean): void }).__setVisibility(false))
  await page.locator('input[type=file]').setInputFiles({
    name: 'mixed-10000.ipynb',
    mimeType: 'application/json',
    buffer: Buffer.from(generateMixedNotebook()),
  })
  await expect(page.locator('.nb-root .nb-cell').first()).toBeAttached({ timeout: 60_000 })
  await page.locator('.navigation input[type=search]').fill('result 5500')
  await page.waitForTimeout(400)
  await expect(page.locator('.navigation [role=status]')).toHaveText('Searching…')

  // Shown again: the index catches up over all 10,000 cells and the search answers.
  await page.evaluate(() => (window as never as { __setVisibility(v: boolean): void }).__setVisibility(true))
  await expect(page.locator('.navigation [role=status]')).toHaveText('0 / 1', { timeout: 30_000 })

  // Hidden mid-reading: a new query waits, and is answered once back.
  await page.evaluate(() => (window as never as { __setVisibility(v: boolean): void }).__setVisibility(false))
  await page.locator('.navigation input[type=search]').fill('result 9900')
  await page.waitForTimeout(400)
  await expect(page.locator('.navigation [role=status]')).toHaveText('Searching…')
  await page.evaluate(() => (window as never as { __setVisibility(v: boolean): void }).__setVisibility(true))
  await expect(page.locator('.navigation [role=status]')).toHaveText('0 / 1', { timeout: 30_000 })
})
