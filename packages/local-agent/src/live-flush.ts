/** Maximum batching delay for a live mirror; independent of persistence cadence. */
export const LIVE_FLUSH_INTERVAL_MS = 50

/**
 * Coalesce an item's updates without postponing its first pending deadline.
 * Even a single short delta flushes without another provider event. Owners
 * cancel an item before its authoritative final and dispose before turn/end.
 */
export class LiveFlush {
  private readonly pending = new Map<number, { timer: ReturnType<typeof setTimeout>; publish: () => void }>()
  private disposed = false

  constructor(
    private readonly onError: (error: unknown) => void,
    private readonly intervalMs = LIVE_FLUSH_INTERVAL_MS,
  ) {}

  /** Schedule the latest content at the item's existing deadline. */
  schedule(item: number, publish: () => void): void {
    if (this.disposed) return
    if (this.intervalMs <= 0) {
      publish()
      return
    }
    const existing = this.pending.get(item)
    if (existing !== undefined) {
      existing.publish = publish
      return
    }
    const entry = {
      publish,
      timer: setTimeout(() => {
        this.pending.delete(item)
        try { entry.publish() } catch (error) { this.onError(error) }
      }, this.intervalMs),
    }
    entry.timer.unref?.()
    this.pending.set(item, entry)
  }

  /** Supersede pending content with an authoritative final or immediate flush. */
  cancel(item: number): void {
    const entry = this.pending.get(item)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    this.pending.delete(item)
  }

  /** Retire every timer; a settled round must never publish a late snapshot. */
  dispose(): void {
    this.disposed = true
    for (const item of this.pending.keys()) this.cancel(item)
  }
}
