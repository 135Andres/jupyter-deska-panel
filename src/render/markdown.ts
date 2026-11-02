import katex from 'katex'
import MarkdownIt from 'markdown-it'
import type { StateBlock, StateInline } from 'markdown-it'
import { sanitizeHtml } from './sanitize'

const DOLLAR = 0x24

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** `$...$` inline math. The closing `$` must not follow a space or precede a digit. */
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== DOLLAR) return false
  const display = src.charCodeAt(start + 1) === DOLLAR
  const open = display ? 2 : 1
  let end = start + open
  for (; end < src.length; end++) {
    const ch = src.charCodeAt(end)
    if (ch === 0x5c) {
      end++
      continue
    }
    if (ch === DOLLAR && (!display || src.charCodeAt(end + 1) === DOLLAR)) break
  }
  if (end >= src.length) return false
  const tex = src.slice(start + open, end)
  if (!tex.trim()) return false
  if (!display && (/^\s|\s$/.test(tex) || /\d/.test(src.charAt(end + 1)))) return false
  if (!silent) {
    const token = state.push('math', '', 0)
    token.content = tex
    token.meta = { display }
  }
  state.pos = end + (display ? 2 : 1)
  return true
}

/** A `$$` fence on its own lines. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const first = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine])
  if (!first.startsWith('$$')) return false
  let line = startLine
  let body = first.slice(2)
  let closed = body.trimEnd().endsWith('$$')
  if (closed) body = body.trimEnd().slice(0, -2)
  while (!closed && ++line < endLine) {
    const text = state.src.slice(state.bMarks[line], state.eMarks[line])
    if (text.trimEnd().endsWith('$$')) {
      body += '\n' + text.trimEnd().slice(0, -2)
      closed = true
    } else {
      body += '\n' + text
    }
  }
  if (!closed) return false
  if (silent) return true
  const token = state.push('math', '', 0)
  token.content = body.trim()
  token.meta = { display: true }
  token.block = true
  token.map = [startLine, line + 1]
  state.line = line + 1
  return true
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
md.inline.ruler.before('escape', 'math', mathInline)
md.block.ruler.before('fence', 'math', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
md.renderer.rules['math'] = (tokens, idx) => {
  const token = tokens[idx]!
  const display = (token.meta as { display: boolean }).display
  return `<span class="nb-math" data-display="${display}" data-tex="${escapeAttr(token.content)}"></span>`
}

/** Renders KaTeX into a target. A bad formula stays visible as its source. */
export function renderMath(target: HTMLElement, tex: string, display: boolean): void {
  try {
    target.innerHTML = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      output: 'html',
    })
  } catch {
    target.textContent = display ? `$$${tex}$$` : `$${tex}$`
    target.classList.add('nb-math-error')
  }
}

/** Fills a container with sanitized Markdown, with LaTeX typeset by KaTeX. */
export function renderMarkdownInto(target: HTMLElement, source: string): void {
  target.innerHTML = sanitizeHtml(md.render(source))
  for (const span of target.querySelectorAll<HTMLElement>('span.nb-math')) {
    renderMath(span, span.dataset['tex'] ?? '', span.dataset['display'] === 'true')
  }
}
