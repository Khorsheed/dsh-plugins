/**
 * The two host lines' job-roster channels behind one observable.
 *
 * 0.1.5 carries each session's job roster on the session-list state
 * (`jobsBySession` — the components keep reading it through a duck-typed
 * selector); rc.1 removed that key and moved rosters to the job-controller
 * client service (`ctx.jobs`: a `state` mirror plus reference-counted
 * `watchRows` streams — the same face ui-jobs consumes). The service belongs
 * to another package, so it is probed through a deferred inject, never
 * declared: this channel publishes an empty snapshot until rc.1's service
 * arms it (on 0.1.5, never — the legacy read carries the rows there).
 *
 * @module dsh-taskpilot/client/jobs-channel
 */

import type { JobView } from '@deepseek-ai/dsh-jobs/view'

/** The slice of rc.1's client jobs snapshot this bundle reads. */
export interface JobsSnapshotLike {
  /** The jobs each watched session can see, keyed by session id; a missing key is an empty roster. */
  readonly rows: Readonly<Record<string, readonly JobView[]>>
}

/** Minimal structural face of rc.1's `ctx.jobs` service (probed, never imported). */
export interface JobsServiceLike {
  readonly state: {
    getSnapshot(): JobsSnapshotLike
    subscribe(listener: () => void): () => void
  }
  watchRows(sessionId: string): () => void
}

/** Empty until rc.1's service arms the channel (stable identity). */
const EMPTY_SNAPSHOT: JobsSnapshotLike = { rows: {} }

/**
 * Observable mirror of rc.1's `ctx.jobs.state`. The slot entries' `hooks.jobs`
 * seat binds to this at registration time, before (and whether or not) the
 * probed service ever appears — arming swaps the source and republishes.
 */
export class JobsChannel {
  private service: JobsServiceLike | undefined
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): JobsSnapshotLike => this.service?.state.getSnapshot() ?? EMPTY_SNAPSHOT

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Bind rc.1's jobs service; the first arm wins (one registry per
   * composition). The service outlives this bundle's registrations, and
   * unmounting every consumer only empties the listener set.
   * @param service - the probed `ctx.jobs`.
   */
  arm(service: JobsServiceLike): void {
    if (this.service !== undefined) return
    this.service = service
    service.state.subscribe(() => { this.emit() })
    this.emit()
  }

  /** Keep one session's roster current on rc.1; a no-op disposer where the service is absent. */
  readonly watchRows = (sessionId: string): (() => void) => this.service?.watchRows(sessionId) ?? (() => {})

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
