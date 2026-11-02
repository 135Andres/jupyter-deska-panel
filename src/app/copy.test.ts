import { expect, test, vi } from 'vitest'
import { copyToClipboard } from './copy'

const blob = new Blob(['x'], { type: 'image/png' })
const refuse = (code: string) => Object.assign(new Error(code), { code })

test('copies text and images', async () => {
  const clipboard = { write: vi.fn().mockResolvedValue(true), writeImage: vi.fn().mockResolvedValue(true) }
  expect(await copyToClipboard(clipboard, { kind: 'text', text: 'a' })).toBe('copied')
  expect(await copyToClipboard(clipboard, { kind: 'image', blob })).toBe('copied')
  expect(clipboard.write).toHaveBeenCalledWith('a')
  expect(clipboard.writeImage).toHaveBeenCalledWith(blob)
})

test('a refused permission, a missing API or another failure becomes a notice, not a throw', async () => {
  const denied = { write: vi.fn().mockRejectedValue(refuse('permission_denied')), writeImage: vi.fn() }
  expect(await copyToClipboard(denied, { kind: 'text', text: 'a' })).toBe('copyDenied')
  expect(await copyToClipboard(undefined, { kind: 'text', text: 'a' })).toBe('copyDenied')
  const broken = { write: vi.fn(), writeImage: vi.fn().mockRejectedValue(refuse('host_error')) }
  expect(await copyToClipboard(broken, { kind: 'image', blob })).toBe('copyFailed')
  const odd = { write: vi.fn().mockRejectedValue(null), writeImage: vi.fn() }
  expect(await copyToClipboard(odd, { kind: 'text', text: 'a' })).toBe('copyFailed')
})
