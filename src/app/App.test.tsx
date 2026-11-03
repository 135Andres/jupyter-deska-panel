import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { App } from './App'
import type { DeskaInit, DeskaSdk } from './deska'

const init: DeskaInit = {
  panel: { id: 'notebook-viewer', name: 'Notebook Viewer', version: null, dev: true },
  place: 'panel',
  theme: { mode: 'light', tokens: { '--deska-bg': 'rgb(255, 255, 255)' } },
  visibility: { visible: true, idle: false },
  permissions: [],
  declined: [],
  locale: 'en-US',
  frames: { panel: 0, extras: 0 },
}

function stubDeska(ready: () => Promise<DeskaInit>) {
  const sdk: DeskaSdk = {
    ready,
    theme: null,
    visible: true,
    place: null,
    setTitle: () => Promise.resolve(),
    on: () => () => {},
  }
  Object.defineProperty(globalThis, 'deska', { value: sdk, configurable: true })
}

afterEach(() => {
  delete (globalThis as { deska?: DeskaSdk }).deska
})

describe('App', () => {
  it('waits for Deska before it greets anyone', () => {
    stubDeska(() => new Promise<DeskaInit>(() => {}))
    const host = document.createElement('div')

    render(<App />, host)

    expect(host.textContent).toContain('Drop a notebook here')
  })

  it('greets with the panel name Deska hands it', async () => {
    stubDeska(() => Promise.resolve(init))
    const host = document.createElement('div')

    render(<App />, host)
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Notebook Viewer'))

    expect(host.textContent).toContain('Drop a notebook here')
  })
})
