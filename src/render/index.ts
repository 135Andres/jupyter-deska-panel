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
  update(notebook: Notebook): void
  scrollToCell(id: string): void
  destroy(): void
}

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
  container.classList.add('nb-root')
  container.dataset['theme'] = options.theme

  // A cell is rendered once per notebook object; its DOM is kept while it scrolls near.
  const list = createVirtualList<Cell>(container, {
    key: (cell) => cell.id,
    estimate: estimateHeight,
    render: (cell) => renderCell(cell, current, options.locale),
  })

  // Block navigation: links in a notebook must never take the panel away.
  const onClick = (event: Event) => {
    if ((event.target as Element | null)?.closest('a')) event.preventDefault()
  }
  container.addEventListener('click', onClick)

  list.setItems(current.cells)

  return {
    update(next) {
      current = next
      list.setItems(next.cells)
    },
    scrollToCell(id) {
      const index = current.cells.findIndex((cell) => cell.id === id)
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
