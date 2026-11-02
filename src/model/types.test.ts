import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  Cell,
  CellType,
  ErrorOutput,
  MimeBundleOutput,
  Notebook,
  Output,
  ParseError,
  ParseErrorCode,
  Result,
  StreamOutput,
} from './types'

describe('notebook model types', () => {
  it('constructs a notebook with every cell kind', () => {
    const cells: Cell[] = [
      { id: 'markdown-1', type: 'markdown', source: '# Example', outputs: [] },
      {
        id: 'code-1',
        type: 'code',
        source: 'print("hello")',
        language: 'python',
        executionCount: 1,
        outputs: [],
      },
      { id: 'raw-1', type: 'raw', source: 'Raw text', outputs: [] },
    ]
    const notebook: Notebook = {
      cells,
      metadata: { kernel: 'python3', language: 'python', title: 'Example' },
      format: { adapterId: 'jupyter', version: '4.5' },
    }

    expectTypeOf(cells.map((cell) => cell.type)).toEqualTypeOf<CellType[]>()
    expect(notebook.cells).toHaveLength(3)
    expect(notebook.format.version).toBe('4.5')
  })

  it('constructs every output variant', () => {
    const mimeBundle: MimeBundleOutput = {
      type: 'mime_bundle',
      data: { 'text/plain': '42' },
      metadata: { 'text/plain': { isolated: true } },
    }
    const stream: StreamOutput = { type: 'stream', name: 'stdout', text: 'hello\n' }
    const error: ErrorOutput = {
      type: 'error',
      ename: 'ValueError',
      evalue: 'bad value',
      traceback: ['ValueError: bad value'],
    }
    const outputs: Output[] = [mimeBundle, stream, error]

    expectTypeOf<Output>().toEqualTypeOf<MimeBundleOutput | StreamOutput | ErrorOutput>()
    expect(outputs.map((output) => output.type)).toEqual(['mime_bundle', 'stream', 'error'])
  })

  it('constructs every parse error code', () => {
    const invalidJson: ParseError = { code: 'invalid_json', message: 'Invalid JSON' }
    const unsupportedFormat: ParseError = {
      code: 'unsupported_format',
      message: 'Unsupported notebook format',
      version: '3.0',
    }
    const notANotebook: ParseError = { code: 'not_a_notebook', message: 'Not a notebook' }

    expectTypeOf<ParseError['code']>().toEqualTypeOf<ParseErrorCode>()
    expectTypeOf<ParseErrorCode>().toEqualTypeOf<
      'invalid_json' | 'unsupported_format' | 'not_a_notebook'
    >()
    expect([invalidJson.code, unsupportedFormat.code, notANotebook.code]).toEqual([
      'invalid_json',
      'unsupported_format',
      'not_a_notebook',
    ])
    if (unsupportedFormat.code === 'unsupported_format') {
      expectTypeOf(unsupportedFormat.version).toEqualTypeOf<string>()
      expect(unsupportedFormat.version).toBe('3.0')
    }
  })

  it('constructs successful and failed results', () => {
    const notebook: Notebook = { cells: [], metadata: {}, format: { adapterId: 'fake', version: '1' } }
    const ok: Result<Notebook, ParseError> = { ok: true, value: notebook }
    const err: Result<Notebook, ParseError> = {
      ok: false,
      error: { code: 'not_a_notebook', message: 'Not a notebook' },
    }

    expectTypeOf<Result<Notebook, ParseError>>().toEqualTypeOf<
      { ok: true; value: Notebook } | { ok: false; error: ParseError }
    >()
    const checkNarrowing = (result: Result<Notebook, ParseError>) => {
      if (result.ok) {
        expectTypeOf(result.value).toEqualTypeOf<Notebook>()
      } else {
        expectTypeOf(result.error).toEqualTypeOf<ParseError>()
      }
    }
    checkNarrowing(ok)
    checkNarrowing(err)
    expect(ok).toEqual({ ok: true, value: notebook })
    expect(err).toEqual({ ok: false, error: { code: 'not_a_notebook', message: 'Not a notebook' } })
  })
})
