/** Bounded, text-free diagnostics. Receipt times require a shared host/browser clock. */
import type { LocalAgentStreamItem } from '../types.ts'

export type PaintSurface = 'room' | 'member'
export type PaintOutcome = 'pending' | 'painted' | 'hidden' | 'unmounted' | 'clock-mismatch'
type Paint = { outcome: PaintOutcome; elapsed?: number }
type Receipt = Pick<LocalAgentStreamItem, 'id' | 'revision' | 'receivedAt'> & {
  baseline: boolean
  paints: Partial<Record<PaintSurface, Paint>>
}
type Round = { sessionId: string; turn: number; receipts: Map<number, Receipt>; dropped: number }

export class LivePaintDiagnostics {
  private readonly rounds = new Map<string, Round>()
  private readonly listeners = new Set<() => void>()
  private evictedRounds = 0
  constructor(private readonly maxRounds = 32, private readonly maxReceipts = 4_096) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private changed(): void { for (const listener of this.listeners) listener() }

  receive(sessionId: string, item: LocalAgentStreamItem, baseline: boolean): void {
    const key = JSON.stringify([sessionId, item.turn])
    let round = this.rounds.get(key)
    if (!round) {
      round = { sessionId, turn: item.turn, receipts: new Map(), dropped: 0 }
      this.rounds.set(key, round)
      if (this.rounds.size > this.maxRounds) {
        this.rounds.delete(this.rounds.keys().next().value!)
        this.evictedRounds++
      }
    }
    // Reconnect baselines must not reclassify an already observed live update.
    if (round.receipts.has(item.revision)) return
    round.receipts.set(item.revision, { id: item.id, revision: item.revision, receivedAt: item.receivedAt, baseline, paints: {} })
    if (round.receipts.size > this.maxReceipts) {
      round.receipts.delete(round.receipts.keys().next().value!)
      round.dropped++
    }
    this.changed()
  }

  begin(sessionId: string, turn: number, revision: number, surface: PaintSurface): ((outcome: Exclude<PaintOutcome, 'pending'>, now: number) => void) | undefined {
    const receipt = this.rounds.get(JSON.stringify([sessionId, turn]))?.receipts.get(revision)
    if (!receipt || receipt.baseline || receipt.paints[surface]) return undefined
    const paint: Paint = { outcome: 'pending' }
    receipt.paints[surface] = paint
    this.changed()
    return (outcome, now) => {
      if (paint.outcome !== 'pending') return
      const elapsed = now - receipt.receivedAt
      paint.outcome = outcome === 'painted' && elapsed < 0 ? 'clock-mismatch' : outcome
      if (paint.outcome === 'painted') paint.elapsed = elapsed
      this.changed()
    }
  }

  /** Survives stream-node unmount; never includes prompts, answers or credentials. */
  report(sessionId: string) {
    return { clock: 'shared-wall-clock-required', evictedRounds: this.evictedRounds, rounds: [...this.rounds.values()]
      .filter(round => round.sessionId === sessionId).map(round => {
        const receipts = [...round.receipts.values()]
        const live = receipts.filter(receipt => !receipt.baseline)
        return { turn: round.turn, dropped: round.dropped, baselineUpdates: receipts.length - live.length, liveUpdates: live.length,
          surfaces: Object.fromEntries((['room', 'member'] as const).map(surface => {
            const paints = live.map(receipt => receipt.paints[surface])
            const samples = paints.flatMap(paint => paint?.elapsed === undefined ? [] : [paint.elapsed])
            const sorted = [...samples].sort((a, b) => a - b)
            const count = (outcome: PaintOutcome): number => paints.filter(paint => paint?.outcome === outcome).length
            return [surface, { samples, p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
              painted: count('painted'), pending: count('pending'), hidden: count('hidden'), unmounted: count('unmounted'),
              clockMismatch: count('clock-mismatch'), unrendered: paints.filter(paint => paint === undefined).length }]
          })),
        }
      }) }
  }
}
