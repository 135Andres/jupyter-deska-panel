/** Windowed list for items of unknown, changing height. */
export interface VirtualList<T> {
  setItems(items: T[], resetHeights?: boolean): void
  scrollToIndex(index: number): void
  /** Forgets the DOM and measured height of one item (or all) and repaints; use after its content changes. */
  invalidate(key?: string): void
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
  let scrollTarget: { index: number; offset: number; top?: number } | null = null
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

  function anchorAtScroll() {
    let index = indexAt(scroller.scrollTop)
    const viewportTop = scroller.getBoundingClientRect().top
    // Use the visible DOM row: estimates can differ from the rendered window.
    for (let i = first; i <= last; i++) {
      const item = items[i]
      const node = item === undefined ? undefined : mounted.get(options.key(item))
      const rect = node?.getBoundingClientRect()
      if (rect && rect.bottom > viewportTop && rect.top < viewportTop + scroller.clientHeight) {
        index = i
        break
      }
    }
    const item = items[index]
    const node = item === undefined ? undefined : mounted.get(options.key(item))
    return {
      index,
      offset: scroller.scrollTop - (offsets[index] ?? 0),
      ...(node ? { top: node.getBoundingClientRect().top - viewportTop } : {}),
    }
  }

  function paint() {
    frame = 0
    if (destroyed) return
    if (items.length === 0) {
      body.replaceChildren()
      mounted.clear()
      top.style.height = bottom.style.height = '0px'
      scrollTarget = null
      return
    }
    const anchor = scrollTarget ?? anchorAtScroll()
    const viewport = scroller.clientHeight || 800
    // Use the requested offset before the browser can clamp it to the old spacer height.
    const scrollTop = scrollTarget === null ? scroller.scrollTop : offsets[scrollTarget.index]! + scrollTarget.offset
    const from = indexAt(Math.max(0, scrollTop - overscan))
    let to = indexAt(scrollTop + viewport + overscan)
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
      const h = mounted.get(key)!.getBoundingClientRect().height
      if (h > 0 && heights.get(key) !== h) {
        heights.set(key, h)
        changed = true
      }
    }
    if (changed) computeOffsets()
    top.style.height = `${offsets[first]!}px`
    bottom.style.height = `${offsets[items.length]! - offsets[last + 1]!}px`
    const node = mounted.get(options.key(items[anchor.index]!))
    if (anchor.top !== undefined && node) {
      scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top
    } else {
      scroller.scrollTop = offsets[anchor.index]! + Math.min(anchor.offset, heightOf(items[anchor.index]!) - 1)
    }
    scrollTarget = null
  }

  function schedule() {
    if (frame || destroyed) return
    frame = requestAnimationFrame(paint)
  }

  scroller.addEventListener('scroll', schedule, { passive: true })

  return {
    setItems(next, resetHeights = false) {
      const anchor = anchorAtScroll()
      const { index, offset } = anchor
      const keys = new Map(next.map((item, i) => [options.key(item), i]))
      // If the anchor is filtered out, keep the next surviving row in view.
      let nextIndex: number | undefined
      for (let i = index; i < items.length && nextIndex === undefined; i++) {
        nextIndex = keys.get(options.key(items[i]!))
      }
      items = next
      if (resetHeights) heights.clear()
      mounted.clear()
      computeOffsets()
      scrollTarget = nextIndex === undefined ? { index: 0, offset: 0 } : { ...anchor, index: nextIndex, offset }
      paint()
    },
    scrollToIndex(index) {
      if (index < 0 || index >= items.length) return
      scrollTarget = { index, offset: 0 }
      paint()
      // Cells near the target were just measured: align once more with the real heights.
      scrollTarget = { index, offset: 0 }
      paint()
    },
    invalidate(key) {
      scrollTarget = anchorAtScroll()
      if (key === undefined) {
        heights.clear()
        mounted.clear()
      } else {
        heights.delete(key)
        mounted.delete(key)
      }
      computeOffsets()
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
