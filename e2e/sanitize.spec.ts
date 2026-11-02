import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const hostileHtml = readFileSync(
  new URL('../fixtures/hostile/attack.html', import.meta.url),
  'utf8',
)
const hostileSvg = readFileSync(new URL('../fixtures/hostile/attack.svg', import.meta.url), 'utf8')

const FORBIDDEN_OUTPUT =
  /<script|on[a-z]+\s*=|javascript:|<iframe|<object|<form|foreignobject|data:text\/html/i

// The dev server serves from src/app, so the render module is reached through /@fs/.
const sanitizeModuleUrl =
  '/@fs/' + fileURLToPath(new URL('../src/render/sanitize.ts', import.meta.url))

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

for (const [name, fixture, mode] of [
  ['HTML', hostileHtml, 'html'],
  ['SVG', hostileSvg, 'svg'],
] as const) {
  test(`${name} hostile fixture: removes active content and survives DOM insertion and event dispatch`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ moduleUrl, fixture: dirty, mode: kind }) => {
        const module = (await import(moduleUrl)) as typeof import('../src/render/sanitize')
        const sanitize = kind === 'html' ? module.sanitizeHtml : module.sanitizeSvg
        const spyCalls: string[] = []
        ;(globalThis as { __notebookExecutionSpy?: (message: string) => void }).__notebookExecutionSpy = (
          message: string,
        ) => spyCalls.push(message)

        const clean = sanitize(dirty)
        const container = document.createElement('div')
        container.innerHTML = clean
        document.body.append(container)

        for (const element of container.querySelectorAll('*')) {
          for (const type of ['load', 'error']) {
            // No bubbling: an error event reaching window is reported by Vite as "[object Event]".
            element.dispatchEvent(new Event(type, { cancelable: true }))
          }
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          if (element instanceof HTMLAnchorElement) element.click()
        }
        for (const form of container.querySelectorAll('form')) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        }
        await Promise.resolve()
        return { clean, spyCalls }
      },
      { moduleUrl: sanitizeModuleUrl, fixture, mode },
    )

    expect(result.clean).not.toMatch(FORBIDDEN_OUTPUT)
    expect(result.spyCalls).toEqual([])
  })
}

test('keeps benign HTML while removing executable links and forms', async ({ page }) => {
  const clean = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import('../src/render/sanitize')
    return module.sanitizeHtml(
      '<table><tr><td>value</td></tr></table><a href="https://example.com">link</a><form>drop</form>',
    )
  }, sanitizeModuleUrl)

  expect(clean).toContain('<table>')
  expect(clean).toContain('href="https://example.com"')
  expect(clean).not.toContain('form')
})

test('keeps a benign static SVG', async ({ page }) => {
  const clean = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import('../src/render/sanitize')
    return module.sanitizeSvg(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>',
    )
  }, sanitizeModuleUrl)

  expect(clean).toContain('<svg')
  expect(clean).toContain('<circle')
  expect(clean).toContain('fill="currentColor"')
})

test('allows only base64 PNG and JPEG data URIs on embedded images', async ({ page }) => {
  const sources = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import('../src/render/sanitize')
    const container = document.createElement('div')
    container.innerHTML = module.sanitizeHtml(
      '<img id="png" src="data:image/png;base64,iVBORw0KGgo=">' +
        '<img id="remote" src="https://example.com/image.png">' +
        '<img id="svg" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    )
    const images = [...container.querySelectorAll('img')]
    return {
      png: images[0]?.getAttribute('src') ?? null,
      remote: images[1]?.hasAttribute('src') ?? null,
      svg: images[2]?.hasAttribute('src') ?? null,
    }
  }, sanitizeModuleUrl)

  expect(sources.png).toBe('data:image/png;base64,iVBORw0KGgo=')
  expect(sources.remote).toBe(false)
  expect(sources.svg).toBe(false)
})
