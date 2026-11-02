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

function renderMimeBundle(data: Record<string, unknown>, locale: Locale): HTMLElement {
  const box = el('div', 'nb-output nb-mime')
  const mime = selectMimeType(data)
  switch (mime) {
    case 'text/html':
      box.innerHTML = sanitizeHtml(asText(data[mime]))
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

function renderOutput(output: Output, locale: Locale): HTMLElement {
  if (output.type === 'mime_bundle') return renderMimeBundle(output.data, locale)
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

/** Builds the DOM for one cell. Pure DOM: no framework, nothing is executed. */
export function renderCell(cell: Cell, notebook: Notebook, locale: Locale): HTMLElement {
  const root = el('section', `nb-cell nb-${cell.type}`)
  root.dataset['cellId'] = cell.id

  if (cell.type === 'markdown') {
    const body = el('div', 'nb-markdown nb-body')
    renderMarkdownInto(body, cell.source)
    root.append(body)
    return root
  }

  const row = el('div', 'nb-input-row')
  const prompt = el('div', 'nb-prompt')
  if (cell.type === 'code') prompt.textContent = `[${cell.executionCount ?? ' '}]`
  const code = el('pre', 'nb-code')
  const inner = el('code', '')
  if (cell.type === 'code') {
    highlightInto(inner, cell.source, cell.language ?? notebook.metadata.language)
  } else {
    inner.textContent = cell.source
    root.title = t(locale, 'rawCell')
  }
  code.append(inner)
  row.append(prompt, code)
  root.append(row)

  if (cell.outputs.length > 0) {
    const outputs = el('div', 'nb-outputs')
    for (const output of cell.outputs) outputs.append(renderOutput(output, locale))
    root.append(outputs)
  }
  return root
}
