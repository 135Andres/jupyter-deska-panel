import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// Rendering markdown and HTML output goes through DOMPurify, which is only
// trustworthy against a real DOM (happy-dom's node iterator skips nodes while
// DOMPurify removes them). These tests run in Chromium instead.
const renderModuleUrl =
  '/@fs/' + fileURLToPath(new URL('../src/render/index.ts', import.meta.url))

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('renders markdown with KaTeX and sanitizes it', async ({ page }) => {
  const result = await page.evaluate(async (moduleUrl) => {
    const { mountNotebook } = (await import(moduleUrl)) as typeof import('../src/render/index')
    const host = document.createElement('div')
    document.body.append(host)
    mountNotebook(
      host,
      {
        cells: [
          {
            id: 'm',
            type: 'markdown',
            source: '# Hi\n\n$x^2$ <script>alert(1)</script> [a](javascript:alert(1))\n\n$$\\frac{1}{2}$$',
            outputs: [],
          },
        ],
        metadata: { language: 'python' },
        format: { adapterId: 'jupyter', version: '4.5' },
      },
      { theme: 'dark', locale: 'en' },
    )
    return {
      heading: host.querySelector('h1')?.textContent ?? null,
      katex: host.querySelectorAll('.katex').length,
      html: host.innerHTML,
    }
  }, renderModuleUrl)

  expect(result.heading).toBe('Hi')
  expect(result.katex).toBe(2)
  // The hostile parts survive only as escaped text, never as markup or URLs.
  expect(result.html).not.toMatch(/<script|href="javascript:|on[a-z]+\s*=/i)
})

test('highlights code and picks the best MIME type', async ({ page }) => {
  const result = await page.evaluate(async (moduleUrl) => {
    const { mountNotebook } = (await import(moduleUrl)) as typeof import('../src/render/index')
    const host = document.createElement('div')
    document.body.append(host)
    mountNotebook(
      host,
      {
        cells: [
          {
            id: 'c',
            type: 'code',
            source: 'def f(): pass',
            executionCount: 3,
            outputs: [
              {
                type: 'mime_bundle',
                metadata: {},
                data: {
                  'text/html': '<b onclick="x()">t</b><script>1</script>',
                  'text/plain': 'plain',
                },
              },
            ],
          },
        ],
        metadata: { language: 'python' },
        format: { adapterId: 'jupyter', version: '4.5' },
      },
      { theme: 'dark', locale: 'en' },
    )
    return {
      keyword: host.querySelector('.hljs-keyword') !== null,
      prompt: host.querySelector('.nb-prompt')?.textContent ?? null,
      mimeBold: host.querySelector('.nb-mime b') !== null,
      html: host.innerHTML,
    }
  }, renderModuleUrl)

  expect(result.keyword).toBe(true)
  expect(result.prompt).toBe('[3]')
  expect(result.mimeBold).toBe(true)
  expect(result.html).not.toMatch(/onclick|<script/i)
})
