import { useEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import type { Notebook } from '../model'
import { indexNavigation, searchCells, type NavigationIndex } from '../model/navigation'
import { t, type Locale } from '../i18n'
import { IconDown, IconFold, IconHelp, IconList, IconMenu, IconOpen, IconOutputs, IconUp } from './icons'

/** What the keyboard shortcuts need from the toolbar's search. */
export interface ToolbarSearch {
  focus(): void
  move(direction: number): void
}

/** The compact, fixed top bar: file name and header, Open, search with a
 * counter, and the outline, changed filter, fold and outputs-only controls.
 * Under 560 px the secondary controls move into a menu. */
export function Toolbar({ locale, openedName, header, onOpen, onShortcuts, notebook, navigate, changed, onlyChanged, onFilter, folded, outputsOnly, onFold, onOutputs, hasView, searchApi, paused = false }: {
  locale: Locale
  openedName: string
  header: string
  onOpen(): void
  onShortcuts(): void
  notebook: Notebook | null
  navigate(id: string): void
  changed: number
  onlyChanged: boolean
  onFilter(filter: 'all' | 'changed'): void
  folded: boolean
  outputsOnly: boolean
  onFold(): void
  onOutputs(): void
  hasView: boolean
  searchApi: RefObject<ToolbarSearch | null>
  /** True while the panel is hidden: indexing and searching wait for it to show again. */
  paused?: boolean
}) {
  const [index, setIndex] = useState<NavigationIndex | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [position, setPosition] = useState(-1)
  const [busy, setBusy] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const secondary = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notebook || paused) return
    const controller = new AbortController()
    void indexNavigation(notebook, controller.signal).then((next) => {
      if (!controller.signal.aborted) setIndex(next)
    })
    return () => controller.abort()
  }, [notebook, paused])

  useEffect(() => {
    const controller = new AbortController()
    setMatches([])
    setPosition(-1)
    setBusy(true)
    if (index && !paused) void searchCells(index, query, controller.signal).then((next) => {
      if (controller.signal.aborted) return
      setMatches(next)
      setBusy(false)
    })
    return () => controller.abort()
  }, [index, query, paused])

  const move = (direction: number) => {
    if (!matches.length) return
    const next = (position + direction + matches.length) % matches.length
    setPosition(next)
    navigate(matches[next]!)
  }

  // What the "/" and "n"/"N" shortcuts call.
  useEffect(() => {
    searchApi.current = { focus: () => searchInput.current?.focus(), move }
    return () => { searchApi.current = null }
  })

  // The narrow menu closes on Escape and on a click anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && (secondary.current?.contains(target) || menuButton.current?.contains(target))) return
      setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [menuOpen])

  return <header class="toolbar">
    <div class="tb-row">
      <button type="button" class="tb-open" aria-label={t(locale, 'open')} onClick={onOpen}>
        <IconOpen />{t(locale, 'openButton')}
      </button>
      <div class="tb-id">
        {openedName && <span class="hint tb-file">{openedName}</span>}
        {header && <span class="hint nb-header">{header}</span>}
      </div>
      <div class="search" role="search">
        <input ref={searchInput} type="search" aria-label={t(locale, 'search')} placeholder={t(locale, 'search')}
          value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        <button type="button" aria-label={t(locale, 'previous')} disabled={busy || !matches.length} onClick={() => move(position < 0 ? 0 : -1)}><IconUp /></button>
        <button type="button" aria-label={t(locale, 'next')} disabled={busy || !matches.length} onClick={() => move(1)}><IconDown /></button>
        <span role="status">{busy ? t(locale, 'searching') : `${position + 1} / ${matches.length}`}</span>
      </div>
      <button type="button" class="tb-menu-button" aria-label={t(locale, 'menu')} aria-haspopup="true"
        aria-expanded={menuOpen} ref={menuButton} onClick={() => setMenuOpen((open) => !open)}><IconMenu /></button>
      <button type="button" class="tb-help" aria-label={t(locale, 'shortcuts')} onClick={onShortcuts}><IconHelp /></button>
    </div>
    <div class="tb-secondary" data-open={menuOpen} ref={secondary}>
      {notebook && <details class="tb-outline">
        <summary><IconList />{t(locale, 'outline')} ({index?.headings.length ?? 0})</summary>
        <nav class="outline" aria-label={t(locale, 'outline')}>
          {index?.headings.map((heading, i) => <button key={i} type="button"
            style={{ paddingInlineStart: `${(heading.level - 1) * 12 + 4}px` }}
            onClick={() => navigate(heading.cellId)}>{heading.title}</button>)}
        </nav>
      </details>}
      {changed > 0 && <div class="filter" role="group">
        <button type="button" aria-pressed={!onlyChanged} onClick={() => onFilter('all')}>{t(locale, 'all')}</button>
        <button type="button" aria-pressed={onlyChanged} onClick={() => onFilter('changed')}>{t(locale, 'changed')} ({changed})</button>
      </div>}
      {hasView && <div class="filter" role="group">
        <button type="button" data-action="fold-all" aria-pressed={folded} onClick={onFold}>
          <IconFold />{folded ? t(locale, 'unfoldAll') : t(locale, 'foldAll')}
        </button>
        <button type="button" data-action="outputs-only" aria-pressed={outputsOnly} onClick={onOutputs}>
          <IconOutputs />{t(locale, 'outputsOnly')}
        </button>
      </div>}
    </div>
  </header>
}
