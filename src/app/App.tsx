import { useEffect, useRef, useState } from 'preact/hooks'
import { findAdapter } from '../adapters'
import { DropSource, type DropSourceWarning } from '../source'
import { mountNotebook, type CopyItem, type NotebookView } from '../render'
import type { Notebook } from '../model'
import { t, type WordKey } from '../i18n'
import { yieldToBrowser } from '../model'
import { copyToClipboard } from './copy'
import { registerAgent } from '../agent'
import { Navigation } from './Navigation'
import type { DeskaInit } from './deska'

async function waitForDeska(): Promise<DeskaInit | null> {
  if (typeof deska === 'undefined') return null
  return deska.ready()
}

const RAW_TEXT_LIMIT = 200_000

export function App() {
  const [init, setInit] = useState<DeskaInit | null>(null)
  const [warning, setWarning] = useState<DropSourceWarning | null>(null)
  const [largeFile, setLargeFile] = useState<{ name: string; size: number } | null>(null)
  const [error, setError] = useState('')
  const [rawText, setRawText] = useState('')
  const [openedName, setOpenedName] = useState('')
  const [revision, setRevision] = useState(0)
  const [notebook, setNotebook] = useState<Notebook | null>(null)
  const [changed, setChanged] = useState(0)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [folded, setFolded] = useState(false)
  const [outputsOnly, setOutputsOnly] = useState(false)
  const [hasView, setHasView] = useState(false)
  const [notice, setNotice] = useState<WordKey | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const target = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const output = useRef<HTMLDivElement>(null)
  const view = useRef<NotebookView | null>(null)
  const lastName = useRef('')
  const resolveLarge = useRef<((open: boolean) => void) | null>(null)
  const initRef = useRef(init)
  initRef.current = init
  const onlyChangedRef = useRef(onlyChanged)
  onlyChangedRef.current = onlyChanged
  const foldedRef = useRef(folded)
  foldedRef.current = folded
  const outputsOnlyRef = useRef(outputsOnly)
  outputsOnlyRef.current = outputsOnly
  const notebookRef = useRef(notebook)
  notebookRef.current = notebook

  // Before `deska.ready()`, so an agent call that arrives early is not lost.
  useEffect(() => registerAgent(typeof deska === 'undefined' ? undefined : deska, {
    notebook: () => notebookRef.current,
    scrollTo: (id) => {
      if (view.current?.scrollToCell(id)) return
      // Hidden by "Changed" or "Outputs only": show everything, then go there.
      setOnlyChanged(false)
      setOutputsOnly(false)
      view.current?.setFilter('all')
      view.current?.setMode('all')
      view.current?.scrollToCell(id)
    },
    highlight: (id, ms) => { view.current?.highlightCell(id, ms) },
    changes: () => view.current?.changes() ?? null,
  }), [])

  // A hidden panel keeps running: pause the work that only serves reading
  // (the search index and the search itself) until Deska shows the panel again.
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (typeof deska === 'undefined' || typeof deska.on !== 'function') return
    return deska.on('visibility', (state) => setVisible(state.visible))
  }, [])

  // The SDK repaints the --deska-* tokens itself; the palette for code, errors and
  // ANSI colours follows the mode, so pass it on.
  useEffect(() => {
    if (typeof deska === 'undefined' || typeof deska.on !== 'function') return
    return deska.on('theme', (theme) => {
      document.documentElement.style.colorScheme = theme.mode
      view.current?.setTheme(theme.mode)
    })
  }, [])

  useEffect(() => {
    let live = true
    void waitForDeska().then((payload) => {
      if (!live) return
      if (payload) {
        document.documentElement.style.colorScheme = payload.theme.mode
        setVisible(payload.visibility.visible)
      }
      setInit(payload)
    })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!target.current) return
    const source = new DropSource(target.current, undefined, async (file) => {
      setLargeFile({ name: file.name, size: file.size })
      return new Promise<boolean>((resolve) => { resolveLarge.current = resolve })
    })
    const refresh = async () => {
      const [file] = await Promise.all([source.current()])
      setWarning(source.warning)
      if (!file || !output.current) return
      setOpenedName(file.name)
      // A file that cannot be shown as a notebook: say why, and show its text.
      const fail = (message: string) => {
        view.current?.destroy()
        view.current = null
        setNotebook(null)
        setHasView(false)
        setError(message)
        setRawText(new TextDecoder().decode(file.bytes.subarray(0, RAW_TEXT_LIMIT)))
      }
      const parseStart = performance.now()
      const adapter = findAdapter(file.name, file.bytes.subarray(0, 4096))
      if (!adapter) { lastName.current = ''; fail(t(initRef.current?.locale.toLowerCase().startsWith('es') ? 'es' : 'en', 'unsupported')); return }
      const result = await adapter.parse(file.bytes, { yieldEvery: 100 })
      // A long parse and the first render are each their own task: sharing one
      // is what made opening a big notebook a single long freeze.
      if (performance.now() - parseStart > 15) await yieldToBrowser()
      if (!result.ok) { fail(result.error.message); return }
      setError('')
      setRawText('')
      const currentInit = initRef.current
      const locale = currentInit?.locale.toLowerCase().startsWith('es') ? 'es' : 'en'
      const options = {
        theme: (typeof deska !== 'undefined' ? deska.theme?.mode : undefined) ?? currentInit?.theme.mode ?? 'light',
        locale,
        onCopy: typeof deska !== 'undefined' && deska.clipboard ? (item: CopyItem) => {
          void copyToClipboard(deska.clipboard, item).then((word) => {
            setNotice(word)
            clearTimeout(noticeTimer.current)
            noticeTimer.current = setTimeout(() => setNotice(null), 3000)
          })
        } : undefined,
      } as const
      // A newer copy of the same notebook: mark what changed since the last one.
      const sameNotebook = lastName.current === file.name
      lastName.current = file.name
      if (view.current) view.current.update(result.value, sameNotebook)
      else {
        view.current = mountNotebook(output.current, result.value, options)
        // Keep the person's choices when a notebook is opened again.
        view.current.foldAll(foldedRef.current)
        view.current.setMode(outputsOnlyRef.current ? 'outputs' : 'all')
      }
      setNotebook(result.value)
      setRevision((value) => value + 1)
      setHasView(true)
      const count = sameNotebook ? view.current.changedCount() : 0
      setChanged(count)
      if (count === 0) setOnlyChanged(false)
      else view.current.setFilter(onlyChangedRef.current ? 'changed' : 'all')
    }
    const unsubscribe = source.onChange(() => { void refresh() })
    void refresh()
    return () => {
      unsubscribe()
      source.destroy()
      clearTimeout(noticeTimer.current)
      view.current?.destroy()
      view.current = null
    }
  }, [])

  const locale = init?.locale.toLowerCase().startsWith('es') ? 'es' : 'en'

  return (
    <main class="hello" ref={target}>
      <h1>{init ? init.panel.name : t(locale, 'title')}</h1>
      <button type="button" onClick={() => fileInput.current?.click()}>{t(locale, 'open')}</button>
      <input ref={fileInput} class="file-input" type="file" accept=".ipynb,.py,.Rmd,.qmd,.zpln,application/json,text/x-python" aria-label={t(locale, 'open')} />
      {!openedName && <p class="hint">{t(locale, 'drop')}</p>}
      {openedName && <p class="hint">{openedName}</p>}
      {notebook && <p class="hint nb-header">{[notebook.metadata.title, notebook.metadata.kernel, notebook.metadata.language, `${notebook.cells.length.toLocaleString(locale)} ${t(locale, 'cells')}`].filter(Boolean).join(' · ')}</p>}
      {changed > 0 && <div class="filter" role="group">
        <button type="button" aria-pressed={!onlyChanged} onClick={() => { setOnlyChanged(false); view.current?.setFilter('all') }}>{t(locale, 'all')}</button>
        <button type="button" aria-pressed={onlyChanged} onClick={() => { setOnlyChanged(true); view.current?.setFilter('changed') }}>{t(locale, 'changed')} ({changed})</button>
      </div>}
      {notebook && <Navigation key={revision} notebook={notebook} locale={locale} paused={!visible} navigate={(id) => {
        setOnlyChanged(false)
        if (onlyChanged) view.current?.setFilter('all')
        view.current?.scrollToCell(id)
      }} />}
      {hasView && <div class="filter" role="group">
        <button type="button" data-action="fold-all" aria-pressed={folded} onClick={() => { const next = !folded; setFolded(next); view.current?.foldAll(next) }}>{folded ? t(locale, 'unfoldAll') : t(locale, 'foldAll')}</button>
        <button type="button" data-action="outputs-only" aria-pressed={outputsOnly} onClick={() => { const next = !outputsOnly; setOutputsOnly(next); view.current?.setMode(next ? 'outputs' : 'all') }}>{t(locale, 'outputsOnly')}</button>
      </div>}
      {notice && <p class="hint" role="status" data-testid="copy-notice">{t(locale, notice)}</p>}
      {error && <p role="alert">{error}</p>}
      {warning?.reason === 'too-large' && <p class="hint">{t(locale, 'size')}</p>}
      {warning?.reason === 'save-failed' && <p class="hint" role="status">{t(locale, 'saveError')}</p>}
      {rawText && <pre class="raw-text">{rawText}</pre>}
      <div class="notebook" ref={output} />
      {largeFile && <div class="dialog-backdrop">
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="large-title">
          <h2 id="large-title">{t(locale, 'large')}</h2>
          <p>{largeFile.name} · {(largeFile.size / 1_000_000).toFixed(1)} MB</p>
          <div class="dialog-actions">
            <button type="button" onClick={() => { resolveLarge.current?.(false); resolveLarge.current = null; setLargeFile(null) }}>{t(locale, 'cancel')}</button>
            <button type="button" onClick={() => { resolveLarge.current?.(true); resolveLarge.current = null; setLargeFile(null) }}>{t(locale, 'anyway')}</button>
          </div>
        </section>
      </div>}
    </main>
  )
}
