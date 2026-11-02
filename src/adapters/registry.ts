import type { Adapter } from '../model/types'

/** Creates an isolated adapter registry. */
export function createAdapterRegistry() {
  const adapters: Adapter[] = []

  return {
    registerAdapter(adapter: Adapter): void {
      if (adapters.some((registered) => registered.id === adapter.id)) {
        throw new Error(`Adapter id "${adapter.id}" is already registered`)
      }
      adapters.push(adapter)
    },
    listAdapters(): readonly Adapter[] {
      return [...adapters]
    },
    findAdapter(name: string, head: Uint8Array): Adapter | undefined {
      return adapters.find((adapter) => adapter.detect(name, head))
    },
  }
}

const defaultRegistry = createAdapterRegistry()

/**
 * Registers an adapter in detection order and rejects duplicate ids.
 * @throws {Error} If the adapter id is already registered.
 */
export function registerAdapter(adapter: Adapter): void {
  defaultRegistry.registerAdapter(adapter)
}

/** Lists registered adapters without exposing the registry for mutation. */
export function listAdapters(): readonly Adapter[] {
  return defaultRegistry.listAdapters()
}

/** Returns the first adapter that detects a file name and its leading bytes. */
export function findAdapter(name: string, head: Uint8Array): Adapter | undefined {
  return defaultRegistry.findAdapter(name, head)
}
