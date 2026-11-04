import { cellHeadings, outputText } from '../model/navigation'
import type { Cell, CellType, Notebook, Output } from '../model/types'
import type { AgentHost, WriteAnswer } from './actions'

/** A read answer is held to 65,536 characters by Deska; stay under it with room for the fence. */
const MAX_ANSWER_CHARS = 60_000
const MAX_SOURCE_CHARS = 4_000
const MAX_TEXT_CHARS = 4_000
const MAX_ENTRIES = 100
const MAX_IMAGES = 10
const NO_COUNT = -1

export interface CellOutputEntry {
  kind: 'stream' | 'text' | 'error' | 'image'
  text: string
  name: string
  ename: string
  evalue: string
  /** A deska.files id Deska turns into an image for the agent; empty when the PNG is only described. */
  imageId: string
  description: string
}

export interface CellAnswer {
  found: boolean
  message: string
  id: string
  index: number
  type: CellType
  language: string
  executionCount: number
  durationMs: number
  source: string
  truncated: boolean
  outputs: CellOutputEntry[]
}

export interface OutlineAnswer {
  total: number
  truncated: boolean
  headings: { level: number; title: string; id: string; index: number }[]
}

export interface FindAnswer {
  total: number
  truncated: boolean
  cells: { id: string; index: number; fragment: string }[]
}

export interface ErrorsAnswer {
  total: number
  truncated: boolean
  cells: { id: string; index: number; ename: string; evalue: string }[]
}

const NOT_OPEN: CellAnswer = {
  found: false,
  message: 'No notebook is open.',
  id: '', index: 0, type: 'raw', language: '', executionCount: NO_COUNT, durationMs: NO_COUNT,
  source: '', truncated: false, outputs: [],
}

const cut = (text: string, max: number) => text.length > max ? text.slice(0, max) : text

/** Tracebacks reach the panel with ANSI colour codes; the agent wants the text alone. */
export function stripAnsi(text: string): string {
  if (!text.includes('\u001b[')) return text
  // Cut each escape sequence: CSI, its parameters, then its final letter.
  return text.split('\u001b[').map((part, i) => i === 0 ? part : part.replace(/^[0-9;]*[A-Za-z]/, '')).join('')
}

function findCell(notebook: Notebook, input: Record<string, unknown>): { cell: Cell; index: number } | null {
  const { id, index } = input
  if (id !== undefined) {
    const at = notebook.cells.findIndex((cell) => cell.id === id)
    return at >= 0 ? { cell: notebook.cells[at]!, index: at } : null
  }
  if (typeof index === 'number' && Number.isInteger(index)) {
    const cell = notebook.cells[index]
    return cell ? { cell, index } : null
  }
  return null
}

function imageDescription(output: Extract<Output, { type: 'mime_bundle' }>): string {
  const meta = output.metadata['image/png']
  const size = meta && typeof meta === 'object' && 'width' in meta && 'height' in meta
    ? `, ${(meta as { width: number }).width}x${(meta as { height: number }).height} px`
    : ''
  return `PNG image output${size}`
}

function decodePng(data: unknown): Uint8Array | null {
  if (typeof data !== 'string' || data.length === 0) return null
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function cellOutputs(host: AgentHost, cell: Cell): Promise<CellOutputEntry[]> {
  const entries: CellOutputEntry[] = []
  let images = 0
  for (const output of cell.outputs) {
    if (output.type === 'stream') {
      entries.push({ kind: 'stream', text: cut(output.text, MAX_TEXT_CHARS), name: output.name, ename: '', evalue: '', imageId: '', description: '' })
      continue
    }
    if (output.type === 'error') {
      entries.push({
        kind: 'error',
        text: cut(stripAnsi(output.traceback.join('\n')), MAX_TEXT_CHARS),
        name: '', ename: output.ename, evalue: cut(output.evalue, 1_000), imageId: '', description: '',
      })
      continue
    }
    const plain = Object.entries(output.data).filter(([mime]) => mime.startsWith('text/'))
      .map(([, value]) => typeof value === 'string' ? value : Array.isArray(value) ? value.join('') : '')
      .join('\n')
    if (plain.trim() !== '') {
      entries.push({ kind: 'text', text: cut(plain, MAX_TEXT_CHARS), name: '', ename: '', evalue: '', imageId: '', description: '' })
    }
    const png = decodePng(output.data['image/png'])
    if (png) {
      const description = imageDescription(output)
      // The docs allow images in a read answer, as a deska.files id; without deska.files, describe it.
      const imageId = images < MAX_IMAGES ? await host.putImage?.(png).catch(() => null) ?? null : null
      if (imageId) images++
      entries.push({ kind: 'image', text: '', name: '', ename: '', evalue: '', imageId: imageId ?? '', description })
    }
  }
  return entries
}

/** get_cell: one cell by id or index, with its source and its outputs as text (and PNG images). */
export async function getCell(host: AgentHost, input: Record<string, unknown>): Promise<CellAnswer> {
  const notebook = host.notebook()
  if (!notebook) return NOT_OPEN
  const { id, index } = input
  if ((id === undefined) === (index === undefined)) {
    return { ...NOT_OPEN, message: 'Give exactly one of id and index.' }
  }
  const found = findCell(notebook, input)
  if (!found) return { ...NOT_OPEN, message: 'No cell with that id or index.' }
  const { cell, index: at } = found
  const answer: CellAnswer = {
    found: true,
    message: '',
    id: cell.id,
    index: at,
    type: cell.type,
    language: cell.language ?? '',
    executionCount: cell.executionCount ?? NO_COUNT,
    durationMs: cell.durationMs ?? NO_COUNT,
    source: cut(cell.source, MAX_SOURCE_CHARS),
    truncated: cell.source.length > MAX_SOURCE_CHARS,
    outputs: await cellOutputs(host, cell),
  }
  // Deska refuses an answer past its size limit: cut whole outputs and say so.
  while (JSON.stringify(answer).length > MAX_ANSWER_CHARS && answer.outputs.length > 0) {
    answer.outputs.pop()
    answer.truncated = true
  }
  if (answer.truncated) answer.message = 'The source or some outputs were cut to fit the answer size limit.'
  return answer
}

/** get_outline: the Markdown headings, the same titles the panel's outline shows. */
export function getOutline(host: AgentHost): OutlineAnswer {
  const notebook = host.notebook()
  if (!notebook) return { total: 0, truncated: false, headings: [] }
  const headings = notebook.cells.flatMap((cell, index) =>
    cellHeadings(cell).map((heading) => ({ level: heading.level, title: cut(heading.title, 200), id: cell.id, index })))
  return {
    total: headings.length,
    truncated: headings.length > MAX_ENTRIES,
    headings: headings.slice(0, MAX_ENTRIES),
  }
}

/** The text find_cells and the panel's search both look at. */
function searchableText(cell: Cell): string {
  return [cell.source, ...cell.outputs.map(outputText)].join('\n')
}

function fragment(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return ''
  const start = Math.max(0, at - 80)
  return cut((start > 0 ? '…' : '') + text.slice(start, at + needle.length + 80), 200)
}

/** find_cells: the panel's search, answered with the matching cells and a fragment of each match. */
export function findCells(host: AgentHost, input: Record<string, unknown>): FindAnswer {
  const notebook = host.notebook()
  const query = typeof input['query'] === 'string' ? input['query'].trim() : ''
  if (!notebook || query === '') return { total: 0, truncated: false, cells: [] }
  const limit = typeof input['max'] === 'number' ? Math.min(input['max'], MAX_ENTRIES) : MAX_ENTRIES
  const cells: FindAnswer['cells'] = []
  for (const [index, cell] of notebook.cells.entries()) {
    const text = searchableText(cell)
    if (text.toLowerCase().includes(query.toLowerCase())) {
      cells.push({ id: cell.id, index, fragment: fragment(text, query) })
    }
  }
  return { total: cells.length, truncated: cells.length > limit, cells: cells.slice(0, limit) }
}

/** list_errors: the cells whose output is an error. */
export function listErrors(host: AgentHost): ErrorsAnswer {
  const notebook = host.notebook()
  if (!notebook) return { total: 0, truncated: false, cells: [] }
  const cells: ErrorsAnswer['cells'] = []
  for (const [index, cell] of notebook.cells.entries()) {
    const failure = cell.outputs.find((output) => output.type === 'error')
    if (failure?.type === 'error') cells.push({ id: cell.id, index, ename: cut(failure.ename, 200), evalue: cut(failure.evalue, 1_000) })
  }
  return { total: cells.length, truncated: cells.length > MAX_ENTRIES, cells: cells.slice(0, MAX_ENTRIES) }
}

/** set_view: the "Changed" filter and the "Outputs only" mode, so the agent can show what changed. */
export function setView(host: AgentHost, input: Record<string, unknown>): WriteAnswer {
  const filter = input['filter'] === 'all' || input['filter'] === 'changed' ? input['filter'] : undefined
  const mode = input['mode'] === 'all' || input['mode'] === 'outputs' ? input['mode'] : undefined
  if (!filter && !mode) return { ok: false, error: 'invalid' }
  if (filter === 'changed') {
    const changes = host.changes()
    if (!changes || changes.changed.length === 0) return { ok: false, error: 'conflict' }
  }
  host.setView?.(filter, mode)
  return { ok: true }
}
