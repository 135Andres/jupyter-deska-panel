import { expect, test, type Page } from '@playwright/test'

// The toolbar: the shortcuts, the 320 px layout, and a theme whose accent is
// not the default one.

const notebook = (cells: unknown[]) => new TextEncoder().encode(JSON.stringify({ cells, metadata: { kernelspec: { name: 'python3' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 }))
const code = (id: string, source: string, text = '') => ({ id, cell_type: 'code', metadata: {}, source, execution_count: null, outputs: text ? [{ output_type: 'stream', name: 'stdout', text }] : [] })
const markdown = (id: string, source: string) => ({ id, cell_type: 'markdown', metadata: {}, source })

async function pick(page: Page, bytes: Uint8Array, name = 'toolbar.ipynb') {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(bytes) })
}

async function stubSdk(page: Page, tokens: Record<string, string> = {}) {
  await page.route('**/__deska/sdk.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `(() => {
      const tokens = ${JSON.stringify(tokens)}
      for (const [k, v] of Object.entries(tokens)) document.documentElement.style.setProperty(k, v)
      window.deska = {
        ready: async () => ({ panel: { name: 'Notebook Viewer' }, locale: 'en', theme: { mode: 'light' } }),
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
        files: { put: async () => ({ id: 'saved' }), get: async () => null, remove: async () => {} }
      }
    })()`,
  }))
}

async function inViewport(page: Page, id: string) {
  const cell = page.locator(`.nb-cell[data-cell-id="${id}"]`)
  await expect(cell).toBeAttached()
  await expect.poll(() => cell.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const root = node.closest('.nb-root')?.getBoundingClientRect()
    if (!root) return false
    return box.top < root.bottom && box.bottom > root.top
  })).toBe(true)
}

test.beforeEach(async ({ page }) => { await stubSdk(page) })

test('the keyboard shortcuts: j/k, /, n/N, c, o, ? and Esc', async ({ page }) => {
  await page.goto('/')
  const cells = [
    markdown('m0', '# Title'),
    code('c0', 'value = 0', 'ran 0'),
    code('c1', 'value = 1', 'ran 1'),
    code('c2', 'value = 2', 'ran 2'),
  ]
  await pick(page, notebook(cells))
  await expect(page.locator('.nb-cell').first()).toBeAttached()

  // j/k walk the cells.
  await page.keyboard.press('j')
  await inViewport(page, 'c0')
  await page.keyboard.press('j')
  await inViewport(page, 'c1')
  await page.keyboard.press('k')
  await inViewport(page, 'c0')

  // "/" focuses the search; typing there never fires a shortcut.
  await page.keyboard.press('/')
  const search = page.getByRole('searchbox', { name: 'Search cells' })
  await expect(search).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('0 / 0')
  await page.keyboard.type('ran')
  await expect(page.getByRole('status')).toHaveText('0 / 3')
  const scrollTop = () => page.locator('.nb-root').evaluate((n) => n.scrollTop)
  const before = await scrollTop()
  await page.keyboard.press('j') // typing in the input: no navigation
  expect(await scrollTop()).toBe(before)
  // "ranj" must finish searching first, or the "0 / 3" below can match the old result.
  await expect(page.getByRole('status')).toHaveText('0 / 0')
  await search.fill('ran')
  await expect(page.getByRole('status')).toHaveText('0 / 3')

  // n/N walk the results, wrapping both ways. They only fire outside the input.
  await search.evaluate((node) => node.blur())
  await page.keyboard.press('n')
  await expect(page.getByRole('status')).toHaveText('1 / 3')
  await inViewport(page, 'c0')
  await page.keyboard.press('n')
  await inViewport(page, 'c1')
  await page.keyboard.press('N')
  await inViewport(page, 'c0')
  await page.keyboard.press('N') // wraps backwards
  await inViewport(page, 'c2')

  // "o" toggles outputs only; "c" the changed filter once there is one.
  await page.keyboard.press('o')
  await expect(page.getByRole('button', { name: 'Outputs only' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.nb-cell.nb-markdown')).toHaveCount(0)
  await page.keyboard.press('o')
  await expect(page.locator('.nb-cell.nb-markdown')).toHaveCount(1)

  const newer = notebook([markdown('m0', '# Title'), code('c0', 'value = 0', 'ran 0'), code('c1', 'value = 1 edited', 'ran 1'), code('c2', 'value = 2', 'ran 2')])
  await pick(page, newer)
  await expect(page.getByRole('button', { name: 'Changed (1)', exact: true })).toBeVisible()
  await page.keyboard.press('c')
  await expect(page.getByRole('button', { name: 'Changed (1)', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.nb-cell')).toHaveCount(1)
  await page.keyboard.press('c')
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // "?" shows the list; Esc closes it.
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
})

test('the toolbar works at 320 px: the secondary controls live in the menu', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await pick(page, notebook([markdown('m0', '# Title'), code('c0', 'value = 0', 'ran 0')]))
  await expect(page.locator('.nb-cell').first()).toBeAttached()

  await expect(page.getByRole('button', { name: 'Open notebook' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search cells' })).toBeVisible()
  await expect(page.locator('.tb-file')).toHaveText('toolbar.ipynb')
  await expect(page.locator('.nb-header')).toContainText('python3')

  const menu = page.getByRole('button', { name: 'Menu' })
  await expect(menu).toBeVisible()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Fold all' })).toBeHidden()

  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Fold all' })).toBeVisible()
  await expect(page.getByText(/^Outline \(/)).toBeVisible()

  await page.getByRole('button', { name: 'Fold all' }).click()
  await expect(page.getByRole('button', { name: 'Unfold all' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Unfold all' })).toBeHidden()
})

test('the controls follow the accent, in the dark theme', async ({ page }, testInfo) => {
  // A green accent, not Deska's default one, in a dark theme.
  await stubSdk(page, {
    '--deska-bg': '#101311', '--deska-text': '#e8ece9', '--deska-text-secondary': '#9aa79e',
    '--deska-border': '#33403a', '--deska-surface': '#1a201c', '--deska-surface-raised': '#232b26',
    '--deska-accent': '#0e8a4d', '--deska-on-accent': '#ffffff', '--deska-focus': '#35c281',
  })
  await page.goto('/')
  await pick(page, notebook([markdown('m0', '# Title'), code('c0', 'value = 0', 'ran 0')]))
  await expect(page.locator('.nb-cell').first()).toBeAttached()

  const outputs = page.getByRole('button', { name: 'Outputs only' })
  await outputs.click()
  await expect(outputs).toHaveAttribute('aria-pressed', 'true')
  await expect(outputs).toHaveCSS('background-color', 'rgb(14, 138, 77)')
  await expect(outputs).toHaveCSS('color', 'rgb(255, 255, 255)')

  // The focus ring uses the theme's focus token (keyboard focus, so it is
  // :focus-visible: "/" focuses the search, Shift+Tab the Open button).
  const open = page.getByRole('button', { name: 'Open notebook' })
  await page.keyboard.press('/')
  await page.keyboard.press('Shift+Tab')
  await expect(open).toBeFocused()
  await expect(open).toHaveCSS('outline-color', 'rgb(53, 194, 129)')
  await testInfo.attach('accent-dark', { body: await page.screenshot(), contentType: 'image/png' })
})
