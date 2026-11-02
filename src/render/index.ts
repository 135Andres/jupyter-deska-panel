import { diffNotebook, type NotebookDiff } from '../model/diff'
import type { Cell, Notebook } from '../model/types'
import { renderCell } from './cells'
import 'katex/dist/katex.min.css'
import './render.css'
import { createVirtualList } from './virtual-list'

/** Theme and language used to render a notebook. */
export interface MountOptions {
  theme: 'light' | 'dark'
  locale: 'en' | 'es'
}

/** A mounted notebook that can be updated, navigated, and destroyed. */
export interface NotebookView {
  /** Shows a new notebook; with `compare`, marks cells that differ from the previous one. */
  update(notebook: Notebook, compare?: boolean): void
  /** Cells marked as changed by the last `update` with `compare`. */
  changedCount(): number
  /** Shows all cells or only the changed ones. */
  setFilter(filter: 'all' | 'changed'): void
  /** "outputs": hides inputs, Markdown and cells with no output. */
  setMode(mode: 'all' | 'outputs'): void
  /** Folds or unfolds the input and output of every code cell. */
  foldAll(folded: boolean): void
  /** True when every foldable part is folded (the "fold all" state). */
  allFolded(): boolean
  /** Scrolls to a cell; false when it is not in the shown rows (filter or mode) or does not exist. */
  scrollToCell(id: string): boolean
  /** Marks a cell for a while (it stays marked through scrolling); false when it does not exist. */
  highlightCell(id: string, ms: number): boolean
  /** The cells that differ from the previous copy, or null when the last `update` did not compare. */
  changes(): ChangeSet | null
  destroy(): void
}

/** A cell with its position: in the current notebook, or in the previous one for deleted cells. */
export interface IndexedCell { cell: Cell; index: number }
export interface ChangeSet { changed: IndexedCell[]; deleted: IndexedCell[] }

type Row = { cell: Cell } | NotebookDiff['deleted'][number]

const LINE_HEIGHT = 20
const CELL_CHROME = 24

function estimateHeight(cell: Cell, input: boolean, output: boolean): number {
  const lines = input ? cell.source.split('\n').length : 0
  const outputs = output ? cell.outputs.length * 60 : cell.outputs.length > 0 ? LINE_HEIGHT : 0
  return CELL_CHROME + (input ? Math.max(lines, 1) * LINE_HEIGHT : LINE_HEIGHT) + outputs
}

/** Mounts a notebook into a container. The container becomes the scroller. */
export function mountNotebook(
  container: HTMLElement,
  notebook: Notebook,
  options: MountOptions,
): NotebookView {
  let current = notebook
  let changed = new Set<string>()
  let filter: 'all' | 'changed' = 'all'
  let deleted: NotebookDiff['deleted'] = []
  let mode: 'all' | 'outputs' = 'all'
  let changes: ChangeSet | null = null
  const highlighted = new Map<string, ReturnType<typeof setTimeout>>()
  const markNode = (id: string, on: boolean) => {
    for (const node of container.querySelectorAll<HTMLElement>('.nb-cell')) {
      if (node.dataset['cellId'] === id) node.classList.toggle('nb-highlight', on)
    }
  }
  // Fold state: a default for every cell, plus per-cell overrides keyed `id:input|output`.
  let foldDefault = false
  const folds = new Map<string, boolean>()
  const isFolded = (id: string, kind: 'input' | 'output') => folds.get(`${id}:${kind}`) ?? foldDefault
  const shown = (cell: Cell) =>
    (filter === 'all' || changed.has(cell.id)) && (mode === 'all' || (cell.type === 'code' && cell.outputs.length > 0))
  const visible = (): Row[] => {
    const rows: Row[] = []
    const groups = new Map(deleted.map((group) => [group.before, group]))
    for (let i = 0; i <= current.cells.length; i++) {
      const group = groups.get(i)
      if (group) rows.push(group)
      const cell = current.cells[i]
      if (cell && shown(cell)) rows.push({ cell })
    }
    return rows
  }
  container.classList.add('nb-root')
  container.dataset['theme'] = options.theme

  // A cell is rendered once per notebook object; its DOM is kept while it scrolls near.
  const list = createVirtualList<Row>(container, {
    key: (row) => 'cell' in row ? `cell:${row.cell.id}` : `deleted:${row.before}`,
    estimate: (row) => 'cell' in row
      ? estimateHeight(row.cell, mode === 'all' && !isFolded(row.cell.id, 'input'), !isFolded(row.cell.id, 'output'))
      : CELL_CHROME + LINE_HEIGHT,
    render: (row) => {
      if (!('cell' in row)) {
        const node = document.createElement('div')
        node.className = 'nb-deleted'
        node.textContent = options.locale === 'es'
          ? `${row.count} celdas eliminadas`
          : `${row.count} deleted cells`
        return node
      }
      const cell = row.cell
      const node = renderCell(cell, current, options.locale, {
        inputFolded: isFolded(cell.id, 'input'),
        outputFolded: isFolded(cell.id, 'output'),
        outputsOnly: mode === 'outputs',
        // Folding changes the cell's height: forget its measurement so the list re-measures.
        onToggle: (kind) => {
          folds.set(`${cell.id}:${kind}`, !isFolded(cell.id, kind))
          list.invalidate(`cell:${cell.id}`)
        },
      })
      if (changed.has(cell.id)) node.classList.add('nb-changed')
      if (highlighted.has(cell.id)) node.classList.add('nb-highlight')
      return node
    },
  })

  // Block navigation: links in a notebook must never take the panel away.
  const onClick = (event: Event) => {
    if ((event.target as Element | null)?.closest('a')) event.preventDefault()
  }
  container.addEventListener('click', onClick)

  list.setItems(visible())

  return {
    update(next, compare = false) {
      const diff: NotebookDiff = compare ? diffNotebook(current, next) : { changed: new Set<string>(), deleted: [], removed: [] }
      changes = compare ? {
        changed: next.cells.flatMap((cell, index) => diff.changed.has(cell.id) ? [{ cell, index }] : []),
        deleted: diff.removed,
      } : null
      changed = diff.changed
      deleted = diff.deleted
      current = next
      if (changed.size === 0) filter = 'all'
      list.setItems(visible())
    },
    changedCount: () => changed.size,
    setFilter(next) {
      filter = next
      list.setItems(visible())
    },
    setMode(next) {
      mode = next
      list.setItems(visible())
      list.invalidate()
    },
    foldAll(folded) {
      foldDefault = folded
      folds.clear()
      list.invalidate()
    },
    allFolded: () => foldDefault && folds.size === 0,
    scrollToCell(id) {
      const index = visible().findIndex((row) => 'cell' in row && row.cell.id === id)
      list.scrollToIndex(index)
      return index >= 0
    },
    highlightCell(id, ms) {
      if (!current.cells.some((cell) => cell.id === id)) return false
      clearTimeout(highlighted.get(id))
      highlighted.set(id, setTimeout(() => { highlighted.delete(id); markNode(id, false) }, ms))
      markNode(id, true)
      return true
    },
    changes: () => changes,
    destroy() {
      for (const timer of highlighted.values()) clearTimeout(timer)
      highlighted.clear()
      container.removeEventListener('click', onClick)
      list.destroy()
      container.classList.remove('nb-root')
      delete container.dataset['theme']
    },
  }
}
