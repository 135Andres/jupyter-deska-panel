import { t } from '../i18n'
import type { Locale } from '../i18n'
import type { Cell, Notebook, Output } from '../model/types'
import { ansiInto } from './ansi'
import { highlightInto } from './highlight'
import { renderMarkdownInto, renderMath } from './markdown'
import { imageDataUri, selectMimeType } from './mime'
import { sanitizeHtml, sanitizeSvg } from './sanitize'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  return node
}

/** Notebook JSON stores text as a string or as an array of lines. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').join('')
  return ''
}

function renderLatex(target: HTMLElement, raw: string): void {
  const tex = raw.trim().replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([\s\S]*)\$$/, '$1')
  renderMath(target, tex, true)
}

/** What a copy button hands to the page: text, or a PNG. */
export type CopyItem = { kind: 'text'; text: string } | { kind: 'image'; blob: Blob }

/** PNG bytes from the data URI of an image output, or null when it does not decode. */
export function pngBlob(dataUri: string): Blob | null {
  const base64 = /^data:image\/png;base64,(.*)$/i.exec(dataUri)?.[1]
  if (!base64) return null
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: 'image/png' })
  } catch {
    return null
  }
}

function copyButton(label: string, className: string, item: () => CopyItem | null, onCopy: (item: CopyItem) => void): HTMLButtonElement {
  const button = el('button', `nb-fold ${className}`)
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', () => {
    const value = item()
    if (value) onCopy(value)
  })
  return button
}

function renderMimeBundle(data: Record<string, unknown>, locale: Locale, onCopy?: (item: CopyItem) => void): HTMLElement {
  const box = el('div', 'nb-output nb-mime')
  const mime = selectMimeType(data)
  switch (mime) {
    case 'text/html':
      box.innerHTML = sanitizeHtml(asText(data[mime]))
      // Big dataframes scroll inside their own box instead of stretching the page.
      if (box.querySelector('table')) box.classList.add('nb-scroll-table')
      break
    case 'image/svg+xml':
      box.innerHTML = sanitizeSvg(asText(data[mime]))
      break
    case 'image/png':
    case 'image/jpeg': {
      const src = imageDataUri(mime, data[mime])
      const img = el('img', 'nb-image')
      img.decoding = 'async'
      img.loading = 'lazy'
      img.alt = ''
      if (src) img.src = src
      box.append(img)
      if (src && mime === 'image/png' && onCopy) {
        box.append(copyButton(t(locale, 'copyImage'), 'nb-copy-image', () => {
          const blob = pngBlob(src)
          return blob ? { kind: 'image', blob } : null
        }, onCopy))
      }
      break
    }
    case 'text/markdown':
      box.classList.add('nb-markdown')
      renderMarkdownInto(box, asText(data[mime]))
      break
    case 'text/latex':
      renderLatex(box, asText(data[mime]))
      break
    case 'text/plain':
      box.classList.add('nb-text')
      ansiInto(box, asText(data[mime]))
      break
    default:
      box.classList.add('nb-placeholder')
      box.textContent = t(locale, 'interactive')
  }
  return box
}

function renderOutput(output: Output, locale: Locale, onCopy?: (item: CopyItem) => void): HTMLElement {
  if (output.type === 'mime_bundle') return renderMimeBundle(output.data, locale, onCopy)
  if (output.type === 'stream') {
    const box = el('pre', `nb-output nb-text nb-stream nb-${output.name === 'stderr' ? 'stderr' : 'stdout'}`)
    ansiInto(box, output.text)
    return box
  }
  const box = el('pre', 'nb-output nb-text nb-error')
  const lines = output.traceback.length > 0 ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`
  ansiInto(box, lines)
  return box
}

/** How a cell is shown: folded parts and the "outputs only" view. */
export interface CellView {
  inputFolded: boolean
  outputFolded: boolean
  outputsOnly: boolean
  onToggle(kind: 'input' | 'output'): void
  /** When set, cells get "Copy source" and PNG outputs get "Copy image". */
  onCopy?: (item: CopyItem) => void
}

/** "250 ms", "1.2 s", "1 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)} min ${total % 60} s`
}

function foldButton(kind: 'input' | 'output', label: string, folded: boolean, view: CellView): HTMLButtonElement {
  const button = el('button', `nb-fold nb-fold-${kind}`)
  button.type = 'button'
  button.textContent = label
  button.setAttribute('aria-pressed', String(folded))
  button.addEventListener('click', () => view.onToggle(kind))
  return button
}

const NO_VIEW: CellView = { inputFolded: false, outputFolded: false, outputsOnly: false, onToggle: () => {} }

/** Builds the DOM for one cell. Pure DOM: no framework, nothing is executed. */
export function renderCell(cell: Cell, notebook: Notebook, locale: Locale, view: CellView = NO_VIEW): HTMLElement {
  const root = el('section', `nb-cell nb-${cell.type}`)
  root.dataset['cellId'] = cell.id

  if (cell.type === 'markdown') {
    const body = el('div', 'nb-markdown nb-body')
    renderMarkdownInto(body, cell.source)
    root.append(body)
    return root
  }

  const hasOutputs = cell.outputs.length > 0
  const showInput = !view.outputsOnly

  if (showInput || hasOutputs) {
    const bar = el('div', 'nb-folds')
    if (showInput && view.onCopy) bar.append(copyButton(t(locale, 'copySource'), 'nb-copy-source', () => ({ kind: 'text', text: cell.source }), view.onCopy))
    if (showInput) bar.append(foldButton('input', t(locale, 'foldInput'), view.inputFolded, view))
    if (hasOutputs) bar.append(foldButton('output', t(locale, 'foldOutput'), view.outputFolded, view))
    root.append(bar)
  }

  const row = el('div', 'nb-input-row')
  const prompt = el('div', 'nb-prompt')
  if (cell.type === 'code') {
    const count = el('span', 'nb-count')
    count.textContent = `[${cell.executionCount ?? ' '}]`
    prompt.append(count)
    if (cell.durationMs !== undefined) {
      const time = el('span', 'nb-duration')
      time.textContent = formatDuration(cell.durationMs)
      prompt.append(time)
    }
  }
  if (showInput) {
    const code = el('pre', 'nb-code')
    const inner = el('code', '')
    if (view.inputFolded) {
      code.classList.add('nb-folded')
      inner.textContent = (cell.source.split('\n')[0] ?? '') + (cell.source.includes('\n') ? ' …' : '')
    } else if (cell.type === 'code') {
      highlightInto(inner, cell.source, cell.language ?? notebook.metadata.language)
    } else {
      inner.textContent = cell.source
    }
    if (cell.type === 'raw') root.title = t(locale, 'rawCell')
    code.append(inner)
    row.append(prompt, code)
    root.append(row)
  } else if (hasOutputs) {
    row.append(prompt)
    root.append(row)
  }

  if (hasOutputs) {
    const outputs = el('div', 'nb-outputs')
    if (view.outputFolded) {
      outputs.classList.add('nb-folded')
      outputs.textContent = t(locale, 'hiddenOutputs')
    } else {
      for (const output of cell.outputs) outputs.append(renderOutput(output, locale, view.onCopy))
    }
    root.append(outputs)
  }
  return root
}
