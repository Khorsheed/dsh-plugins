/**
 * DOM hider: hide EVERY chat row whose node anchor falls inside a withdrawn
 * span — all node kinds, not just user messages — through a dynamic
 * stylesheet keyed on the row's `data-chat-flow-key` attribute
 * (ChatNodeSeat.tsx). The projection itself offers no suppression seam (see
 * README), so this works at the DOM layer. The attribute is an undocumented
 * surface: the first time a non-empty rule set is computed, the hider probes
 * for it (after a frame, so React has committed). A page restored onto a tab
 * where the chat rows are not mounted yet (the trace tab, or the chat area
 * still mounting) makes that first probe miss, so a miss does NOT disable
 * the hider outright: it enters a bounded retry — a MutationObserver waits
 * for the first row to appear, with a deadline — and only a window that
 * expires with rows still absent disables the hider, with one console.warn,
 * degrading to renderer-only hiding (the shadowed user renderer keeps hiding
 * user messages). Even then the observer stays: a row appearing after the
 * disable (the page sat on a non-chat tab past the window) proves the
 * attribute exists after all, and hiding reactivates. It never throws. Rules track the currently selected
 * session only: flow keys are session-scoped (seq-like ids collide across
 * sessions), and only one chat view is mounted at a time.
 */
import type { ChatConversationViewNode, ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { chatSourceOf, type ChatSlice } from './chat-hook.ts'
import { MESSAGE_TOOLS_PLUGIN, messageToolsOp } from '../marker.ts'
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
      const source = data.source as { kind?: string; plugin?: string; op?: unknown } | undefined
      // Every message-tools context row is a presentation duplicate or a
      // wake-only trigger: restore replays are rendered by the plugin's own
      // rows, edit triggers are never transcript content, and withdrawal /
      // edit replacements are not append-surface context rows at all.
      if (source?.kind === 'plugin' && source.plugin === MESSAGE_TOOLS_PLUGIN
        || restoredSeqs.has(data.seq ?? -1)
        || messageToolsOp(data.source) === 'edit-trigger') {
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
 * Tuning of {@link installDomHider}; the defaults match production.
 */
export interface DomHiderOptions {
  /**
   * Bound on the probe retry window: how long the hider waits for the first
   * `data-chat-flow-key` row to appear before concluding the attribute is
   * gone and disabling itself (default 10s; tests shrink it).
   */
  probeRetryWindowMs?: number
}

/**
 * Install the hider: one shared style element, rebound whenever the selected
 * session changes, rewritten only when the span set or the node count moves.
 * @param ctx - client root context (reads the sessions service).
 * @param options - probe retry tuning.
 * @returns disposer removing the stylesheet and every subscription.
 */
export function installDomHider(ctx: ClientContext, options: DomHiderOptions = {}): () => void {
  const probeRetryWindowMs = options.probeRetryWindowMs ?? 10_000
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
  let retrying = false
  let retryObserver: MutationObserver | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let latest: ChatSlice | undefined

  const applyRules = (chat: ChatSlice): void => {
    latest = chat
    const nodes = chat.nodes.values()
    const ranges = foldHiddenRanges(nodes)
    const nextSignature = `${ranges.join(',')}:${nodes.length}`
    if (nextSignature === signature) return
    signature = nextSignature
    style.textContent = renderHiderRules(hiddenFlowKeys(nodes, ranges))
  }

  const probeFound = (): boolean => document.querySelector('[data-chat-flow-key]') !== null

  const stopRetry = (): void => {
    retrying = false
    retryObserver?.disconnect()
    retryObserver = undefined
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  const passProbe = (): void => {
    stopRetry()
    probed = true
    disabled = false
    /* v8 ignore next -- the probe is only scheduled from onSnapshot, which sets latest first */
    if (latest !== undefined) applyRules(latest)
  }

  const failProbe = (): void => {
    // Window expired with rows still absent: degrade (one warn, no rules) —
    // but KEEP the observer: a row appearing later proves the miss was
    // mounting timing (e.g. the page sat on the trace tab past the window),
    // and hiding reactivates instead of leaking the spans forever.
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    retrying = false
    disabled = true
    style.textContent = ''
    console.warn(
      'message-tools: data-chat-flow-key rows not found; full-span chat hiding disabled '
      + '(user messages stay hidden by the shadowed renderer; hiding reactivates if chat rows appear)',
    )
  }

  /**
   * A missed probe is not proof the attribute is gone — the chat rows may
   * simply not be mounted yet (page restored onto the trace tab, chat area
   * still mounting). Watch for the first row within a bounded window; only
   * an expired window with rows still absent disables the hider, and the
   * observer outlives even that (see failProbe).
   */
  const startRetry = (): void => {
    retrying = true
    if (typeof MutationObserver === 'function') {
      retryObserver = new MutationObserver(() => { if (probeFound()) passProbe() })
      retryObserver.observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-flow-key'],
      })
    }
    retryTimer = setTimeout(() => { if (probeFound()) passProbe(); else failProbe() }, probeRetryWindowMs)
  }

  const onSnapshot = (chat: ChatSlice): void => {
    latest = chat
    if (disabled) return
    if (probed) {
      applyRules(chat)
      return
    }
    // Probe on the first non-empty rule set, one frame out so React has
    // committed the rows the rules target.
    if (hiddenFlowKeys(chat.nodes.values()).length === 0) return
    if (probeScheduled || retrying) return
    probeScheduled = true
    nextFrame(() => {
      probeScheduled = false
      if (probeFound()) {
        passProbe()
        return
      }
      startRetry()
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
    // Chat data lives inside the Session snapshot on rc hosts and in the
    // uiConversation binding's chat target on 0.1.2 — chatSourceOf picks.
    const source = chatSourceOf(ctx, current)
    if (source === undefined) return
    onSnapshot(source.getSnapshot())
    stopSession = source.subscribe(() => { onSnapshot(source.getSnapshot()) })
  }

  const stopList = ctx.sessions.list.subscribe(bindCurrent)
  // Host 0.1.2-alpha.1 removed ISessions.currentProvideInfo (commit
  // be531688f3, with the runtime package). It was only an extra rebind
  // trigger here — bindCurrent re-resolves the session binding on every
  // list snapshot, and alpha's binding() is pure addressing available as
  // soon as the session is listed — so subscribe when the feed exists
  // (rc hosts) and go without it when it does not.
  const provideFeed = (ctx.sessions as { currentProvideInfo?: HostObservable<unknown> }).currentProvideInfo
  const stopProvide = provideFeed?.subscribe(bindCurrent)
  bindCurrent()
  return () => {
    stopList()
    stopProvide?.()
    stopSession?.()
    stopRetry()
    style.remove()
  }
}
