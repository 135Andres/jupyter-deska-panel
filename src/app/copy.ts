import type { CopyItem } from '../render'
import type { WordKey } from '../i18n'

/** The part of `deska.clipboard` that copying needs. */
export interface Clipboard {
  write(text: string): Promise<boolean>
  writeImage(image: Blob): Promise<boolean>
}

/**
 * Writes to the clipboard and answers with the word to tell the person. Never
 * throws: a refused permission, a missing focus or a host error is a notice.
 */
export async function copyToClipboard(clipboard: Clipboard | undefined, item: CopyItem): Promise<WordKey> {
  if (!clipboard) return 'copyDenied'
  try {
    if (item.kind === 'text') await clipboard.write(item.text)
    else await clipboard.writeImage(item.blob)
    return 'copied'
  } catch (err) {
    return (err as { code?: unknown } | null)?.code === 'permission_denied' ? 'copyDenied' : 'copyFailed'
  }
}
