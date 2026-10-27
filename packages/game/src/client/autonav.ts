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
 * The busy rules, the per-viewer switch, notices and console traces come from
 * the shared reveal kit; this layer knows the game: where a turn's result is,
 * the dots, and the agent's `game_show` requests.
 *
 * Per viewer and best effort: the switch and the dots live in this browser.
 * @module @khorsheed/dsh-game/client
 */
import { RevealController } from '@khorsheed/dsh-client-ui-reveal-kit/src/client/index.ts'
import type { NavTarget } from './contract.ts'
import type { ShowRequest, TurnReport } from '../types.ts'

/** A turn report older than this is history (a reload), not news. */
const FRESH_MS = 120_000

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
  /** The shared controller (busy rules, switch, notices, traces); the notice bar subscribes to it. */
  readonly reveal: RevealController<NavTarget>
  private readonly listeners = new Set<() => void>()
  private readonly handled = new Set<string>()
  /** The last version announced per project (a version is announced once, however it was learned of). */
  private readonly announced = new Map<string, number>()

  /** @param open - opens the game tab at a place (the plugin's openAt). */
  constructor(open: (target: NavTarget) => void) {
    this.reveal = new RevealController<NavTarget>({
      name: 'game', open, switchKey: SWITCH_KEY,
      // An element's page is not left for another element's.
      leavesView: (target, viewing) => target.view === 'elements' && viewing.view === 'elements'
        && viewing.elementId !== undefined && viewing.elementId !== target.elementId,
    })
    this.reveal.subscribe(() => { this.changed() })
  }

  get enabled(): boolean { return this.reveal.enabled }
  setEnabled(on: boolean): void { this.reveal.setEnabled(on) }
  get notice(): NavNotice | null { return this.reveal.notice }
  dismiss(): void { this.reveal.dismiss() }
  follow(): void { this.reveal.follow() }
  mount(): () => void { return this.reveal.mount() }
  touched(): void { this.reveal.touched() }
  setPlaying(on: boolean): void { this.reveal.hold(on ? 'a game is running' : null) }
  setViewing(target: NavTarget | null): void { this.reveal.setViewing(target) }

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
    // Already announced (mid-turn, or by the agent's own game_show): the version is old news.
    if (offer.target.view === 'play' && report.version !== null && this.announced.get(report.projectId) === report.version.version) return
    if (report.version !== null) this.announced.set(report.projectId, report.version.version)
    this.reveal.offer(offer.target, offer.text, 'turn end')
  }

  /** A version went live (or became a candidate) with no turn end to tell of it. */
  versionLanded(projectId: string, version: number, text: string): void {
    if (this.announced.get(projectId) === version) return
    this.announced.set(projectId, version)
    this.reveal.offer({ view: 'play' }, text, `v${version} landed`)
  }

  /** The session got bound to a project while the page was open (a room member created or opened it). */
  projectOpened(text: string): void {
    this.reveal.offer({ view: 'play' }, text, 'project bound')
  }

  /**
   * The agent asked to show the user something (\`game_show\`). Taken once per
   * request; when it lands with a new version, that version counts as announced.
   * @returns whether the request was acted on.
   */
  requested(projectId: string, request: ShowRequest, text: string, fresh: boolean, version: number): boolean {
    const target: NavTarget = { view: request.target.view, ...(request.target.elementId === undefined ? {} : { elementId: request.target.elementId }), ...(request.target.chapterId === undefined ? {} : { chapterId: request.target.chapterId }) }
    const outcome = this.reveal.request(projectId, request.seq, target, text, fresh)
    if (outcome === null) return false
    if (version > 0) this.announced.set(projectId, version)
    return true
  }
}
