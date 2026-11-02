import MarkdownIt from 'markdown-it'
import type { Notebook, Output } from './types'

export interface Heading { cellId: string; level: number; title: string }
export interface NavigationIndex {
  headings: Heading[]
  cells: { id: string; text: string }[]
}

const markdown = new MarkdownIt({ html: false })
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function outputText(output: Output): string {
  if (output.type === 'stream') return output.text
  if (output.type === 'error') return [output.ename, output.evalue, ...output.traceback].join('\n')
  return Object.entries(output.data)
    .filter(([mime]) => mime.startsWith('text/'))
    .map(([, value]) => typeof value === 'string' ? value : Array.isArray(value) ? value.join('') : '')
    .join('\n')
}

/** Index the model, including cells outside the rendered window, in small batches. */
export async function indexNavigation(notebook: Notebook, signal: AbortSignal): Promise<NavigationIndex> {
  const index: NavigationIndex = { headings: [], cells: [] }
  for (let i = 0; i < notebook.cells.length; i++) {
    if (signal.aborted) return index
    const cell = notebook.cells[i]!
    index.cells.push({ id: cell.id, text: [cell.source, ...cell.outputs.map(outputText)].join('\n').toLowerCase() })
    if (cell.type === 'markdown') {
      const tokens = markdown.parse(cell.source, {})
      for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j]!
        if (token.type !== 'heading_open') continue
        const inline = tokens[j + 1]
        const title = (inline?.children ?? []).map((child) =>
          child.type === 'softbreak' || child.type === 'hardbreak' ? ' ' : child.content,
        ).join('')
        index.headings.push({ cellId: cell.id, level: Number(token.tag.slice(1)), title })
      }
    }
    if ((i + 1) % 100 === 0) await yieldToBrowser()
  }
  return index
}

/** One result per matching cell; literal, case-insensitive search. */
export async function searchCells(index: NavigationIndex, query: string, signal: AbortSignal): Promise<string[]> {
  const needle = query.toLowerCase().trim()
  const matches: string[] = []
  if (!needle) return matches
  for (let i = 0; i < index.cells.length; i++) {
    if (signal.aborted) return matches
    const cell = index.cells[i]!
    if (cell.text.includes(needle)) matches.push(cell.id)
    if ((i + 1) % 100 === 0) await yieldToBrowser()
  }
  return matches
}
