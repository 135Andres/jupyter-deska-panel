import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Notebooks saved by other tools, with their exact metadata and quirks:
// Colab (nbformat 4.0, metadata.colab, executionInfo, outputs with metadata,
// a pasted attachment), Kaggle (_uuid, execution timestamps), VS Code
// (metadata.vscode, an ANSI traceback) and JupyterLab (execute_result with
// image/png + text/plain, a Markdown attachment). All synthetic, written for
// this repository from the public nbformat specification.

const fixture = (name: string) => readFileSync(new URL(`../fixtures/notebooks/${name}`, import.meta.url))

const SDK = `(() => {
  window.deska = {
    ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: 'light' },
      visibility: { visible: true, idle: false } }),
    on: () => () => {},
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} },
  }
})()`

async function openPanel(page: Page) {
  await page.route('**/__deska/sdk.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SDK }))
  await page.goto('/')
  await page.getByRole('button', { name: /open notebook|abrir notebook/i }).waitFor()
}

async function pick(page: Page, name: string) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: fixture(name) })
}

test('opens a Colab-style notebook: ids in metadata, run times, an attachment image', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'colab-like.ipynb')
  const root = page.locator('.nb-root')
  await expect(root.locator('h1')).toHaveText('Colab-style notebook')
  await expect(page.locator('.nb-header')).toContainText('python3 · python · 5 cells')
  // Colab keeps its cell ids in cell metadata; the panel reads the nbformat id
  // field, which 4.0 does not have, so the ids are positional.
  await expect(root.locator('.nb-cell')).toHaveCount(5)
  // executionInfo.elapsed is the run time of the cell.
  await expect(root.locator('.nb-cell[data-cell-id="cell-3"] .nb-duration')).toHaveText('8.1 s')
  await expect(root.locator('.nb-cell[data-cell-id="cell-2"] .nb-duration')).toHaveText('250 ms')
  // The execute_result table (output metadata present) renders as HTML.
  await expect(root.locator('.nb-output table')).toContainText('north')
  // The display_data PNG with output metadata decodes.
  await expect(root.locator('img.nb-image[src^="data:image/png"]')).toHaveCount(1)
  expect(await root.locator('img.nb-image').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  // The image pasted into the Markdown text (an attachment) is inlined and shown.
  const attached = root.locator('.nb-markdown img')
  await expect(attached).toHaveCount(1)
  expect(await attached.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
})

test('opens a Kaggle-style notebook: _uuid metadata and execution timestamps', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'kaggle-like.ipynb')
  const root = page.locator('.nb-root')
  await expect(root.locator('h1')).toHaveText('Kaggle-style notebook')
  await expect(page.locator('.nb-header')).toContainText('3 cells')
  // The execution timestamps give the run time of the first code cell.
  await expect(root.locator('.nb-cell[data-cell-id="cell-1"] .nb-duration')).toHaveText('2.5 s')
  await expect(root.locator('.nb-output table')).toContainText('10.5')
})

test('opens a VS Code notebook: metadata.vscode and a coloured traceback', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'vscode-like.ipynb')
  const root = page.locator('.nb-root')
  await expect(root.locator('h1')).toHaveText('VS Code notebook')
  await expect(root.locator('.nb-cell')).toHaveCount(3)
  await expect(root.locator('.nb-cell[data-cell-id="vs-run"] .nb-duration')).toHaveText('1.3 s')
  // The error output keeps its ANSI colours and no raw escape byte is shown.
  const error = root.locator('.nb-output.nb-error')
  await expect(error).toContainText("KeyError: 'profit'")
  expect(await error.innerText()).not.toContain('\u001b')
  await expect(error.locator('span[style*="color"], [class*="ansi"]').first()).toBeAttached()
})

test('opens a JupyterLab notebook: execute_result image and a Markdown attachment', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'jupyterlab-like.ipynb')
  const root = page.locator('.nb-root')
  await expect(root.locator('h1')).toHaveText('JupyterLab notebook')
  // The execute_result carries image/png and text/plain: the image wins.
  await expect(root.locator('img.nb-image[src^="data:image/png"]')).toHaveCount(1)
  expect(await root.locator('img.nb-image').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  // The Markdown attachment is inlined into the text.
  const attached = root.locator('.nb-markdown img')
  await expect(attached).toHaveCount(1)
  expect(await attached.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(root.locator('.nb-output.nb-error')).toContainText('ZeroDivisionError: division by zero')
})
