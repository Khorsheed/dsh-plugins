/**
 * 改完自动跳转: after the agent changes the game, the panel goes where the
 * result is — the play area for a new version, an element's page when only
 * that element changed — without taking the panel away from someone using it.
 *
 * One controller per page, shared by the tab body (which reports use: a game
 * running, a recent touch, the element on screen) and the turn card (which
 * reports what a finished turn changed). A jump the user would not want right
 * now becomes a notice in the tab instead. Elements a turn changed carry a
 * dot until their page has been open once (an automatic open counts).
 *
 * Per viewer and best effort: the switch and the dots live in this browser.
 * @module @khorsheed/dsh-game/client
 */
import type { NavTarget } from './contract.ts'
import type { TurnReport } from '../types.ts'

/** A touch in the panel this recent means the user is busy there. */
const BUSY_MS = 20_000
/** A turn report older than this is history (a reload), not news. */
const FRESH_MS = 120_000
/** Below this window width the sidebar would cover the conversation: never opened for the user. */
const WIDE_PX = 820

const SWITCH_KEY = 'dsh-game:auto-nav'
const UNSEEN_KEY = 'dsh-game:unseen'

/** A jump held back for a busy user. */
export interface NavNotice {
  readonly text: string
  readonly target: NavTarget
}

/** What to say and where to go for a change. */
export interface NavOffer {
  readonly target: NavTarget
  readonly text: string
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Per-viewer convenience only.
  }
}

/** Words the controller needs (the caller's dictionary). */
export interface NavWords {
  version: (version: number) => string
  candidate: (version: number) => string
  element: (name: string) => string
  elements: (count: number) => string
  chapter: (title: string) => string
}

/**
 * Where a finished turn's result is, or null when there is nothing to show
 * (a failed check, nothing changed). A version wins when code changed too;
 * changes to elements alone open them; a design-only turn opens its chapter.
 */
export function offerFor(report: TurnReport, words: NavWords): NavOffer | null {
  if (report.check !== null && !report.check.ok) return null
  const changed = report.elements.filter(e => e.what !== 'removed')
  const codeChanged = report.code.length > 0 || report.params.length > 0
  if (report.version !== null && (codeChanged || changed.length === 0)) {
    return { target: { view: 'play' }, text: report.version.kind === 'candidate' ? words.candidate(report.version.version) : words.version(report.version.version) }
  }
  if (changed.length === 1) return { target: { view: 'elements', elementId: changed[0]!.id, ...(report.version === null ? {} : { playVersion: report.version.version }) }, text: words.element(changed[0]!.name) }
  if (changed.length > 1) return { target: { view: 'elements' }, text: words.elements(changed.length) }
  if (report.version !== null) return { target: { view: 'play' }, text: words.version(report.version.version) }
  if (report.chapters.length > 0) return { target: { view: 'design', chapterId: report.chapters[0]!.id }, text: words.chapter(report.chapters[0]!.title) }
  return null
}

/** The page-wide controller. */
export class AutoNav {
  private lastTouch = 0
  private playing = false
  private viewing: NavTarget | null = null
  private mounted = 0
  private noticeNow: NavNotice | null = null
  private readonly listeners = new Set<() => void>()
  private readonly handled = new Set<string>()
  /** The last version announced per project (a mid-turn publish is not announced again at turn end). */
  private readonly announced = new Map<string, number>()

  /** @param open - opens the game tab at a place (the plugin's openAt). */
  constructor(private readonly open: (target: NavTarget) => void) {}

  get enabled(): boolean { return read(SWITCH_KEY, true) }
  setEnabled(on: boolean): void { write(SWITCH_KEY, on); this.changed() }

  get notice(): NavNotice | null { return this.noticeNow }
  dismiss(): void { this.noticeNow = null; this.changed() }
  /** Follow the held-back jump. */
  follow(): void {
    const n = this.noticeNow
    this.noticeNow = null
    this.changed()
    if (n !== null) this.open(n.target)
  }

  /** The tab body mounted (or went away): only a mounted panel, or a wide window, is navigated. */
  mount(): () => void {
    this.mounted++
    return () => { this.mounted-- }
  }
  touched(): void { this.lastTouch = Date.now() }
  setPlaying(on: boolean): void { this.playing = on }
  setViewing(target: NavTarget | null): void { this.viewing = target }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private changed(): void { for (const l of this.listeners) l() }

  /** Elements a turn changed that this viewer has not opened since. */
  unseen(projectId: string): ReadonlySet<string> {
    return new Set(read<Record<string, string[]>>(UNSEEN_KEY, {})[projectId] ?? [])
  }
  markSeen(projectId: string, elementId: string): void {
    const all = read<Record<string, string[]>>(UNSEEN_KEY, {})
    const list = all[projectId] ?? []
    if (!list.includes(elementId)) return
    all[projectId] = list.filter(id => id !== elementId)
    write(UNSEEN_KEY, all)
    this.changed()
  }
  private addUnseen(projectId: string, ids: readonly string[]): void {
    if (ids.length === 0) return
    const all = read<Record<string, string[]>>(UNSEEN_KEY, {})
    all[projectId] = [...new Set([...(all[projectId] ?? []), ...ids])]
    write(UNSEEN_KEY, all)
    this.changed()
  }

  /** A finished turn's report (from its card): dot what changed, then go see it. */
  turnEnded(sessionId: string, report: TurnReport, words: NavWords): void {
    const key = `${sessionId}:${report.turn}`
    if (this.handled.has(key) || Date.now() - Date.parse(report.at) > FRESH_MS) return
    this.handled.add(key)
    this.addUnseen(report.projectId, report.elements.filter(e => e.what !== 'removed').map(e => e.id))
    const offer = offerFor(report, words)
    if (offer === null) return
    // Already announced mid-turn: the version is old news, unless the turn's point is an element.
    if (offer.target.view === 'play' && report.version !== null && this.announced.get(report.projectId) === report.version.version) return
    if (report.version !== null) this.announced.set(report.projectId, report.version.version)
    this.offer(offer)
  }

  /** A version went live (or became a candidate) mid-turn: the agent published. */
  versionLanded(projectId: string, version: number, text: string): void {
    if (this.announced.get(projectId) === version) return
    this.announced.set(projectId, version)
    this.offer({ target: { view: 'play' }, text })
  }

  /** Go, or — when the user is in the middle of something, or it is switched off — leave a notice. */
  private offer(offer: NavOffer): void {
    const busy = this.playing || Date.now() - this.lastTouch < BUSY_MS
      || (offer.target.view === 'elements' && this.viewing?.view === 'elements' && this.viewing.elementId !== undefined && this.viewing.elementId !== offer.target.elementId)
    if (!this.enabled || busy) {
      this.noticeNow = { text: offer.text, target: offer.target }
      this.changed()
      return
    }
    if (this.mounted === 0 && (typeof window === 'undefined' || window.innerWidth < WIDE_PX)) return
    this.noticeNow = null
    this.open(offer.target)
    this.changed()
  }
}
