import type {
  Adapter,
  Cell,
  NotebookMetadata,
  Output,
  ParseError,
  Result,
} from '../model/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinedText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((line) => typeof line === 'string')) {
    return value.join('')
  }
  return undefined
}

function inlineAttachments(source: string, attachments: unknown): string {
  if (!isRecord(attachments)) return source

  let inlined = source
  for (const [name, bundle] of Object.entries(attachments)) {
    if (!isRecord(bundle)) continue
    for (const [mime, value] of Object.entries(bundle)) {
      const encoded = joinedText(value)
      if (encoded === undefined) continue
      inlined = inlined.split(`attachment:${name}`).join(`data:${mime};base64,${encoded}`)
      break
    }
  }
  return inlined
}

function normalizeOutput(output: unknown): Output | undefined {
  if (!isRecord(output)) return undefined

  switch (output.output_type) {
    case 'execute_result':
    case 'display_data': {
      const data = isRecord(output.data)
        ? Object.fromEntries(
            Object.entries(output.data).map(([mime, value]) => [
              mime,
              mime !== 'application/json' &&
              !mime.endsWith('+json') &&
              Array.isArray(value) &&
              value.every((line) => typeof line === 'string')
                ? value.join('')
                : value,
            ]),
          )
        : {}
      return {
        type: 'mime_bundle',
        data,
        metadata: isRecord(output.metadata) ? output.metadata : {},
      }
    }
    case 'stream':
      return {
        type: 'stream',
        name: typeof output.name === 'string' ? output.name : '',
        text: joinedText(output.text) ?? '',
      }
    case 'error':
      return {
        type: 'error',
        ename: typeof output.ename === 'string' ? output.ename : '',
        evalue: typeof output.evalue === 'string' ? output.evalue : '',
        traceback: Array.isArray(output.traceback)
          ? output.traceback.filter((line): line is string => typeof line === 'string')
          : [],
      }
    default:
      return undefined
  }
}

function normalizeCell(value: unknown, index: number, language?: string): Cell | undefined {
  if (!isRecord(value)) return undefined
  const type = value.cell_type
  if (type !== 'markdown' && type !== 'code' && type !== 'raw') return undefined

  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : `cell-${index}`
  const identity = { id, ...(id !== value.id ? { generatedId: true } : {}) }
  const source = joinedText(value.source) ?? ''
  if (type === 'markdown') {
    return { ...identity, type, source: inlineAttachments(source, value.attachments), outputs: [] }
  }
  if (type === 'raw') return { ...identity, type, source, outputs: [] }

  const cell: Cell = {
    ...identity,
    type,
    source,
    outputs: Array.isArray(value.outputs)
      ? value.outputs
          .map(normalizeOutput)
          .filter((output): output is Output => output !== undefined)
      : [],
  }
  if (language !== undefined) cell.language = language
  if (typeof value.execution_count === 'number') cell.executionCount = value.execution_count
  const durationMs = durationOf(value.metadata)
  if (durationMs !== undefined) cell.durationMs = durationMs
  return cell
}

function timeMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/** Run time from VS Code/Jupyter `execution` timestamps or the ExecuteTime extension. */
function durationOf(metadata: unknown): number | undefined {
  if (!isRecord(metadata)) return undefined
  let start: number | undefined
  let end: number | undefined
  if (isRecord(metadata.execution)) {
    start = timeMs(metadata.execution['iopub.execute_input']) ?? timeMs(metadata.execution['iopub.status.busy'])
    end = timeMs(metadata.execution['shell.execute_reply']) ?? timeMs(metadata.execution['iopub.status.idle'])
  } else if (isRecord(metadata.ExecuteTime)) {
    start = timeMs(metadata.ExecuteTime.start_time)
    end = timeMs(metadata.ExecuteTime.end_time)
  }
  if (start === undefined || end === undefined || end < start) return undefined
  return end - start
}

function error(code: ParseError['code'], message: string, version?: string): Result<never, ParseError> {
  if (code === 'unsupported_format') {
    return { ok: false, error: { code, message, version: version ?? 'unknown' } }
  }
  return { ok: false, error: { code, message } }
}

/** Reads Jupyter nbformat 4.0 through 4.5 without executing notebook content. */
export const jupyterAdapter: Adapter = {
  id: 'jupyter',
  label: 'Jupyter notebook',
  extensions: ['.ipynb'],
  detect: (name) => name.toLowerCase().endsWith('.ipynb'),
  parse: async (bytes, options) => {
    try {
      const input: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes))
      if (!isRecord(input)) return error('not_a_notebook', 'JSON value is not a notebook')

      const major = input.nbformat
      const minor = input.nbformat_minor
      if (major === 3) {
        return error(
          'unsupported_format',
          'Older notebook format is not supported',
          `3.${typeof minor === 'number' ? minor : 0}`,
        )
      }
      if (typeof major !== 'number' || typeof minor !== 'number') {
        return error('not_a_notebook', 'JSON value is not a notebook')
      }
      if (major !== 4 || !Number.isInteger(minor) || minor < 0 || minor > 5) {
        return error('unsupported_format', 'Notebook format is not supported', `${major}.${minor}`)
      }
      if (!Array.isArray(input.cells)) {
        return error('not_a_notebook', 'Notebook has no cell list')
      }

      const rawMetadata = isRecord(input.metadata) ? input.metadata : {}
      const languageInfo = isRecord(rawMetadata.language_info) ? rawMetadata.language_info : {}
      const kernelSpec = isRecord(rawMetadata.kernelspec) ? rawMetadata.kernelspec : {}
      const language =
        typeof languageInfo.name === 'string'
          ? languageInfo.name
          : typeof kernelSpec.language === 'string'
            ? kernelSpec.language
            : undefined
      const metadata: NotebookMetadata = {}
      if (typeof kernelSpec.name === 'string') metadata.kernel = kernelSpec.name
      if (language !== undefined) metadata.language = language
      if (typeof rawMetadata.title === 'string') metadata.title = rawMetadata.title

      const cells: Cell[] = []
      const yieldEvery =
        Number.isFinite(options.yieldEvery) && options.yieldEvery > 0
          ? Math.floor(options.yieldEvery)
          : 0
      for (let index = 0; index < input.cells.length; index += 1) {
        if (yieldEvery > 0 && index > 0 && index % yieldEvery === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        const cell = normalizeCell(input.cells[index], index, language)
        if (cell === undefined) return error('not_a_notebook', 'Notebook contains an invalid cell')
        cells.push(cell)
      }

      return {
        ok: true,
        value: {
          cells,
          metadata,
          format: { adapterId: 'jupyter', version: `${major}.${minor}` },
        },
      }
    } catch {
      return error('invalid_json', 'Notebook is not valid JSON')
    }
  },
} satisfies Adapter
