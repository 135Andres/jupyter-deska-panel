import DOMPurify from 'dompurify'
import type { Config } from 'dompurify'
import { isImageDataUri } from './mime'

const IMAGE_TAGS = new Set(['img', 'image'])
const IMAGE_URL_ATTRIBUTES = new Set(['src', 'href', 'xlink:href'])

// Embedded raster images are data-only; other URLs and executable URL values are dropped.
DOMPurify.addHook('uponSanitizeAttribute', (node, attribute) => {
  const name = attribute.attrName.toLowerCase()
  // Control characters are stripped on purpose: they hide "javascript:" from naive URL checks.
  // eslint-disable-next-line no-control-regex
  const compactValue = attribute.attrValue.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '')

  if (
    /^on/i.test(name) ||
    /javascript:|data:text\/html/i.test(compactValue) ||
    (IMAGE_TAGS.has(node.tagName.toLowerCase()) &&
      IMAGE_URL_ATTRIBUTES.has(name) &&
      !isImageDataUri(attribute.attrValue))
  ) {
    attribute.keepAttr = false
  }
})

const COMMON_CONFIG = {
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'foreignobject',
    'animate',
    'animatemotion',
    'animatetransform',
    'set',
    'discard',
  ],
  FORBID_ATTR: ['style', 'srcset'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
  KEEP_CONTENT: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  RETURN_TRUSTED_TYPE: false,
} satisfies Config

/** Sanitizes an untrusted HTML fragment before it is inserted into the document. */
export function sanitizeHtml(html: string): string {
  if (!DOMPurify.isSupported) return ''
  return DOMPurify.sanitize(html, {
    ...COMMON_CONFIG,
    USE_PROFILES: { html: true },
  })
}

/** Sanitizes an untrusted, static SVG fragment before it is inserted into the document. */
export function sanitizeSvg(svg: string): string {
  if (!DOMPurify.isSupported) return ''
  return DOMPurify.sanitize(svg, {
    ...COMMON_CONFIG,
    NAMESPACE: 'http://www.w3.org/2000/svg',
    USE_PROFILES: { svg: true, svgFilters: true },
  })
}
