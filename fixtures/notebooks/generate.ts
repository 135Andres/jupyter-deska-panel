/**
 * Deterministic generators for the two notebooks that are too large to keep in
 * the repository: one with 10,000 mixed cells and one over 50 MiB.
 *
 * Both return the notebook bytes and never write to disk. A caller that needs a
 * file writes them to the system temporary directory, never inside the repo.
 *
 * Every notebook produced here is nbformat 4.5. The same parameters always give
 * the same bytes: there is no clock and no random number generator.
 */

/** The cell count of the mixed notebook. */
export const MIXED_CELL_COUNT = 10_000

/** The size the large notebook aims for, comfortably over 50 MiB. */
export const LARGE_NOTEBOOK_BYTES = 52 * 1024 * 1024

const encoder = new TextEncoder()

/** One line of the payload repeated in the large notebook's text outputs. */
const PAYLOAD_LINE = `${'0123456789abcdef'.repeat(4)}\n`

/** About 66 KiB of deterministic text, used by the large notebook. */
const PAYLOAD = PAYLOAD_LINE.repeat(1024)

const NOTEBOOK_METADATA = {
  kernelspec: {
    display_name: 'Python 3',
    language: 'python',
    name: 'python3',
  },
  language_info: {
    name: 'python',
    version: '3.12.0',
    mimetype: 'text/x-python',
    file_extension: '.py',
  },
}

/** A stable, schema-valid cell id for a zero-based cell index. */
function cellId(index: number): string {
  return `cell-${String(index + 1).padStart(5, '0')}`
}

/** Serializes cells and the notebook header into the final JSON text. */
function notebookJson(cells: string[]): string {
  return (
    '{"cells":[' +
    cells.join(',') +
    '],"metadata":' +
    JSON.stringify(NOTEBOOK_METADATA) +
    ',"nbformat":4,"nbformat_minor":5}'
  )
}

/** Builds a Markdown cell. */
function markdownCell(index: number, source: string): string {
  return JSON.stringify({
    cell_type: 'markdown',
    id: cellId(index),
    metadata: {},
    source,
  })
}

/** Builds a code cell with an execution count and outputs. */
function codeCell(
  index: number,
  source: string,
  outputs: unknown[],
  executionCount: number,
): string {
  return JSON.stringify({
    cell_type: 'code',
    execution_count: executionCount,
    id: cellId(index),
    metadata: {},
    outputs,
    source,
  })
}

/** A stdout stream output carrying one line. */
function streamOutput(text: string): unknown {
  return { name: 'stdout', output_type: 'stream', text: [text] }
}

/** A display_data output with a text/plain value. */
function textOutput(text: string): unknown {
  return {
    data: { 'text/plain': [text] },
    metadata: {},
    output_type: 'display_data',
  }
}

/** Builds the code cell used for every odd cell of the mixed notebook. */
function mixedCodeCell(index: number): string {
  const number = index + 1
  const outputs: unknown[] = [streamOutput(`cell ${number} ran\n`)]
  if (number % 10 === 0) {
    outputs.push(textOutput(`result ${number}: ${'x'.repeat(32)}`))
  }
  if (number % 100 === 0) {
    outputs.push({
      data: {
        'text/html': [`<table class="dataframe"><tbody><tr><td>${number}</td></tr></tbody></table>`],
        'text/plain': [`${number}`],
      },
      metadata: {},
      output_type: 'display_data',
    })
  }
  return codeCell(index, `print("cell ${number}")\n`, outputs, number)
}

/** Builds the Markdown cell used for every even cell of the mixed notebook. */
function mixedMarkdownCell(index: number): string {
  const number = index + 1
  const source =
    number % 100 === 0
      ? `## Section ${number / 100}\n\nA synthetic heading, with inline math $x_{${number}}^2$.\n`
      : `Paragraph ${number} of the synthetic notebook.\n`
  return markdownCell(index, source)
}

/** Returns a deterministic notebook with `cellCount` alternating cell kinds. */
export function generateMixedNotebook(cellCount = MIXED_CELL_COUNT): Uint8Array {
  const cells: string[] = []
  for (let index = 0; index < cellCount; index += 1) {
    cells.push(index % 2 === 0 ? mixedMarkdownCell(index) : mixedCodeCell(index))
  }
  return encoder.encode(notebookJson(cells))
}

/**
 * Returns a deterministic notebook whose JSON bytes exceed `targetBytes`.
 *
 * Each cell writes a fixed block of text, so the loop that adds cells is what
 * makes the result big; the content itself never changes between runs.
 */
export function generateLargeNotebook(targetBytes = LARGE_NOTEBOOK_BYTES): Uint8Array {
  const headerAndFooter = notebookJson([]).length
  const cells: string[] = []
  let size = headerAndFooter
  for (let index = 0; size <= targetBytes; index += 1) {
    const cell =
      index % 4 === 3
        ? markdownCell(index, `## Block ${index + 1}\n\n${PAYLOAD}`)
        : codeCell(
            index,
            `print("block ${index + 1}")\n`,
            [streamOutput(`block ${index + 1}\n`), textOutput(PAYLOAD)],
            index + 1,
          )
    cells.push(cell)
    size += cell.length + 1
  }
  return encoder.encode(notebookJson(cells))
}
