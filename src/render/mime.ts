export const MIME_PRIORITY = [
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'text/markdown',
  'text/latex',
  'text/plain',
] as const

export type RenderableMimeType = (typeof MIME_PRIORITY)[number]
export type RasterImageMimeType = 'image/png' | 'image/jpeg'

export const INTERACTIVE_OUTPUT_MESSAGE = 'Interactive output, not shown'

const IMAGE_DATA_URI =
  /^data:(image\/(?:png|jpeg));base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/i

/** Whether a value is a base64 PNG or JPEG data URI, with no other URL form allowed. */
export function isImageDataUri(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_DATA_URI.test(value)
}

/**
 * Returns a data URI for an image value, or null when it is not a valid image of
 * that MIME type. Jupyter stores PNG and JPEG as bare base64 (a string, or lines,
 * often ending in a newline); a full data URI is also accepted when its MIME matches.
 */
export function imageDataUri(mime: RasterImageMimeType, value: unknown): string | null {
  const text = Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join('') : value
  if (typeof text !== 'string') return null
  if (text.startsWith('data:')) {
    return IMAGE_DATA_URI.exec(text)?.[1]?.toLowerCase() === mime ? text : null
  }
  const base64 = text.replace(/\s+/g, '')
  const uri = `data:${mime};base64,${base64}`
  return IMAGE_DATA_URI.test(uri) ? uri : null
}

const PLOTLY_MIME = 'application/vnd.plotly.v1+json'

/**
 * Selects the first usable representation, ignoring unknown and interactive MIME types.
 * A Plotly output with no image shows the placeholder rather than its text/plain repr.
 */
export function selectMimeType(
  data: Record<string, unknown>,
): RenderableMimeType | typeof INTERACTIVE_OUTPUT_MESSAGE {
  for (const mime of MIME_PRIORITY) {
    if (!Object.hasOwn(data, mime)) continue
    if ((mime === 'image/png' || mime === 'image/jpeg') && imageDataUri(mime, data[mime]) === null) {
      continue
    }
    if (mime === 'text/plain' && Object.hasOwn(data, PLOTLY_MIME)) break
    return mime
  }
  return INTERACTIVE_OUTPUT_MESSAGE
}
