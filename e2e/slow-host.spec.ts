import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// A host whose ready(), storage and files each take seconds: the panel must
// show its empty state at once, reopen the saved notebook when the host finally
// hands it back, and not lose an agent call that arrives before any of that.
// The double delays every host call and keeps the agent listeners, like the
// real host; its state survives a reload through sessionStorage.

const demo = readFileSync(new URL('../fixtures/notebooks/demo-sales.ipynb', import.meta.url))
const DELAY_MS = 2000

const SDK = `(() => {
  const listeners = {}
  const pending = new Map()
  let next = 0
  const delay = (v) => new Promise((resolve) => setTimeout(() => resolve(v), ${DELAY_MS}))
  const KEY = '__deska_double'
  const FILES_KEY = '__deska_double_files'
  const state = JSON.parse(sessionStorage.getItem(KEY) || '{}')
  const files = JSON.parse(sessionStorage.getItem(FILES_KEY) || '{}')
  const toB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(r.error); r.readAsDataURL(blob)
  })
  window.deska = {
    ready: async () => delay({ panel: { name: 'Notebook Viewer' }, locale: 'en-US', theme: { mode: 'light' },
      visibility: { visible: true, idle: false } }),
    on: (name, fn) => { listeners[name] = fn; return () => { delete listeners[name] } },
    agent: { respond: (callId, result) => { pending.get(callId)?.(result); pending.delete(callId); return Promise.resolve(true) } },
    storage: {
      get: async (k) => delay(state[k] ?? null),
      set: async (k, v) => { state[k] = v; sessionStorage.setItem(KEY, JSON.stringify(state)) },
      remove: async (k) => { delete state[k]; sessionStorage.setItem(KEY, JSON.stringify(state)) },
    },
    files: {
      put: async (blob) => { const id = 'f' + Object.keys(files).length; files[id] = await toB64(blob);
        sessionStorage.setItem(FILES_KEY, JSON.stringify(files)); return delay({ id }) },
      get: async (id) => delay(files[id] ? new Blob([Uint8Array.from(atob(files[id]), (c) => c.charCodeAt(0))]) : null),
      remove: async (id) => { delete files[id]; sessionStorage.setItem(FILES_KEY, JSON.stringify(files)) },
    },
  }
  window.__call = (action, input) => new Promise((resolve) => {
    const callId = 'call' + next++
    pending.set(callId, resolve)
    listeners['agent.action']({ callId, action, input })
  })
})()`

test('a slow host: empty state at once, the notebook reopens, and an early agent call is kept', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/__deska/sdk.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SDK }))

  // First visit: open the demo notebook once, so the host has it saved.
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({ name: 'demo-sales.ipynb', mimeType: 'application/json', buffer: demo })
  await expect(page.locator('.nb-root .nb-cell').first()).toBeAttached({ timeout: 30_000 })
  // The host is slow: wait until it has really taken the persisted notebook.
  await page.waitForFunction(() =>
    Boolean(sessionStorage.getItem('__deska_double_files') && sessionStorage.getItem('__deska_double')),
  )

  // Reload into the slow host: the empty state is there at once.
  await page.reload()
  const t0 = Date.now()
  await expect(page.getByRole('button', { name: /open notebook|abrir notebook/i })).toBeVisible()
  await expect(page.locator('main.hello .hint').first()).toBeVisible()
  expect(Date.now() - t0).toBeLessThan(DELAY_MS)

  // An agent call arrives long before the host has handed anything back.
  const answer = page.evaluate(() => (window as never as { __call(a: string, i: unknown): Promise<unknown> }).__call('scroll_to_cell', { index: 3 }))

  // The saved notebook reopens once the host answers, and the early call
  // is answered against it, not lost to a spurious "not found".
  await expect(page.locator('.nb-root .nb-cell').first()).toBeAttached({ timeout: 30_000 })
  await expect(page.locator('main')).toContainText('demo-sales.ipynb')
  expect(await answer).toEqual({ ok: true })
})
