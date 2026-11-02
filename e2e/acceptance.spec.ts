import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { generateLargeNotebook, generateMixedNotebook } from '../fixtures/notebooks/generate'

// One test per acceptance criterion of PLAN.md, section 0.1, driven through the
// real app in Chromium. The Deska SDK is replaced by a small in-memory double
// (state kept in sessionStorage so it survives a reload, like the real host).

const fixture = (name: string) => readFileSync(new URL(`../fixtures/notebooks/${name}`, import.meta.url))
const hostileHtml = readFileSync(new URL('../fixtures/hostile/attack.html', import.meta.url), 'utf8')
const hostileSvg = readFileSync(new URL('../fixtures/hostile/attack.svg', import.meta.url), 'utf8')

const SDK = `
const KEY = '__deska_double';
const state = JSON.parse(sessionStorage.getItem(KEY) || '{"storage":{},"files":{}}');
const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));
const mode = new URLSearchParams(location.search).get('theme') || 'light';
const toB64 = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
window.deska = {
  ready: async () => ({ panel: { id: 'dev-notebook-viewer', name: 'Notebook Viewer', version: null, dev: true },
    place: 'panel', theme: { mode, tokens: {} }, visibility: { visible: true, idle: false },
    permissions: [], declined: [], locale: new URLSearchParams(location.search).get('locale') || 'en-US', frames: { panel: 0, extras: 0 } }),
  theme: null, visible: true, place: null, setTitle: async () => {}, on: () => () => {},
  storage: {
    get: async (k) => state.storage[k] ?? null,
    set: async (k, v) => { state.storage[k] = v; save() },
    remove: async (k) => { delete state.storage[k]; save() },
  },
  files: {
    put: async (blob) => { const id = 'f' + Object.keys(state.files).length + '-' + Date.now(); state.files[id] = await toB64(blob); save(); return { id } },
    get: async (id) => state.files[id] ? new Blob([Uint8Array.from(atob(state.files[id]), c => c.charCodeAt(0))]) : null,
    remove: async (id) => { delete state.files[id]; save() },
  },
};
`

async function openPanel(page: Page, query = '') {
  await page.route('**/__deska/sdk.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: SDK }),
  )
  await page.goto('/' + query)
  await expect(page.getByRole('button', { name: /open notebook|abrir notebook/i })).toBeVisible()
}

async function pick(page: Page, name: string, buffer: Buffer | Uint8Array) {
  // Playwright refuses in-memory buffers over 50 MB: hand those over as a file.
  if (buffer.byteLength > 50 * 1024 * 1024) {
    const path = join(mkdtempSync(join(tmpdir(), 'nbv-')), name)
    writeFileSync(path, buffer)
    await page.locator('input[type=file]').setInputFiles(path)
    return
  }
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(buffer),
  })
}

function notebook(cells: unknown[]): Buffer {
  return Buffer.from(
    JSON.stringify({
      cells,
      metadata: { language_info: { name: 'python' } },
      nbformat: 4,
      nbformat_minor: 5,
    }),
  )
}

test('1. rich outputs render in light and dark', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await openPanel(page, `?theme=${theme}`)
    await pick(page, 'rich-outputs.ipynb', fixture('rich-outputs.ipynb'))
    const root = page.locator('.nb-root')
    await expect(root).toHaveAttribute('data-theme', theme)
    await expect(root.locator('.nb-output table')).not.toHaveCount(0) // pandas table
    await expect(root.locator('img.nb-image[src^="data:image/png"]')).toHaveCount(1) // matplotlib
    await expect(root.locator('.nb-output svg')).not.toHaveCount(0) // SVG
    await expect(root.locator('.katex')).not.toHaveCount(0) // LaTeX
    // Rendered, not merely present: the table and image have a real box.
    expect((await root.locator('.nb-output table').first().boundingBox())?.height).toBeGreaterThan(0)
    expect(
      await root.locator('img.nb-image').evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0)

    await pick(page, 'stream.ipynb', fixture('stream-and-traceback.ipynb'))
    await expect(root.getByText('stderr').first()).toBeVisible()
    // The traceback is coloured from ANSI escapes and carries no raw escape bytes.
    const text = await root.innerText()
    expect(text).not.toContain('\u001b')
    expect(text).not.toMatch(/\[0;31m/)
    await expect(root.locator('.nb-output span[style*="color"], .nb-output [class*="ansi"]').first()).toBeAttached()
  }
})

test('2. Plotly shows its static fallback or the placeholder row', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'plotly-with-fallback.ipynb', fixture('plotly-with-fallback.ipynb'))
  await expect(page.locator('.nb-root img.nb-image')).toHaveCount(1)
  await expect(page.locator('.nb-root .nb-placeholder')).toHaveCount(0)

  await pick(page, 'plotly-no-fallback.ipynb', fixture('plotly-no-fallback.ipynb'))
  // No image: the output is the placeholder row, not the text/plain repr.
  const output = page.locator('.nb-root .nb-outputs .nb-output').first()
  await expect(output).toBeVisible()
  await expect(page.locator('.nb-root img.nb-image')).toHaveCount(0)
  await expect(page.locator('.nb-root .nb-placeholder')).toHaveCount(1)
  await expect(output).toContainText('Interactive output, not shown')
  expect(await output.innerText()).not.toContain('Figure')
})

test('3. a hostile notebook runs nothing', async ({ page, baseURL }) => {
  const spy: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => {
    spy.push(`dialog:${d.message()}`)
    void d.dismiss()
  })
  await page.exposeFunction('__spyReport', (m: string) => spy.push(m))
  await page.addInitScript(() => {
    ;(globalThis as { __notebookExecutionSpy?: (m: string) => void }).__notebookExecutionSpy = (m) =>
      void (globalThis as unknown as { __spyReport: (m: string) => void }).__spyReport(m)
  })

  const hostile = notebook([
    {
      cell_type: 'markdown',
      id: 'm1',
      metadata: {},
      source: [
        "<script>__notebookExecutionSpy('md-script')</script>\n",
        "<img src=x onerror=\"__notebookExecutionSpy('md-onerror')\">\n",
        "[click](javascript:__notebookExecutionSpy('md-link'))\n",
        "<a href=\"javascript:__notebookExecutionSpy('md-html-link')\" id=\"evil\">evil</a>",
      ],
    },
    {
      cell_type: 'code',
      id: 'c1',
      metadata: {},
      execution_count: 1,
      source: ['1'],
      outputs: [
        { output_type: 'display_data', metadata: {}, data: { 'text/html': hostileHtml } },
        { output_type: 'display_data', metadata: {}, data: { 'image/svg+xml': hostileSvg } },
      ],
    },
  ])

  await openPanel(page)
  await pick(page, 'hostile.ipynb', hostile)
  await expect(page.locator('.nb-root .nb-cell')).not.toHaveCount(0)
  await expect(page.locator('.nb-root')).toContainText('evil')

  // Nothing active survives in the DOM...
  const active = await page.locator('.nb-root').evaluate((root) => ({
    elements: root.querySelectorAll('script, iframe, object, embed, form, foreignObject, style').length,
    handlers: [...root.querySelectorAll('*')].flatMap((e) =>
      e.getAttributeNames().filter((n) => n.startsWith('on')),
    ),
    urls: [...root.querySelectorAll('[href], [src], [action], [data], [xlink\\:href]')]
      .flatMap((e) => e.getAttributeNames().map((n) => e.getAttribute(n) ?? ''))
      .filter((v) => /^\s*(javascript:|data:text\/html)/i.test(v)),
  }))
  expect(active).toEqual({ elements: 0, handlers: [], urls: [] })
  // ...and clicking the hostile links and letting everything settle runs nothing.
  for (const link of await page.locator('.nb-root a').all()) await link.click({ force: true })
  await page.waitForTimeout(500)
  expect(spy).toEqual([])
  expect(errors).toEqual([])
  expect(page.url()).toBe(new URL('/', baseURL).href)
})

test('4. a 10,000-cell notebook opens and scrolls; first render is measured', async ({ page }, info) => {
  const bytes = generateMixedNotebook()
  await openPanel(page)

  // t0: the change event of the picker; t1: the first cell is in the DOM.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, number | undefined>
    document.querySelector('input[type=file]')!.addEventListener(
      'change',
      () => {
        w['__t0'] = performance.now()
        const mo = new MutationObserver(() => {
          if (document.querySelector('.nb-root .nb-cell')) {
            w['__t1'] = performance.now()
            mo.disconnect()
          }
        })
        mo.observe(document.body, { childList: true, subtree: true })
      },
      { capture: true },
    )
  })
  await pick(page, 'mixed-10000.ipynb', bytes)
  await page.waitForFunction(() => (window as unknown as Record<string, number>)['__t1'] !== undefined, null, {
    timeout: 60_000,
  })
  const firstRenderMs = await page.evaluate(() => {
    const w = window as unknown as Record<string, number>
    return Math.round(w['__t1']! - w['__t0']!)
  })

  // Virtualization: only a window of the 10,000 cells is in the DOM.
  const mounted = await page.locator('.nb-root .nb-cell').count()
  expect(mounted).toBeGreaterThan(0)
  expect(mounted).toBeLessThan(300)

  // Scrolling: jump around and watch for long main-thread tasks.
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] }
    w.__long = []
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({
      type: 'longtask',
      buffered: true,
    })
  })
  const scroller = await page.evaluate(() => {
    const root = document.querySelector('.nb-root') as HTMLElement
    return { scrollable: root.scrollHeight > root.clientHeight + 1, scrollHeight: root.scrollHeight }
  })
  expect(scroller.scrollable).toBe(true)
  const t = Date.now()
  for (const f of [0.25, 0.5, 0.75, 1]) {
    await page.evaluate(async (frac) => {
      const root = document.querySelector('.nb-root') as HTMLElement
      root.scrollTop = (root.scrollHeight - root.clientHeight) * frac
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }, f)
    expect(await page.locator('.nb-root .nb-cell').count()).toBeLessThan(300)
  }
  const scrollMs = Date.now() - t
  const worstLongTask = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long))
  await expect(page.locator('.nb-root .nb-cell[data-cell-id="cell-10000"]')).toBeAttached()

  const record = {
    cells: 10_000,
    bytes: bytes.byteLength,
    firstRenderMs,
    scrollFourJumpsMs: scrollMs,
    worstLongTaskMs: Math.round(worstLongTask),
    domCellsMounted: mounted,
    chromium: page.context().browser()?.version(),
    measuredAt: new Date().toISOString(),
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/first-render-10000.json', JSON.stringify(record, null, 2) + '\n')
  info.annotations.push({ type: 'first-render-ms', description: String(firstRenderMs) })
  console.log('first render, 10,000 cells:', JSON.stringify(record))
  expect(worstLongTask).toBeLessThan(1000) // "without freezing"
})

test('5. over the threshold it asks first: Cancel opens nothing, Open anyway opens it', async ({ page }) => {
  const big = generateLargeNotebook()
  await openPanel(page)

  await pick(page, 'big.ipynb', big)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(500)
  await expect(page.locator('.nb-root')).toHaveCount(0)
  await expect(page.locator('.nb-cell')).toHaveCount(0)

  await pick(page, 'big.ipynb', big)
  await dialog.getByRole('button', { name: 'Open anyway' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.nb-root .nb-cell').first()).toBeAttached({ timeout: 60_000 })
})

test('6. invalid JSON and nbformat 3 show their messages and the raw text', async ({ page }) => {
  await openPanel(page)
  for (const name of ['invalid-json.ipynb', 'nbformat3.ipynb']) {
    const raw = fixture(name).toString('utf8')
    await pick(page, name, Buffer.from(raw))
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    expect((await alert.innerText()).trim().length).toBeGreaterThan(10)
    // The raw text of the file is shown so the person can still read it.
    const snippet = raw.trim().slice(0, 40).replace(/\s+/g, ' ')
    const shown = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    expect(shown, `${name}: raw text is shown`).toContain(snippet)
  }
})

test('7. the package passes the Deska checks (npm run check:deska)', () => {
  test.setTimeout(180_000)
  execFileSync('npm', ['run', 'check:deska'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' })
})

test('8. the last notebook reopens after the panel reloads', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'rich-outputs.ipynb', fixture('rich-outputs.ipynb'))
  await expect(page.locator('.nb-root .nb-cell').first()).toBeAttached()

  await page.reload()
  await expect(page.locator('.nb-root .nb-cell').first()).toBeAttached()
  await expect(page.locator('main')).toContainText('rich-outputs.ipynb')
  await expect(page.locator('.nb-root .katex').first()).toBeAttached()
})


test('9. a newer copy marks two changed cells and shows a deletion in place', async ({ page }) => {
  const code = (id: string, source: string, text = '') => ({
    id, cell_type: 'code', source, metadata: {}, execution_count: 1,
    outputs: text ? [{ output_type: 'stream', name: 'stdout', text }] : [],
  })
  await openPanel(page, '?locale=es')
  await pick(page, 'changes.ipynb', notebook([
    code('a', 'same'), code('b', 'before'), code('c', 'deleted'), code('d', 'output', 'before'),
  ]))
  await expect(page.locator('.nb-cell')).toHaveCount(4)
  await expect(page.locator('.nb-changed')).toHaveCount(0)
  await pick(page, 'changes.ipynb', notebook([
    code('a', 'same'), code('b', 'after'), code('d', 'output', 'after'),
  ]))
  await expect(page.locator('.nb-changed')).toHaveCount(2)
  expect(await page.locator('.nb-changed').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-cell-id')))).toEqual(['b', 'd'])
  const deleted = page.locator('.nb-deleted')
  await expect(deleted).toHaveText('1 celdas eliminadas')
  const order = () => page.locator('.nb-cell, .nb-deleted').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-cell-id') ?? node.textContent))
  expect(await order()).toEqual(['a', 'b', '1 celdas eliminadas', 'd'])
  const filter = page.getByRole('button', { name: 'Cambiadas (2)', exact: true })
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.nb-cell')).toHaveCount(2)
  expect(await order()).toEqual(['b', '1 celdas eliminadas', 'd'])
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await expect(page.locator('.nb-cell')).toHaveCount(3)
})

// ---- 0.2: view ----

const viewCode = (id: string, source: string, extra: Record<string, unknown> = {}, outputs: unknown[] = []) => ({
  id, cell_type: 'code', source, metadata: {}, execution_count: 3, outputs, ...extra,
})
const stdout = (text: string) => ({ output_type: 'stream', name: 'stdout', text })

test('10. fold the input or output of a cell, and fold everything; heights are re-measured', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'fold.ipynb', notebook([
    viewCode('a', 'x = 1\ny = 2\nz = 3\nw = 4', {}, [stdout('out-a\n'.repeat(15))]),
    viewCode('b', 'print(1)', {}, [stdout('out-b')]),
  ]))
  const a = page.locator('.nb-cell[data-cell-id="a"]')
  const before = (await a.boundingBox())!.height
  await a.getByRole('button', { name: 'Input', exact: true }).click()
  await expect(a.locator('pre.nb-code')).toHaveClass(/nb-folded/)
  await expect(a.locator('.nb-output')).toHaveCount(1) // the output stays
  const afterInput = (await a.boundingBox())!.height
  expect(afterInput).toBeLessThan(before)
  await a.getByRole('button', { name: 'Output', exact: true }).click()
  await expect(a.locator('.nb-output')).toHaveCount(0)
  expect((await a.boundingBox())!.height).toBeLessThan(afterInput)
  // The next cell follows without a gap or overlap: the list re-measured.
  const gap = (await page.locator('.nb-cell[data-cell-id="b"]').boundingBox())!.y - (await a.boundingBox())!.y - (await a.boundingBox())!.height
  expect(Math.abs(gap)).toBeLessThan(2)

  await page.getByRole('button', { name: 'Fold all' }).click()
  await expect(page.locator('.nb-output')).toHaveCount(0)
  await expect(page.locator('pre.nb-code.nb-folded')).toHaveCount(2)
  await page.getByRole('button', { name: 'Unfold all' }).click()
  await expect(page.locator('.nb-output')).toHaveCount(2)
  await expect(page.locator('pre.nb-code.nb-folded')).toHaveCount(0)
})

test('11. "Outputs only" hides inputs, markdown and cells without output, in both themes', async ({ page }) => {
  await openPanel(page, '?theme=dark')
  await pick(page, 'only.ipynb', notebook([
    { id: 'm', cell_type: 'markdown', source: '# Title', metadata: {} },
    viewCode('a', 'print("hi")', {}, [stdout('hi')]),
    viewCode('b', 'x = 1'),
  ]))
  await expect(page.locator('.nb-cell')).toHaveCount(3)
  const button = page.getByRole('button', { name: 'Outputs only' })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.nb-cell')).toHaveCount(1)
  await expect(page.locator('pre.nb-code')).toHaveCount(0)
  await expect(page.locator('.nb-output')).toHaveText('hi')
  await expect(page.locator('.nb-root')).toHaveAttribute('data-theme', 'dark')
  await button.click()
  await expect(page.locator('.nb-cell')).toHaveCount(3)
})

for (const theme of ['light', 'dark']) {
  test(`12. a big pandas table scrolls inside its own box (${theme})`, async ({ page }) => {
    const rows = Array.from({ length: 400 }, (_, i) => `<tr><td>${i}</td><td>v${i}</td></tr>`).join('')
    const html = `<table><thead><tr><th>i</th><th>v</th></tr></thead><tbody>${rows}</tbody></table>`
    await page.setViewportSize({ width: 900, height: 800 })
    await openPanel(page, `?theme=${theme}`)
    await pick(page, 'table.ipynb', notebook([
      viewCode('t', 'df', {}, [{ output_type: 'execute_result', execution_count: 3, metadata: {}, data: { 'text/html': html } }]),
    ]))
    const box = page.locator('.nb-output.nb-scroll-table')
    await expect(box).toHaveCount(1)
    const root = (await page.locator('.nb-root').boundingBox())!
    const size = await box.evaluate((node) => ({ client: node.clientHeight, scroll: node.scrollHeight, overflow: getComputedStyle(node).overflowY }))
    expect(size.overflow).toBe('auto')
    expect(size.scroll).toBeGreaterThan(size.client)
    expect(size.client).toBeLessThanOrEqual(root.height * 0.6 + 1)
    expect(size.client).toBeGreaterThan(root.height * 0.3)
    await box.evaluate((node) => { node.scrollTop = 500 })
    expect(await box.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  })
}

test('13. shows the execution number and the duration when the notebook has them', async ({ page }) => {
  await openPanel(page)
  await pick(page, 'time.ipynb', notebook([
    viewCode('a', 'slow()', {
      execution_count: 12,
      metadata: { execution: { 'iopub.execute_input': '2026-01-01T10:00:00Z', 'shell.execute_reply': '2026-01-01T10:01:05Z' } },
    }),
    viewCode('b', 'fast()', { execution_count: 13 }),
  ]))
  const a = page.locator('.nb-cell[data-cell-id="a"] .nb-prompt')
  await expect(a.locator('.nb-count')).toHaveText('[12]')
  await expect(a.locator('.nb-duration')).toHaveText('1 min 5 s')
  await expect(page.locator('.nb-cell[data-cell-id="b"] .nb-prompt .nb-count')).toHaveText('[13]')
  await expect(page.locator('.nb-cell[data-cell-id="b"] .nb-duration')).toHaveCount(0)
})
