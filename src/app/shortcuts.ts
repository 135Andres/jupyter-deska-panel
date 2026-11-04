/** The panel's keyboard shortcuts. One place decides which key means what, so
 * the handler in App stays small and this table is easy to test. */

export type ShortcutAction =
  | 'next-cell'
  | 'prev-cell'
  | 'focus-search'
  | 'next-match'
  | 'prev-match'
  | 'toggle-changed'
  | 'toggle-outputs'
  | 'show-shortcuts'
  | 'escape'

/** True when the person is writing somewhere the shortcuts must not fire. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
}

/** The shortcut a keydown stands for, or null when it is not one: another key,
 * a held modifier, or the person is typing in a field. Escape always counts. */
export function shortcutFor(event: KeyboardEvent): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Escape') return 'escape'
  if (isTyping(event.target)) return null
  switch (event.key) {
    case 'j': return 'next-cell'
    case 'k': return 'prev-cell'
    case '/': return 'focus-search'
    case 'n': return 'next-match'
    case 'N': return 'prev-match'
    case 'c': return 'toggle-changed'
    case 'o': return 'toggle-outputs'
    case '?': return 'show-shortcuts'
    default: return null
  }
}
