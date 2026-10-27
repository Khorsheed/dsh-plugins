/**
 * The reveal controller: take a sidebar panel to something worth seeing — a
 * result the agent just produced, or a place the agent asked the user to
 * look at — without taking the panel from a user who is busy in it.
 *
 * One controller per plugin per page. The plugin's panel reports use (it is
 * mounted, a touch, something playing, what is on screen); the plugin's own
 * poll or turn hooks hand it offers and agent requests. An offer the user
 * would not want right now (busy, or the per-viewer switch is off) becomes a
 * notice instead. Every decision leaves one console line, so "why did it not
 * jump" is answerable from the page.
 * @module @khorsheed/dsh-client-ui-reveal-kit
 */

/** A jump held back for a busy user. */
export interface RevealNotice<T> {
  readonly text: string
  readonly target: T
}

/** How the controller is set up by its plugin. */
export interface RevealOptions<T> {
  /** Short name in console traces (`game`, `library`…). */
  readonly name: string
  /** Opens the plugin's tab at a target (its own `sidebarRight.openTab` plus in-tab navigation). */
  readonly open: (target: T) => void
  /** localStorage key of the per-viewer switch (default on). */
  readonly switchKey: string
  /** Whether a target would take the user off what they are looking at now (another element's page, say). */
  readonly leavesView?: (target: T, viewing: T) => boolean
  /** A touch this recent means the user is busy in the panel (ms, default 20 s). */
  readonly busyMs?: number
  /** Below this window width a closed panel is not opened: it would cover the conversation (px, default 820). */
  readonly wideMinPx?: number
}

/** Why an offer did not jump (traced, and returned for tests). */
export type RevealOutcome = 'opened' | 'notice:off' | 'notice:holding' | 'notice:touched' | 'notice:view' | 'skipped:narrow' | 'skipped:seen'

function readSwitch(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true
  }
}

/** The controller. */
export class RevealController<T> {
  private lastTouch = 0
  private holding: string | null = null
  private viewing: T | null = null
  private mounted = 0
  private noticeNow: RevealNotice<T> | null = null
  private readonly listeners = new Set<() => void>()
  /** Agent request sequence numbers already acted on, per key (a project, say). */
  private readonly requests = new Map<string, number>()

  constructor(private readonly options: RevealOptions<T>) {}

  get enabled(): boolean { return readSwitch(this.options.switchKey) }
  setEnabled(on: boolean): void {
    try {
      localStorage.setItem(this.options.switchKey, on ? 'on' : 'off')
    } catch {
      // Per-viewer convenience only.
    }
    this.changed()
  }

  get notice(): RevealNotice<T> | null { return this.noticeNow }
  dismiss(): void { this.noticeNow = null; this.changed() }
  /** Follow the held-back jump. */
  follow(): void {
    const n = this.noticeNow
    this.noticeNow = null
    this.changed()
    if (n !== null) this.options.open(n.target)
  }

  /** The panel mounted; call the result when it unmounts. A mounted panel is navigated at any width. */
  mount(): () => void {
    this.mounted++
    return () => { this.mounted-- }
  }
  /** Any pointer or key use in the panel. */
  touched(): void { this.lastTouch = Date.now() }
  /** Something the user is in the middle of (a game running, a video playing): no jumps while set. */
  hold(reason: string | null): void { this.holding = reason }
  /** What the panel shows now (for `leavesView`). */
  setViewing(target: T | null): void { this.viewing = target }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private changed(): void { for (const l of this.listeners) l() }

  /**
   * The agent asked the user to look at something (request `seq` under `key`).
   * Each request is acted on once; the first one seen for a key on this page
   * is only taken when `fresh` (it landed moments ago, not found on a reload).
   * @returns what happened, or null when the request is not new.
   */
  request(key: string, seq: number, target: T, text: string, fresh: boolean): RevealOutcome | null {
    const seen = this.requests.get(key)
    this.requests.set(key, Math.max(seq, seen ?? 0))
    if (seen !== undefined ? seq <= seen : !fresh) return null
    return this.offer(target, text, 'request')
  }

  /**
   * Go to `target`, or — when the user is in the middle of something, or the
   * switch is off — leave a notice. `why` names the source in the trace.
   */
  offer(target: T, text: string, why: string): RevealOutcome {
    const outcome = this.decide(target)
    this.trace(`${why} → ${outcome}: ${text}`, target)
    if (outcome === 'opened') {
      this.noticeNow = null
      this.options.open(target)
      this.changed()
    } else if (outcome.startsWith('notice:')) {
      this.noticeNow = { text, target }
      this.changed()
    }
    return outcome
  }

  private decide(target: T): RevealOutcome {
    if (!this.enabled) return 'notice:off'
    if (this.holding !== null) return 'notice:holding'
    if (Date.now() - this.lastTouch < (this.options.busyMs ?? 20_000)) return 'notice:touched'
    if (this.viewing !== null && this.options.leavesView?.(target, this.viewing) === true) return 'notice:view'
    const wide = typeof window !== 'undefined' && window.innerWidth >= (this.options.wideMinPx ?? 820)
    if (this.mounted === 0 && !wide) return 'skipped:narrow'
    return 'opened'
  }

  private trace(line: string, target: T): void {
    try {
      console.info(`[reveal:${this.options.name}] ${line}${this.holding === null ? '' : ` (holding: ${this.holding})`}`, target)
    } catch {
      // No console: nothing to trace.
    }
  }
}
