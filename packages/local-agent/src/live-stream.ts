/** Transient member output, with bounded followers and incremental durable checkpoints. */
import type { Session } from '@deepseek-ai/dsh-session'
import type { LocalAgentStreamFrame, LocalAgentStreamItem } from './types.ts'

/** Shared process-local output registry. No Agent impersonation or durable token events. */
export class LocalAgentStreams {
  private readonly items = new Map<string, Map<string, LocalAgentStreamItem>>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private revision = 0
  private disposed = false

  publish(sessionId: string, item: Omit<LocalAgentStreamItem, 'revision'>): void {
    if (this.disposed) return
    let items = this.items.get(sessionId)
    if (items === undefined) this.items.set(sessionId, items = new Map())
    items.set(item.id, { ...item, revision: ++this.revision })
    this.notify(sessionId)
  }

  finish(sessionId: string, id: string): void {
    const items = this.items.get(sessionId)
    if (!items?.delete(id)) return
    if (items.size === 0) this.items.delete(sessionId)
    this.notify(sessionId)
  }

  private notify(sessionId: string): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener()
  }

  /**
   * Opening baseline followed by coalesced suffix patches. Each follower keeps
   * only its last delivered state; a slow browser cannot accumulate a queue.
   */
  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<LocalAgentStreamFrame> {
    let wake: (() => void) | undefined
    let dirty = true
    let baseline = true
    const previous = new Map<string, LocalAgentStreamItem>()
    const notify = (): void => { dirty = true; wake?.(); wake = undefined }
    let listeners = this.listeners.get(sessionId)
    if (listeners === undefined) this.listeners.set(sessionId, listeners = new Set())
    listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted && !this.disposed) {
        if (!dirty) await new Promise<void>(resolve => { wake = resolve })
        if (signal.aborted || this.disposed) return
        dirty = false
        const items = this.items.get(sessionId) ?? new Map<string, LocalAgentStreamItem>()
        const updates: LocalAgentStreamFrame['updates'][number][] = []
        const removed: string[] = []
        for (const [id, item] of items) {
          const old = previous.get(id)
          if (old?.revision === item.revision) continue
          const append = old !== undefined && item.text.startsWith(old.text)
          updates.push({ ...item, text: append ? item.text.slice(old.text.length) : item.text, append })
          previous.set(id, item)
        }
        for (const id of previous.keys()) {
          if (!items.has(id)) { previous.delete(id); removed.push(id) }
        }
        if (baseline || updates.length > 0 || removed.length > 0) {
          const frame = { baseline, updates, removed }
          baseline = false
          yield frame
        }
      }
    } finally {
      signal.removeEventListener('abort', notify)
      listeners.delete(notify)
      if (listeners.size === 0) this.listeners.delete(sessionId)
    }
  }

  dispose(): void {
    this.disposed = true
    this.items.clear()
    for (const listeners of this.listeners.values()) for (const notify of listeners) notify()
    this.listeners.clear()
  }
}

/** Durable cadence is independent of browser cadence; checkpoint bytes are suffixes. */
export const LIVE_CHECKPOINT_INTERVAL_MS = 1_000

/** One round's producer. Final native messages replace its presentation nodes by coordinate. */
export class LiveStreamPublisher {
  private readonly states = new Map<number, { item: Omit<LocalAgentStreamItem, 'revision'>; durable: string; timer?: ReturnType<typeof setTimeout> }>()
  constructor(
    private readonly streams: LocalAgentStreams,
    private readonly session: Session,
    private readonly turn: number,
    private readonly persist: () => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  update(step: number, kind: 'think' | 'text', text: string): void {
    let state = this.states.get(step)
    if (state === undefined) {
      const item = { id: `${this.turn}:${step}`, turn: this.turn, step, kind, text, receivedAt: Date.now() }
      state = { item, durable: text }
      this.states.set(step, state)
      this.session.append('local-agent/stream', { ...item, sessionId: String(this.session.id), opening: true, append: false })
      this.persist()
    } else {
      state.item = { ...state.item, text, receivedAt: Date.now() }
    }
    this.streams.publish(String(this.session.id), state.item)
    if (state.timer === undefined) {
      state.timer = setTimeout(() => {
        delete state.timer
        try { this.checkpoint(step) } catch (error) { this.onError(error) }
      }, LIVE_CHECKPOINT_INTERVAL_MS)
      state.timer.unref?.()
    }
  }

  private checkpoint(step: number): void {
    const state = this.states.get(step)
    if (state === undefined || state.durable === state.item.text) return
    const append = state.item.text.startsWith(state.durable)
    this.session.append('local-agent/stream', {
      ...state.item,
      sessionId: String(this.session.id),
      text: append ? state.item.text.slice(state.durable.length) : state.item.text,
      append,
    })
    state.durable = state.item.text
    this.persist()
  }

  /** Call only after the corresponding native final message has been appended. */
  finish(step: number): void {
    const state = this.states.get(step)
    if (state?.timer !== undefined) clearTimeout(state.timer)
    this.states.delete(step)
    this.streams.finish(String(this.session.id), `${this.turn}:${step}`)
  }

  /** A producer failure keeps a durable partial, without claiming completion. */
  dispose(): void {
    for (const step of this.states.keys()) { this.checkpoint(step); this.finish(step) }
  }
}
