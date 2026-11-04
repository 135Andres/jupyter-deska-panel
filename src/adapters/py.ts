import type { Adapter, Cell, NotebookMetadata, ParseError, Result } from '../model/types'
import { createYieldPolicy, yieldToBrowser } from '../model/yield'

/** A cell before it gets an id; the three `.py` formats never carry outputs. */
interface Draft {
  type: 'markdown' | 'code' | 'raw'
  source: string
  language?: string
  /** The format's own name for the cell, when it has one. */
  name?: string
}

const DATABRICKS_HEADER = '# Databricks notebook source'
const DATABRICKS_SEPARATOR = /^# COMMAND -{5,}\s*$/
const PERCENT_MARKER = /^#\s?%%(?!%)(.*)$/

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes)
const lines = (text: string): string[] => text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
const isPy = (name: string): boolean => name.toLowerCase().endsWith('.py')

/** Drops blank lines at both ends and joins the rest. */
function trimBlank(rows: string[]): string {
  let start = 0
  let end = rows.length
  while (start < end && rows[start]!.trim() === '') start += 1
  while (end > start && rows[end - 1]!.trim() === '') end -= 1
  return rows.slice(start, end).join('\n')
}

/** Removes the indentation shared by every non-blank line. */
function dedent(rows: string[]): string[] {
  let common = Infinity
  for (const row of rows) {
    if (row.trim() === '') continue
    common = Math.min(common, row.length - row.trimStart().length)
  }
  if (!Number.isFinite(common) || common === 0) return rows
  return rows.map((row) => row.slice(Math.min(common, row.length - row.trimStart().length)))
}

async function build(
  drafts: Draft[],
  adapterId: string,
  version: string,
  options: { yieldEvery: number },
  metadata: NotebookMetadata,
): Promise<Result<import('../model/types').Notebook, ParseError>> {
  if (drafts.length === 0) {
    return { ok: false, error: { code: 'not_a_notebook', message: 'File has no notebook cells' } }
  }
  const shouldYield = createYieldPolicy(options.yieldEvery)
  const used = new Set<string>()
  const cells: Cell[] = []
  for (let index = 0; index < drafts.length; index += 1) {
    if (shouldYield(index)) await yieldToBrowser()
    const draft = drafts[index]!
    const named = draft.name !== undefined && !used.has(draft.name)
    const id = named ? draft.name! : `cell-${index}`
    used.add(id)
    const cell: Cell = {
      id,
      ...(named ? {} : { generatedId: true }),
      type: draft.type,
      source: draft.source,
      outputs: [],
    }
    if (draft.type === 'code') cell.language = draft.language ?? metadata.language
    cells.push(cell)
  }
  return { ok: true, value: { cells, metadata, format: { adapterId, version } } }
}

// ---------------------------------------------------------------- Jupytext

/** Reads the `# ---` YAML header Jupytext writes, returning what is left. */
function jupytextHeader(rows: string[]): { rest: string[]; metadata: NotebookMetadata } {
  const metadata: NotebookMetadata = { language: 'python' }
  if (rows[0]?.trim() !== '# ---') return { rest: rows, metadata }
  const end = rows.findIndex((row, i) => i > 0 && row.trim() === '# ---')
  if (end === -1) return { rest: rows, metadata }
  const block = rows.slice(1, end).map((row) => row.replace(/^#\s?/, ''))
  const kernelspec = block.findIndex((row) => /^\s*kernelspec:/.test(row))
  if (kernelspec !== -1) {
    for (const row of block.slice(kernelspec + 1)) {
      if (!/^\s/.test(row)) break
      const name = /^\s+name:\s*(\S+)/.exec(row)?.[1]
      const language = /^\s+language:\s*(\S+)/.exec(row)?.[1]
      if (name) metadata.kernel = name
      if (language) metadata.language = language
    }
  }
  const title = block.map((row) => /^title:\s*(.+)$/.exec(row)?.[1]).find(Boolean)
  if (title) metadata.title = title.replace(/^["']|["']$/g, '')
  return { rest: rows.slice(end + 1), metadata }
}

function commented(rows: string[]): string {
  return trimBlank(rows.map((row) => (row.trim() === '#' ? '' : row.replace(/^# ?/, ''))))
}

/** Reads a Jupytext "percent" script: `# %%` starts a cell. */
export const jupytextAdapter: Adapter = {
  id: 'jupytext',
  label: 'Jupytext script',
  extensions: ['.py'],
  detect: (name, head) => isPy(name) && lines(decode(head)).some((row) => PERCENT_MARKER.test(row)) &&
    !decode(head).trimStart().startsWith(DATABRICKS_HEADER),
  parse: async (bytes, options) => {
    const { rest, metadata } = jupytextHeader(lines(decode(bytes)))
    const drafts: Draft[] = []
    let kind: Draft['type'] | undefined
    let body: string[] = []
    const flush = () => {
      if (kind === undefined) {
        const source = trimBlank(body)
        if (source !== '') drafts.push({ type: 'code', source })
      } else if (kind === 'code') drafts.push({ type: 'code', source: trimBlank(body) })
      else drafts.push({ type: kind, source: commented(body) })
    }
    for (const row of rest) {
      const marker = PERCENT_MARKER.exec(row)
      if (!marker) {
        body.push(row)
        continue
      }
      flush()
      body = []
      const tag = /\[(markdown|md|raw)\]/.exec(marker[1]!)?.[1]
      kind = tag === undefined ? 'code' : tag === 'raw' ? 'raw' : 'markdown'
    }
    flush()
    return build(drafts, 'jupytext', 'percent', options, metadata)
  },
} satisfies Adapter

// -------------------------------------------------------------- Databricks

const MAGIC_LANGUAGES: Record<string, string> = {
  sql: 'sql',
  scala: 'scala',
  r: 'r',
  python: 'python',
  sh: 'bash',
}

function databricksCell(chunk: string[]): Draft | undefined {
  const rows = chunk.filter((row) => !row.startsWith('# DBTITLE'))
  const content = rows.filter((row) => row.trim() !== '')
  if (content.length === 0) return undefined
  if (!content.every((row) => /^# MAGIC(\s|$)/.test(row))) {
    return { type: 'code', source: trimBlank(rows) }
  }
  const stripped = rows.map((row) => row.replace(/^# MAGIC ?/, ''))
  const first = stripped.findIndex((row) => row.trim() !== '')
  const magic = /^%([\w-]+)\s*(.*)$/.exec(stripped[first]!)
  const tail = (): string[] => (magic![2] ? [magic![2], ...stripped.slice(first + 1)] : stripped.slice(first + 1))
  if (magic && (magic[1] === 'md' || magic[1] === 'md-sandbox')) {
    return { type: 'markdown', source: trimBlank(tail()) }
  }
  const language = magic ? MAGIC_LANGUAGES[magic[1]!] : undefined
  if (language !== undefined) return { type: 'code', source: trimBlank(tail()), language }
  return { type: 'code', source: trimBlank(stripped) }
}

/** Reads a Databricks source export: `# COMMAND ----------` separates cells. */
export const databricksAdapter: Adapter = {
  id: 'databricks-source',
  label: 'Databricks source notebook',
  extensions: ['.py'],
  detect: (name, head) => isPy(name) && decode(head).replace(/^\uFEFF/, '').startsWith(DATABRICKS_HEADER),
  parse: async (bytes, options) => {
    const rows = lines(decode(bytes))
    if (rows[0]?.trim() === DATABRICKS_HEADER) rows.shift()
    const chunks: string[][] = [[]]
    for (const row of rows) {
      if (DATABRICKS_SEPARATOR.test(row)) chunks.push([])
      else chunks[chunks.length - 1]!.push(row)
    }
    const drafts = chunks.map(databricksCell).filter((draft): draft is Draft => draft !== undefined)
    return build(drafts, 'databricks-source', '1', options, { language: 'python' })
  },
} satisfies Adapter

// ------------------------------------------------------------------ marimo

const MARIMO_MARKDOWN = /^mo\.md\(\s*(?:[rRfF]{0,2})("""|'''|"|')([\s\S]*?)\1\s*\)\s*$/

/** Turns one `@app.cell` function into a cell: its body, minus the final `return`. */
function marimoCell(chunk: string[]): Draft {
  const def = chunk.findIndex((row) => /^(async\s+)?def\s/.test(row))
  let headerEnd = def
  while (headerEnd < chunk.length - 1 && !chunk[headerEnd]!.trimEnd().endsWith(':')) headerEnd += 1
  const name = /^(?:async\s+)?def\s+(\w+)/.exec(chunk[def]!)?.[1]
  const body = dedent(chunk.slice(headerEnd + 1))
  let ret = body.length - 1
  while (ret >= 0 && !/^return(\s|\(|$)/.test(body[ret]!)) ret -= 1
  const code = ret === -1 ? body : body.slice(0, ret)
  const source = trimBlank(code)
  const draft: Draft = { type: 'code', source }
  if (name !== undefined && !/^_\d*$/.test(name)) draft.name = name
  const markdown = MARIMO_MARKDOWN.exec(source)
  if (markdown) {
    draft.type = 'markdown'
    draft.source = trimBlank(dedent(markdown[2]!.split('\n')))
  }
  return draft
}

/** Reads a marimo app: every `@app.cell` function is one cell. */
export const marimoAdapter: Adapter = {
  id: 'marimo',
  label: 'marimo notebook',
  extensions: ['.py'],
  detect: (name, head) => {
    if (!isPy(name)) return false
    const text = decode(head)
    return /^import marimo\b/m.test(text) && /^@app\.cell\b/m.test(text)
  },
  parse: async (bytes, options) => {
    const chunks: string[][] = []
    let current: string[] | undefined
    for (const row of lines(decode(bytes))) {
      if (/^@app\.cell\b/.test(row)) {
        current = [row]
        chunks.push(current)
      } else if (/^(@app\.|app\.run|if __name__)/.test(row)) {
        current = undefined
      } else if (current) {
        current.push(row)
      }
    }
    const drafts = chunks.filter((chunk) => chunk.some((row) => /^(async\s+)?def\s/.test(row))).map(marimoCell)
    return build(drafts, 'marimo', '1', options, { language: 'python' })
  },
} satisfies Adapter
