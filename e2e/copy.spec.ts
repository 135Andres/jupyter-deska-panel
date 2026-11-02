import { expect, test, type Page } from '@playwright/test'

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// A double of deska.clipboard: it records writes, or rejects with an error code.
async function fakeClipboard(page: Page, failWith?: string) {
  await page.route('**/__deska/sdk.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `(() => {
      const fail = ${JSON.stringify(failWith ?? null)}
      const refuse = () => Promise.reject(Object.assign(new Error(fail), { code: fail }))
      window.__copied = []
      window.deska = {
        ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: 'light' } }),
        on: () => () => {},
        clipboard: {
          write: (text) => fail ? refuse() : (window.__copied.push({ kind: 'text', text }), Promise.resolve(true)),
          writeImage: async (blob) => {
            if (fail) return refuse()
            window.__copied.push({ kind: 'image', type: blob.type, size: blob.size })
            return true
          },
        },
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
        files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} },
      }
    })()`,
  }))
}

const notebook = Buffer.from(JSON.stringify({
  cells: [{
    id: 'c1', cell_type: 'code', metadata: {}, source: 'print(1)', execution_count: 1,
    outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/png': PNG } }],
  }],
  metadata: {}, nbformat: 4, nbformat_minor: 5,
}))
const open = async (page: Page) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'copy.ipynb', mimeType: 'application/json', buffer: notebook })
}

test('copies a cell source and a PNG output to the clipboard', async ({ page }) => {
  await fakeClipboard(page)
  await open(page)
  await page.locator('.nb-copy-source').click()
  await expect(page.getByTestId('copy-notice')).toHaveText('Copied')
  await page.locator('.nb-copy-image').click()
  const copied = await page.evaluate(() => (window as never as { __copied: unknown[] }).__copied)
  expect(copied[0]).toEqual({ kind: 'text', text: 'print(1)' })
  expect(copied[1]).toMatchObject({ kind: 'image', type: 'image/png' })
  expect((copied[1] as { size: number }).size).toBeGreaterThan(0)
})

test('a refused permission shows a short notice and the panel keeps working', async ({ page }) => {
  await fakeClipboard(page, 'permission_denied')
  await open(page)
  await page.locator('.nb-copy-source').click()
  await expect(page.getByTestId('copy-notice')).toHaveText('Copying is turned off for this panel.')
  await page.locator('.nb-copy-image').click()
  await expect(page.locator('.nb-cell')).toBeVisible()
  await expect(page.getByTestId('copy-notice')).toBeVisible()
})

test('another failure shows a different short notice', async ({ page }) => {
  await fakeClipboard(page, 'not_focused')
  await open(page)
  await page.locator('.nb-copy-source').click()
  await expect(page.getByTestId('copy-notice')).toHaveText('Could not copy.')
})
