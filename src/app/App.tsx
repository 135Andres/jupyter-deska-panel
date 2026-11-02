import { useEffect, useRef, useState } from 'preact/hooks'
import { findAdapter } from '../adapters'
import { DropSource, type DropSourceWarning } from '../source'
import { mountNotebook, type NotebookView } from '../render'
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
  const [changed, setChanged] = useState(0)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [folded, setFolded] = useState(false)
  const [outputsOnly, setOutputsOnly] = useState(false)
  const [hasView, setHasView] = useState(false)
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

  useEffect(() => {
    let live = true
    void waitForDeska().then((payload) => {
      if (live) setInit(payload)
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
        setHasView(false)
        setError(message)
        setRawText(new TextDecoder().decode(file.bytes.subarray(0, RAW_TEXT_LIMIT)))
      }
      const adapter = findAdapter(file.name, file.bytes.subarray(0, 4096))
      if (!adapter) { lastName.current = ''; fail('Unsupported notebook file'); return }
      const result = await adapter.parse(file.bytes, { yieldEvery: 100 })
      if (!result.ok) { fail(result.error.message); return }
      setError('')
      setRawText('')
      const currentInit = initRef.current
      const locale = currentInit?.locale.toLowerCase().startsWith('es') ? 'es' : 'en'
      const options = { theme: currentInit?.theme.mode ?? 'light', locale } as const
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
      view.current?.destroy()
      view.current = null
    }
  }, [])

  const locale = init?.locale.toLowerCase().startsWith('es') ? 'es' : 'en'
  const words = locale === 'es'
    ? { open: 'Abrir notebook', drop: 'Arrastra un archivo .ipynb aquí o selecciónalo.', cancel: 'Cancelar', anyway: 'Abrir de todos modos', large: 'Este notebook es grande y puede tardar en abrirse.', size: 'No se guardará para la próxima sesión porque supera 32 MB.', changed: 'Cambiadas', all: 'Todas', foldAll: 'Plegar todo', unfoldAll: 'Desplegar todo', outputsOnly: 'Solo salidas', saveError: 'No se pudo guardar el último notebook para la próxima sesión.' }
    : { open: 'Open notebook', drop: 'Drop a .ipynb file here or choose one.', cancel: 'Cancel', anyway: 'Open anyway', large: 'This notebook is large and may take a while to open.', size: 'It will not be saved for next time because it is over 32 MB.', changed: 'Changed', all: 'All', foldAll: 'Fold all', unfoldAll: 'Unfold all', outputsOnly: 'Outputs only', saveError: 'The last notebook could not be saved for next time.' }

  return (
    <main class="hello" ref={target}>
      <h1>{init ? init.panel.name : 'Notebook Viewer'}</h1>
      <button type="button" onClick={() => fileInput.current?.click()}>{words.open}</button>
      <input ref={fileInput} class="file-input" type="file" accept=".ipynb,application/json" aria-label={words.open} />
      {!openedName && <p class="hint">{words.drop}</p>}
      {openedName && <p class="hint">{openedName}</p>}
      {changed > 0 && <div class="filter" role="group">
        <button type="button" aria-pressed={!onlyChanged} onClick={() => { setOnlyChanged(false); view.current?.setFilter('all') }}>{words.all}</button>
        <button type="button" aria-pressed={onlyChanged} onClick={() => { setOnlyChanged(true); view.current?.setFilter('changed') }}>{words.changed} ({changed})</button>
      </div>}
      {hasView && <div class="filter" role="group">
        <button type="button" data-action="fold-all" aria-pressed={folded} onClick={() => { const next = !folded; setFolded(next); view.current?.foldAll(next) }}>{folded ? words.unfoldAll : words.foldAll}</button>
        <button type="button" data-action="outputs-only" aria-pressed={outputsOnly} onClick={() => { const next = !outputsOnly; setOutputsOnly(next); view.current?.setMode(next ? 'outputs' : 'all') }}>{words.outputsOnly}</button>
      </div>}
      {error && <p role="alert">{error}</p>}
      {warning?.reason === 'too-large' && <p class="hint">{words.size}</p>}
      {warning?.reason === 'save-failed' && <p class="hint" role="status">{words.saveError}</p>}
      {rawText && <pre class="raw-text">{rawText}</pre>}
      <div class="notebook" ref={output} />
      {largeFile && <div class="dialog-backdrop">
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="large-title">
          <h2 id="large-title">{words.large}</h2>
          <p>{largeFile.name} · {(largeFile.size / 1_000_000).toFixed(1)} MB</p>
          <div class="dialog-actions">
            <button type="button" onClick={() => { resolveLarge.current?.(false); resolveLarge.current = null; setLargeFile(null) }}>{words.cancel}</button>
            <button type="button" onClick={() => { resolveLarge.current?.(true); resolveLarge.current = null; setLargeFile(null) }}>{words.anyway}</button>
          </div>
        </section>
      </div>}
    </main>
  )
}
