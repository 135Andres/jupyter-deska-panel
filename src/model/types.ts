/** A notebook normalized by an adapter. */
export interface Notebook {
  cells: Cell[]
  metadata: NotebookMetadata
  format: NotebookFormat
}

/** Optional notebook-level information supplied by the source format. */
export interface NotebookMetadata {
  kernel?: string
  language?: string
  title?: string
}

/** The adapter that read the notebook and the source format version. */
export interface NotebookFormat {
  adapterId: string
  version: string
}

/** The supported cell kinds. */
export type CellType = 'markdown' | 'code' | 'raw'

/** A normalized notebook cell with a stable, adapter-assigned id. */
export interface Cell {
  id: string
  /** True when the adapter generated a positional id rather than reading one. */
  generatedId?: boolean
  type: CellType
  source: string
  language?: string
  executionCount?: number
  /** How long the cell ran, in milliseconds, when the notebook records it. */
  durationMs?: number
  outputs: Output[]
}

/** A display output containing values and metadata keyed by MIME type. */
export interface MimeBundleOutput {
  type: 'mime_bundle'
  data: Record<string, unknown>
  metadata: Record<string, unknown>
}

/** Text written to a named output stream. */
export interface StreamOutput {
  type: 'stream'
  name: string
  text: string
}

/** An execution error and its formatted traceback lines. */
export interface ErrorOutput {
  type: 'error'
  ename: string
  evalue: string
  traceback: string[]
}

/** An output saved in a notebook cell. */
export type Output = MimeBundleOutput | StreamOutput | ErrorOutput

/** A parsing failure, with the source version for unsupported formats. */
export type ParseError =
  | { code: 'invalid_json'; message: string }
  | { code: 'unsupported_format'; message: string; version: string }
  | { code: 'not_a_notebook'; message: string }

/** The closed set of notebook parsing error codes. */
export type ParseErrorCode = ParseError['code']

/** A success or failure value without exceptions or classes. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/** Controls cooperative yielding during parsing. */
export interface ParseOptions {
  yieldEvery: number
}

/** Reads one notebook format into the shared cell model. */
export interface Adapter {
  id: string
  label: string
  extensions: readonly string[]
  detect(name: string, head: Uint8Array): boolean
  parse(bytes: Uint8Array, options: ParseOptions): Promise<Result<Notebook, ParseError>>
}
