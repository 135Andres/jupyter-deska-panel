import { readFileSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { generateMixedNotebook } from '../fixtures/notebooks/generate'

// Temporary profiling spec: run with
//   E2E_PORT=5391 npx playwright test e2e/profile.spec.ts
// It prints the worst long tasks and a CDP CPU profile aggregated by function.

const SDK_BASE = readFileSync(new URL('./acceptance.spec.ts', import.meta.url), 'utf8').match(/const SDK = `([\s\S]*?)`\n/)!

/** The e2e double, with the file persistence made instant: the real host answers files.put over postMessage. */
const SDK_FAST = SDK_BASE[1]!
  .replace(/const toB64 = [^\n]*/, '')
  .replace(/put: async \(blob\) => \{.*\},/, "put: async () => ({ id: 'f0' }),")
  .replace(/get: async \(id\) => [^\n]*/, 'get: async () => null,')

async function openPanel(page: Page) {
  await page.route('**/__deska/sdk.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: SDK_FAST }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: /open notebook|abrir notebook/i }).waitFor()
}

test('profile the 10,000-cell notebook', async ({ page }) => {
  test.setTimeout(120_000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await openPanel(page)

  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    w['__tasks'] = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (w['__tasks'] as { name: string; start: number; duration: number }[]).push({ name: e.name, start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
    document.querySelector('input[type=file]')!.addEventListener('change', () => {
      (window as unknown as Record<string, number>)['__t0'] = performance.now()
    }, { capture: true })
  })
  await cdp.send('Profiler.start')
  await page.locator('input[type=file]').setInputFiles({
    name: 'mixed-10000.ipynb',
    mimeType: 'application/json',
    buffer: Buffer.from(generateMixedNotebook()),
  })
  await page.waitForFunction(() => document.querySelector('.nb-root .nb-cell') !== null, null, { timeout: 60_000 })
  const firstCellMs = await page.evaluate(() => {
    const w = window as unknown as Record<string, number>
    return Math.round(performance.now() - w['__t0']!)
  })
  // Let the search index finish too.
  await page.waitForFunction(() => document.querySelector('.navigation summary') !== null, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  const { profile } = await cdp.send('Profiler.stop')
  const tasks = await page.evaluate(() => (window as unknown as { __tasks: { name: string; start: number; duration: number }[] }).__tasks)
  const t0 = await page.evaluate(() => (window as unknown as Record<string, number>)['__t0']!)

  console.log('\n=== first cell:', firstCellMs, 'ms')
  console.log('=== long tasks (start relative to file pick, ms):')
  for (const t of tasks) console.log(`  +${Math.round(t.start - t0)}ms  ${Math.round(t.duration)}ms  ${t.name}`)

  // Aggregate self time per function from the whole profile.
  const nodes = new Map<string, { fn: string; self: number }>()
  const byId = new Map<number, { callFrame: { functionName: string; url: string } }>()
  for (const n of profile.nodes) byId.set(n.id, n)
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  let total = 0
  for (let i = 0; i < samples.length; i++) {
    const ms = (deltas[i] ?? 0) / 1000
    const node = byId.get(samples[i]!)
    if (!node) continue
    const key = node.callFrame.functionName || '(anonymous)'
    const url = node.callFrame.url.replace(/^.*\//, '')
    const k = `${key} @ ${url}`
    const entry = nodes.get(k) ?? { fn: k, self: 0 }
    entry.self += ms
    nodes.set(k, entry)
    total += ms
  }
  console.log(`\n=== CDP profile: ${Math.round(total)}ms sampled`)
  const top = [...nodes.values()].sort((a, b) => b.self - a.self).slice(0, 30)
  for (const n of top) console.log(`  ${Math.round(n.self)}ms  ${n.fn}`)
})
