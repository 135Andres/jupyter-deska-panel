import { describe, expect, it } from 'vitest'
import { shortcutFor } from './shortcuts'

const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, key: k, target: document.body, ...over }) as KeyboardEvent

const typing = (k: string) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, key: k, target: document.createElement('input') }) as unknown as KeyboardEvent

describe('shortcutFor', () => {
  it('maps each shortcut key', () => {
    expect(shortcutFor(key('j'))).toBe('next-cell')
    expect(shortcutFor(key('k'))).toBe('prev-cell')
    expect(shortcutFor(key('/'))).toBe('focus-search')
    expect(shortcutFor(key('n'))).toBe('next-match')
    expect(shortcutFor(key('N'))).toBe('prev-match')
    expect(shortcutFor(key('c'))).toBe('toggle-changed')
    expect(shortcutFor(key('o'))).toBe('toggle-outputs')
    expect(shortcutFor(key('?'))).toBe('show-shortcuts')
    expect(shortcutFor(key('Escape'))).toBe('escape')
  })

  it('ignores keys that are not shortcuts', () => {
    expect(shortcutFor(key('x'))).toBeNull()
    expect(shortcutFor(key('J'))).toBeNull()
    expect(shortcutFor(key('Enter'))).toBeNull()
  })

  it('does not fire while the person is typing, except for Escape', () => {
    expect(shortcutFor(typing('j'))).toBeNull()
    expect(shortcutFor(typing('/'))).toBeNull()
    expect(shortcutFor(typing('c'))).toBeNull()
    expect(shortcutFor(typing('Escape'))).toBe('escape')
  })

  it('does not fire with a held modifier', () => {
    expect(shortcutFor(key('j', { ctrlKey: true }))).toBeNull()
    expect(shortcutFor(key('k', { metaKey: true }))).toBeNull()
    expect(shortcutFor(key('o', { altKey: true }))).toBeNull()
    expect(shortcutFor(key('Escape', { ctrlKey: true }))).toBeNull()
  })

  it('ignores contenteditable fields too', () => {
    const field = document.createElement('div')
    field.contentEditable = 'true'
    expect(shortcutFor({ ...key('j'), target: field } as KeyboardEvent)).toBeNull()
  })
})
