/** Bound optional catalog enrichment so cold log reads cannot fan out across the library. */
export class CatalogReads {
  private pending: { cancelled: boolean; priority: number; work: (active: () => boolean) => Promise<void> }[] = []
  private running = 0
  constructor(private readonly limit = 2) {}
  add(work: (active: () => boolean) => Promise<void>, priority = 1): () => void {
    const item = { cancelled: false, priority, work }
    this.pending.push(item)
    this.pending.sort((a, b) => a.priority - b.priority)
    this.pump()
    return () => { item.cancelled = true; this.pending = this.pending.filter(entry => entry !== item) }
  }
  private pump() {
    while (this.running < this.limit && this.pending.length) {
      const item = this.pending.shift()!
      if (item.cancelled) continue
      this.running++
      // The owner APIs have no caller cancellation. Keep their slot until they settle;
      // cancelling only suppresses queued reads and subsequent optional work.
      void Promise.resolve().then(() => item.cancelled ? undefined : item.work(() => !item.cancelled))
        .catch(() => {}).finally(() => { this.running--; this.pump() })
    }
  }
}
