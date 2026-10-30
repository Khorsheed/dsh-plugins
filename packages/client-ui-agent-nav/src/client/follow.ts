/**
 * The one follow rule (proposal 2026-10-30-agent-sidebar-navigation, U2/U4):
 * when a write tool's answer names a destination, the right Sidebar goes there
 * by itself only if the person watched that call land — on the session on
 * screen, not while working in a panel, not in a narrow window, at most once
 * per Turn. Every other case leaves the conversation's card (and the owner's
 * badge) for a click.
 *
 * "Watched it land" is read from the session's event window itself: the host
 * publishes every live event as an `append` delta, while opening a session,
 * reconnecting and paging back publish `replace` / `prepend`. So a follower
 * acts on appended `tool/result`s only, and only for a call whose `tool/call`
 * it saw appended too — a replayed history never moves the Sidebar, and no
 * tool row has to be rendered for the rule to work (a finished Turn folds its
 * rows into 「已调用工具」).
 *
 * Each plugin bundle inlines this module and starts one follower for the
 * kinds it owns. What must be shared across bundles — which ids were handled,
 * which Turn already moved the Sidebar, when the person last touched a panel —
 * lives in one page-wide registry on `globalThis`.
 *
 * Every decision is one console line: `[nav] dest=… kind=… decision=… reason=… session=…`.
 *
 * @module @khorsheed/dsh-client-ui-agent-nav/client
 */
import { readDestinations, type ContentLike, type Destination } from '../destination.ts'

/** What the follower does with one destination. */
export type FollowDecision = 'follow' | 'badge' | 'skip'

/** Why. */
export type FollowReason =
  | 'watched' | 'seen' | 'replay' | 'offscreen' | 'member' | 'narrow' | 'busy' | 'turn-once'

/** A panel touched this recently is being worked in: the Sidebar does not move under the person. */
export const BUSY_MS = 20_000

/** Below this window width a moving Sidebar covers the conversation: card only (U7). */
export const NARROW_PX = 820

/** The facts one decision is made from. */
export interface FollowInput {
  /** The call's `tool/call` and its result were both appended live. */
  readonly live: boolean
  /** The result belongs to the session on screen. */
  readonly onScreen: boolean
  /** In a room: whose write it was. Undefined outside a room. */
  readonly role?: 'coordinator' | 'member' | undefined
  /** Milliseconds since the person last touched a panel (undefined: never). */
  readonly idleMs: number | undefined
  /** The window is narrower than {@link NARROW_PX}. */
  readonly narrow: boolean
  /** This destination id was handled before on this page. */
  readonly seen: boolean
  /** Another destination already moved the Sidebar in this Turn. */
  readonly turnFollowed: boolean
}

/**
 * The follow rule. Order matters: the first failing check names the reason.
 * @param input - the facts.
 * @returns the decision and its reason.
 */
export function decideFollow(input: FollowInput): { decision: FollowDecision; reason: FollowReason } {
  if (input.seen) return { decision: 'skip', reason: 'seen' }
  if (!input.live) return { decision: 'skip', reason: 'replay' }
  if (!input.onScreen) return { decision: 'badge', reason: 'offscreen' }
  if (input.role === 'member') return { decision: 'badge', reason: 'member' }
  if (input.narrow) return { decision: 'badge', reason: 'narrow' }
  if (input.idleMs !== undefined && input.idleMs < BUSY_MS) return { decision: 'badge', reason: 'busy' }
  if (input.turnFollowed) return { decision: 'badge', reason: 'turn-once' }
  return { decision: 'follow', reason: 'watched' }
}

/* ------------------------------------------------------------ page registry */

interface NavRegistry {
  readonly version: 1
  readonly seen: Set<string>
  /** Session id → the last Turn that moved the Sidebar. */
  readonly turnFollowed: Map<string, number>
  lastInteraction: number | undefined
}

const REGISTRY_KEY = Symbol.for('dsh.agent-nav.registry')

/** The page-wide registry every inlined copy of this module shares. */
export function navRegistry(): NavRegistry {
  const holder = globalThis as unknown as Record<symbol, NavRegistry | undefined>
  let registry = holder[REGISTRY_KEY]
  if (registry === undefined || registry.version !== 1) {
    registry = { version: 1, seen: new Set(), turnFollowed: new Map(), lastInteraction: undefined }
    holder[REGISTRY_KEY] = registry
  }
  return registry
}

/**
 * Note that the person is working in a panel. Panel roots call it from their
 * capture handlers ({@link interactionHandlers}).
 * @param now - the clock (tests).
 */
export function markInteraction(now: number = Date.now()): void {
  navRegistry().lastInteraction = now
}

/** Spread onto a panel root: any pointer or key inside it counts as working there. */
export const interactionHandlers = {
  onPointerDownCapture: (): void => { markInteraction() },
  onKeyDownCapture: (): void => { markInteraction() },
} as const

/* ------------------------------------------------------------ the follower */

/** A session event, as the client event window carries it (structural). */
interface EventLike {
  readonly type: string
  readonly time?: number
  readonly data?: unknown
}

/** The client event window's latest delta (structural `SessionEventWindow`). */
interface WindowLike {
  readonly change: { readonly kind: string; readonly entries?: ReadonlyArray<{ readonly type: string; readonly event: EventLike }> }
}

/** An observable value (structural `ObservableSnapshot`). */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** What the follower reads from the host (see {@link followerHostOf}). */
export interface NavFollowerHost {
  /** The session on screen, and its changes. */
  readonly onScreen: Observable<string | undefined>
  /** The session's live event window; undefined while the runtime has not minted it. */
  readonly events: (sessionId: string) => Observable<WindowLike> | undefined
}

/** What one owner does with its destinations. */
export interface NavFollowerOptions {
  /** The tab kinds this owner opens. */
  readonly kinds: readonly string[]
  /** Go there (open the tab at the params). */
  readonly open: (destination: Destination) => void
  /** Mark it without moving (a strip dot, a tab badge). Optional. */
  readonly badge?: (destination: Destination) => void
  /** The log sink (default: `console.info`). */
  readonly log?: (line: string) => void
  /** The window width (tests). */
  readonly width?: () => number
  /** The clock (tests). */
  readonly now?: () => number
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

/** How long to keep retrying a session whose event window is not minted yet. */
const ATTACH_RETRY_MS = 1500
const ATTACH_RETRIES = 20

/**
 * Follow the on-screen session's write answers for some kinds.
 * @param host - the host faces.
 * @param options - the kinds and what to do with them.
 * @returns the stop function.
 */
export function startNavFollower(host: NavFollowerHost, options: NavFollowerOptions): () => void {
  const owned = new Set(options.kinds)
  const log = options.log ?? ((line: string) => { console.info(line) })
  const width = options.width ?? (() => (typeof window === 'undefined' ? Infinity : window.innerWidth))
  const now = options.now ?? Date.now
  let attached: string | undefined
  let detach: (() => void) | undefined
  let retry: ReturnType<typeof setInterval> | undefined
  /** Calls whose `tool/call` was appended live, by session. */
  const liveCalls = new Set<string>()

  const handle = (sessionId: string, event: EventLike): void => {
    const data = record(event.data)
    if (data === null) return
    if (event.type === 'tool/call') {
      if (typeof data['callId'] === 'string') liveCalls.add(data['callId'])
      return
    }
    if (event.type !== 'tool/result') return
    const message = record(data['message'])
    if (message === null || message['isError'] === true) return
    const content = Array.isArray(message['content']) ? message['content'] as ContentLike[] : []
    const callId = record(message['source'])?.['callId']
    const turn = typeof data['turn'] === 'number' ? data['turn'] : undefined
    const registry = navRegistry()
    for (const destination of readDestinations(content)) {
      if (!owned.has(destination.kind)) continue
      const idle = registry.lastInteraction === undefined ? undefined : now() - registry.lastInteraction
      const { decision, reason } = decideFollow({
        live: typeof callId === 'string' && liveCalls.has(callId),
        onScreen: true,
        idleMs: idle,
        narrow: width() < NARROW_PX,
        seen: registry.seen.has(destination.id),
        turnFollowed: turn !== undefined && registry.turnFollowed.get(sessionId) === turn,
      })
      log(`[nav] dest=${destination.id} kind=${destination.kind} decision=${decision} reason=${reason} session=${sessionId}`)
      if (decision === 'skip') continue
      registry.seen.add(destination.id)
      try {
        if (decision === 'follow') {
          if (turn !== undefined) registry.turnFollowed.set(sessionId, turn)
          options.open(destination)
        } else {
          options.badge?.(destination)
        }
      } catch (error) {
        log(`[nav] dest=${destination.id} kind=${destination.kind} failed=${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const tryAttach = (sessionId: string): boolean => {
    const source = host.events(sessionId)
    if (source === undefined) return false
    detach = source.subscribe(() => {
      const change = source.getSnapshot().change
      if (change.kind !== 'append') return
      for (const entry of change.entries ?? []) {
        if (entry.type === 'event') handle(sessionId, entry.event)
      }
    })
    return true
  }

  const sync = (): void => {
    const sessionId = host.onScreen.getSnapshot()
    if (sessionId === attached) return
    detach?.()
    detach = undefined
    if (retry !== undefined) clearInterval(retry)
    retry = undefined
    liveCalls.clear()
    attached = sessionId
    if (sessionId === undefined || tryAttach(sessionId)) return
    let left = ATTACH_RETRIES
    retry = setInterval(() => {
      left -= 1
      if (attached !== sessionId || tryAttach(sessionId) || left <= 0) {
        clearInterval(retry)
        retry = undefined
      }
    }, ATTACH_RETRY_MS)
  }

  const unsubscribe = host.onScreen.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    detach?.()
    if (retry !== undefined) clearInterval(retry)
  }
}

/**
 * The follower's host faces from a client context, probed: the right Sidebar's
 * `mounted` (the session on screen) and the session binding's event window.
 * Undefined when either is missing (an older host line): the owner then has
 * cards only.
 * @param get - the context's `ctx.get`.
 */
export function followerHostOf(get: (name: string) => unknown): NavFollowerHost | undefined {
  const sidebar = record(get('sidebarRight'))
  const mounted = record(sidebar?.['mounted'])
  const sessions = record(get('sessions'))
  const binding = sessions?.['binding']
  if (mounted === null || typeof mounted['getSnapshot'] !== 'function' || typeof mounted['subscribe'] !== 'function'
    || typeof binding !== 'function') return undefined
  return {
    onScreen: mounted as unknown as Observable<string | undefined>,
    events: sessionId => {
      try {
        const bound = record((binding as (id: string) => unknown).call(sessions, sessionId))
        const source = record(bound?.['eventSource'])
        return source !== null && typeof source['getSnapshot'] === 'function' && typeof source['subscribe'] === 'function'
          ? source as unknown as Observable<WindowLike>
          : undefined
      } catch {
        return undefined
      }
    },
  }
}
