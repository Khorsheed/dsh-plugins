import type { LocalAgentMemberFeedEvent, LocalAgentMemberFeedRequest, LocalAgentStreamFrame, LocalAgentStreamItem } from '../types.ts'

type Channel = LocalAgentMemberFeedRequest['channel']
type Value<C extends Channel> = Extract<LocalAgentMemberFeedEvent, { channel: C }>['value']
type Follow = (requests: readonly LocalAgentMemberFeedRequest[], signal: AbortSignal) => AsyncIterable<LocalAgentMemberFeedEvent>
type Subscriber = { pending?: LocalAgentMemberFeedEvent | undefined; wake?: (() => void) | undefined }
type Entry = { request: LocalAgentMemberFeedRequest; subscribers: Set<Subscriber>; cached?: LocalAgentMemberFeedEvent }
const keyOf = (id: string, channel: Channel): string => JSON.stringify([id, channel])

/** Coalesce unsent suffixes without losing text; no per-token event queue. */
export function coalesceOutput(previous: LocalAgentStreamFrame, next: LocalAgentStreamFrame): LocalAgentStreamFrame {
  if (next.baseline) return next
  const updates = new Map(previous.updates.map(update => [update.id, update]))
  for (const update of next.updates) {
    const old = updates.get(update.id)
    if (old !== undefined && update.revision <= old.revision) continue
    updates.set(update.id, update.append && old !== undefined
      ? { ...update, text: old.text + update.text, append: old.append } : update)
  }
  return { baseline: previous.baseline, updates: [...updates.values()], removed: [...new Set([...previous.removed, ...next.removed])] }
}

/** All member renderers in one browser plugin instance share one Remote stream. */
export class MemberFeeds {
  private readonly entries = new Map<string, Entry>()
  private controller: AbortController | undefined
  private scheduled = false
  private disposed = false
  constructor(private readonly source: Follow) {}

  async *follow<C extends Channel>(memberId: string, channel: C, signal: AbortSignal): AsyncIterable<Value<C>> {
    if (signal.aborted || this.disposed) return
    const key = keyOf(memberId, channel)
    let entry = this.entries.get(key)
    if (entry === undefined) {
      this.entries.set(key, entry = { request: { memberId, channel }, subscribers: new Set() })
      this.schedule()
    }
    const subscriber: Subscriber = { pending: entry.cached }
    const wake = (): void => { subscriber.wake?.(); subscriber.wake = undefined }
    entry.subscribers.add(subscriber)
    signal.addEventListener('abort', wake, { once: true })
    try {
      while (!signal.aborted && !this.disposed) {
        if (subscriber.pending === undefined) await new Promise<void>(resolve => { subscriber.wake = resolve })
        if (signal.aborted || this.disposed) return
        const event = subscriber.pending
        subscriber.pending = undefined
        if (event === undefined) continue
        if (event.channel === 'error') throw new Error(event.message)
        yield event.value as Value<C>
      }
    } finally {
      signal.removeEventListener('abort', wake)
      entry.subscribers.delete(subscriber)
      if (entry.subscribers.size === 0 && this.entries.get(key) === entry) {
        this.entries.delete(key)
        this.schedule()
      }
    }
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.controller?.abort()
      this.controller = undefined
      if (this.disposed || this.entries.size === 0) return
      const controller = this.controller = new AbortController()
      void this.run(controller)
    })
  }

  private deliver(event: LocalAgentMemberFeedEvent): void {
    const entry = this.entries.get(keyOf(event.memberId, event.channel === 'error' ? event.source : event.channel))
    if (entry === undefined) return
    if (event.channel === 'output') {
      // A late local subscriber receives a full active baseline, never a suffix.
      const old = entry.cached?.channel === 'output' ? entry.cached.value : undefined
      const items = new Map<string, LocalAgentStreamItem>(event.value.baseline ? [] : old?.updates.map(item => [item.id, item]) ?? [])
      for (const update of event.value.updates) {
        const previous = items.get(update.id)
        if (update.append && previous === undefined) throw new Error('Member feed suffix without baseline')
        if (previous !== undefined && update.revision <= previous.revision) continue
        items.set(update.id, { ...update, text: update.append ? previous!.text + update.text : update.text })
      }
      for (const id of event.value.removed) items.delete(id)
      entry.cached = { ...event, value: { baseline: true, updates: [...items.values()].map(item => ({ ...item, append: false })), removed: [] } }
    } else if (event.channel !== 'error') entry.cached = event
    for (const subscriber of entry.subscribers) {
      subscriber.pending = event.channel === 'output' && subscriber.pending?.channel === 'output'
        ? { ...event, value: coalesceOutput(subscriber.pending.value, event.value) } : event
      subscriber.wake?.()
      subscriber.wake = undefined
    }
  }

  private async run(controller: AbortController): Promise<void> {
    try {
      for await (const event of this.source([...this.entries.values()].map(entry => entry.request), controller.signal)) {
        if (controller.signal.aborted) return
        this.deliver(event)
      }
      if (!controller.signal.aborted) throw new Error('Member feed disconnected')
    } catch (error) {
      if (controller.signal.aborted) return
      for (const entry of this.entries.values()) this.deliver({
        memberId: entry.request.memberId, channel: 'error', source: entry.request.channel,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  dispose(): void {
    this.disposed = true
    this.controller?.abort()
    for (const entry of this.entries.values()) for (const subscriber of entry.subscribers) subscriber.wake?.()
    this.entries.clear()
  }
}
