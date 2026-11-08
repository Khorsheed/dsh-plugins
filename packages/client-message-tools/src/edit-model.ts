/**
 * Resolve the model route that actually answered one editable user message.
 * The first following model step is the evidence; later selections and later
 * human turns never rewrite that history.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { isMessageToolsEdit } from './marker.ts'

/** Whether an event starts the next human-owned exchange after the target. */
function nextHumanMessage(event: SessionEvent): boolean {
  return event.type === 'user/message' && (event.data.source.kind === 'user' || isMessageToolsEdit(event))
}

/** Detach a model selection from a recorded request configuration. */
function selectionOf(config: { provider: string; model: string; reasoningEffort?: ModelSelection['reasoningEffort'] }): ModelSelection {
  return {
    provider: config.provider,
    model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
  }
}

/**
 * Read the route used by the first model step after an editable user message.
 * An unchanged request header is reused across steps, so a matching assistant
 * message also validates the latest earlier header. Without either that pair
 * or a header inside the step, there is no reliable native-model evidence.
 * @param events - complete session event log.
 * @param surfaceNodes - currently live append-surface event seqs.
 * @param targetSeq - user message being edited.
 * @returns the historical route, or null when none can be established.
 */
export function editModelSelection(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
): ModelSelection | null {
  if (!surfaceNodes.includes(targetSeq)) return null
  const target = events[targetSeq]
  if (target?.type !== 'user/message') return null

  let end = events.length
  let step: Extract<SessionEvent, { type: 'step/start' }> | undefined
  for (let seq = targetSeq + 1; seq < events.length; seq++) {
    const event = events[seq]!
    if (nextHumanMessage(event)) {
      end = seq
      break
    }
    if (event.type === 'step/start') {
      step = event
      break
    }
  }
  if (step === undefined) return null

  let assistant: Extract<SessionEvent, { type: 'assistant/message' }> | undefined
  const localHeaders: Extract<SessionEvent, { type: 'request/header' }>[] = []
  for (let seq = step.seq + 1; seq < end; seq++) {
    const event = events[seq]!
    if (nextHumanMessage(event)) break
    if (event.type === 'step/end' && event.data.turn === step.data.turn && event.data.step === step.data.step) break
    if (event.type === 'assistant/message' && event.data.turn === step.data.turn && event.data.step === step.data.step) {
      assistant = event
    } else if (event.type === 'request/header') {
      localHeaders.push(event)
    }
  }

  let header = localHeaders.at(-1)
  if (header === undefined) {
    for (let seq = step.seq - 1; seq >= 0; seq--) {
      const event = events[seq]!
      if (event.type === 'request/header') {
        header = event
        break
      }
    }
  }
  if (assistant !== undefined) {
    const source = assistant.data.message.source
    if (header !== undefined && (header.data.header.config.provider !== source.provider || header.data.header.config.model !== source.model)) {
      return null
    }
    return header === undefined
      ? { provider: source.provider, model: source.model }
      : selectionOf(header.data.header.config)
  }
  return localHeaders.length > 0
    ? selectionOf(localHeaders.at(-1)!.data.header.config)
    : null
}
