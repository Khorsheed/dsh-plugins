/**
 * DOM hider: hide EVERY chat row whose node anchor falls inside a withdrawn
 * span — all node kinds, not just user messages — through a dynamic
 * stylesheet keyed on the row's `data-chat-flow-key` attribute
 * (ChatNodeSeat.tsx). The projection itself offers no suppression seam (see
 * README), so this works at the DOM layer. The attribute is an undocumented
 * surface: the first time a non-empty rule set is computed, the hider probes
 * for it (after a frame, so React has committed) and, when absent, disables
 * itself with one console.warn — the shadowed user renderer keeps hiding
 * user messages, which is the pre-hider behavior. Rules track the currently
 * selected session only: flow keys are session-scoped (seq-like ids collide
 * across sessions), and only one chat view is mounted at a time.
 */
import type { ChatConversationViewNode, ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { messageToolsOp } from '../marker.ts'
import { foldHiddenRanges, isSeqHidden, type RestoredMessageData } from './withdrawn-node.ts'

/**
 * Flow keys of every chat node inside a hidden span. The withdrawal divider
 * itself (`message-tools-withdrawn`, anchored at the span's exclusive end) is
 * never included — it is the marker that must stay visible. Restore events
 * (user-message and assistant-text replays) are additionally matched by the
 * built-in message Definition into context-injection rows (every
 * append-surface user/message qualifies), so the context row sharing a
 * restored row's seq is hidden as a duplicate — the plugin's restored rows
 * are the presentation.
 * @param nodes - every materialized chat node of the session.
 * @param ranges - precomputed hidden spans (folded from `nodes` when omitted).
 * @returns the flow keys to hide, in node order.
 */
export function hiddenFlowKeys(nodes: readonly ChatConversationViewNode[], ranges?: readonly number[]): string[] {
  const restoredSeqs = new Set(
    nodes
      .filter(node => node.kind === 'message-tools-restored' || node.kind === 'message-tools-restored-assistant')
      .map(node => (node.data as RestoredMessageData).seq),
  )
  const effective = ranges ?? foldHiddenRanges(nodes)
  const keys: string[] = []
  for (const node of nodes) {
    if (node.kind === 'message-tools-withdrawn') continue
    if (node.kind === 'context') {
      const data = node.data as { seq?: number; source?: unknown }
      // The context row duplicating a restore row (same source event seq), or
      // rendering an edit trigger — the trigger is only the wake, never
      // transcript content.
      if (restoredSeqs.has(data.seq ?? -1) || messageToolsOp(data.source) === 'edit-trigger') {
        keys.push(node.key)
        continue
      }
    }
    if (isSeqHidden(effective, node.anchorSeq)) keys.push(node.key)
  }
  return keys
}

/**
 * Render the display rules for one rule set.
 * @param keys - flow keys to hide.
 * @returns the stylesheet text (empty string hides nothing).
 */
export function renderHiderRules(keys: readonly string[]): string {
  return keys
    .map(key => `[data-chat-flow-key=${JSON.stringify(key)}]{display:none!important}`)
    .join('\n')
}

/**
 * Install the hider: one shared style element, rebound whenever the selected
 * session changes, rewritten only when the span set or the node count moves.
 * @param ctx - client root context (reads the sessions service).
 * @returns disposer removing the stylesheet and every subscription.
 */
export function installDomHider(ctx: ClientContext): () => void {
  // rAF so the probe runs after React committed; setTimeout covers jsdom.
  const nextFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: () => void): void => { setTimeout(callback, 16) }
  const style = document.createElement('style')
  style.setAttribute('data-message-tools-hider', '')
  document.head.appendChild(style)

  let activeSession: SessionId | undefined
  let stopSession: (() => void) | undefined
  let signature = ''
  let probed = false
  let probeScheduled = false
  let disabled = false
  let latest: ConversationSnapshot | undefined

  const applyRules = (snapshot: ConversationSnapshot): void => {
    latest = snapshot
    const nodes = snapshot.chat.nodes.values()
    const ranges = foldHiddenRanges(nodes)
    const nextSignature = `${ranges.join(',')}:${nodes.length}`
    if (nextSignature === signature) return
    signature = nextSignature
    style.textContent = renderHiderRules(hiddenFlowKeys(nodes, ranges))
  }

  const onSnapshot = (snapshot: ConversationSnapshot): void => {
    latest = snapshot
    if (disabled) return
    if (probed) {
      applyRules(snapshot)
      return
    }
    // Probe on the first non-empty rule set, one frame out so React has
    // committed the rows the rules target.
    if (hiddenFlowKeys(snapshot.chat.nodes.values()).length === 0) return
    if (probeScheduled) return
    probeScheduled = true
    nextFrame(() => {
      probeScheduled = false
      if (document.querySelector('[data-chat-flow-key]') === null) {
        disabled = true
        style.textContent = ''
        console.warn(
          'message-tools: data-chat-flow-key rows not found; full-span chat hiding disabled '
          + '(user messages stay hidden by the shadowed renderer)',
        )
        return
      }
      probed = true
      /* v8 ignore next -- the probe is only scheduled from onSnapshot, which sets latest first */
      if (latest !== undefined) applyRules(latest)
    })
  }

  const bindCurrent = (): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === activeSession && stopSession !== undefined) return
    stopSession?.()
    stopSession = undefined
    activeSession = current
    signature = ''
    style.textContent = ''
    if (current === undefined) return
    const binding = ctx.sessions.binding(current)
    if (binding === undefined) return
    onSnapshot(binding.session.getSnapshot())
    stopSession = binding.session.subscribe(() => { onSnapshot(binding.session.getSnapshot()) })
  }

  const stopList = ctx.sessions.list.subscribe(bindCurrent)
  const stopProvide = ctx.sessions.currentProvideInfo.subscribe(bindCurrent)
  bindCurrent()
  return () => {
    stopList()
    stopProvide()
    stopSession?.()
    style.remove()
  }
}
