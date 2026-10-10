/**
 * Game mode, browser half: mounts the `game` Remote, registers the `game`
 * right-Sidebar tab type (self-hidden where the session cannot reach the game
 * tools) and its body in the keyed pane seat. Turn-boundary pushes
 * (`api-session/status` / `api-session/activity`, the two the official
 * allowlist forwards) refresh the tab, which is how a version deployed at the
 * end of a turn reaches the play area.
 * @module @khorsheed/dsh-game/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@khorsheed/dsh-game/remote'
import gameRemote from '@khorsheed/dsh-game/remote'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { GAME_CHAT_KIND, GameChatRow, gameMessageDefinition } from './chat-node.tsx'
import type { GameApi, GameTabInjected, NavTarget } from './contract.ts'
import { gameTurnDefinition, GameTurnCard } from './TurnCard.tsx'
import { GameDock } from './GameDock.tsx'
import { GAME_KIND, GAME_TAB_ID, gameDefinition } from './definition.tsx'
import { GameTab } from './GameTab.tsx'
import { en, NS, zh } from './locales.ts'
import { GameTabVisibility, RegistrationToggle, type GamePluginInventorySnapshot } from './preset-visibility.ts'

export { GameTab, GAME_KIND, GAME_TAB_ID }

/** The generated Remote face. */
type GameRemote = TypertRemoteNamespaceMap['game']

/** The on-screen session across host lines (the worktrees precedent). */
type SessionListCurrent = SessionListState & {
  current?: SessionId
  byId: Record<SessionId, { id: SessionId; retainedBy?: Readonly<Record<string, number>> }>
}
function mainSessionId(list: SessionListState): SessionId | undefined {
  const view = list as SessionListCurrent
  return Object.values(view.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id ?? view.current
}

/** `remote.game` is mounted here and read back through ctx.get (never injected — that would deadlock the loader). */
export const inject = ['slots', 'remote', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(gameRemote))
  } catch (error) {
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'game: dictionaries')
  const t = ctx.locale.bind(NS)
  const remote = ctx.get('remote.game') as GameRemote
  const pluginInventory = ctx.get('remote.pluginInventory') as {
    list: () => Promise<RemoteResult<GamePluginInventorySnapshot>>
  } | undefined

  const listeners = new Set<(sessionId: string) => void>()
  const emit = (sessionId: string): void => { for (const listener of listeners) listener(sessionId) }
  const carrier = ctx.remote as {
    $on?: (event: 'api-session/status' | 'api-session/activity', listener: (sessionId: string) => void) => () => void
  }
  if (typeof carrier.$on === 'function') {
    for (const forwarded of ['api-session/status', 'api-session/activity'] as const) {
      const off = carrier.$on(forwarded, (sessionId: string) => { emit(sessionId) })
      disposers.push(async () => { off() })
    }
  }

  const tabVisibility = new GameTabVisibility(ctx, pluginInventory)
  ctx.effect(() => {
    const toggle = new RegistrationToggle(
      () => ctx.sidebarRightTabs.register(gameDefinition(t)),
      () => tabVisibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
    )
    toggle.setReady(true)
    const unsubscribe = tabVisibility.subscribe(() => { toggle.sync() })
    return () => { unsubscribe(); toggle.setReady(false) }
  }, 'game: tab type visibility')

  const api: GameApi = {
    state: sid => remote.state(sid),
    projectCards: () => remote.projectCards(),
    turnReport: (sid, turn) => remote.turnReport(sid, { turn }),
    bind: (sid, projectId) => remote.bind(sid, { projectId }),
    bundle: (projectId, which) => remote.bundle({ projectId, which }),
    versionBundle: (projectId, version) => remote.versionBundle({ projectId, version }),
    confirm: (sid, projectId) => remote.confirm(sid, { projectId }),
    reject: (sid, projectId, reason) => remote.reject(sid, { projectId, reason }),
    rollback: (sid, projectId, version) => remote.rollback(sid, { projectId, version }),
    diff: (projectId, from, to) => remote.diff({ projectId, from, to }),
    checkShot: projectId => remote.checkShot({ projectId }),
    setAutoConfirm: (sid, projectId, on) => remote.setAutoConfirm(sid, { projectId, on }),
    logPlay: (sid, entry) => remote.logPlay(sid, entry),
    setParam: (sid, projectId, key, value) => remote.setParam(sid, { projectId, key, value }),
    finalizeParams: (sid, projectId) => remote.finalizeParams(sid, { projectId }),
    resetParams: (sid, projectId) => remote.resetParams(sid, { projectId }),
    editElement: (sid, projectId, elementId, patch) => remote.editElement(sid, { projectId, elementId, ...patch }),
    pickProposal: (sid, projectId, elementId, at, index) => remote.pickProposal(sid, { projectId, elementId, at, index }),
    writeChapter: (sid, projectId, chapterId, text) => remote.writeChapter(sid, { projectId, chapterId, text }),
    requestRestyle: (sid, projectId, styleId) => remote.requestRestyle(sid, { projectId, styleId }),
    setOnePager: (sid, projectId, patch) => remote.setOnePager(sid, { projectId, ...patch }),
    dropPending: (sid, projectId, key) => remote.dropPending(sid, { projectId, key }),
  }

  /** The session's composer, structurally (the quote/canvas precedent; a composition may have none). */
  interface ConversationInput {
    readonly state: { getSnapshot(): { draft: string } }
    setDraft(value: string): void
    focus?: () => void
  }
  const inputFor = (sessionId: SessionId): ConversationInput | undefined => {
    try {
      const scope = (ctx.get('sessions') as { scope?: (id: SessionId) => { get(name: string): unknown } } | undefined)?.scope?.(sessionId)
      const input = (scope?.get('conversation') as { input?: { for(actx: unknown): unknown } } | undefined)?.input?.for(scope)
      const face = input as Partial<ConversationInput> | undefined
      return typeof face?.setDraft === 'function' && typeof face.state?.getSnapshot === 'function' ? face as ConversationInput : undefined
    } catch {
      return undefined
    }
  }
  const navListeners = new Set<(target: NavTarget) => void>()
  let parkedNav: NavTarget | null = null
  const face: GameTabInjected = {
    openAt: (target) => {
      parkedNav = target
      try {
        ctx.sidebarRight.openTab(GAME_KIND)
      } catch (error) {
        ctx.logger.warn('game: openTab failed (tab type not registered?)', error)
      }
      for (const listener of navListeners) listener(target)
    },
    subscribeNav: (listener) => {
      navListeners.add(listener)
      return () => { navListeners.delete(listener) }
    },
    takeNav: () => {
      const target = parkedNav
      parkedNav = null
      return target
    },
    api,
    insertDraft: (sessionId, text) => {
      const input = inputFor(sessionId)
      if (input === undefined) return false
      const kept = input.state.getSnapshot().draft.replace(/\s+$/, '')
      input.setDraft(kept.length === 0 ? text : `${kept}\n\n${text}`)
      if (typeof input.focus === 'function') input.focus()
      return true
    },
    subscribeSessionEvents: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    touch: sessionId => { emit(sessionId) },
  }

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: GAME_TAB_ID,
    locale: NS,
    inject: (): GameTabInjected => face,
  }, GameTab)), 'game: tab body')

  // 将附上: the dock above the composer (only renders for a bound session with pending changes).
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-game-pending',
    order: 45,
    locale: NS,
    inject: (): GameTabInjected => face,
  }, GameDock)), 'game: pending dock')

  // The turn card: what each agent turn changed in the game, beneath the
  // turn's closing prose (outside the fold), with jumps into the tab. The
  // canvas-novel turn-tail precedent.
  // The seat's owner props are typed by ui-chat; this card reads them
  // structurally (the canvas-novel precedent), so it registers structurally.
  const seats = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  ctx.effect(() => seats.inject('conversation.chat.turnTail', () => {
    const conversation = (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as {
      events?: { register?: (definition: unknown) => () => void }
    } | undefined
    const register = conversation?.events?.register
    if (register === undefined) return () => undefined
    const disposeDefinition = register.call(conversation?.events, gameTurnDefinition)
    const disposeEntry = seats.register({
      name: 'conversation.chat.turnTail',
      id: '@khorsheed/dsh-game/turn',
      order: 45,
      locale: NS,
      inject: (): GameTabInjected => face,
    }, GameTurnCard)
    return () => {
      disposeEntry()
      disposeDefinition()
    }
  }), 'game: turn-tail card')

  // The conversation rows for dsh-game messages (check findings, attached changes).
  ctx.inject(['uiConversation'], (lctx) => {
    lctx.effect(() => lctx.uiConversation.events.register(gameMessageDefinition), 'game: chat projection')
  })
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: GAME_CHAT_KIND,
    locale: NS,
  }, GameChatRow)), 'game: chat row')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
