import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import type { Adapter } from '../model/types'
import { findAdapter, listAdapters, registerAdapter } from './registry'

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
  beforeAll(() => {
    registerAdapter(fakeAdapter)
  })

  it('registers and lists adapters', () => {
    expectTypeOf(fakeAdapter).toExtend<Adapter>()
    expect(listAdapters()).toContain(fakeAdapter)
  })

  it('rejects an adapter with a duplicate id', () => {
    expect(() => registerAdapter(fakeAdapter)).toThrow('Adapter id "fake" is already registered')
    expect(listAdapters().filter((adapter) => adapter.id === fakeAdapter.id)).toEqual([fakeAdapter])
  })

  it('finds an adapter from a file name and leading bytes', () => {
    expect(findAdapter('example.fake', new Uint8Array([0x23]))).toBe(fakeAdapter)
    expect(findAdapter('example.txt', new Uint8Array([0x23]))).toBeUndefined()
    expect(findAdapter('example.fake', new Uint8Array([0x00]))).toBeUndefined()
  })

  it('keeps the adapter parse contract', async () => {
    await expect(fakeAdapter.parse(new Uint8Array(), { yieldEvery: 20 })).resolves.toEqual({
      ok: false,
      error: { code: 'not_a_notebook', message: 'Fake parser (20)' },
    })
  })
})
