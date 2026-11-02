import type { Cell, Notebook } from './types'

function same(a: Cell, b: Cell): boolean {
  return a.type === b.type && a.source === b.source && JSON.stringify(a.outputs) === JSON.stringify(b.outputs)
}

export interface NotebookDiff {
  changed: Set<string>
  /** Consecutive deletions, placed before a cell index in the new notebook. */
  deleted: { before: number; count: number }[]
  /** The deleted cells themselves, with their index in the previous notebook. */
  removed: { cell: Cell; index: number }[]
}

/** Match real ids first; generated ids need source matching before positional fallback. */
export function diffNotebook(prev: Notebook, next: Notebook): NotebookDiff {
  const partners = new Map<number, number>()
  const used = new Set<number>()
  const ids = new Map(prev.cells.flatMap((cell, i) => cell.generatedId ? [] : [[cell.id, i] as const]))
  next.cells.forEach((cell, i) => {
    const old = cell.generatedId ? undefined : ids.get(cell.id)
    if (old !== undefined && !used.has(old)) {
      partners.set(i, old)
      used.add(old)
    }
  })

  const sourceKey = (cell: Cell) => JSON.stringify([cell.type, cell.source])
  const sources = new Map<string, number[]>()
  prev.cells.forEach((cell, i) => {
    if (!cell.generatedId || used.has(i)) return
    const key = sourceKey(cell)
    const matches = sources.get(key) ?? []
    matches.push(i)
    sources.set(key, matches)
  })
  next.cells.forEach((cell, i) => {
    if (!cell.generatedId) return
    const old = sources.get(sourceKey(cell))?.shift()
    if (old !== undefined) {
      partners.set(i, old)
      used.add(old)
    }
  })
  const remaining = prev.cells.flatMap((cell, i) => cell.generatedId && !used.has(i) ? [i] : [])
  let cursor = 0
  next.cells.forEach((cell, i) => {
    if (!cell.generatedId || partners.has(i)) return
    const old = remaining[cursor++]
    if (old !== undefined) {
      partners.set(i, old)
      used.add(old)
    }
  })

  const changed = new Set<string>()
  next.cells.forEach((cell, i) => {
    const old = partners.get(i)
    if (old === undefined || !same(prev.cells[old]!, cell)) changed.add(cell.id)
  })
  const after = new Map([...partners].map(([i, old]) => [old, i]))
  const deleted: NotebookDiff['deleted'] = []
  const removed: NotebookDiff['removed'] = []
  let before = next.cells.length
  for (let i = prev.cells.length - 1; i >= 0; i--) {
    const partner = after.get(i)
    if (partner !== undefined) before = partner
    else {
      removed.unshift({ cell: prev.cells[i]!, index: i })
      const group = deleted[0]
      if (group?.before === before) group.count++
      else deleted.unshift({ before, count: 1 })
    }
  }
  return { changed, deleted, removed }
}
