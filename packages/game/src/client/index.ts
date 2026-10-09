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
import type { GameTabInjected } from './contract.ts'
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
export const inject = ['slots', 'remote', 'locale', 'sessions', 'sidebarRightTabs']

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
  const carrier = ctx.remote as {
    $on?: (event: 'api-session/status' | 'api-session/activity', listener: (sessionId: string) => void) => () => void
  }
  if (typeof carrier.$on === 'function') {
    for (const forwarded of ['api-session/status', 'api-session/activity'] as const) {
      const off = carrier.$on(forwarded, (sessionId: string) => { for (const listener of listeners) listener(sessionId) })
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

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: GAME_TAB_ID,
    locale: NS,
    inject: (): GameTabInjected => ({
      fetchState: (sid: SessionId) => remote.state(sid),
      bind: (sid: SessionId, projectId: string | null) => remote.bind(sid, { projectId }),
      fetchBundle: (projectId: string, which: 'current' | 'candidate') => remote.bundle({ projectId, which }),
      confirm: (sid: SessionId, projectId: string) => remote.confirm(sid, { projectId }),
      setAutoConfirm: (sid: SessionId, projectId: string, on: boolean) => remote.setAutoConfirm(sid, { projectId, on }),
      logPlay: (sid: SessionId, entry) => remote.logPlay(sid, entry),
      subscribeSessionEvents: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }),
  }, GameTab)), 'game: tab body')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
