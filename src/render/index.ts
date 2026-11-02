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
  scrollToCell(id: string): void
  destroy(): void
}

type Row = { cell: Cell } | NotebookDiff['deleted'][number]

const LINE_HEIGHT = 20
const CELL_CHROME = 24

function estimateHeight(cell: Cell): number {
  const lines = cell.source.split('\n').length
  const outputs = cell.outputs.length * 60
  return CELL_CHROME + lines * LINE_HEIGHT + outputs
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
  const visible = (): Row[] => {
    const rows: Row[] = []
    const groups = new Map(deleted.map((group) => [group.before, group]))
    for (let i = 0; i <= current.cells.length; i++) {
      const group = groups.get(i)
      if (group) rows.push(group)
      const cell = current.cells[i]
      if (cell && (filter === 'all' || changed.has(cell.id))) rows.push({ cell })
    }
    return rows
  }
  container.classList.add('nb-root')
  container.dataset['theme'] = options.theme

  // A cell is rendered once per notebook object; its DOM is kept while it scrolls near.
  const list = createVirtualList<Row>(container, {
    key: (row) => 'cell' in row ? `cell:${row.cell.id}` : `deleted:${row.before}`,
    estimate: (row) => 'cell' in row ? estimateHeight(row.cell) : CELL_CHROME + LINE_HEIGHT,
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
      const node = renderCell(cell, current, options.locale)
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
