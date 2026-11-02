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
  scrollToCell(id: string): void
  destroy(): void
}

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
      const diff = compare ? diffNotebook(current, next) : { changed: new Set<string>(), deleted: [] }
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
    },
    destroy() {
      container.removeEventListener('click', onClick)
      list.destroy()
      container.classList.remove('nb-root')
      delete container.dataset['theme']
    },
  }
}
