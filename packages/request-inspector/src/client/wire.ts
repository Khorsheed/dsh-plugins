/**
 * The four verbs' wire face, at FULL descriptor arity: the gateway runtime
 * enforces each verb's declared parameter count exactly (`prepareInvocation`
 * throws before any network traffic on a mismatch — a trailing optional
 * parameter counts), so every call passes the trailing `filter` explicitly.
 * The panel never filters; server-side consumers pass their own allow-list.
 *
 * @module @khorsheed/dsh-request-inspector/client/wire
 */
import type { InspectorRemote, InspectorTabInjected } from './contract.ts'

/** The injected face's verbs over the generated Remote, always at full arity. */
export function inspectorWire(remote: InspectorRemote): InspectorTabInjected {
  return {
    listTurns: sessionId => remote.listTurns(sessionId, undefined),
    getTurn: (sessionId, turnSeq) => remote.getTurn(sessionId, turnSeq, undefined),
    getRequest: (sessionId, seq) => remote.getRequest(sessionId, seq, undefined),
    getTurnTiming: (sessionId, turnSeq) => remote.getTurnTiming(sessionId, turnSeq, undefined),
  }
}
