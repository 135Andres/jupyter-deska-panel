import { useEffect, useState } from 'preact/hooks'
import type { DeskaInit } from './deska'

/** Asks Deska who we are. Answers null when the page runs outside Deska. */
async function waitForDeska(): Promise<DeskaInit | null> {
  if (typeof deska === 'undefined') return null
  return deska.ready()
}

export function App() {
  const [init, setInit] = useState<DeskaInit | null>(null)

  useEffect(() => {
    let live = true
    void waitForDeska().then((payload) => {
      if (live) setInit(payload)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <main class="hello">
      <h1>{init ? init.panel.name : 'Notebook Viewer'}</h1>
      <p>{init ? `Hello from ${init.panel.name}.` : 'Waiting for Deska.'}</p>
      <p class="hint">{init ? `Theme: ${init.theme.mode} · Locale: ${init.locale}` : 'The panel reads notebooks; nothing to open yet.'}</p>
    </main>
  )
}
