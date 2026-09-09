/**
 * Whalesong runtime controller: own the running halves (overlay + sound player +
 * favicon animator + session-list subscription) as one idempotent state
 * machine driven by the client config. `enabled` false means zero residue —
 * no subscription, no DOM, no AudioContext, no body class, original favicon;
 * re-enabling restarts with a fresh baseline (the frame at restart is the
 * baseline, so nothing chimes for pre-existing state). Volume changes apply
 * live without a restart.
 *
 * State delivery is belt-and-braces: the store subscription carries every
 * notify, and a low-frequency reconcile poll re-diffs the snapshot so a lost
 * notification (any upstream batching/latch path) still clears the whalesong
 * within one interval of the work ending.
 * Factored out of the cordis apply so every transition is unit-testable
 * with fake halves.
 * @module @khorsheed/dsh-whalesong/client/controller
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { anySessionRunning, diffPendingInteractions, diffSessionList } from './status.ts'
import { createWhalesongOverlay, setWhalesongActive, type WhalesongOverlay } from './whalesong-overlay.ts'
import { createSoundPlayer, type WhalesongSoundPlayer } from './sound.ts'
import { createFaviconAnimator, type FaviconAnimator } from './favicon.ts'
import type { WhalesongClientConfig } from './config.ts'

/** Reconcile cadence: off-transitions land ≤3s even if a notify is lost. */
export const RECONCILE_MS = 2500

/** Runtime creation dependencies (factories injectable for tests). */
export interface WhalesongRuntimeDeps {
  readonly doc: Document
  readonly win: Window
  /** Global session-list snapshot feed (`ctx.sessions.list`). */
  readonly list: ObservableSnapshot<SessionListState>
  /**
   * Pending-interaction feed (`ctx.uiSession.pendingInteractions`) driving the
   * blocked chime; absent when the ui-session service is not assembled, which
   * degrades the blocked chime off (completion chimes are unaffected).
   */
  readonly pending?: ObservableSnapshot<SessionPendingInteractionSnapshot>
  readonly createOverlay?: (doc: Document) => WhalesongOverlay
  readonly createSound?: (win: Window) => WhalesongSoundPlayer
  readonly createFavicon?: (win: Window) => FaviconAnimator
}

/** Runtime lifecycle handle. */
export interface WhalesongRuntime {
  /** Apply a (possibly unchanged) config; transitions are idempotent. */
  applyConfig(config: WhalesongClientConfig): void
  /** Stop everything; safe from any state and safe to repeat. */
  dispose(): void
}

/** The running halves of one enabled period. */
interface Running {
  overlay: WhalesongOverlay
  sound: WhalesongSoundPlayer
  favicon: FaviconAnimator
  unsubscribe: () => void
}

/**
 * Create the runtime.
 * @param deps - window/document, the session-list feed, and half factories.
 * @returns the runtime handle.
 */
export function createWhalesongRuntime(deps: WhalesongRuntimeDeps): WhalesongRuntime {
  const { doc, win, list, pending } = deps
  const makeOverlay = deps.createOverlay ?? createWhalesongOverlay
  const makeSound = deps.createSound ?? createSoundPlayer
  const makeFavicon = deps.createFavicon ?? createFaviconAnimator

  let running: Running | undefined
  let volume = 1

  function start(): void {
    const overlay = makeOverlay(doc)
    const sound = makeSound(win)
    sound.setVolume(volume)
    const favicon = makeFavicon(win)
    // Baseline frames: current running/blocked state shows the whalesong but fires no edges.
    let prev: SessionListState = list.getSnapshot()
    let prevPending = pending?.getSnapshot()
    const baselineRunning = anySessionRunning(prev)
    setWhalesongActive(doc, baselineRunning)
    favicon.setActive(baselineRunning)

    const reconcile = (): void => {
      const next = list.getSnapshot()
      const nextPending = pending?.getSnapshot()
      if (next === prev && nextPending === prevPending) return // unchanged snapshots: nothing to do
      const events = diffSessionList(prev, next)
      const blocked = nextPending === undefined ? [] : diffPendingInteractions(prevPending, nextPending)
      prev = next
      prevPending = nextPending
      setWhalesongActive(doc, events.anyRunning)
      favicon.setActive(events.anyRunning)
      // One chime per kind per frame: a multi-session completion wave stays quiet-ish.
      if (events.completed.length > 0) sound.play('completed')
      if (blocked.length > 0) sound.play('blocked')
    }

    const unsubscribeList = list.subscribe(reconcile)
    const unsubscribePending = pending?.subscribe(reconcile)
    const poll = win.setInterval(reconcile, RECONCILE_MS)
    running = {
      overlay,
      sound,
      favicon,
      unsubscribe: () => {
        unsubscribeList()
        unsubscribePending?.()
        win.clearInterval(poll)
      },
    }
  }

  function stop(): void {
    const current = running
    if (current === undefined) return
    running = undefined
    current.unsubscribe()
    current.favicon.dispose() // original favicon restored
    current.overlay.dispose()
    current.sound.dispose()
    setWhalesongActive(doc, false)
  }

  return {
    applyConfig(config: WhalesongClientConfig) {
      volume = config.volume
      if (config.enabled && running === undefined) {
        start()
        return
      }
      if (!config.enabled && running !== undefined) {
        stop()
        return
      }
      running?.sound.setVolume(volume)
    },
    dispose() {
      stop()
    },
  }
}
