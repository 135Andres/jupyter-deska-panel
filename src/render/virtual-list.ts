/** Windowed list for items of unknown, changing height. */
export interface VirtualList<T> {
  setItems(items: T[]): void
  scrollToIndex(index: number): void
  destroy(): void
}

export interface VirtualListOptions<T> {
  key(item: T): string
  /** First guess for an item that has not been measured yet. */
  estimate(item: T): number
  render(item: T): HTMLElement
  overscanPx?: number
}

/**
 * Keeps only the items near the viewport in the DOM, between two spacers.
 * Heights are measured once rendered and remembered by key.
 */
export function createVirtualList<T>(scroller: HTMLElement, options: VirtualListOptions<T>): VirtualList<T> {
  const overscan = options.overscanPx ?? 800
  const top = document.createElement('div')
  const bottom = document.createElement('div')
  const body = document.createElement('div')
  scroller.replaceChildren(top, body, bottom)

  const heights = new Map<string, number>()
  let items: T[] = []
  let offsets: number[] = [0]
  let first = 0
  let last = -1
  let frame = 0
  let destroyed = false
  const mounted = new Map<string, HTMLElement>()

  const heightOf = (item: T) => heights.get(options.key(item)) ?? options.estimate(item)

  function computeOffsets() {
    offsets = new Array<number>(items.length + 1)
    offsets[0] = 0
    for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i]! + heightOf(items[i]!)
  }

  function indexAt(y: number): number {
    let lo = 0
    let hi = items.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid]! <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  function paint() {
    frame = 0
    if (destroyed) return
    if (items.length === 0) {
      body.replaceChildren()
      mounted.clear()
      top.style.height = bottom.style.height = '0px'
      return
    }
    const viewport = scroller.clientHeight || 800
    const from = indexAt(Math.max(0, scroller.scrollTop - overscan))
    let to = indexAt(scroller.scrollTop + viewport + overscan)
    to = Math.min(to, items.length - 1)
    first = from
    last = to

    const wanted = new Set<string>()
    const nodes: HTMLElement[] = []
    for (let i = from; i <= to; i++) {
      const item = items[i]!
      const key = options.key(item)
      wanted.add(key)
      let node = mounted.get(key)
      if (!node) {
        node = options.render(item)
        mounted.set(key, node)
      }
      nodes.push(node)
    }
    for (const key of [...mounted.keys()]) if (!wanted.has(key)) mounted.delete(key)
    body.replaceChildren(...nodes)

    // Measure what is on screen; if an estimate was off, correct and repaint once.
    let changed = false
    for (let i = from; i <= to; i++) {
      const key = options.key(items[i]!)
      const h = mounted.get(key)!.offsetHeight
      if (h > 0 && heights.get(key) !== h) {
        heights.set(key, h)
        changed = true
      }
    }
    if (changed) {
      const anchor = offsets[from]!
      computeOffsets()
      const shift = offsets[from]! - anchor
      if (shift !== 0) scroller.scrollTop += shift
    }
    top.style.height = `${offsets[first]!}px`
    bottom.style.height = `${offsets[items.length]! - offsets[last + 1]!}px`
  }

  function schedule() {
    if (frame || destroyed) return
    frame = requestAnimationFrame(paint)
  }

  scroller.addEventListener('scroll', schedule, { passive: true })

  return {
    setItems(next) {
      items = next
      mounted.clear()
      computeOffsets()
      paint()
    },
    scrollToIndex(index) {
      if (index < 0 || index >= items.length) return
      scroller.scrollTop = offsets[index]!
      paint()
    },
    destroy() {
      destroyed = true
      scroller.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
      scroller.replaceChildren()
    },
  }
}
