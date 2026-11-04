#!/usr/bin/env node
// Runs docs/manual-test.md (and the rest of the feature list) as recorded
// walkthroughs in Chromium, against the Vite dev server with a Deska SDK double
// that behaves like the real one: theme tokens written before the `theme` event,
// storage and files that survive a reload, `agent.action` calls checked against
// panel.json, clipboard writes, and a declined `agent` permission.
//
// Every step asserts what it shows. For each scenario it writes to docs/recordings/:
//   <id>.webm  the full video        <id>.png  an animated PNG of the steps
// and docs/recordings/RESULTS.md with every step, pass or fail.
//
//   REC_PORT=5791 node scripts/showcase/record.mjs [scenario-id ...]
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { encodeApng } from './apng.mjs'
import { generateMixedNotebook } from '../../fixtures/notebooks/generate.ts'
import { violations } from '../../src/agent/schema-subset.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outDir = resolve(root, 'docs/recordings')
const port = process.env.REC_PORT ?? '5791'
const base = `http://localhost:${port}/`
const VIEW = { width: 1000, height: 640 }
const only = process.argv.slice(2)

const fixture = (name) => readFile(resolve(root, 'fixtures/notebooks', name))
const manifest = JSON.parse(await readFile(resolve(root, 'panel/panel.json'), 'utf8'))

const TOKENS = {
  light: { '--deska-bg': '#ffffff', '--deska-text': '#1f2328', '--deska-text-secondary': '#59636e', '--deska-border': '#d1d9e0', '--deska-font-ui': 'system-ui, sans-serif', '--deska-font-mono': 'ui-monospace, monospace' },
  dark: { '--deska-bg': '#1b1d21', '--deska-text': '#e6e8eb', '--deska-text-secondary': '#9aa3ad', '--deska-border': '#3a3f46', '--deska-font-ui': 'system-ui, sans-serif', '--deska-font-mono': 'ui-monospace, monospace' },
}

const sdk = ({ agent = true, theme = 'light' } = {}) => `(() => {
  const KEY = '__deska_double'
  const state = JSON.parse(sessionStorage.getItem(KEY) || '{"storage":{},"files":{}}')
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(state))
  const TOKENS = ${JSON.stringify(TOKENS)}
  const listeners = {}
  const pending = new Map()
  let next = 0
  const paint = (mode) => {
    for (const [k, v] of Object.entries(TOKENS[mode])) document.documentElement.style.setProperty(k, v)
    document.documentElement.style.background = TOKENS[mode]['--deska-bg']
    return { mode, tokens: TOKENS[mode] }
  }
  const toB64 = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s) }
  window.__copied = []
  window.deska = {
    theme: null,
    ready: async () => {
      window.deska.theme = paint(sessionStorage.getItem('__theme') || '${theme}')
      return { panel: { id: 'dev-notebook-viewer', name: 'Notebook Viewer', version: null, dev: true }, place: 'panel',
        theme: window.deska.theme, visibility: { visible: true, idle: false },
        permissions: ${agent ? "['agent', 'clipboard-write']" : "['clipboard-write']"}, declined: ${agent ? '[]' : "['agent']"},
        locale: 'en-US', frames: { panel: 0, extras: 0 }, ${agent ? 'agent: { tasks: 1 },' : ''} }
    },
    on: (name, fn) => { listeners[name] = fn; return () => { delete listeners[name] } },
    setTitle: async () => {},
    agent: { respond: (callId, result) => {
      ${agent ? '' : "return Promise.reject(Object.assign(new Error('permission_denied'), { code: 'permission_denied' }))"}
      pending.get(callId)?.(result); pending.delete(callId); return Promise.resolve(true)
    } },
    clipboard: {
      write: async (text) => { window.__copied.push({ kind: 'text', text }); return true },
      writeImage: async (blob) => { window.__copied.push({ kind: 'image', type: blob.type, size: blob.size }); return true },
    },
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
  }
  // Like Deska: the SDK writes the new tokens, then calls the panel's listener.
  window.__setTheme = (mode) => { sessionStorage.setItem('__theme', mode); window.deska.theme = paint(mode); listeners.theme?.(window.deska.theme) }
  window.__agentListening = () => Boolean(listeners['agent.action'])
  window.__call = (action, input) => new Promise((resolve) => {
    const callId = 'call' + next++
    pending.set(callId, resolve)
    listeners['agent.action']?.({ callId, action, input })
    ${agent ? '' : "resolve({ refused: 'permission_denied' })"}
  })
})()`

// ---------- recording helpers ----------

async function caption(page, label, state = 'run') {
  await page.evaluate(([label, state]) => {
    let bar = document.getElementById('__caption')
    if (!bar) {
      bar = document.createElement('div')
      bar.id = '__caption'
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;padding:7px 12px;font:600 14px/20px system-ui,sans-serif;color:#fff;white-space:pre-wrap'
      document.documentElement.appendChild(bar)
    }
    bar.style.background = state === 'fail' ? '#b42318ee' : state === 'pass' ? '#1a7f37ee' : '#1f2328ee'
    bar.textContent = (state === 'pass' ? '✓ ' : state === 'fail' ? '✗ ' : '▶ ') + label
  }, [label, state])
}

function recorder(page, scenario) {
  const frames = []
  const steps = []
  let failed = false
  const frame = async (ms = 1500) => frames.push({ png: await page.screenshot({ type: 'png' }), ms })
  return {
    frames, steps,
    get failed() { return failed },
    frame,
    async step(label, fn, { hold = 1600 } = {}) {
      if (failed) { steps.push({ label, status: 'skipped' }); return }
      const started = Date.now()
      try {
        await caption(page, label)
        const note = await fn()
        await caption(page, note ? `${label}\n${note}` : label, 'pass')
        await frame(hold)
        steps.push({ label, status: 'pass', note, ms: Date.now() - started })
      } catch (error) {
        failed = true
        const message = String(error?.message ?? error).split('\n').slice(0, 4).join(' ').replace(/\s+/g, ' ').slice(0, 300)
        await caption(page, `${label}\n${message}`, 'fail').catch(() => {})
        await frame(4000).catch(() => {})
        steps.push({ label, status: 'fail', note: message, ms: Date.now() - started })
        console.error(`  ✗ ${scenario}: ${label}: ${message}`)
      }
    },
  }
}

async function drop(page, name, bytes) {
  await page.evaluate(async ([name, b64]) => {
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([buf], name, { type: 'application/json' }))
    const target = document.querySelector('main')
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, [name, Buffer.from(bytes).toString('base64')])
}

async function callAgent(page, name, input) {
  const action = manifest.agent.actions.find((a) => a.name === name)
  const refused = violations(action.input, input)
  if (refused.length) throw new Error(`Deska would refuse this input: ${refused.join('; ')}`)
  const answer = await page.evaluate(([n, i]) => window.__call(n, i), [name, input])
  if (action.output && !answer?.refused) {
    const bad = violations(action.output, answer)
    if (bad.length) throw new Error(`answer breaks the output schema: ${bad.join('; ')}`)
  }
  return answer
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
const bg = (page, selector) => page.locator(selector).first().evaluate((n) => getComputedStyle(n).backgroundColor)
const fg = (page, selector) => page.locator(selector).first().evaluate((n) => getComputedStyle(n).color)

async function scrollRoot(page, to) {
  await page.locator('.nb-root').evaluate((n, to) => { n.scrollTop = to === 'end' ? n.scrollHeight : to }, to)
  await page.waitForTimeout(350)
}

const cellIn = (page, id) => page.locator(`.nb-cell[data-cell-id="${id}"]`)
async function inViewport(page, id) {
  await expect(cellIn(page, id)).toBeAttached()
  await expect.poll(() => cellIn(page, id).evaluate((node) => {
    const box = node.getBoundingClientRect()
    const r = node.closest('.nb-root').getBoundingClientRect()
    return box.top < r.bottom && box.bottom > r.top
  })).toBe(true)
}

// ---------- the notebooks ----------

const demo = await fixture('demo-sales.ipynb')
const demoJson = JSON.parse(demo.toString())
function editedDemo() {
  const nb = structuredClone(demoJson)
  const region = nb.cells.find((c) => c.id === 'region')
  region.source = [...region.source, '\nrevenue = revenue[revenue > 200_000]  # agent: drop the small regions']
  const load = nb.cells.find((c) => c.id === 'load')
  load.outputs[0].text = ['Loaded 1,262 orders from sales_q3.csv\n']
  nb.cells = nb.cells.filter((c) => c.id !== 'warn')
  return Buffer.from(JSON.stringify(nb))
}

// ---------- scenarios ----------

const scenarios = [
  {
    id: '01-open-notebook',
    title: 'Open a notebook by dropping it on the panel',
    manual: 'Steps 1 and 2',
    async run(page, r) {
      await r.step('The panel loads and shows the empty state', async () => {
        await expect(page.getByRole('button', { name: /open notebook/i })).toBeVisible()
        await expect(page.locator('.hint')).toContainText(/drop a notebook/i)
      })
      await r.step('Drop demo-sales.ipynb onto the panel', async () => {
        await drop(page, 'demo-sales.ipynb', demo)
        await expect(page.locator('.nb-cell').first()).toBeVisible()
      })
      await r.step('The header shows file name, kernel, language and cell count', async () => {
        await expect(page.locator('.hint').first()).toHaveText('demo-sales.ipynb')
        const header = page.locator('.nb-header')
        await expect(header).toContainText('Quarterly sales review')
        await expect(header).toContainText('python3')
        await expect(header).toContainText(`${demoJson.cells.length} cells`)
        return (await header.innerText()).trim()
      })
      await r.step('Markdown with LaTeX (KaTeX) and highlighted code', async () => {
        await expect(page.locator('.nb-markdown .katex').first()).toBeVisible()
        await expect(page.locator('.nb-code .hljs-keyword, .nb-code [class*="hljs-"]').first()).toBeAttached()
        return `${await page.locator('.katex').count()} formulas rendered`
      })
      await r.step('A pandas table and the execution time of each cell', async () => {
        await cellIn(page, 'clean').scrollIntoViewIfNeeded()
        await expect(cellIn(page, 'clean').locator('table.dataframe')).toBeVisible()
        await expect(cellIn(page, 'load').locator('.nb-duration')).toHaveText(/0\.8\s?s|840\s?ms/)
      })
      await r.step('A matplotlib PNG and an SVG chart', async () => {
        await cellIn(page, 'plot').scrollIntoViewIfNeeded()
        await expect(cellIn(page, 'plot').locator('img')).toBeVisible()
        await cellIn(page, 'trend').scrollIntoViewIfNeeded()
        await expect(cellIn(page, 'trend').locator('svg, img')).toBeVisible()
      })
      await r.step('A stderr warning and a traceback with ANSI colours', async () => {
        await scrollRoot(page, 'end')
        await cellIn(page, 'check').scrollIntoViewIfNeeded()
        await expect(cellIn(page, 'check').locator('.nb-error')).toContainText("KeyError: 'region_code'")
        await expect(cellIn(page, 'warn').locator('.nb-stderr')).toContainText('FutureWarning')
      })
    },
  },
  {
    id: '02-theme',
    title: 'Follow Deska’s theme, light and dark, live',
    manual: 'Step 3',
    async run(page, r) {
      await drop(page, 'demo-sales.ipynb', demo)
      await expect(page.locator('.nb-cell').first()).toBeVisible()
      await cellIn(page, 'region').scrollIntoViewIfNeeded()
      await r.step('Light theme: light background, dark text, light code blocks', async () => {
        expect(luminance(await bg(page, '.nb-code'))).toBeGreaterThan(0.6)
        expect(luminance(await fg(page, '.nb-root'))).toBeLessThan(0.4)
      })
      await r.step('Deska switches to dark: code blocks, text and errors follow', async () => {
        await page.evaluate(() => window.__setTheme('dark'))
        await page.waitForTimeout(300)
        expect(luminance(await fg(page, '.nb-root')), 'text colour').toBeGreaterThan(0.6)
        expect(luminance(await bg(page, '.nb-code')), 'code block background').toBeLessThan(0.35)
        await scrollRoot(page, 'end')
        expect(luminance(await bg(page, '.nb-error')), 'traceback background').toBeLessThan(0.35)
      })
      await r.step('Back to light', async () => {
        await page.evaluate(() => window.__setTheme('light'))
        await page.waitForTimeout(300)
        expect(luminance(await bg(page, '.nb-code'))).toBeGreaterThan(0.6)
        expect(luminance(await fg(page, '.nb-root'))).toBeLessThan(0.4)
      })
    },
  },
  {
    id: '03-reload',
    title: 'Reopen the last notebook after the panel reloads',
    manual: 'Step 4',
    async run(page, r) {
      await r.step('Open demo-sales.ipynb', async () => {
        await drop(page, 'demo-sales.ipynb', demo)
        await expect(page.locator('.nb-cell').first()).toBeVisible()
      })
      await r.step('Reload the panel: the notebook reopens by itself, at the top', async () => {
        await page.reload()
        await expect(page.locator('.nb-cell').first()).toBeVisible()
        await expect(page.locator('.hint').first()).toHaveText('demo-sales.ipynb')
        expect(await page.locator('.nb-root').evaluate((n) => n.scrollTop)).toBe(0)
      })
    },
  },
  {
    id: '04-what-changed',
    title: 'See what the agent changed in a newer copy',
    manual: 'Step 5',
    async run(page, r) {
      await r.step('Open demo-sales.ipynb', async () => {
        await drop(page, 'demo-sales.ipynb', demo)
        await expect(page.locator('.nb-cell').first()).toBeVisible()
        await expect(page.locator('.nb-changed')).toHaveCount(0)
      })
      await r.step('Drop a newer copy: one source and one output changed, one cell deleted', async () => {
        await drop(page, 'demo-sales.ipynb', editedDemo())
        await expect(page.getByRole('button', { name: 'Changed (2)' })).toBeVisible()
        await expect(cellIn(page, 'load')).toHaveClass(/nb-changed/)
        return 'Marked in amber; the filter says Changed (2)'
      })
      await r.step('Turn on "Changed": only the changed cells and the deleted row', async () => {
        await page.getByRole('button', { name: 'Changed (2)' }).click()
        await expect(page.locator('.nb-cell')).toHaveCount(2)
        await expect(page.locator('.nb-deleted')).toContainText(/1 (cell )?deleted|deleted/i)
      })
      await r.step('Back to "All"', async () => {
        await page.getByRole('button', { name: 'All', exact: true }).click()
        await expect(page.locator('.nb-cell').nth(5)).toBeAttached()
      })
    },
  },
  {
    id: '05-agent-actions',
    title: 'A connected agent points at cells',
    manual: 'Step 6',
    async run(page, r) {
      await page.waitForFunction(() => window.__agentListening())
      await drop(page, 'demo-sales.ipynb', demo)
      await expect(page.locator('.nb-cell').first()).toBeVisible()
      await r.step('summarize_changes before a second copy: nothing to compare', async () => {
        const a = await callAgent(page, 'summarize_changes', {})
        expect(a.available).toBe(false)
        return `→ ${JSON.stringify(a).slice(0, 110)}`
      })
      await r.step('scroll_to_cell { id: "check" } (the failing assert)', async () => {
        expect(await callAgent(page, 'scroll_to_cell', { id: 'check' })).toEqual({ ok: true })
        await inViewport(page, 'check')
        return '→ {"ok":true}'
      })
      await r.step('highlight_cell { index: 6, seconds: 3 } (the PNG chart)', async () => {
        expect(await callAgent(page, 'highlight_cell', { index: 6, seconds: 3 })).toEqual({ ok: true })
        await inViewport(page, 'plot')
        await expect(cellIn(page, 'plot')).toHaveClass(/nb-highlight/)
        return '→ {"ok":true}; the mark goes away by itself'
      }, { hold: 1800 })
      await r.step('The highlight disappears after about 3 seconds', async () => {
        await expect(cellIn(page, 'plot')).not.toHaveClass(/nb-highlight/, { timeout: 5000 })
      })
      await r.step('A newer copy, then summarize_changes', async () => {
        await drop(page, 'demo-sales.ipynb', editedDemo())
        await expect(page.getByRole('button', { name: 'Changed (2)' })).toBeVisible()
        const a = await callAgent(page, 'summarize_changes', {})
        expect(a.available).toBe(true)
        expect(a.cells.map((c) => c.status).sort()).toEqual(['changed', 'changed', 'deleted'])
        return `→ ${a.cells.map((c) => `${c.status} ${c.id}`).join(', ')}`
      })
      await r.step('scroll_to_cell to a cell that does not exist: not_found, the view stays', async () => {
        const before = await page.locator('.nb-root').evaluate((n) => n.scrollTop)
        expect(await callAgent(page, 'scroll_to_cell', { id: 'nope' })).toEqual({ ok: false, error: 'not_found' })
        expect(await page.locator('.nb-root').evaluate((n) => n.scrollTop)).toBe(before)
        return '→ {"ok":false,"error":"not_found"}'
      })
    },
  },
  {
    id: '06-agent-declined',
    title: 'The person declines the agent permission: the panel still reads',
    manual: 'Step 7',
    sdk: { agent: false },
    async run(page, r) {
      await r.step('Permission `agent` declined; open demo-sales.ipynb', async () => {
        await drop(page, 'demo-sales.ipynb', demo)
        await expect(page.locator('.nb-cell').first()).toBeVisible()
        await expect(cellIn(page, 'clean').locator('table')).toBeAttached()
      })
      await r.step('Search and the Changed filter keep working', async () => {
        await page.getByRole('searchbox', { name: 'Search cells' }).fill('region')
        await expect(page.locator('.search')).toContainText(/\d+ \/ \d+|\/ \d+/)
        await drop(page, 'demo-sales.ipynb', editedDemo())
        await expect(page.getByRole('button', { name: 'Changed (2)' })).toBeVisible()
      })
    },
  },
  {
    id: '07-copy',
    title: 'Copy a cell or an output image',
    async run(page, r) {
      await drop(page, 'demo-sales.ipynb', demo)
      await expect(page.locator('.nb-cell').first()).toBeVisible()
      await r.step('Copy the source of a code cell', async () => {
        await cellIn(page, 'region').scrollIntoViewIfNeeded()
        await cellIn(page, 'region').locator('.nb-copy-source').click()
        await expect(page.getByTestId('copy-notice')).toHaveText('Copied')
        const copied = await page.evaluate(() => window.__copied.at(-1))
        expect(copied.text).toContain('groupby("region")')
        return 'The clipboard holds the cell source'
      })
      await r.step('Copy the PNG chart as an image', async () => {
        await cellIn(page, 'plot').scrollIntoViewIfNeeded()
        await cellIn(page, 'plot').locator('.nb-copy-image').click()
        const copied = await page.evaluate(() => window.__copied.at(-1))
        expect(copied).toMatchObject({ kind: 'image', type: 'image/png' })
        return `image/png, ${copied.size.toLocaleString('en')} bytes`
      })
    },
  },
  {
    id: '08-navigate',
    title: 'Outline and search',
    async run(page, r) {
      await drop(page, 'demo-sales.ipynb', demo)
      await expect(page.locator('.nb-cell').first()).toBeVisible()
      await r.step('Open the outline built from the Markdown headings', async () => {
        await page.getByText(/^Outline \(/).click()
        await expect(page.locator('.outline')).toContainText('4. Checks')
      })
      await r.step('Jump to "4. Checks"', async () => {
        await page.locator('.outline').getByRole('button', { name: '4. Checks' }).click()
        await inViewport(page, 'checks-h')
      })
      await r.step('Search "revenue" and walk the results', async () => {
        await page.getByRole('searchbox', { name: 'Search cells' }).fill('revenue')
        await expect(page.locator('.search')).toContainText(/\/ [1-9]/)
        await page.getByRole('button', { name: 'Next', exact: true }).click()
        await page.waitForTimeout(300)
        await r.frame(1200)
        await page.getByRole('button', { name: 'Next', exact: true }).click()
        return (await page.locator('.search').innerText()).replace(/\s+/g, ' ').slice(0, 80)
      })
    },
  },
  {
    id: '09-fold-and-outputs',
    title: 'Fold inputs and outputs, or read only the outputs',
    async run(page, r) {
      await drop(page, 'demo-sales.ipynb', demo)
      await expect(page.locator('.nb-cell').first()).toBeVisible()
      await r.step('Fold all: each cell keeps its first line', async () => {
        await page.getByRole('button', { name: 'Fold all' }).click()
        await expect(page.getByRole('button', { name: 'Unfold all' })).toBeVisible()
      })
      await r.step('Unfold all, then "Outputs only"', async () => {
        await page.getByRole('button', { name: 'Unfold all' }).click()
        await page.getByRole('button', { name: 'Outputs only' }).click()
        await expect(page.locator('.nb-markdown')).toHaveCount(0)
        await expect(page.locator('table.dataframe').first()).toBeVisible()
      })
      await r.step('Large tables scroll inside their own box', async () => {
        const table = page.locator('.nb-output:has(table)').first()
        await expect(table).toBeVisible()
        const style = await table.evaluate((n) => getComputedStyle(n).overflowY)
        expect(['auto', 'scroll']).toContain(style)
      })
    },
  },
  {
    id: '10-formats',
    title: 'Jupytext, Databricks, marimo, R Markdown, Quarto and Zeppelin',
    async run(page, r) {
      const files = [
        ['jupytext-percent.py', 'Jupytext percent'],
        ['databricks-source.py', 'Databricks source'],
        ['marimo-app.py', 'marimo'],
        ['rmarkdown-report.Rmd', 'R Markdown'],
        ['quarto-doc.qmd', 'Quarto'],
        ['zeppelin-note.zpln', 'Zeppelin (with saved outputs)'],
      ]
      for (const [file, label] of files) {
        await r.step(`${label}: ${file}`, async () => {
          await drop(page, file, await fixture(file))
          await expect(page.locator('.hint').first()).toHaveText(file)
          await expect(page.locator('.nb-cell').first()).toBeVisible()
          return `${await page.locator('.nb-cell').count()} cells`
        }, { hold: 1300 })
      }
    },
  },
  {
    id: '11-hostile',
    title: 'A hostile notebook runs nothing',
    async run(page, r) {
      const html = await readFile(resolve(root, 'fixtures/hostile/attack.html'), 'utf8')
      const svg = await readFile(resolve(root, 'fixtures/hostile/attack.svg'), 'utf8')
      await page.evaluate(() => { window.__ran = []; window.__notebookExecutionSpy = (what) => window.__ran.push(what) })
      const nb = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
        { id: 'm', cell_type: 'markdown', metadata: {}, source: '# Hostile\n\n<img src=x onerror="__notebookExecutionSpy(\'md\')"> [click](javascript:__notebookExecutionSpy(\'md-link\'))' },
        { id: 'h', cell_type: 'code', metadata: {}, execution_count: 1, source: 'display(HTML(attack))', outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/html': html } }] },
        { id: 's', cell_type: 'code', metadata: {}, execution_count: 2, source: 'display(SVG(attack))', outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/svg+xml': svg } }] },
      ] }
      await r.step('Open a notebook with <script>, on* handlers, javascript: links and SVG scripts', async () => {
        await drop(page, 'hostile.ipynb', Buffer.from(JSON.stringify(nb)))
        await expect(cellIn(page, 'h')).toBeVisible()
        await page.waitForTimeout(800)
      })
      await r.step('Click every link in the outputs', async () => {
        for (const link of await page.locator('.nb-root a').all()) await link.click({ force: true }).catch(() => {})
        await page.waitForTimeout(500)
      })
      await r.step('Nothing ran: no script, handler or link fired', async () => {
        expect(await page.evaluate(() => window.__ran)).toEqual([])
        expect(await page.locator('.nb-root script, .nb-root iframe, .nb-root object, .nb-root embed').count()).toBe(0)
        return 'execution spy: [] — 0 script/iframe/object/embed nodes'
      })
    },
  },
  {
    id: '12-large',
    title: '10,000 cells open and scroll without freezing',
    async run(page, r) {
      const big = generateMixedNotebook()
      let ms = 0
      await r.step(`Open a 10,000-cell notebook (${(big.byteLength / 1e6).toFixed(1)} MB)`, async () => {
        const t0 = Date.now()
        await drop(page, 'large-10000.ipynb', big)
        await expect(page.locator('.nb-cell').first()).toBeVisible({ timeout: 20000 })
        ms = Date.now() - t0
        return `first cell after ${ms} ms; ${await page.locator('.nb-cell').count()} cells in the DOM`
      })
      for (const at of [0.25, 0.5, 0.75, 1]) {
        await r.step(`Scroll to ${at * 100}%`, async () => {
          const t0 = Date.now()
          await page.locator('.nb-root').evaluate((n, at) => { n.scrollTop = (n.scrollHeight - n.clientHeight) * at }, at)
          await page.waitForTimeout(250)
          await expect(page.locator('.nb-cell').first()).toBeVisible()
          const mounted = await page.locator('.nb-cell').count()
          expect(mounted).toBeLessThan(200)
          return `${Date.now() - t0} ms, ${mounted} cells mounted`
        }, { hold: 900 })
      }
    },
  },
  {
    id: '13-toolbar-and-keys',
    title: 'The toolbar and the keyboard shortcuts',
    async run(page, r) {
      await drop(page, 'demo-sales.ipynb', demo)
      await expect(page.locator('.nb-cell').first()).toBeVisible()
      await r.step('The toolbar shows the file name and the notebook header', async () => {
        await expect(page.locator('.toolbar .hint').first()).toHaveText('demo-sales.ipynb')
        const header = page.locator('.nb-header')
        await expect(header).toContainText('Quarterly sales review')
        await expect(header).toContainText('python3')
        return (await header.innerText()).trim()
      })
      await r.step('j and k walk the cells', async () => {
        await page.keyboard.press('j')
        await inViewport(page, 'load')
        await page.keyboard.press('k')
        await inViewport(page, 'intro')
        return 'j goes to the next cell, k back to the previous one'
      })
      await r.step('/ focuses the search; n and N walk the results', async () => {
        await page.keyboard.press('/')
        const search = page.getByRole('searchbox', { name: 'Search cells' })
        await expect(search).toBeFocused()
        await page.keyboard.type('revenue')
        await expect(page.locator('.search')).toContainText(/\/ [1-9]/)
        await search.evaluate((node) => node.blur())
        await page.keyboard.press('n')
        await page.waitForTimeout(250)
        await page.keyboard.press('n')
        await r.frame(1200)
        await page.keyboard.press('N')
        return (await page.locator('.search').innerText()).replace(/\s+/g, ' ').slice(0, 80)
      })
      await r.step('o shows only the outputs, and back', async () => {
        await page.keyboard.press('o')
        await expect(page.getByRole('button', { name: 'Outputs only' })).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator('.nb-cell.nb-markdown')).toHaveCount(0)
        await page.keyboard.press('o')
        await expect(page.locator('.nb-cell.nb-markdown').first()).toBeVisible()
      })
      await r.step('c turns on "Changed" after a newer copy', async () => {
        await drop(page, 'demo-sales.ipynb', editedDemo())
        await expect(page.getByRole('button', { name: 'Changed (2)' })).toBeVisible()
        await page.keyboard.press('c')
        await expect(page.locator('.nb-cell')).toHaveCount(2)
        await page.keyboard.press('c')
        await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')
        return 'c shows only the 2 changed cells, c again shows all'
      })
      await r.step('? lists the shortcuts; Esc closes the list', async () => {
        await page.keyboard.press('?')
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
        await r.frame(1400)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
      })
      await r.step('At 320 px the secondary controls move into the menu', async () => {
        await page.setViewportSize({ width: 320, height: 640 })
        const menu = page.getByRole('button', { name: 'Menu' })
        await expect(menu).toBeVisible()
        await menu.click()
        await expect(page.getByRole('button', { name: 'Fold all' })).toBeVisible()
        await page.getByRole('button', { name: 'Fold all' }).click()
        await expect(page.getByRole('button', { name: 'Unfold all' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: 'Unfold all' })).toBeHidden()
        await page.setViewportSize(VIEW)
        return 'the menu holds the outline, the filters, fold and outputs'
      })
    },
  },
]

// ---------- run ----------

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (await fetch(base).then((res) => res.ok, () => false)) return
    await new Promise((res) => setTimeout(res, 200))
  }
  throw new Error(`vite did not answer on ${base}`)
}

const vite = spawn('npx', ['vite', '--port', port, '--strictPort'], { cwd: root, stdio: 'ignore' })
const videoTmp = await mkdtemp(join(tmpdir(), 'nbv-video-'))
const results = []
let browser
try {
  await waitForServer()
  browser = await chromium.launch()
  await mkdir(outDir, { recursive: true })
  for (const s of scenarios.filter((s) => !only.length || only.includes(s.id))) {
    console.log(`▶ ${s.id}`)
    const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: videoTmp, size: VIEW } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`console: ${m.text()}`) })
    await page.route('**/__deska/sdk.js', (route) => route.fulfill({ contentType: 'text/javascript', body: sdk(s.sdk) }))
    await page.goto(base)
    await page.getByRole('button', { name: /open notebook/i }).waitFor()
    await caption(page, s.title)
    await page.waitForTimeout(600)
    const r = recorder(page, s.id)
    await r.frame(1800)
    await s.run(page, r)
    await r.step('No uncaught errors and no console errors', async () => {
      expect(errors).toEqual([])
    }, { hold: 1200 })
    const video = page.video()
    await context.close()
    if (video) await video.saveAs(resolve(outDir, `${s.id}.webm`))
    await writeFile(resolve(outDir, `${s.id}.png`), encodeApng(r.frames))
    results.push({ ...s, steps: r.steps, failed: r.failed })
    console.log(`  ${r.failed ? '✗ FAIL' : '✓ pass'} (${r.steps.filter((x) => x.status === 'pass').length}/${r.steps.length})`)
  }
} finally {
  await browser?.close()
  vite.kill()
  await rm(videoTmp, { recursive: true, force: true })
}

// ---------- report ----------

if (!only.length) {
  const chromiumVersion = await chromium.launch().then(async (b) => { const v = b.version(); await b.close(); return v })
  const lines = [
    '# Recorded walkthroughs',
    '',
    `Run by \`node scripts/showcase/record.mjs\` on ${new Date().toISOString().slice(0, 10)}: Chromium ${chromiumVersion}, Node ${process.version}, ${cpus()[0]?.model.trim()}, ${Math.round(totalmem() / 2 ** 30)} GB.`,
    'The panel runs on the Vite dev server with a double of the Deska SDK (theme, storage, files, agent, clipboard).',
    'Every step asserts what it shows; a failed step turns the caption red and stops the scenario.',
    'Each scenario has a full video (`.webm`) and an animated PNG of its steps (`.png`, plays inline on GitHub).',
    '',
    '| Scenario | manual-test.md | Steps | Result | Recording |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((s) => `| ${s.title} | ${s.manual ?? '—'} | ${s.steps.filter((x) => x.status === 'pass').length}/${s.steps.length} | ${s.failed ? '✗ fail' : '✓ pass'} | [video](${s.id}.webm) · [steps](${s.id}.png) |`),
    '',
  ]
  for (const s of results) {
    lines.push(`## ${s.title}`, '', `![${s.title}](${s.id}.png)`, '')
    for (const st of s.steps) {
      const mark = st.status === 'pass' ? '✓' : st.status === 'fail' ? '✗' : '–'
      lines.push(`- ${mark} ${st.label}${st.note ? ` — ${st.note.replace(/\n/g, ' ')}` : ''}`)
    }
    lines.push('')
  }
  await writeFile(resolve(outDir, 'RESULTS.md'), lines.join('\n'))
}
const failed = results.filter((s) => s.failed)
console.log(failed.length ? `${failed.length} scenario(s) failed: ${failed.map((s) => s.id).join(', ')}` : `all ${results.length} scenarios passed`)
process.exit(failed.length ? 1 : 0)
