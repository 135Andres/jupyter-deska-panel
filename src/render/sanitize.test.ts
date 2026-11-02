import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import hostileHtml from '../../fixtures/hostile/attack.html?raw'
import hostileSvg from '../../fixtures/hostile/attack.svg?raw'
import { sanitizeHtml, sanitizeSvg } from './sanitize'

const FORBIDDEN_OUTPUT =
  /<script|on[a-z]+\s*=|javascript:|<iframe|<object|<form|foreignobject|data:text\/html/i
const executionSpy = vi.fn()

beforeEach(() => {
  executionSpy.mockClear()
  vi.stubGlobal('__notebookExecutionSpy', executionSpy)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe.each([
  ['HTML', hostileHtml, sanitizeHtml],
  ['SVG', hostileSvg, sanitizeSvg],
] as const)('%s hostile fixture', (_name, fixture, sanitize) => {
  test('removes active content and survives DOM insertion and event dispatch', async () => {
    const clean = sanitize(fixture)
    expect(clean).not.toMatch(FORBIDDEN_OUTPUT)

    const container = document.createElement('div')
    container.innerHTML = clean
    document.body.append(container)

    for (const element of container.querySelectorAll('*')) {
      for (const type of ['load', 'error']) {
        element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
      }
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      if (element instanceof HTMLAnchorElement) element.click()
    }
    for (const form of container.querySelectorAll('form')) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }
    await Promise.resolve()

    expect(executionSpy).toHaveBeenCalledTimes(0)
  })
})

test('keeps benign HTML while removing executable links and forms', () => {
  const clean = sanitizeHtml(
    '<table><tr><td>value</td></tr></table><a href="https://example.com">link</a><form>drop</form>',
  )

  expect(clean).toContain('<table>')
  expect(clean).toContain('href="https://example.com"')
  expect(clean).not.toContain('form')
})

test('keeps a benign static SVG', () => {
  const clean = sanitizeSvg(
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>',
  )

  expect(clean).toContain('<svg')
  expect(clean).toContain('<circle')
  expect(clean).toContain('fill="currentColor"')
})

test('allows only base64 PNG and JPEG data URIs on embedded images', () => {
  const container = document.createElement('div')
  container.innerHTML = sanitizeHtml(
    '<img id="png" src="data:image/png;base64,iVBORw0KGgo=">' +
      '<img id="remote" src="https://example.com/image.png">' +
      '<img id="svg" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
  )

  expect(container.querySelector('#png')?.getAttribute('src')).toBe(
    'data:image/png;base64,iVBORw0KGgo=',
  )
  expect(container.querySelector('#remote')?.hasAttribute('src')).toBe(false)
  expect(container.querySelector('#svg')?.hasAttribute('src')).toBe(false)
})
