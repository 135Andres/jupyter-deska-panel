import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DropSource,
  LAST_NOTEBOOK_STORAGE_KEY,
  MAX_PERSISTED_BYTES,
  type DropSourceSdk,
} from './drop-source'

class SdkDouble {
  readonly storageValues = new Map<string, unknown>()
  readonly files = new Map<string, Blob>()
  readonly removed: string[] = []
  putError: Error | null = null
  outside = false
  ready: Promise<unknown> = Promise.resolve({})
  private nextId = 1

  readonly sdk: DropSourceSdk = {
    ready: () => this.ready,
    storage: {
      get: async (key) => this.storageValues.get(key) ?? null,
      set: async (key, value) => {
        this.storageValues.set(key, value)
        return true
      },
      remove: async (key) => {
        this.storageValues.delete(key)
        return true
      },
    },
    files: {
      put: async (file) => {
        if (this.outside) return new Promise(() => undefined)
        if (this.putError) throw this.putError
        const id = `file-${this.nextId++}`
        this.files.set(id, file)
        return { id }
      },
      get: async (id) => this.files.get(id) ?? null,
      remove: async (id) => {
        this.files.delete(id)
        this.removed.push(id)
        return true
      },
    },
  }
}

const sources: DropSource[] = []

function makeSource(sdk?: DropSourceSdk): { source: DropSource; target: HTMLDivElement } {
  const target = document.createElement('div')
  document.body.append(target)
  const source = new DropSource(target, sdk)
  sources.push(source)
  return { source, target }
}

function notebook(name = 'analysis.ipynb', contents = '{"cells":[]}', lastModified = 100): File {
  return new File([contents], name, { type: 'application/json', lastModified })
}

function notebookOfSize(size: number): File {
  const file = notebook()
  const bytes = new Uint8Array(size)
  Object.defineProperties(file, {
    size: { value: size },
    arrayBuffer: { value: async () => bytes.buffer },
  })
  return file
}

async function drop(target: HTMLElement, file: File): Promise<void> {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
  target.dispatchEvent(event)
  await vi.waitFor(() => expect((event as unknown as { defaultPrevented: boolean }).defaultPrevented).toBe(true))
}

async function opened(source: DropSource): Promise<void> {
  await vi.waitFor(async () => expect(await source.current()).not.toBeNull(), { timeout: 5_000 })
}

function restored(source: DropSource): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = source.onChange(() => {
      unsubscribe()
      resolve()
    })
  })
}

afterEach(() => {
  for (const source of sources.splice(0)) source.destroy()
  document.body.replaceChildren()
})

describe('DropSource input', () => {
  it('prevents dragover default and opens a dropped file', async () => {
    const { source, target } = makeSource(new SdkDouble().sdk)
    const changed = vi.fn()
    source.onChange(changed)
    const dragover = new Event('dragover', { bubbles: true, cancelable: true })
    target.dispatchEvent(dragover)
    expect(dragover.defaultPrevented).toBe(true)

    await drop(target, notebook())
    await opened(source)

    expect((await source.current())?.name).toBe('analysis.ipynb')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('opens a file chosen with a picker inside the target', async () => {
    const { source, target } = makeSource(new SdkDouble().sdk)
    const picker = document.createElement('input')
    picker.type = 'file'
    target.append(picker)
    Object.defineProperty(picker, 'files', { value: [notebook('picked.ipynb')] })

    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await opened(source)

    expect((await source.current())?.name).toBe('picked.ipynb')
  })

  it('settles current outside Deska before and immediately after a drop', async () => {
    const sdk = new SdkDouble()
    sdk.ready = new Promise(() => undefined)
    sdk.outside = true
    const { source, target } = makeSource(sdk.sdk)

    await expect(source.current()).resolves.toBeNull()
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: { files: [notebook('browser.ipynb')] } })
    target.dispatchEvent(event)
    await expect(source.current()).resolves.toBeNull()
    await opened(source)
  })

  it('works for drop and picker input when the SDK never becomes ready', async () => {
    const sdk = new SdkDouble()
    sdk.ready = new Promise(() => undefined)
    sdk.outside = true
    const { source, target } = makeSource(sdk.sdk)
    await drop(target, notebook('browser.ipynb'))
    await opened(source)
    expect((await source.current())?.name).toBe('browser.ipynb')

    const picker = document.createElement('input')
    picker.type = 'file'
    target.append(picker)
    Object.defineProperty(picker, 'files', { value: [notebook('picked-browser.ipynb')] })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(async () => expect((await source.current())?.name).toBe('picked-browser.ipynb'))
    expect(sdk.files.size).toBe(0)
  })
})

describe('DropSource persistence', () => {
  it('uses the conservative decimal 32 MB persistence limit', () => {
    expect(MAX_PERSISTED_BYTES).toBe(32_000_000)
  })

  it('saves a file at the 32 MB limit and stores its id', async () => {
    const sdk = new SdkDouble()
    const { source, target } = makeSource(sdk.sdk)
    const file = notebookOfSize(MAX_PERSISTED_BYTES)

    const change = new Event('change', { bubbles: true })
    const picker = document.createElement('input')
    picker.type = 'file'
    target.append(picker)
    Object.defineProperty(picker, 'files', { value: [file] })
    picker.dispatchEvent(change)
    await opened(source)
    await vi.waitFor(() => expect(sdk.storageValues.has(LAST_NOTEBOOK_STORAGE_KEY)).toBe(true))

    const stored = sdk.storageValues.get(LAST_NOTEBOOK_STORAGE_KEY) as { id: string }
    expect(sdk.files.get(stored.id)).toBe(file)
    expect(source.warning).toBeNull()
  })

  it('keeps a larger file only for the session and warns', async () => {
    const sdk = new SdkDouble()
    const { source, target } = makeSource(sdk.sdk)
    const file = notebookOfSize(MAX_PERSISTED_BYTES + 1)

    await drop(target, file)
    await opened(source)
    await vi.waitFor(() => expect(sdk.storageValues.has(LAST_NOTEBOOK_STORAGE_KEY)).toBe(false))

    expect((await source.current())?.size).toBe(MAX_PERSISTED_BYTES + 1)
    expect(sdk.files.size).toBe(0)
    expect(source.warning).toEqual({ reason: 'too-large' })
  })

  it('removes the saved copy when a drop arrives while it is loading', async () => {
    const sdk = new SdkDouble()
    sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, { id: 'saved', name: 'saved.ipynb' })
    sdk.files.set('saved', notebook('saved.ipynb'))
    let markLoading!: () => void
    const loading = new Promise<void>((resolve) => {
      markLoading = resolve
    })
    sdk.sdk.files.get = () => {
      markLoading()
      return new Promise(() => undefined)
    }
    const { target } = makeSource(sdk.sdk)
    await loading

    await drop(target, notebook('new.ipynb'))
    await vi.waitFor(() => expect(sdk.files.has('file-1')).toBe(true))
    await vi.waitFor(() => expect(sdk.removed).toContain('saved'))

    expect(sdk.files.has('saved')).toBe(false)
  })

  it('replaces the saved copy and removes the previous file', async () => {
    const sdk = new SdkDouble()
    const { source, target } = makeSource(sdk.sdk)
    await drop(target, notebook('old.ipynb'))
    await opened(source)
    await vi.waitFor(() => expect(sdk.files.has('file-1')).toBe(true))

    await drop(target, notebook('new.ipynb'))
    await vi.waitFor(() => expect(sdk.files.has('file-2')).toBe(true))
    await vi.waitFor(() => expect(sdk.removed).toContain('file-1'))

    expect(sdk.storageValues.get(LAST_NOTEBOOK_STORAGE_KEY)).toMatchObject({ id: 'file-2', name: 'new.ipynb' })
    expect(sdk.files.has('file-1')).toBe(false)
  })

  it('opens even when the SDK refuses to save', async () => {
    const sdk = new SdkDouble()
    sdk.putError = Object.assign(new Error('storage_full'), { code: 'storage_full' })
    const { source, target } = makeSource(sdk.sdk)
    const warnings: unknown[] = []
    source.onChange(() => warnings.push(source.warning))

    await drop(target, notebook('unsaved.ipynb'))
    await opened(source)
    await vi.waitFor(() => expect(source.warning).toEqual({ reason: 'save-failed', code: 'storage_full' }))

    expect((await source.current())?.name).toBe('unsaved.ipynb')
    expect(sdk.files.size).toBe(0)
    expect(warnings).toEqual([null, { reason: 'save-failed', code: 'storage_full' }])
  })
})

describe('DropSource restoration', () => {
  it('restores the last notebook through a slow host, without losing it', async () => {
    const sdk = new SdkDouble()
    sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, { id: 'saved', name: 'saved.ipynb', modifiedAt: 200 })
    sdk.files.set('saved', notebook('saved.ipynb', '{"restored":true}', 100))
    // A host whose ready(), storage and files each take their time.
    const slow = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 15))
    const slowSdk: DropSourceSdk = {
      ready: () => slow({}),
      storage: { ...sdk.sdk.storage, get: async (key: string) => slow(sdk.storageValues.get(key) ?? null) },
      files: { ...sdk.sdk.files, get: async (id: string) => slow(sdk.files.get(id) ?? null) },
    }
    const { source } = makeSource(slowSdk)

    // Nothing is announced while the host is still slow-handing the restore.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await source.current()).toBeNull()

    const file = await source.restored
    expect(file?.name).toBe('saved.ipynb')
    expect((await source.current())?.name).toBe('saved.ipynb')
  })

  it('announces a restored notebook through onChange', async () => {
    const sdk = new SdkDouble()
    sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, { id: 'saved', name: 'saved.ipynb' })
    sdk.files.set('saved', notebook('saved.ipynb'))
    const { source } = makeSource(sdk.sdk)

    await restored(source)

    expect((await source.current())?.name).toBe('saved.ipynb')
  })

  it('reopens the last notebook', async () => {
    const sdk = new SdkDouble()
    sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, { id: 'saved', name: 'saved.ipynb', modifiedAt: 200 })
    sdk.files.set('saved', notebook('ignored.ipynb', '{"restored":true}', 100))
    const { source } = makeSource(sdk.sdk)

    await restored(source)

    const current = await source.current()
    expect(current?.name).toBe('saved.ipynb')
    expect(current?.modifiedAt).toBe(200)
    expect(new TextDecoder().decode(current?.bytes)).toBe('{"restored":true}')
  })

  it.each([null, 42, 'saved', {}, { id: 4, name: 'bad.ipynb' }, { id: 'x', name: 'x', modifiedAt: -1 }])(
    'treats invalid storage value %j as empty',
    async (value) => {
      const sdk = new SdkDouble()
      sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, value)
      const { source } = makeSource(sdk.sdk)
      expect(await source.current()).toBeNull()
    },
  )

  it.each([
    { id: 'saved', name: '' },
    { id: 'saved', name: 'saved.ipynb', modifiedAt: 1e300 },
  ])('rejects an invalid stored notebook record %#', async (value) => {
    const sdk = new SdkDouble()
    sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, value)
    sdk.files.set('saved', notebook('saved.ipynb'))
    const storageGet = vi.spyOn(sdk.sdk.storage, 'get')
    const fileGet = vi.spyOn(sdk.sdk.files, 'get')
    const { source } = makeSource(sdk.sdk)

    await expect(source.current()).resolves.toBeNull()
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fileGet).not.toHaveBeenCalled()
  })

  it('treats a missing saved file as empty', async () => {
    const sdk = new SdkDouble()
    sdk.storageValues.set(LAST_NOTEBOOK_STORAGE_KEY, { id: 'missing', name: 'missing.ipynb' })
    const { source } = makeSource(sdk.sdk)
    expect(await source.current()).toBeNull()
  })
})
