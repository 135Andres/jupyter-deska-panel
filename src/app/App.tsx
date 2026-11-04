import { useEffect, useRef, useState } from 'preact/hooks'
import { findAdapter } from '../adapters'
import { DropSource, type DropSourceWarning } from '../source'
import { mountNotebook, type CopyItem, type NotebookView } from '../render'
import type { Notebook } from '../model'
import { t, type WordKey } from '../i18n'
import { yieldToBrowser } from '../model'
import { copyToClipboard } from './copy'
import { registerAgent } from '../agent'
import { Toolbar, type ToolbarSearch } from './Toolbar'
import { IconClose } from './icons'
import { shortcutFor } from './shortcuts'
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const target = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const output = useRef<HTMLDivElement>(null)
  const view = useRef<NotebookView | null>(null)
  const lastName = useRef('')
  const resolveLarge = useRef<((open: boolean) => void) | null>(null)
  const searchApi = useRef<ToolbarSearch | null>(null)
  const cellIndex = useRef(-1)
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
  const changedRef = useRef(changed)
  changedRef.current = changed
  // Set once the notebook source exists; the agent host waits on it (see below).
  const agentReadyRef = useRef<(() => Promise<void>) | null>(null)

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
    ready: () => agentReadyRef.current?.() ?? Promise.resolve(),
    putImage: async (bytes) => {
      const files = typeof deska === 'undefined' ? undefined : deska.files
      if (!files) return null
      try { return (await files.put(new Blob([bytes.slice().buffer], { type: 'image/png' }))).id } catch { return null }
    },
    setView: (filter, mode) => {
      if (filter) { setOnlyChanged(filter === 'changed'); view.current?.setFilter(filter) }
      if (mode) { setOutputsOnly(mode === 'outputs'); view.current?.setMode(mode) }
    },
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
        setVisible(payload.visibility?.visible ?? true)
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
    // One refresh at a time, in order: a slow host must not interleave two
    // opens of the same notebook.
    let refreshQueue: Promise<void> = Promise.resolve()
    const doRefresh = async () => {
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
      cellIndex.current = -1
      const count = sameNotebook ? view.current.changedCount() : 0
      setChanged(count)
      if (count === 0) setOnlyChanged(false)
      else view.current.setFilter(onlyChangedRef.current ? 'changed' : 'all')
    }
    const refresh = () => {
      refreshQueue = refreshQueue.then(doRefresh).catch(() => undefined)
    }
    // An agent call that arrives before the host has handed back the reopened
    // notebook waits for the restore and the refresh it triggers, not a
    // spurious "not found".
    agentReadyRef.current = async () => {
      await source.restored
      await refreshQueue
    }
    const unsubscribe = source.onChange(() => refresh())
    refresh()
    return () => {
      agentReadyRef.current = null
      unsubscribe()
      source.destroy()
      clearTimeout(noticeTimer.current)
      view.current?.destroy()
      view.current = null
    }
  }, [])

  const locale = init?.locale.toLowerCase().startsWith('es') ? 'es' : 'en'

  // j/k walk the cells the view can show; a cell hidden by "Changed" or
  // "Outputs only" is skipped.
  const goCell = (direction: 1 | -1) => {
    const nb = notebookRef.current
    if (!nb) return
    for (let i = cellIndex.current + direction; i >= 0 && i < nb.cells.length; i += direction) {
      if (view.current?.scrollToCell(nb.cells[i]!.id)) { cellIndex.current = i; break }
    }
  }

  const toggleChanged = () => {
    if (changedRef.current === 0) return
    const next = !onlyChangedRef.current
    setOnlyChanged(next)
    view.current?.setFilter(next ? 'changed' : 'all')
  }

  const toggleOutputs = () => {
    const next = !outputsOnlyRef.current
    setOutputsOnly(next)
    view.current?.setMode(next ? 'outputs' : 'all')
  }

  // The keyboard shortcuts. They never fire while the person is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutFor(event)
      if (!action) return
      // "/" would land in the input it focuses; "?" opens the browser's quick
      // find in some of them.
      if (action === 'focus-search' || action === 'show-shortcuts') event.preventDefault()
      switch (action) {
        case 'escape': setShortcutsOpen(false); break
        case 'show-shortcuts': setShortcutsOpen((open) => !open); break
        case 'focus-search': searchApi.current?.focus(); break
        case 'next-match': searchApi.current?.move(1); break
        case 'prev-match': searchApi.current?.move(-1); break
        case 'next-cell': goCell(1); break
        case 'prev-cell': goCell(-1); break
        case 'toggle-changed': toggleChanged(); break
        case 'toggle-outputs': toggleOutputs(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const header = notebook
    ? [notebook.metadata.title, notebook.metadata.kernel, notebook.metadata.language, `${notebook.cells.length.toLocaleString(locale)} ${t(locale, 'cells')}`].filter(Boolean).join(' · ')
    : ''

  const shortcutRows: [string[], WordKey][] = [
    [['j', 'k'], 'scCells'],
    [['/'], 'scSearch'],
    [['n', 'N'], 'scResults'],
    [['c'], 'scChanged'],
    [['o'], 'scOutputs'],
    [['?'], 'scList'],
    [['Esc'], 'scClose'],
  ]

  return (
    <main class="app" ref={target}>
      <h1 class="panel-name">{init ? init.panel.name : t(locale, 'title')}</h1>
      <Toolbar key={revision} locale={locale} openedName={openedName} header={header}
        onOpen={() => fileInput.current?.click()} onShortcuts={() => setShortcutsOpen(true)}
        notebook={notebook} navigate={(id) => {
          setOnlyChanged(false)
          if (onlyChanged) view.current?.setFilter('all')
          view.current?.scrollToCell(id)
        }}
        changed={changed} onlyChanged={onlyChanged} onFilter={(filter) => { setOnlyChanged(filter === 'changed'); view.current?.setFilter(filter) }}
        folded={folded} outputsOnly={outputsOnly}
        onFold={() => { const next = !folded; setFolded(next); view.current?.foldAll(next) }}
        onOutputs={toggleOutputs}
        hasView={hasView} searchApi={searchApi} paused={!visible} />
      <input ref={fileInput} class="file-input" type="file" accept=".ipynb,.py,.Rmd,.qmd,.zpln,application/json,text/x-python" aria-label={t(locale, 'open')} />
      <div class="content">
        {!openedName && <p class="hint">{t(locale, 'drop')}</p>}
        {notice && <p class="hint" role="status" data-testid="copy-notice">{t(locale, notice)}</p>}
        {error && <p role="alert">{error}</p>}
        {warning?.reason === 'too-large' && <p class="hint">{t(locale, 'size')}</p>}
        {warning?.reason === 'save-failed' && <p class="hint" role="status">{t(locale, 'saveError')}</p>}
        {rawText && <pre class="raw-text">{rawText}</pre>}
        <div class="notebook" ref={output} />
      </div>
      {shortcutsOpen && <div class="dialog-backdrop" onClick={() => setShortcutsOpen(false)}>
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(event) => event.stopPropagation()}>
          <h2 id="shortcuts-title">{t(locale, 'shortcuts')}</h2>
          <ul class="shortcut-list">
            {shortcutRows.map(([keys, word]) => <li key={word}>
              {keys.map((key) => <kbd key={key}>{key}</kbd>)}
              <span>{t(locale, word)}</span>
            </li>)}
          </ul>
          <div class="dialog-actions">
            <button type="button" onClick={() => setShortcutsOpen(false)}><IconClose />{t(locale, 'close')}</button>
          </div>
        </section>
      </div>}
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
