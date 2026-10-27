/**
 * The game tab follows the agent: `game_publish` says where the user should
 * look (the play area, an element's page, the element grid…), the page picks
 * the request up on its poll, and this controller carries it out — unless the
 * user is busy in the panel (a game running, a touch in the last 20 s), in
 * which case it waits as a notice. The page itself never decides where to go.
 *
 * Each request is carried out once; one found on a reload is history. Every
 * decision leaves a `[game:reveal]` console line.
 * @module @khorsheed/dsh-game/client
 */
import type { NavTarget } from './contract.ts'
import type { ShowRequest } from '../types.ts'

/** A touch this recent means the user is busy in the panel. */
const BUSY_MS = 20_000
/** Below this window width a closed panel is not opened: it would cover the conversation. */
const WIDE_PX = 820
/** A request older than this, seen first on this page, is history (a reload). */
const FRESH_MS = 90_000

/** A request held back while the user was busy. */
export interface RevealNotice {
  readonly text: string
  readonly target: NavTarget
}

/** The page-wide controller. */
export class Reveal {
  private lastTouch = 0
  private playing = false
  private mounted = 0
  private noticeNow: RevealNotice | null = null
  private readonly listeners = new Set<() => void>()
  /** The last request sequence carried out per project. */
  private readonly done = new Map<string, number>()

  /** @param open - opens the game tab at a place (the plugin's openAt). */
  constructor(private readonly open: (target: NavTarget) => void) {}

  get notice(): RevealNotice | null { return this.noticeNow }
  dismiss(): void { this.noticeNow = null; this.changed() }
  follow(): void {
    const n = this.noticeNow
    this.dismiss()
    if (n !== null) this.open(n.target)
  }

  /** The tab mounted; the result unmounts it. A mounted tab is navigated at any width. */
  mount(): () => void {
    this.mounted++
    return () => { this.mounted-- }
  }
  touched(): void { this.lastTouch = Date.now() }
  setPlaying(on: boolean): void { this.playing = on }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private changed(): void { for (const l of this.listeners) l() }

  /** The agent's request for a project, as the poll returned it. */
  request(projectId: string, request: ShowRequest, now = Date.now()): 'opened' | 'notice' | 'skipped' | null {
    const seen = this.done.get(projectId)
    this.done.set(projectId, Math.max(request.seq, seen ?? 0))
    if (seen !== undefined ? request.seq <= seen : now - Date.parse(request.at) > FRESH_MS) return null
    const target: NavTarget = {
      view: request.target.view,
      ...(request.target.elementId === undefined ? {} : { elementId: request.target.elementId }),
      ...(request.target.chapterId === undefined ? {} : { chapterId: request.target.chapterId }),
    }
    const busy = this.playing ? 'a game is running' : now - this.lastTouch < BUSY_MS ? 'the panel was just used' : null
    const narrow = this.mounted === 0 && (typeof window === 'undefined' || window.innerWidth < WIDE_PX)
    const outcome = busy !== null ? 'notice' : narrow ? 'skipped' : 'opened'
    try {
      console.info(`[game:reveal] #${request.seq} ${request.note} → ${outcome}${busy === null ? '' : ` (${busy})`}${narrow && busy === null ? ' (closed panel, narrow window)' : ''}`, target)
    } catch {
      // No console.
    }
    if (outcome === 'notice') { this.noticeNow = { text: request.note, target }; this.changed() }
    if (outcome === 'opened') { this.noticeNow = null; this.open(target); this.changed() }
    return outcome
  }
}
