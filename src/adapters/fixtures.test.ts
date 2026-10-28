import { describe, expect, it } from 'vitest'
import {
  generateLargeNotebook,
  generateMixedNotebook,
  LARGE_NOTEBOOK_BYTES,
  MIXED_CELL_COUNT,
} from '../../fixtures/notebooks/generate'
import invalidJson from '../../fixtures/notebooks/invalid-json.ipynb?raw'
import nbformat3 from '../../fixtures/notebooks/nbformat3.ipynb?raw'
import plotlyNoFallback from '../../fixtures/notebooks/plotly-no-fallback.ipynb?raw'
import plotlyWithFallback from '../../fixtures/notebooks/plotly-with-fallback.ipynb?raw'
import richOutputs from '../../fixtures/notebooks/rich-outputs.ipynb?raw'
import streamAndTraceback from '../../fixtures/notebooks/stream-and-traceback.ipynb?raw'

interface FixtureOutput {
  output_type: string
  name?: string
  text?: string | string[]
  data?: Record<string, unknown>
  traceback?: string[]
  ename?: string
}

interface FixtureCell {
  cell_type: string
  id?: string
  metadata: Record<string, unknown>
  source: string | string[]
  outputs?: FixtureOutput[]
}

interface FixtureNotebook {
  nbformat: number
  nbformat_minor: number
  metadata: Record<string, unknown>
  cells?: FixtureCell[]
  worksheets?: { cells: FixtureCell[] }[]
}

/** Parses a fixture that is expected to be valid JSON. */
function parseFixture(raw: string): FixtureNotebook {
  return JSON.parse(raw) as FixtureNotebook
}

/** Joins a Jupyter string-or-string-list value into one string. */
function textOf(value: unknown): string {
  return Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : ''
}

/** Every output of every cell in a notebook. */
function allOutputs(notebook: FixtureNotebook): FixtureOutput[] {
  return (notebook.cells ?? []).flatMap((cell) => cell.outputs ?? [])
}

/** The outputs of one type. */
function outputsOfType(notebook: FixtureNotebook, type: string): FixtureOutput[] {
  return allOutputs(notebook).filter((output) => output.output_type === type)
}

/** Decodes a base64 string into bytes. */
function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const validFixtures: [string, string][] = [
  ['rich-outputs.ipynb', richOutputs],
  ['stream-and-traceback.ipynb', streamAndTraceback],
  ['plotly-with-fallback.ipynb', plotlyWithFallback],
  ['plotly-no-fallback.ipynb', plotlyNoFallback],
]

describe('notebook fixtures', () => {
  it.each(validFixtures)('parses %s as a well-formed nbformat 4 notebook', (name, raw) => {
    const notebook = parseFixture(raw)

    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBeGreaterThanOrEqual(0)
    expect(notebook.nbformat_minor).toBeLessThanOrEqual(5)
    expect(notebook.metadata).toBeTypeOf('object')
    expect(notebook.cells?.length).toBeGreaterThan(0)

    for (const cell of notebook.cells ?? []) {
      expect(['markdown', 'code', 'raw']).toContain(cell.cell_type)
      expect(cell.metadata).toBeTypeOf('object')
      expect(typeof cell.source === 'string' || Array.isArray(cell.source)).toBe(true)
      // nbformat 4.5 requires a cell id: letters, digits, hyphen and underscore.
      expect(cell.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      if (cell.cell_type === 'code') expect(Array.isArray(cell.outputs)).toBe(true)
    }

    expect(name.endsWith('.ipynb')).toBe(true)
  })

  it('has the rich outputs the renderer draws', () => {
    const notebook = parseFixture(richOutputs)
    const outputs = allOutputs(notebook)

    const htmlOutput = outputs.find((output) => output.data?.['text/html'] !== undefined)
    const html = textOf(htmlOutput?.data?.['text/html'])
    expect(html).toContain('<table')
    expect(html).toContain('class="dataframe"')
    expect(html).toContain('alpha')

    const pngOutput = outputs.find((output) => output.data?.['image/png'] !== undefined)
    const pngBase64 = pngOutput?.data?.['image/png']
    expect(pngBase64).toBeTypeOf('string')
    const png = decodeBase64(pngBase64 as string)
    expect(Array.from(png.subarray(0, 8))).toEqual(PNG_SIGNATURE)
    // IHDR width and height: a real 2x2 image.
    expect(Array.from(png.subarray(16, 24))).toEqual([0, 0, 0, 2, 0, 0, 0, 2])

    const svgOutput = outputs.find((output) => output.data?.['image/svg+xml'] !== undefined)
    const svg = textOf(svgOutput?.data?.['image/svg+xml'])
    expect(svg.trimStart().startsWith('<svg')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toMatch(/<script/i)
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i)

    const markdown = (notebook.cells ?? [])
      .filter((cell) => cell.cell_type === 'markdown')
      .map((cell) => textOf(cell.source))
      .join('\n')
    expect(markdown).toContain('$e^{i\\pi} + 1 = 0$')
    expect(markdown).toContain('\\int_0^1 x^2\\,dx = \\frac{1}{3}')
  })

  it('has a stdout stream, a stderr stream and an ANSI traceback', () => {
    const notebook = parseFixture(streamAndTraceback)
    const streams = outputsOfType(notebook, 'stream')
    expect(streams.map((output) => output.name)).toEqual(['stdout', 'stderr'])
    expect(textOf(streams[0]?.text)).toBe('first line\nsecond line\nthird line\n')
    expect(textOf(streams[1]?.text)).toContain('stderr')

    const errors = outputsOfType(notebook, 'error')
    expect(errors).toHaveLength(1)
    const [error] = errors
    expect(error?.ename).toBe('ValueError')
    expect(error?.traceback?.length).toBeGreaterThan(0)
    const traceback = (error?.traceback ?? []).join('\n')
    // Real ESC bytes after JSON parsing, not the literal text "\u001b".
    expect(traceback).toContain('\u001b[0;31m')
    expect(traceback).toContain('\u001b[0m')
    expect(traceback).toContain('bad value: 42')
  })

  it('carries Plotly output with and without a PNG fallback', () => {
    const withFallback = parseFixture(plotlyWithFallback)
    const withFallbackOutput = allOutputs(withFallback).find(
      (output) => output.data?.['application/vnd.plotly.v1+json'] !== undefined,
    )
    expect(withFallbackOutput).toBeDefined()
    expect(withFallbackOutput?.data?.['image/png']).toBeTypeOf('string')
    expect(textOf(withFallbackOutput?.data?.['text/plain'])).toContain('Figure')

    const noFallback = parseFixture(plotlyNoFallback)
    const noFallbackOutput = allOutputs(noFallback).find(
      (output) => output.data?.['application/vnd.plotly.v1+json'] !== undefined,
    )
    expect(noFallbackOutput).toBeDefined()
    expect(noFallbackOutput?.data).not.toHaveProperty('image/png')
    expect(textOf(noFallbackOutput?.data?.['text/plain'])).toContain('Figure')
  })

  it('keeps every fixture under the 200 KB budget', () => {
    const fixtures: Record<string, string> = {
      ...Object.fromEntries(validFixtures),
      'invalid-json.ipynb': invalidJson,
      'nbformat3.ipynb': nbformat3,
    }
    for (const [name, raw] of Object.entries(fixtures)) {
      expect(new TextEncoder().encode(raw).byteLength, name).toBeLessThan(200 * 1024)
    }
  })

  it('rejects the invalid JSON fixture', () => {
    expect(() => JSON.parse(invalidJson)).toThrow(SyntaxError)
  })

  it('keeps the nbformat 3 fixture at version 3', () => {
    const notebook = parseFixture(nbformat3)
    expect(notebook.nbformat).toBe(3)
    expect(notebook.nbformat_minor).toBe(0)
    expect(notebook.worksheets).toHaveLength(1)
    expect(notebook.worksheets?.[0]?.cells.length).toBeGreaterThan(0)
    expect(notebook.cells).toBeUndefined()
  })
})

describe('notebook generator', () => {
  it('generates a 10,000-cell notebook of mixed kinds and outputs', () => {
    const bytes = generateMixedNotebook()
    const notebook = parseFixture(new TextDecoder().decode(bytes))

    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(5)
    expect(notebook.cells).toHaveLength(MIXED_CELL_COUNT)
    expect(MIXED_CELL_COUNT).toBe(10_000)

    const cells = notebook.cells ?? []
    expect(new Set(cells.map((cell) => cell.cell_type))).toEqual(new Set(['markdown', 'code']))
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(MIXED_CELL_COUNT)

    const codeCells = cells.filter((cell) => cell.cell_type === 'code')
    expect(codeCells.length).toBe(MIXED_CELL_COUNT / 2)
    expect(codeCells.every((cell) => (cell.outputs?.length ?? 0) > 0)).toBe(true)
    expect(codeCells.every((cell) => typeof cell.id === 'string')).toBe(true)
    expect(outputsOfType(notebook, 'stream').length).toBe(codeCells.length)
    expect(
      allOutputs(notebook).some((output) => output.data?.['text/html'] !== undefined),
    ).toBe(true)
  })

  it('is deterministic for the same parameters', () => {
    const first = generateMixedNotebook(300)
    const second = generateMixedNotebook(300)
    expect(new TextDecoder().decode(first)).toBe(new TextDecoder().decode(second))
    expect(parseFixture(new TextDecoder().decode(first)).cells).toHaveLength(300)

    const smallLarge = generateLargeNotebook(64 * 1024)
    expect(new TextDecoder().decode(smallLarge)).toBe(
      new TextDecoder().decode(generateLargeNotebook(64 * 1024)),
    )
    expect(smallLarge.byteLength).toBeGreaterThan(64 * 1024)
    expect(parseFixture(new TextDecoder().decode(smallLarge)).nbformat).toBe(4)
  })

  it(
    'generates a notebook larger than 50 MiB',
    () => {
      const bytes = generateLargeNotebook()

      expect(bytes.byteLength).toBeGreaterThan(50 * 1024 * 1024)
      expect(bytes.byteLength).toBeGreaterThanOrEqual(LARGE_NOTEBOOK_BYTES)
      const text = new TextDecoder().decode(bytes)
      expect(text.startsWith('{"cells":[')).toBe(true)
      expect(text.endsWith('}')).toBe(true)
      expect(text).toContain('"nbformat":4,"nbformat_minor":5')
    },
    60_000,
  )
})
