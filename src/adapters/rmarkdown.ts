import type { Adapter, Cell, NotebookMetadata } from '../model/types'

const EXTENSION = /\.(rmd|qmd)$/i
/** An executable chunk opens with an engine in braces: ```{r}, ```{python, echo=FALSE}. */
const CHUNK_OPEN = /^(\s*)(`{3,})\s*\{\s*([A-Za-z][\w+-]*)/
/** Any other fence belongs to the prose, so a ```{r} inside it is not a chunk. */
const PLAIN_OPEN = /^(\s*)(`{3,})(?!\s*\{)/

const LANGUAGES: Record<string, string> = {
  r: 'r',
  python: 'python',
  julia: 'julia',
  sql: 'sql',
  scala: 'scala',
  bash: 'bash',
  sh: 'bash',
  ojs: 'javascript',
  js: 'javascript',
}

interface Draft {
  type: 'markdown' | 'code'
  source: string
  language?: string
}

function trimBlank(rows: string[]): string {
  let start = 0
  let end = rows.length
  while (start < end && rows[start]!.trim() === '') start += 1
  while (end > start && rows[end - 1]!.trim() === '') end -= 1
  return rows.slice(start, end).join('\n')
}

/** Splits the YAML front matter off, reading its `title`. */
function frontMatter(rows: string[]): { rest: string[]; title?: string } {
  if (rows[0]?.trim() !== '---') return { rest: rows }
  const end = rows.findIndex((row, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(row))
  if (end === -1) return { rest: rows }
  const title = rows
    .slice(1, end)
    .map((row) => /^title:\s*(.+?)\s*$/.exec(row)?.[1])
    .find((value) => value !== undefined)
  const clean = title?.replace(/^(["'])(.*)\1$/, '$2')
  return { rest: rows.slice(end + 1), ...(clean ? { title: clean } : {}) }
}

/** Reads R Markdown and Quarto: prose becomes Markdown cells, `{engine}` chunks become code cells. */
export const rmarkdownAdapter: Adapter = {
  id: 'rmarkdown',
  label: 'R Markdown / Quarto',
  extensions: ['.Rmd', '.qmd'],
  detect: (name) => EXTENSION.test(name),
  parse: async (bytes, options) => {
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')
    const { rest, title } = frontMatter(text.split(/\r\n|\r|\n/))

    const drafts: Draft[] = []
    let prose: string[] = []
    const flushProse = () => {
      const source = trimBlank(prose)
      if (source !== '') drafts.push({ type: 'markdown', source })
      prose = []
    }

    let chunk: { fence: string; language: string; body: string[] } | undefined
    let plainFence: string | undefined
    for (const row of rest) {
      if (chunk) {
        if (new RegExp(`^\\s*\`{${chunk.fence.length},}\\s*$`).test(row)) {
          drafts.push({ type: 'code', source: trimBlank(chunk.body), language: chunk.language })
          chunk = undefined
        } else chunk.body.push(row)
        continue
      }
      if (plainFence !== undefined) {
        prose.push(row)
        if (new RegExp(`^\\s*\`{${plainFence.length},}\\s*$`).test(row)) plainFence = undefined
        continue
      }
      const open = CHUNK_OPEN.exec(row)
      if (open) {
        flushProse()
        const engine = open[3]!.toLowerCase()
        chunk = { fence: open[2]!, language: LANGUAGES[engine] ?? engine, body: [] }
        continue
      }
      const plain = PLAIN_OPEN.exec(row)
      if (plain) plainFence = plain[2]
      prose.push(row)
    }
    // An unclosed chunk keeps what it has read.
    if (chunk) drafts.push({ type: 'code', source: trimBlank(chunk.body), language: chunk.language })
    else flushProse()

    if (drafts.length === 0) {
      return { ok: false, error: { code: 'not_a_notebook', message: 'File has no notebook cells' } }
    }

    const metadata: NotebookMetadata = {}
    const language = drafts.find((draft) => draft.type === 'code')?.language
    if (language !== undefined) metadata.language = language
    if (title !== undefined) metadata.title = title

    const yieldEvery =
      Number.isFinite(options.yieldEvery) && options.yieldEvery > 0 ? Math.floor(options.yieldEvery) : 0
    const cells: Cell[] = []
    for (let index = 0; index < drafts.length; index += 1) {
      if (yieldEvery > 0 && index > 0 && index % yieldEvery === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      const draft = drafts[index]!
      cells.push({
        id: `cell-${index}`,
        generatedId: true,
        type: draft.type,
        source: draft.source,
        ...(draft.language !== undefined ? { language: draft.language } : {}),
        outputs: [],
      })
    }
    return { ok: true, value: { cells, metadata, format: { adapterId: 'rmarkdown', version: '1' } } }
  },
} satisfies Adapter
