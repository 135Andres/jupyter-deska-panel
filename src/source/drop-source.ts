export interface NotebookFile {
  name: string
  size: number
  modifiedAt?: number
  bytes: Uint8Array
}

export interface NotebookSource {
  /** The current file, or null when none is open. */
  current(): Promise<NotebookFile | null>
  /** Called for new input, initial restoration or a persistence warning; never for disk changes. */
  onChange(listener: () => void): () => void
}

export interface DropSourceSdk {
  ready(): Promise<unknown>
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<unknown>
    remove(key: string): Promise<unknown>
  }
  files: {
    put(file: Blob): Promise<{ id: string }>
    get(id: string): Promise<Blob | null>
    remove(id: string): Promise<unknown>
  }
}

export type DropSourceWarning =
  | { reason: 'too-large' }
  | { reason: 'save-failed'; code: string }

export type ConfirmLargeFile = (file: File) => Promise<boolean>

interface StoredNotebook {
  id: string
  name: string
  modifiedAt?: number
}

// The public SDK says "32 MB" without defining the unit, so use the smaller decimal limit.
export const MAX_PERSISTED_BYTES = 32 * 1000 * 1000
export const LAST_NOTEBOOK_STORAGE_KEY = 'notebook-viewer.last-notebook'

export class DropSource implements NotebookSource {
  private file: NotebookFile | null = null
  private saved: StoredNotebook | null = null
  private readonly listeners = new Set<() => void>()
  private readonly stored: Promise<StoredNotebook | null>
  private saveQueue: Promise<void> = Promise.resolve()
  private revision = 0
  private warningValue: DropSourceWarning | null = null

  constructor(
    private readonly target: HTMLElement,
    private readonly sdk: DropSourceSdk | undefined = (globalThis as { deska?: DropSourceSdk }).deska,
    private readonly confirmLarge: ConfirmLargeFile = async () => true,
  ) {
    target.addEventListener('dragover', this.onDragOver)
    target.addEventListener('drop', this.onDrop)
    target.addEventListener('change', this.onPick)
    this.stored = this.readStored()
    void this.restore(this.stored)
  }

  current(): Promise<NotebookFile | null> {
    return Promise.resolve(this.file)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A persistence warning for the app to present; null after a successful save. */
  get warning(): DropSourceWarning | null {
    return this.warningValue
  }

  destroy(): void {
    this.target.removeEventListener('dragover', this.onDragOver)
    this.target.removeEventListener('drop', this.onDrop)
    this.target.removeEventListener('change', this.onPick)
    this.listeners.clear()
  }

  private readonly onDragOver = (event: DragEvent): void => {
    event.preventDefault()
  }

  private readonly onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (file) void this.open(file)
  }

  private readonly onPick = (event: Event): void => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void this.open(file)
  }

  private async open(file: File): Promise<void> {
    if (file.size > RECOMMENDED_MAX_BYTES && !(await this.confirmLarge(file))) return
    const revision = ++this.revision
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (revision !== this.revision) return

    this.file = {
      name: file.name,
      size: bytes.byteLength,
      modifiedAt: file.lastModified,
      bytes,
    }
    this.warningValue = bytes.byteLength > MAX_PERSISTED_BYTES ? { reason: 'too-large' } : null
    this.saveQueue = this.saveQueue.then(() => this.persist(file, bytes.byteLength, revision))
    for (const listener of this.listeners) listener()
  }

  private async persist(file: File, size: number, revision: number): Promise<void> {
    const previous = this.saved ?? (await this.stored)
    if (size > MAX_PERSISTED_BYTES) {
      this.saved = null
      if (this.sdk && previous) await this.removeSaved(previous)
      else if (this.sdk) await this.sdk.storage.remove(LAST_NOTEBOOK_STORAGE_KEY).catch(() => undefined)
      return
    }

    if (!this.sdk) {
      this.setWarning({ reason: 'save-failed', code: 'host_error' }, revision)
      return
    }

    let kept: { id: string } | undefined
    try {
      kept = await this.sdk.files.put(file)
      const stored = { id: kept.id, name: file.name, modifiedAt: file.lastModified }
      await this.sdk.storage.set(LAST_NOTEBOOK_STORAGE_KEY, stored)
      this.saved = stored
      if (previous && previous.id !== kept.id) await this.removePrevious(previous, revision)
    } catch (error) {
      if (kept) await this.sdk.files.remove(kept.id).catch(() => undefined)
      this.setWarning({ reason: 'save-failed', code: errorCode(error) }, revision)
      return
    }
  }

  private async removePrevious(previous: StoredNotebook, revision: number): Promise<void> {
    if (!this.sdk) return
    try {
      await this.sdk.files.remove(previous.id)
    } catch (error) {
      this.setWarning({ reason: 'save-failed', code: errorCode(error) }, revision)
    }
  }

  private setWarning(warning: DropSourceWarning, revision: number): void {
    if (revision !== this.revision) return
    this.warningValue = warning
    for (const listener of this.listeners) listener()
  }

  private async removeSaved(saved: StoredNotebook): Promise<void> {
    if (!this.sdk) return
    try {
      await this.sdk.storage.remove(LAST_NOTEBOOK_STORAGE_KEY)
      await this.sdk.files.remove(saved.id)
    } catch {
      // The size warning remains relevant even if cleaning up the old copy fails.
    }
  }

  private async readStored(): Promise<StoredNotebook | null> {
    if (!this.sdk) return null
    try {
      await this.sdk.ready()
      return readStored(await this.sdk.storage.get(LAST_NOTEBOOK_STORAGE_KEY))
    } catch {
      return null
    }
  }

  private async restore(storedValue: Promise<StoredNotebook | null>): Promise<NotebookFile | null> {
    if (!this.sdk) return null
    try {
      const stored = await storedValue
      if (!stored) return null
      this.saved = stored
      if (this.revision !== 0) return this.file
      const blob = await this.sdk.files.get(stored.id)
      if (!blob) return null
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (this.revision !== 0) return this.file
      this.file = { name: stored.name, size: bytes.byteLength, modifiedAt: stored.modifiedAt, bytes }
      for (const listener of this.listeners) listener()
      return this.file
    } catch {
      return null
    }
  }
}

export const RECOMMENDED_MAX_BYTES = 50 * 1000 * 1000

function readStored(value: unknown): StoredNotebook | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    typeof candidate.name !== 'string' ||
    candidate.name.length === 0
  ) {
    return null
  }
  if (
    candidate.modifiedAt !== undefined &&
    (typeof candidate.modifiedAt !== 'number' || !Number.isSafeInteger(candidate.modifiedAt) || candidate.modifiedAt < 0)
  ) {
    return null
  }
  return { id: candidate.id, name: candidate.name, modifiedAt: candidate.modifiedAt as number | undefined }
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'host_error'
}
