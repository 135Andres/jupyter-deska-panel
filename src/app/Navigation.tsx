import { useEffect, useState } from 'preact/hooks'
import type { Notebook } from '../model'
import { indexNavigation, searchCells, type NavigationIndex } from '../model/navigation'
import { t, type Locale } from '../i18n'

export function Navigation({ notebook, locale, navigate }: {
  notebook: Notebook
  locale: Locale
  navigate(id: string): void
}) {
  const [index, setIndex] = useState<NavigationIndex | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [position, setPosition] = useState(-1)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    void indexNavigation(notebook, controller.signal).then((next) => {
      if (!controller.signal.aborted) setIndex(next)
    })
    return () => controller.abort()
  }, [notebook])

  useEffect(() => {
    const controller = new AbortController()
    setMatches([])
    setPosition(-1)
    setBusy(true)
    if (index) void searchCells(index, query, controller.signal).then((next) => {
      if (controller.signal.aborted) return
      setMatches(next)
      setBusy(false)
    })
    return () => controller.abort()
  }, [index, query])

  const move = (direction: number) => {
    const next = (position + direction + matches.length) % matches.length
    setPosition(next)
    navigate(matches[next]!)
  }

  return <section class="navigation" aria-label={t(locale, 'navigation')}>
    <details>
      <summary>{t(locale, 'outline')} ({index?.headings.length ?? 0})</summary>
      <nav class="outline" aria-label={t(locale, 'outline')}>
        {index?.headings.map((heading, i) => <button key={i} type="button"
          style={{ paddingInlineStart: `${(heading.level - 1) * 12 + 4}px` }}
          onClick={() => navigate(heading.cellId)}>{heading.title}</button>)}
      </nav>
    </details>
    <div class="search">
      <input type="search" aria-label={t(locale, 'search')} placeholder={t(locale, 'search')}
        value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" disabled={busy || !matches.length} onClick={() => move(position < 0 ? 0 : -1)}>{t(locale, 'previous')}</button>
      <button type="button" disabled={busy || !matches.length} onClick={() => move(1)}>{t(locale, 'next')}</button>
      <span role="status">{busy ? t(locale, 'searching') : `${position + 1} / ${matches.length}`}</span>
    </div>
  </section>
}
