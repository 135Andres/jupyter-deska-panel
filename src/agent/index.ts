/** The panel's actions for a connected agent (`deska.agent`), and the wiring to Deska's SDK. */
import type { DeskaSdk } from '../app/deska'
import { ACTION_KINDS, runAction, type AgentHost } from './actions'

export { ACTION_KINDS, runAction, summarizeCell } from './actions'
export type { AgentHost, ChangesAnswer, ChangeEntry, WriteAnswer } from './actions'
export { stripAnsi } from './reads'
export type { CellAnswer, CellOutputEntry, ErrorsAnswer, FindAnswer, OutlineAnswer } from './reads'

/**
 * Answers `agent.action` calls. Call it before `deska.ready()` so no call waits.
 * Returns a function that stops listening. Outside Deska, or on an older SDK, it does nothing.
 */
export function registerAgent(sdk: Partial<Pick<DeskaSdk, 'on' | 'agent'>> | undefined, host: AgentHost): () => void {
  const agent = sdk?.agent
  if (typeof sdk?.on !== 'function' || !agent) return () => {}
  return sdk.on('agent.action', ({ callId, action, input }) => {
    if (!(action in ACTION_KINDS)) console.warn(`Unknown agent action: ${action}`)
    // A call that lands while the last notebook is still being restored waits
    // for it, so a slow host does not turn it into a spurious "not found".
    void (host.ready?.() ?? Promise.resolve())
      .then(() => runAction(host, action, input))
      .then(
        (answer) => { void agent.respond(callId, answer) },
        () => { void agent.respond(callId, { ok: false, error: 'failed' }) },
      )
  })
}
