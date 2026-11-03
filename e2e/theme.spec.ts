import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Deska writes the new --deska-* tokens, then fires `theme`. The panel must pass
// the mode on, or code blocks and tracebacks keep the old palette (light code on
// a dark panel). Regression test for the bug the recorded walkthrough found.
const demo = readFileSync(new URL('../fixtures/notebooks/demo-sales.ipynb', import.meta.url))
const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255
}

test('follows a live theme change from Deska, and shows the notebook header', async ({ page }) => {
  await page.route('**/__deska/sdk.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `(() => {
      const tokens = { light: { '--deska-bg': '#ffffff', '--deska-text': '#1f2328' }, dark: { '--deska-bg': '#1b1d21', '--deska-text': '#e6e8eb' } }
      const listeners = {}
      const paint = (mode) => { for (const [k, v] of Object.entries(tokens[mode])) document.documentElement.style.setProperty(k, v); return { mode, tokens: tokens[mode] } }
      window.deska = {
        theme: null,
        ready: async () => { window.deska.theme = paint('light'); return { panel: { name: 'Notebook Viewer' }, locale: 'en', theme: window.deska.theme } },
        on: (name, fn) => { listeners[name] = fn; return () => { delete listeners[name] } },
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
        files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} },
      }
      window.__setTheme = (mode) => { window.deska.theme = paint(mode); listeners.theme?.(window.deska.theme) }
    })()`,
  }))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'demo-sales.ipynb', mimeType: 'application/json', buffer: demo })
  await expect(page.locator('.nb-header')).toHaveText('Quarterly sales review · python3 · python · 13 cells')

  const code = page.locator('.nb-code').first()
  const bg = () => code.evaluate((n) => getComputedStyle(n).backgroundColor)
  expect(luminance(await bg())).toBeGreaterThan(0.6)
  await page.evaluate(() => (window as never as { __setTheme(m: string): void }).__setTheme('dark'))
  await expect.poll(async () => luminance(await bg())).toBeLessThan(0.35)
  await page.evaluate(() => (window as never as { __setTheme(m: string): void }).__setTheme('light'))
  await expect.poll(async () => luminance(await bg())).toBeGreaterThan(0.6)
})
