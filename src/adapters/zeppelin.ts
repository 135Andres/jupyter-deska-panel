import type { Adapter, Cell, NotebookMetadata, Output, ParseError, Result } from '../model/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Interpreter name (without the `%`) to the language that highlights it. */
const LANGUAGES: Record<string, string> = {
  spark: 'scala',
  'spark.pyspark': 'python',
  pyspark: 'python',
  python: 'python',
  'python.ipython': 'python',
  ipython: 'python',
  'spark.sql': 'sql',
  sql: 'sql',
  jdbc: 'sql',
  'spark.r': 'r',
  'spark.ir': 'r',
  r: 'r',
  sh: 'bash',
  flink: 'scala',
  scala: 'scala',
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Zeppelin TABLE results are tab-separated text; show them as an HTML table. */
function tableHtml(data: string): string {
  const rows = data.replace(/\n+$/, '').split('\n').map((row) => row.split('\t'))
  const cell = (tag: string, value: string) => `<${tag}>${escapeHtml(value)}</${tag}>`
  const [head = [], ...body] = rows
  return (
    `<table><thead><tr>${head.map((v) => cell('th', v)).join('')}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr>${r.map((v) => cell('td', v)).join('')}</tr>`).join('')}</tbody></table>`
  )
}

function normalizeResults(results: unknown): Output[] {
  if (!isRecord(results) || !Array.isArray(results.msg)) return []
  const failed = results.code === 'ERROR'
  const outputs: Output[] = []
  for (const msg of results.msg) {
    if (!isRecord(msg) || typeof msg.data !== 'string') continue
    const bundle = (data: Record<string, unknown>): Output => ({ type: 'mime_bundle', data, metadata: {} })
    switch (msg.type) {
      case 'TEXT':
        if (failed) {
          const lines = msg.data.split('\n')
          outputs.push({
            type: 'error',
            ename: 'Error',
            evalue: lines.find((line) => line.trim() !== '')?.trim() ?? '',
            traceback: lines,
          })
        } else outputs.push({ type: 'stream', name: 'stdout', text: msg.data })
        break
      case 'HTML':
      case 'ANGULAR':
        outputs.push(bundle({ 'text/html': msg.data }))
        break
      case 'TABLE':
        outputs.push(bundle({ 'text/html': tableHtml(msg.data), 'text/plain': msg.data }))
        break
      case 'IMG':
        outputs.push(bundle({ 'image/png': msg.data }))
        break
      default:
        outputs.push(bundle({ 'text/plain': msg.data }))
    }
  }
  return outputs
}

function timeMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

function normalizeParagraph(value: unknown, index: number): Cell | undefined {
  if (!isRecord(value)) return undefined
  const text = typeof value.text === 'string' ? value.text : ''
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : undefined
  const identity = { id: id ?? `cell-${index}`, ...(id === undefined ? { generatedId: true } : {}) }

  // `%interpreter` (optionally with `(props)` or text after it) opens the paragraph.
  const magic = /^\s*%([\w.]+)(?:\([^)]*\))?[ \t]*(?:\r?\n)?/.exec(text)
  const interpreter = magic?.[1]?.toLowerCase()
  const body = magic ? text.slice(magic[0].length) : text
  if (interpreter === 'md') return { ...identity, type: 'markdown', source: body.trim(), outputs: [] }

  const config = isRecord(value.config) ? value.config : {}
  const editor = isRecord(config.editorSetting) ? config.editorSetting : {}
  const language =
    (interpreter !== undefined ? LANGUAGES[interpreter] : undefined) ??
    (typeof editor.language === 'string' ? editor.language : undefined)

  const cell: Cell = { ...identity, type: 'code', source: body.replace(/\s+$/, ''), outputs: normalizeResults(value.results) }
  if (language !== undefined) cell.language = language
  const start = timeMs(value.dateStarted)
  const end = timeMs(value.dateFinished)
  if (start !== undefined && end !== undefined && end >= start) cell.durationMs = end - start
  return cell
}

function error(code: ParseError['code'], message: string): Result<never, ParseError> {
  return { ok: false, error: { code, message } as ParseError }
}

/** Reads an Apache Zeppelin `.zpln` note, outputs included. */
export const zeppelinAdapter: Adapter = {
  id: 'zeppelin',
  label: 'Zeppelin note',
  extensions: ['.zpln'],
  detect: (name) => name.toLowerCase().endsWith('.zpln'),
  parse: async (bytes, options) => {
    let input: unknown
    try {
      input = JSON.parse(new TextDecoder('utf-8').decode(bytes))
    } catch {
      return error('invalid_json', 'Note is not valid JSON')
    }
    if (!isRecord(input) || !Array.isArray(input.paragraphs)) {
      return error('not_a_notebook', 'JSON value is not a Zeppelin note')
    }

    const yieldEvery =
      Number.isFinite(options.yieldEvery) && options.yieldEvery > 0 ? Math.floor(options.yieldEvery) : 0
    const cells: Cell[] = []
    for (let index = 0; index < input.paragraphs.length; index += 1) {
      if (yieldEvery > 0 && index > 0 && index % yieldEvery === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      const cell = normalizeParagraph(input.paragraphs[index], index)
      if (cell === undefined) return error('not_a_notebook', 'Note contains an invalid paragraph')
      cells.push(cell)
    }

    const metadata: NotebookMetadata = {}
    const language = cells.find((cell) => cell.type === 'code' && cell.language !== undefined)?.language
    if (language !== undefined) metadata.language = language
    if (typeof input.name === 'string' && input.name !== '') metadata.title = input.name
    const version = typeof input.version === 'string' ? input.version : '1'
    return { ok: true, value: { cells, metadata, format: { adapterId: 'zeppelin', version } } }
  },
} satisfies Adapter
