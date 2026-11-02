/** The panel's actions for a connected agent (`deska.agent`), and the wiring to Deska's SDK. */
import type { DeskaSdk } from '../app/deska'
import { ACTION_KINDS, runAction, type AgentHost } from './actions'

export { ACTION_KINDS, runAction, summarizeCell } from './actions'
export type { AgentHost, ChangesAnswer, ChangeEntry, WriteAnswer } from './actions'

/**
 * Answers `agent.action` calls. Call it before `deska.ready()` so no call waits.
 * Returns a function that stops listening. Outside Deska, or on an older SDK, it does nothing.
 */
export function registerAgent(sdk: Partial<Pick<DeskaSdk, 'on' | 'agent'>> | undefined, host: AgentHost): () => void {
  const agent = sdk?.agent
  if (typeof sdk?.on !== 'function' || !agent) return () => {}
  return sdk.on('agent.action', ({ callId, action, input }) => {
    if (!(action in ACTION_KINDS)) console.warn(`Unknown agent action: ${action}`)
    void agent.respond(callId, runAction(host, action, input))
  })
}
