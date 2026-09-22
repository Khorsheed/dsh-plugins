/** One shared Remote subscription per viewed member, independent of session history. */
import type { LocalAgentStreamFrame, LocalAgentStreamItem } from '../types.ts'
import { LivePaintDiagnostics } from './live-paint.ts'

export type FollowMemberOutput = (id: string, signal: AbortSignal) => AsyncIterable<LocalAgentStreamFrame>
export interface LiveOutputItem extends LocalAgentStreamItem { baseline: boolean }
export interface LiveOutputSnapshot {
  readonly items: ReadonlyMap<string, LiveOutputItem>
  readonly connected: boolean
}

export class MemberLiveOutput {
  private readonly listeners = new Set<() => void>()
  private snapshot: LiveOutputSnapshot = { items: new Map(), connected: false }
  private controller: AbortController | undefined
  constructor(private readonly id: string, private readonly follow: FollowMemberOutput, private readonly onIdle: () => void,
    private readonly diagnostics: LivePaintDiagnostics) {}

  readonly getSnapshot = (): LiveOutputSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.controller === undefined) {
      const controller = new AbortController()
      this.controller = controller
      void this.run(controller.signal)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.controller?.abort()
        this.controller = undefined
        this.snapshot = { items: new Map(), connected: false }
        this.onIdle()
      }
    }
  }

  private publish(snapshot: LiveOutputSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  private async run(signal: AbortSignal): Promise<void> {
    let delay = 250
    while (!signal.aborted) {
      try {
        for await (const frame of this.follow(this.id, signal)) {
          if (signal.aborted) return
          const items = frame.baseline ? new Map<string, LiveOutputItem>() : new Map(this.snapshot.items)
          for (const update of frame.updates) {
            const old = items.get(update.id)
            if (update.append && old === undefined) throw new Error('live output suffix without baseline')
            if (old !== undefined && update.revision <= old.revision) continue
            this.diagnostics.receive(this.id, update, frame.baseline)
            items.set(update.id, { ...update, text: update.append ? old!.text + update.text : update.text, baseline: frame.baseline })
          }
          // Retain the final live text until the durable native message removes
          // its node; the two transports may arrive in either order.
          this.publish({ items, connected: true })
          delay = 250
        }
      } catch {
        // A reconnect obtains a fresh baseline, never replays stale suffixes.
      }
      if (signal.aborted) return
      this.publish({ ...this.snapshot, connected: false })
      await new Promise<void>(resolve => {
        const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, delay)
        signal.addEventListener('abort', done, { once: true })
      })
      delay = Math.min(delay * 2, 5_000)
    }
  }
}

/** Cached only while rendered: historical sessions do not retain text or connections. */
export class MemberLiveOutputs {
  readonly diagnostics = new LivePaintDiagnostics()
  private readonly stores = new Map<string, MemberLiveOutput>()
  constructor(private readonly follow: FollowMemberOutput) {}
  get(id: string): MemberLiveOutput {
    let store = this.stores.get(id)
    if (store === undefined) this.stores.set(id, store = new MemberLiveOutput(id, this.follow, () => {
      if (this.stores.get(id) === store) this.stores.delete(id)
    }, this.diagnostics))
    return store
  }
}
