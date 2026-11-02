import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Adapter } from '../model/types'
import { createAdapterRegistry } from './registry'

const fakeAdapter = {
  id: 'fake',
  label: 'Fake notebook',
  extensions: ['.fake'],
  detect: (name, head) => name.endsWith('.fake') && head[0] === 0x23,
  parse: async (_bytes, { yieldEvery }) => ({
    ok: false,
    error: { code: 'not_a_notebook', message: `Fake parser (${yieldEvery})` },
  }),
} satisfies Adapter

describe('adapter registry', () => {
  it('registers and lists adapters', () => {
    const registry = createAdapterRegistry()
    registry.registerAdapter(fakeAdapter)

    expectTypeOf(fakeAdapter).toExtend<Adapter>()
    expect(registry.listAdapters()).toContain(fakeAdapter)
  })

  it('rejects an adapter with a duplicate id', () => {
    const registry = createAdapterRegistry()
    registry.registerAdapter(fakeAdapter)

    expect(() => registry.registerAdapter(fakeAdapter)).toThrow(
      'Adapter id "fake" is already registered',
    )
    expect(registry.listAdapters().filter((adapter) => adapter.id === fakeAdapter.id)).toEqual([
      fakeAdapter,
    ])
  })

  it('finds an adapter from a file name and leading bytes', () => {
    const registry = createAdapterRegistry()
    registry.registerAdapter(fakeAdapter)

    expect(registry.findAdapter('example.fake', new Uint8Array([0x23]))).toBe(fakeAdapter)
    expect(registry.findAdapter('example.txt', new Uint8Array([0x23]))).toBeUndefined()
    expect(registry.findAdapter('example.fake', new Uint8Array([0x00]))).toBeUndefined()
  })

  it('keeps the adapter parse contract', async () => {
    await expect(fakeAdapter.parse(new Uint8Array(), { yieldEvery: 20 })).resolves.toEqual({
      ok: false,
      error: { code: 'not_a_notebook', message: 'Fake parser (20)' },
    })
  })
})
