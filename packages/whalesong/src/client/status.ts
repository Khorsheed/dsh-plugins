/**
 * Pure state derivation: diff two session-list snapshots into whalesong events.
 * Kept DOM/Audio-free so every edge rule is unit-testable without a browser.
 * @module @khorsheed/dsh-whalesong/client/status
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteraction, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

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
 * Diff two consecutive Session status snapshots into blocked edges: a session
 * whose pending interaction appears (absent or cleared → present) blocks. The
 * first frame is a baseline — pass `prev === undefined` and no edge fires (a
 * session discovered already-waiting is not a transition). An interaction
 * that persists across frames never re-fires; one that clears and returns
 * re-fires on the new appearance. Status entries carrying no pending
 * interaction (running/completion facts only) never count.
 * @param prev - previous frame, or undefined for the baseline frame.
 * @param next - current frame.
 * @returns the sessions that became blocked this frame.
 */
export function diffPendingInteractions(
  prev: SessionStatusSnapshot | undefined,
  next: SessionStatusSnapshot,
): readonly string[] {
  if (prev === undefined) return []
  const blocked: string[] = []
  for (const [id, status] of next) {
    if (status.pendingInteraction !== undefined && prev.get(id)?.pendingInteraction === undefined) {
      blocked.push(id)
    }
  }
  return blocked
}

/** 0.1.5 ui-session feed shape (removed in 0.1.6-alpha.2): pending interaction per Session. */
export type LegacyPendingInteractionSnapshot = ReadonlyMap<SessionId, SessionPendingInteraction>

/**
 * Adapt the 0.1.5 `uiSession.pendingInteractions` feed to the SessionStatus
 * face the runtime consumes: every mapped interaction becomes a status entry
 * carrying only its `pendingInteraction`. The projection is memoized on the
 * source snapshot identity so the controller's unchanged-frame short-circuit
 * (`next === prev`) keeps working across the adapter.
 * @param source - legacy pending-interaction feed.
 * @returns a status-shaped feed mirroring the source.
 */
export function sessionStatusFromLegacyPending(
  source: ObservableSnapshot<LegacyPendingInteractionSnapshot>,
): ObservableSnapshot<SessionStatusSnapshot> {
  let cachedSource: LegacyPendingInteractionSnapshot | undefined
  let cached: SessionStatusSnapshot = new Map()
  return {
    getSnapshot: () => {
      const snapshot = source.getSnapshot()
      if (snapshot === cachedSource) return cached
      cachedSource = snapshot
      cached = new Map([...snapshot].map(([id, interaction]) => [id, {
        running: undefined,
        pendingInteraction: interaction,
        completionUnread: false,
      }]))
      return cached
    },
    subscribe: listener => source.subscribe(listener),
  }
}
