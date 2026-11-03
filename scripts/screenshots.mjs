#!/usr/bin/env node
// Takes the Marketplace screenshots with Playwright, under the sandbox theme tokens
// the panel really reads, and writes them to panel/screenshots/ (the build copies
// that folder to the package root, where the Marketplace expects it).
//
//   SHOTS_PORT=5591 npm run screenshots
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = resolve(root, 'panel/screenshots')
const port = process.env.SHOTS_PORT ?? '5591'
const base = `http://localhost:${port}/`

const themes = {
  light: { '--deska-bg': '#ffffff', '--deska-text': '#1f2328', '--deska-text-secondary': '#59636e', '--deska-border': '#d1d9e0', '--deska-font-ui': 'system-ui, sans-serif', '--deska-font-mono': 'ui-monospace, monospace' },
  dark: { '--deska-bg': '#1b1d21', '--deska-text': '#e6e8eb', '--deska-text-secondary': '#9aa3ad', '--deska-border': '#3a3f46', '--deska-font-ui': 'system-ui, sans-serif', '--deska-font-mono': 'ui-monospace, monospace' },
}

// The Marketplace allows 1 to 5 images, so five of the eight views ship.
const shots = [
  { file: '1-rich-outputs-light.png', theme: 'light', scene: 'rich' },
  { file: '2-rich-outputs-dark.png', theme: 'dark', scene: 'rich' },
  { file: '3-changed-light.png', theme: 'light', scene: 'changed' },
  { file: '4-search-outline-dark.png', theme: 'dark', scene: 'search' },
  { file: '5-outputs-only-light.png', theme: 'light', scene: 'outputs' },
]

const raw = await readFile(resolve(root, 'fixtures/notebooks/demo-sales.ipynb'), 'utf8')
const rich = Buffer.from(raw)
const edited = JSON.parse(raw)
// The same edit as the recorded walkthrough: one source, one output, one deleted cell.
const region = edited.cells.find((c) => c.id === 'region')
region.source = [...region.source, '\nrevenue = revenue[revenue > 200_000]  # agent: drop the small regions']
edited.cells.find((c) => c.id === 'load').outputs[0].text = ['Loaded 1,262 orders from sales_q3.csv\n']
edited.cells = edited.cells.filter((c) => c.id !== 'warn')
const changedNotebook = Buffer.from(JSON.stringify(edited))
const file = (buffer) => ({ name: 'demo-sales.ipynb', mimeType: 'application/json', buffer })

const vite = spawn('npx', ['vite', '--port', port, '--strictPort'], { cwd: root, stdio: 'ignore' })
const browser = await chromium.launch()
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(base).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const tokens = themes[shot.theme]
    await page.route('**/__deska/sdk.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `window.deska = {
        ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: '${shot.theme}', tokens: ${JSON.stringify(tokens)} } }),
        on: () => () => {},
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
        files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} }
      }`,
    }))
    await page.goto(base)
    await page.addStyleTag({ content: `:root { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join(" ")} }` })
    const input = page.locator('input[type=file]')
    await input.setInputFiles(file(rich))
    await page.locator('.nb-cell').first().waitFor()
    if (shot.scene === 'changed') {
      await input.setInputFiles(file(changedNotebook))
      await page.getByRole('button', { name: /^Changed \(/ }).click()
    }
    if (shot.scene === 'search') {
      await page.getByText(/^Outline \(/).click()
      await page.getByRole('searchbox', { name: 'Search cells' }).fill('revenue')
      await page.waitForTimeout(500)
    }
    if (shot.scene === 'outputs') await page.locator('[data-action=outputs-only]').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: resolve(out, shot.file) })
    await page.close()
    console.log('screenshots:', shot.file)
  }
} finally {
  await browser.close()
  vite.kill()
}
