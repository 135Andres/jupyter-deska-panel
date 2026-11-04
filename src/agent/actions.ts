import type { Cell, Notebook } from '../model/types'

/** What the actions need from the page. The model stays free of the DOM and of Deska. */
export interface AgentHost {
  /**
   * Resolves when the panel has finished restoring the last notebook from the
   * host. A call that arrives earlier — on a slow host, before `ready()` even
   * answers — waits here instead of being told the notebook is not there.
   */
  ready?(): Promise<void>
  notebook(): Notebook | null
  /** Brings the cell into view, undoing any filter that hides it. */
  scrollTo(id: string): void
  highlight(id: string, ms: number): void
  /** The cells that differ from the previous copy; null when there was no comparison. */
  changes(): { changed: IndexedCell[]; deleted: IndexedCell[] } | null
}

export interface IndexedCell { cell: Cell; index: number }

export type WriteError = 'invalid' | 'conflict' | 'not_found' | 'failed'
export type WriteAnswer = { ok: true } | { ok: false; error: WriteError }

export interface ChangeEntry {
  id: string
  index: number
  type: Cell['type']
  status: 'changed' | 'deleted'
  summary: string
}
export interface ChangesAnswer {
  available: boolean
  message: string
  total: number
  truncated: boolean
  cells: ChangeEntry[]
}

export const ACTION_KINDS: Record<string, 'read' | 'write'> = {
  scroll_to_cell: 'write',
  highlight_cell: 'write',
  summarize_changes: 'read',
}

const DEFAULT_HIGHLIGHT_SECONDS = 3
const MAX_ENTRIES = 100
const SUMMARY_CHARS = 80

/** The first non-empty line of the source, plus the error name when the cell failed. */
export function summarizeCell(cell: Cell): string {
  const line = cell.source.split('\n').find((text) => text.trim() !== '')?.trim() ?? '(empty)'
  const text = line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS - 1)}…` : line
  const failure = cell.outputs.find((output) => output.type === 'error')
  return failure?.type === 'error' ? `${text} · error: ${failure.ename}`.slice(0, 200) : text
}

type Located = { ok: true; id: string } | { ok: false; error: WriteError }

/** Finds a cell by `id` or by 0-based `index`. Exactly one of them must be given. */
function locate(host: AgentHost, input: Record<string, unknown>): Located {
  const { id, index } = input
  if ((id === undefined) === (index === undefined)) return { ok: false, error: 'invalid' }
  const notebook = host.notebook()
  if (!notebook) return { ok: false, error: 'not_found' }
  if (id !== undefined) {
    return typeof id === 'string' && notebook.cells.some((cell) => cell.id === id)
      ? { ok: true, id }
      : { ok: false, error: 'not_found' }
  }
  const cell = typeof index === 'number' && Number.isInteger(index) ? notebook.cells[index] : undefined
  return cell ? { ok: true, id: cell.id } : { ok: false, error: 'not_found' }
}

function summarizeChanges(host: AgentHost, input: Record<string, unknown>): ChangesAnswer {
  const changes = host.changes()
  if (!changes) {
    return {
      available: false,
      message: 'No previous version to compare. Changes appear once the same notebook is opened again.',
      total: 0,
      truncated: false,
      cells: [],
    }
  }
  const limit = typeof input['max'] === 'number' ? Math.min(input['max'], MAX_ENTRIES) : MAX_ENTRIES
  const all: ChangeEntry[] = [
    ...changes.changed.map(({ cell, index }) => entry(cell, index, 'changed')),
    ...changes.deleted.map(({ cell, index }) => entry(cell, index, 'deleted')),
  ]
  return {
    available: true,
    message: all.length === 0
      ? 'The notebook has no changes since the previous copy.'
      : 'Changed cells use their index in the current notebook; deleted cells use their index in the previous one.',
    total: all.length,
    truncated: all.length > limit,
    cells: all.slice(0, limit),
  }
}

const entry = (cell: Cell, index: number, status: ChangeEntry['status']): ChangeEntry =>
  ({ id: cell.id, index, type: cell.type, status, summary: summarizeCell(cell) })

/** Runs one action and returns the answer to give to `deska.agent.respond`. */
export function runAction(host: AgentHost, action: string, input: unknown): WriteAnswer | ChangesAnswer {
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  try {
    if (action === 'summarize_changes') return summarizeChanges(host, args)
    if (action !== 'scroll_to_cell' && action !== 'highlight_cell') return { ok: false, error: 'invalid' }
    const found = locate(host, args)
    if (!found.ok) return found
    host.scrollTo(found.id)
    if (action === 'highlight_cell') {
      const seconds = typeof args['seconds'] === 'number' ? args['seconds'] : DEFAULT_HIGHLIGHT_SECONDS
      host.highlight(found.id, seconds * 1000)
    }
    return { ok: true }
  } catch {
    return action === 'summarize_changes'
      ? { available: false, message: 'The panel failed to read the changes.', total: 0, truncated: false, cells: [] }
      : { ok: false, error: 'failed' }
  }
}
