/**
 * Pure state derivation: diff two session-list snapshots into whalesong events.
 * Kept DOM/Audio-free so every edge rule is unit-testable without a browser.
 * @module @khorsheed/dsh-whalesong/client/status
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

/** Events derived from one frame transition of the session list. */
export interface WhalesongEvents {
  /** Whether any session is running in the `next` frame (drives the whalesong overlay). */
  readonly anyRunning: boolean
  /** Sessions that finished this frame (running true → false). */
  readonly completed: readonly string[]
}

/**
 * True when at least one UI-listed session row is running. Deliberately
 * counts only `ids` (the host-list order, i.e. what the sidebar shows):
 * `byId` also carries addressed subagent rows whose `running` bit projects
 * from the child catalog (`child.activity === 'running'`, service.ts), which
 * can linger after the work ends — counting them latched `dsh-whalesong-on`
 * on in the v1.1 field test (task over, class stuck for minutes).
 */
export function anySessionRunning(state: SessionListState): boolean {
  return state.ids.some(id => state.byId[id]?.running === true)
}

/**
 * Diff two consecutive session-list snapshots. Edge rules:
 * - the first frame is a baseline — pass `prev === undefined` to get only
 *   `anyRunning` (a session already running at startup is not a "completion");
 * - `completed`: row present in both frames, running true → false;
 * - flapping rows (true→false→true→false across frames) naturally re-fire on
 *   each true→false crossing; same-frame repeats cannot occur because the
 *   store notifies once per snapshot.
 * @param prev - previous frame, or undefined for the baseline frame.
 * @param next - current frame.
 * @returns the events of this transition.
 */
export function diffSessionList(prev: SessionListState | undefined, next: SessionListState): WhalesongEvents {
  const completed: string[] = []
  if (prev !== undefined) {
    // SessionId is a branded string; key iteration goes through keyof casts.
    for (const id of Object.keys(next.byId) as (keyof typeof next.byId)[]) {
      const nextRow = next.byId[id]
      const prevRow = prev.byId[id as keyof typeof prev.byId]
      if (nextRow === undefined || prevRow === undefined) continue // new session: no completion edge
      if (prevRow.running && !nextRow.running) completed.push(id)
    }
  }
  return { anyRunning: anySessionRunning(next), completed }
}

/**
 * Diff two consecutive pending-interaction snapshots into blocked edges: a
 * session whose pending interaction appears (absent → present) blocks. The
 * first frame is a baseline — pass `prev === undefined` and no edge fires (a
 * session discovered already-waiting is not a transition). An interaction
 * that persists across frames never re-fires; one that clears and returns
 * re-fires on the new appearance.
 * @param prev - previous frame, or undefined for the baseline frame.
 * @param next - current frame.
 * @returns the sessions that became blocked this frame.
 */
export function diffPendingInteractions(
  prev: SessionPendingInteractionSnapshot | undefined,
  next: SessionPendingInteractionSnapshot,
): readonly string[] {
  if (prev === undefined) return []
  const blocked: string[] = []
  for (const id of next.keys()) {
    if (!prev.has(id)) blocked.push(id)
  }
  return blocked
}
