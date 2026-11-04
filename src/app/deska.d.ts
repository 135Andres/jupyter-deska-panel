/**
 * The part of Deska's panel SDK this panel uses so far.
 *
 * The contract is Deska's: https://deska.dev/docs/panel-sdk. It only grows, so
 * this file only needs the members the panel calls today.
 */

export interface DeskaPanelInfo {
  /** The package id, or a `dev-` id while the folder is loaded in Deska. */
  id: string
  /** The `name` from panel.json. */
  name: string
  /** The installed version, or null while building. */
  version: string | null
  /** True for a loaded folder or a page on localhost. */
  dev: boolean
}

export interface DeskaTheme {
  mode: 'light' | 'dark'
  /** Every `--deska-*` token, already resolved to a value. */
  tokens: Record<string, string>
}

export interface DeskaVisibility {
  visible: boolean
  idle: boolean
}

/** What `deska.ready()` answers. */
export interface DeskaInit {
  panel: DeskaPanelInfo
  place: 'panel' | 'extras'
  theme: DeskaTheme
  visibility: DeskaVisibility
  /** What this panel may do on this computer. */
  permissions: string[]
  /** What the person turned off. */
  declined: string[]
  /** The person's locale, for `Intl` and the panel's own words. */
  locale: string
  frames: { panel: number; extras: number }
}

/** A call from a connected agent. `input` has already passed the schema in panel.json. */
export interface DeskaAgentCall {
  callId: string
  action: string
  input: unknown
}

export interface DeskaSdk {
  ready(): Promise<DeskaInit>
  readonly theme: DeskaTheme | null
  readonly visible: boolean
  readonly place: 'panel' | 'extras' | null
  setTitle(title: string): Promise<void>
  /** Needs `"sdk": 4` and the `agent` permission. */
  readonly agent?: { respond(callId: string, result: unknown): Promise<boolean> }
  /** Needs the `clipboard-write` permission; call from a click. Rejects with an Error that has a `code`. */
  readonly clipboard?: {
    write(text: string): Promise<boolean>
    writeImage(image: Blob | ArrayBuffer | Uint8Array): Promise<boolean>
  }
  /** Keeps files for this panel across reloads. */
  readonly files?: {
    put(file: Blob): Promise<{ id: string }>
    get(id: string): Promise<Blob | null>
    remove(id: string): Promise<unknown>
  }
  on(event: 'agent.action', listener: (call: DeskaAgentCall) => void): () => void
  on(event: 'theme', listener: (theme: DeskaTheme) => void): () => void
  on(event: 'visibility', listener: (state: DeskaVisibility) => void): () => void
}

declare global {
  /** Deska's SDK, served at `/__deska/sdk.js` inside every panel. */
  const deska: DeskaSdk
}
