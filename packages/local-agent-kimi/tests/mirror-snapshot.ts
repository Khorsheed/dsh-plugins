/**
 * The child log as a comparable event sequence for the mirror snapshot specs:
 * every event's type, data and append options, in log order. Wall-clock
 * fields are frozen by the specs (fake `Date`), so only the random message
 * ids are normalized — a changed event shape, order, or step coordinate shows
 * in the diff.
 */
import type { Session } from '@deepseek-ai/dsh-session'

/** A fixed wall clock for the snapshot specs (2026-01-01T00:00:00Z). */
export const SNAPSHOT_NOW = 1_767_225_600_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The child session's events; seq stays (sourceEventSeqs reference it), random message ids read `<uuid>`. */
export function mirrorSnapshot(session: Session): unknown[] {
  return JSON.parse(JSON.stringify(session.snapshotEvents()), (_key, value: unknown) =>
    typeof value === 'string' && UUID.test(value) ? '<uuid>' : value) as unknown[]
}

/**
 * Poll a condition without touching the frozen clock: `vi.waitFor` advances
 * fake timers (the Date included) on every poll, which would make the
 * snapshot's times depend on how many polls a run took.
 */
export async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!check()) {
    if (performance.now() > deadline) throw new Error('condition not met before the deadline')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
