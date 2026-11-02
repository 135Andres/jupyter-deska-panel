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

/** Returns an image value only when its data URI MIME matches the output MIME. */
export function imageDataUri(mime: RasterImageMimeType, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = IMAGE_DATA_URI.exec(value)
  return match?.[1]?.toLowerCase() === mime ? value : null
}

/** Selects the first usable representation, ignoring unknown and interactive MIME types. */
export function selectMimeType(
  data: Record<string, unknown>,
): RenderableMimeType | typeof INTERACTIVE_OUTPUT_MESSAGE {
  for (const mime of MIME_PRIORITY) {
    if (!Object.hasOwn(data, mime)) continue
    if ((mime === 'image/png' || mime === 'image/jpeg') && imageDataUri(mime, data[mime]) === null) {
      continue
    }
    return mime
  }
  return INTERACTIVE_OUTPUT_MESSAGE
}
