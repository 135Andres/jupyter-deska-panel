import type { Adapter } from '../model/types'

const adapters: Adapter[] = []

/** Registers an adapter in detection order and rejects duplicate ids. */
export function registerAdapter(adapter: Adapter): void {
  if (adapters.some((registered) => registered.id === adapter.id)) {
    throw new Error(`Adapter id "${adapter.id}" is already registered`)
  }
  adapters.push(adapter)
}

/** Lists registered adapters without exposing the registry for mutation. */
export function listAdapters(): readonly Adapter[] {
  return [...adapters]
}

/** Returns the first adapter that detects a file name and its leading bytes. */
export function findAdapter(name: string, head: Uint8Array): Adapter | undefined {
  return adapters.find((adapter) => adapter.detect(name, head))
}
