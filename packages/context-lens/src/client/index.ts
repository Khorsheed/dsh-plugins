/**
 * Request-inspector, browser half: mounts this package's generated Remote
 * contribution so `remote.requestInspector` exists, then surfaces the panel —
 * the `context-lens` right-Sidebar page tab (the official two-stage path:
 * the type into `ctx.sidebarRightTabs`, the body into the keyed seat under the
 * type's id), the per-turn icon in the assistant message's action row
 * (`conversation.chat.assistant-actions`), and the session-header utility
 * (`conversation.session.header.utilities`). All three registrations ride
 * registration-level toggles on the preset-visibility criterion (the package's
 * own row, root-mounted by its bundle patch, grants every session; a
 * preset-mounted row grants that preset's sessions); every unreadable path
 * fails open.
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API and the ctx.remote merge.
import type {} from '@khorsheed/dsh-context-lens/remote'
import requestInspectorRemote from '@khorsheed/dsh-context-lens/remote'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.sessions service merge (ISessions) — the visibility
// criterion reads the current session's preset.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.assistant-actions').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges
// and the right-Sidebar SlotMap seats ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { resolveTurnSeq } from './aggregate.ts'
import type { ListTurnsResult } from '../types.ts'
import type { InspectorRemote, InspectorTabInjected } from './contract.ts'
import { inspectorWire } from './wire.ts'
import { REQUEST_INSPECTOR_KIND, REQUEST_INSPECTOR_TAB_ID, requestInspectorDefinition } from './definition.tsx'
import { HeaderInspectUtility } from './HeaderUtility.tsx'
import { InspectorPanel } from './InspectorPanel.tsx'
import { en, NS, zh } from './locales.ts'
import {
  InspectorTabVisibility, RegistrationToggle, type InspectorPluginInventorySnapshot,
} from './preset-visibility.ts'
import { TurnInspectAction } from './TurnAction.tsx'

export { InspectorPanel } from './InspectorPanel.tsx'
export { TokenView } from './TokenView.tsx'
export { TimingView } from './TimingView.tsx'
export { SegmentBlocks, OutputBlock } from './SegmentBlocks.tsx'
export { RawView } from './RawView.tsx'
export { SegCtl } from './SegCtl.tsx'
export { TurnMenu, turnTitle } from './TurnMenu.tsx'
export { TurnInspectAction } from './TurnAction.tsx'
export { HeaderInspectUtility } from './HeaderUtility.tsx'
export {
  scrollConversationToTurn, scrollConversationToBottom, preferredScrollBehavior,
} from './scroll-sync.ts'
export { REQUEST_INSPECTOR_KIND, REQUEST_INSPECTOR_TAB_ID, requestInspectorDefinition } from './definition.tsx'
export type { RequestInspectorTabParams } from './definition.tsx'
export {
  InspectorTabVisibility, RegistrationToggle, REQUEST_INSPECTOR_ROW_MODULE,
} from './preset-visibility.ts'
export type { InspectorPluginInventorySnapshot } from './preset-visibility.ts'
export { resolveTurnSeq, latestTurnSeq, aggregateCategories, summarizeLanes } from './aggregate.ts'
export type {
  InspectorRemote, InspectorTabInjected, InspectorTabProps,
  InspectorActionInjected, InspectorActionProps,
  InspectorUtilityInjected, InspectorUtilityProps,
} from './contract.ts'

/** The on-screen session across host lines: 0.1.6-alpha.2 dropped
 * `SessionListState.current` for per-row `retainedBy.mainView` counts (the
 * `mainView` reference source is declared by ui-session, outside this
 * package's type program — hence the duck shape), while 0.1.5 publishes only
 * `current`. One build reads both.
 * @param list - sessions list snapshot.
 * @returns the main-view session id, or undefined when nothing is on screen.
 */
type SessionListCurrent = SessionListState & {
  current?: SessionId
  byId: Record<SessionId, { id: SessionId; retainedBy?: Readonly<Record<string, number>> }>
}
function mainSessionId(list: SessionListState): SessionId | undefined {
  const view = list as SessionListCurrent
  return Object.values(view.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id ?? view.current
}

/** Required services: slots, the remote channel, the locale, the session list (the visibility criterion), and the right-Sidebar faces. */
export const inject = ['slots', 'remote', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type (toggled on the visibility criterion), its body, and the two entry
 * points.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(requestInspectorRemote))
  } catch (error) {
    // A duplicate mount (two compositions) fails loud here but breaks nothing
    // else: the namespace exists once, which is all callers probe.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-lens: dictionaries')
  const t = ctx.locale.bind(NS)

  // Read lazily: a composition without the host half yields RPC errors on the
  // verbs, which the panel surfaces as its error state — never a boot failure.
  // All wire calls route through `inspectorWire`: the gateway runtime enforces
  // each verb's declared parameter count EXACTLY (a trailing optional param
  // counts), so the trailing filter arg is always passed explicitly.
  const remote = (): InspectorRemote => ctx.get('remote.requestInspector') as InspectorRemote
  const wire = (): InspectorTabInjected => inspectorWire(remote())
  const tabFace = (): InspectorTabInjected => ({
    ...wire(),
    loadThrough: async (sessionId, seq) => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding !== undefined) await binding.session.loadThrough(seq as Parameters<typeof binding.session.loadThrough>[0])
    },
  })

  /** Open the inspector tab; a kind hidden by the criterion throws, degrade to a log. */
  const openTab = (turnSeq: number | undefined): void => {
    try {
      ctx.sidebarRight.openTab(
        REQUEST_INSPECTOR_KIND,
        turnSeq === undefined ? undefined : { params: { turnSeq } },
      )
    } catch (error) {
      ctx.logger.warn('context-lens: openTab failed (tab type not registered?)', error)
    }
  }

  /** The turn action's resolve-and-open: closingMessageId match, latest-turn fallback. */
  const openForMessage = async (sessionId: SessionId, messageId?: string): Promise<void> => {
    let turnSeq: number | undefined
    try {
      const result: RemoteResult<ListTurnsResult> = await wire().listTurns(sessionId)
      if (result.ok) turnSeq = resolveTurnSeq(result.value.turns, messageId)
    } catch {
      // A dead namespace still opens the tab (its own error state reports it).
    }
    openTab(turnSeq)
  }
  const openLatest = (sessionId: SessionId): void => {
    void openForMessage(sessionId)
  }

  // The OFFICIAL pluginInventory namespace, probed the canvas way: through
  // ctx.get, never injected — a host without it must fail the criterion OPEN.
  const pluginInventory = ctx.get('remote.pluginInventory') as {
    list: () => Promise<RemoteResult<InspectorPluginInventorySnapshot>>
  } | undefined
  const visibility = new InspectorTabVisibility(ctx, pluginInventory)

  // The tab type and the two entries register exactly while the current
  // session's criterion passes (hidden means NOT registered; an opened tab of
  // an unregistered kind renders the host's designed tab.unavailable fallback).
  ctx.effect(() => {
    const toggles = [
      new RegistrationToggle(
        () => ctx.sidebarRightTabs.register(requestInspectorDefinition(t)),
        () => visibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
      ),
      new RegistrationToggle(
        () => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'context-lens-turn',
          // After the official actions and the sidechat quote (order 20).
          order: 30,
          locale: NS,
          inject: () => ({ open: openForMessage }),
        }, TurnInspectAction)),
        () => visibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
      ),
      new RegistrationToggle(
        () => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'context-lens-header',
          // After the official entries and the worktrees badge (order -20).
          order: 40,
          locale: NS,
          inject: () => ({ openLatest }),
        }, HeaderInspectUtility)),
        () => visibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
      ),
    ]
    for (const toggle of toggles) toggle.setReady(true)
    const unsubscribe = visibility.subscribe(() => {
      for (const toggle of toggles) toggle.sync()
    })
    return () => {
      unsubscribe()
      for (const toggle of toggles) toggle.setReady(false)
    }
  }, 'context-lens: surface visibility')

  // Stage two: the body under the type's id in the keyed pane seat. The body
  // registers unconditionally — an opened tab of a hidden type renders the
  // host's tab.unavailable without ever mounting this component.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: REQUEST_INSPECTOR_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, InspectorPanel)), 'context-lens: tab body')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
