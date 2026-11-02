import { describe, expect, test } from 'vitest'
import {
  imageDataUri,
  INTERACTIVE_OUTPUT_MESSAGE,
  MIME_PRIORITY,
  selectMimeType,
} from './mime'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const JPEG = 'data:image/jpeg;base64,/9j/2Q=='

function valueFor(mime: (typeof MIME_PRIORITY)[number]): unknown {
  if (mime === 'image/png') return PNG
  if (mime === 'image/jpeg') return JPEG
  return mime
}

describe('selectMimeType', () => {
  test.each(MIME_PRIORITY)('selects %s at its priority position', (mime) => {
    const position = MIME_PRIORITY.indexOf(mime)
    const data = Object.fromEntries(
      MIME_PRIORITY.slice(position)
        .reverse()
        .map((candidate) => [candidate, valueFor(candidate)]),
    )
    data['application/vnd.plotly.v1+json'] = '{}'
    data['application/x-unknown'] = 'unknown'

    expect(selectMimeType(data)).toBe(mime)
  })

  test('uses the declared priority rather than bundle insertion order', () => {
    expect(
      selectMimeType({
        'text/plain': 'plain',
        'text/html': '<p>HTML</p>',
        'image/svg+xml': '<svg />',
      }),
    ).toBe('text/html')
  })

  test('falls through unknown and interactive representations', () => {
    expect(
      selectMimeType({
        'application/vnd.plotly.v1+json': '{}',
        'application/x-unknown': 'unknown',
        'text/plain': 'static fallback',
      }),
    ).toBe('text/plain')
  })

  test('returns the interactive placeholder when there is no renderable fallback', () => {
    expect(selectMimeType({ 'application/vnd.plotly.v1+json': '{}' })).toBe(
      INTERACTIVE_OUTPUT_MESSAGE,
    )
    expect(selectMimeType({})).toBe(INTERACTIVE_OUTPUT_MESSAGE)
  })
})

describe('raster image data', () => {
  test.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
  ] as const)('accepts a base64 data URI for %s', (mime, value) => {
    expect(imageDataUri(mime, value)).toBe(value)
    expect(selectMimeType({ [mime]: value })).toBe(mime)
  })

  test.each([
    'https://example.com/image.png',
    '/image.png',
    'iVBORw0KGgo=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png,iVBORw0KGgo=',
    'data:image/png;base64,not base64!',
  ])('rejects a non-matching or non-base64 image value: %s', (value) => {
    expect(imageDataUri('image/png', value)).toBeNull()
    expect(
      selectMimeType({ 'image/png': value, 'text/plain': 'safe fallback' }),
    ).toBe('text/plain')
  })

  test('rejects a data URI whose MIME differs from the bundle key', () => {
    expect(imageDataUri('image/png', JPEG)).toBeNull()
    expect(
      selectMimeType({ 'image/png': JPEG, 'text/markdown': 'fallback' }),
    ).toBe('text/markdown')
  })
})
