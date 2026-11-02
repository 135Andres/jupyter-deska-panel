import { describe, expect, it, vi } from 'vitest'
import type { Notebook } from '../model/types'
import { jupyterAdapter } from './index'
import { listAdapters } from './registry'

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function notebook(
  cells: unknown[] = [],
  minor = 5,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return { cells, metadata, nbformat: 4, nbformat_minor: minor }
}

async function parse(value: unknown, yieldEvery = 20) {
  return jupyterAdapter.parse(encode(value), { yieldEvery })
}

async function parseOk(value: unknown): Promise<Notebook> {
  const result = await parse(value)
  if (!result.ok) throw new Error(`Unexpected parse error: ${result.error.code}`)
  return result.value
}

describe('Jupyter adapter', () => {
  it('is registered and detects only .ipynb names', () => {
    expect(listAdapters()).toContain(jupyterAdapter)
    expect(jupyterAdapter.detect('notebook.ipynb', new Uint8Array())).toBe(true)
    expect(jupyterAdapter.detect('NOTEBOOK.IPYNB', new Uint8Array())).toBe(true)
    expect(jupyterAdapter.detect('notebook.py', new Uint8Array())).toBe(false)
    expect(jupyterAdapter.detect('notebook.ipynb.txt', new Uint8Array())).toBe(false)
  })

  it.each([0, 1, 2, 3, 4, 5])('parses nbformat 4.%i', async (minor) => {
    const result = await parseOk(notebook([], minor))
    expect(result.format).toEqual({ adapterId: 'jupyter', version: `4.${minor}` })
    expect(result.cells).toEqual([])
  })

  it('joins sources and MIME lines and normalizes all output kinds', async () => {
    const result = await parseOk(
      notebook(
        [
          {
            id: 'code-cell',
            cell_type: 'code',
            source: ['print(', '"answer")'],
            execution_count: 7,
            outputs: [
              {
                output_type: 'execute_result',
                data: {
                  'text/plain': ['4', '2'],
                  'application/json': { answer: 42 },
                },
                metadata: { 'text/plain': { isolated: true } },
              },
              {
                output_type: 'display_data',
                data: {
                  'text/html': ['<b>', 'ok</b>'],
                  'application/json': [1, 2],
                },
              },
              { output_type: 'stream', name: 'stdout', text: ['hello', ' world\n'] },
              {
                output_type: 'error',
                ename: 'ValueError',
                evalue: 'bad value',
                traceback: ['first line', 'second line'],
              },
            ],
          },
        ],
        5,
        {
          title: 'Example',
          language_info: { name: 'python' },
          kernelspec: { name: 'python3', language: 'python' },
        },
      ),
    )

    expect(result.metadata).toEqual({ title: 'Example', kernel: 'python3', language: 'python' })
    expect(result.cells).toEqual([
      {
        id: 'code-cell',
        type: 'code',
        source: 'print("answer")',
        language: 'python',
        executionCount: 7,
        outputs: [
          {
            type: 'mime_bundle',
            data: { 'text/plain': '42', 'application/json': { answer: 42 } },
            metadata: { 'text/plain': { isolated: true } },
          },
          {
            type: 'mime_bundle',
            data: { 'text/html': '<b>ok</b>', 'application/json': [1, 2] },
            metadata: {},
          },
          { type: 'stream', name: 'stdout', text: 'hello world\n' },
          {
            type: 'error',
            ename: 'ValueError',
            evalue: 'bad value',
            traceback: ['first line', 'second line'],
          },
        ],
      },
    ])
  })

  it('turns Markdown attachments into data URIs', async () => {
    const result = await parseOk(
      notebook([
        {
          cell_type: 'markdown',
          source: ['![pixel](', 'attachment:pixel.png)'],
          attachments: { 'pixel.png': { 'image/png': ['aW', '1n'] } },
        },
      ]),
    )

    expect(result.cells[0]?.source).toBe('![pixel](data:image/png;base64,aW1n)')
    expect(result.cells[0]?.outputs).toEqual([])
  })

  it('derives the same missing cell ids from indices on every parse', async () => {
    const input = notebook([
      { cell_type: 'raw', source: 'á' },
      { cell_type: 'markdown', source: 'second' },
    ])

    const first = await parseOk(input)
    const second = await parseOk(input)
    expect(first.cells.map((cell) => cell.id)).toEqual(['cell-0', 'cell-1'])
    expect(second.cells.map((cell) => cell.id)).toEqual(first.cells.map((cell) => cell.id))
    expect(first.cells[0]?.source).toBe('á')
  })

  it('falls back to kernelspec for language and kernel metadata', async () => {
    const result = await parseOk(
      notebook(
        [{ cell_type: 'code', source: 'x <- 1', execution_count: null, outputs: [] }],
        4,
        { kernelspec: { name: 'ir', language: 'R' } },
      ),
    )

    expect(result.metadata).toEqual({ kernel: 'ir', language: 'R' })
    expect(result.cells[0]?.language).toBe('R')
    expect(result.cells[0]?.executionCount).toBeUndefined()
  })

  it('returns unsupported_format for nbformat 3', async () => {
    await expect(parse({ cells: [], nbformat: 3, nbformat_minor: 0 })).resolves.toEqual({
      ok: false,
      error: {
        code: 'unsupported_format',
        message: 'Older notebook format is not supported',
        version: '3.0',
      },
    })
  })

  it('returns invalid_json rather than throwing for malformed bytes', async () => {
    await expect(
      jupyterAdapter.parse(new TextEncoder().encode('{not json'), { yieldEvery: 20 }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_json', message: 'Notebook is not valid JSON' },
    })
  })

  it('returns not_a_notebook for valid JSON without notebook fields', async () => {
    await expect(parse({ hello: 'world' })).resolves.toEqual({
      ok: false,
      error: { code: 'not_a_notebook', message: 'JSON value is not a notebook' },
    })
  })

  it('yields to the main thread after each configured cell chunk', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const cells = Array.from({ length: 5 }, (_, index) => ({
      cell_type: 'raw',
      source: `cell ${index}`,
    }))

    try {
      const result = await parse(notebook(cells), 2)
      expect(result.ok).toBe(true)
      expect(timeout).toHaveBeenCalledTimes(2)
    } finally {
      timeout.mockRestore()
    }
  })

  it('reads run time from execution timestamps or ExecuteTime, and ignores bad ones', async () => {
    const code = (id: string, metadata: unknown) =>
      ({ id, cell_type: 'code', source: '', metadata, execution_count: 1, outputs: [] })
    const nb = await parseOk(notebook([
      code('a', { execution: { 'iopub.execute_input': '2026-01-01T10:00:00.000Z', 'shell.execute_reply': '2026-01-01T10:00:01.500Z' } }),
      code('b', { ExecuteTime: { start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:01:05Z' } }),
      code('c', { execution: { 'iopub.execute_input': '2026-01-01T10:00:05Z', 'shell.execute_reply': '2026-01-01T10:00:00Z' } }),
      code('d', { execution: { 'iopub.execute_input': 'nope' } }),
      code('e', {}),
    ]))
    expect(nb.cells.map((c) => c.durationMs)).toEqual([1500, 65_000, undefined, undefined, undefined])
  })
})
