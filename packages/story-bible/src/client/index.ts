/**
 * story-bible, browser half: ONE right-Sidebar tab type (`story`, 写作) over
 * the `story` Remote face — the work strip once, the internal 灵感碎片/章节
 * 阅读 switcher, both panes — plus the two keyed tool rows and the two
 * session-header gate chips (plan unconfirmed / pending count).
 *
 * F1-4: the M3 two-kind shape (story-fragments / story-reader) retired into
 * the internal switcher — one plugin, one host tab; layouts holding the
 * retired kinds render the host's designed `tab.unavailable` fallback (close
 * and reopen). Mode visibility: the tab follows the cross-session rule (the
 * install layer decides, no runtime switch); the CHIPS are session-bound
 * chrome and follow the preset criterion (preset-visibility.ts, fail-open).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-story-bible/remote'
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls ui-conversation's SlotMap merge (the header utilities seat)
// and ui-session's SessionStandardProps merge (the chips' sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { OpenInAppProbe, pickIde } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import storyRemote from '@khorsheed/dsh-story-bible/remote'
import type { StoryRemote, StoryTabInjected } from './contract.ts'
import { STORY_KIND, STORY_TAB_ID, storyDefinition } from './definition.ts'
import { en, zh } from './locales.ts'
import { StoryUiStore } from './store.ts'
import { StoryChipVisibility } from './preset-visibility.ts'
import { StoryTab } from './StoryTab.tsx'
import { StoryWriteRow } from './toolview/StoryWriteRow.tsx'
import { StoryExtractRow } from './toolview/StoryExtractRow.tsx'
import { StoryPendingChip, StoryPlanChip } from './chips.tsx'

export { STORY_KIND } from './definition.ts'
export { StoryUiStore } from './store.ts'
export { StoryTab } from './StoryTab.tsx'
export { StoryWriteRow } from './toolview/StoryWriteRow.tsx'
export { StoryExtractRow } from './toolview/StoryExtractRow.tsx'
export { StoryPlanChip, StoryPendingChip } from './chips.tsx'
export type { StoryRemote, StoryTabInjected, StoryTabProps } from './contract.ts'

/** The locale namespace the dictionaries register under. */
export const NS = 'story'

/**
 * Required services: slots, the remote channel, the locale, the
 * right-Sidebar faces, the conversation face (the chips' seat), and the
 * session list (the chips' criterion reads the current session).
 * `remote.story` is deliberately NOT an inject: this plugin both mounts the
 * namespace and consumes it, and the Cordis property proxy only resolves
 * services declared in `inject` or provided by an ancestor fiber — declaring
 * it would deadlock the loader (the canvas precedent).
 */
export const inject = ['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type, its body, the two tool rows, and the two header chips.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(storyRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'story-bible: dictionaries')
  const t = ctx.locale.bind(NS)

  // The shared layout/freshness store: one instance, published into every seat.
  const store = new StoryUiStore()

  // The open-in-app probe (the editor door): one per page, read lazily; a
  // failed read publishes an empty list, which hides the gesture.
  const probe = new OpenInAppProbe()
  void probe.load()

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the views report that instead of pending forever.
  const requireRemote = (): StoryRemote => {
    const mounted = ctx.get('remote.story') as StoryRemote | undefined
    if (mounted === undefined) throw new Error('story-bible: the host half is not installed')
    return mounted
  }

  /** Every mutating wrapper lands here: a landed write touches the shared store, so every reader re-reads. */
  const touchOnSuccess = <T extends { ok: boolean }>(result: T): T => {
    if (result.ok) store.touch()
    return result
  }

  /** Open the story tab (both doors and both chips share it). */
  const openStoryTab = (): void => {
    try {
      ctx.sidebarRight.openTab(STORY_KIND)
    } catch (error) {
      ctx.logger.warn('story-bible: openTab(story) failed', error)
    }
  }

  const tabFace = (): StoryTabInjected => ({
    listWorks: () => requireRemote().listWorks(),
    readWork: request => requireRemote().readWork(request),
    getFocus: sessionId => requireRemote().getFocus(sessionId),
    listMemories: request => requireRemote().listMemories(request),
    listCharacters: request => requireRemote().listCharacters(request),
    listExperiences: request => requireRemote().listExperiences(request),
    listChapters: request => requireRemote().listChapters(request),
    readChapter: request => requireRemote().readChapter(request),
    ledger: request => requireRemote().ledger(request),
    listMentions: request => requireRemote().listMentions(request),
    listPending: request => requireRemote().listPending(request),
    statWorkspace: request => requireRemote().statWorkspace(request),
    // The mutating calls hand the TAB's session to the host (the tab is
    // session scope; the fence resolves that session's mode).
    createWork: async (sessionId, request) => touchOnSuccess(await requireRemote().createWork(sessionId, request)),
    focusWork: async (sessionId, request) => touchOnSuccess(await requireRemote().focusWork(sessionId, request)),
    writeMemory: async (sessionId, request) => touchOnSuccess(await requireRemote().writeMemory(sessionId, request)),
    decideMemory: async (sessionId, request) => touchOnSuccess(await requireRemote().decideMemory(sessionId, request)),
    patchMemory: async (sessionId, request) => touchOnSuccess(await requireRemote().patchMemory(sessionId, request)),
    writeCharacter: async (sessionId, request) => touchOnSuccess(await requireRemote().writeCharacter(sessionId, request)),
    reviewChapter: async (sessionId, request) => touchOnSuccess(await requireRemote().reviewChapter(sessionId, request)),
    confirmChapterPlan: async (sessionId, request) => touchOnSuccess(await requireRemote().confirmChapterPlan(sessionId, request)),
    foreshadowExit: async (sessionId, request) => touchOnSuccess(await requireRemote().foreshadowExit(sessionId, request)),
    decidePending: async (sessionId, request) => touchOnSuccess(await requireRemote().decidePending(sessionId, request)),
    retractExperience: async (sessionId, request) => touchOnSuccess(await requireRemote().retractExperience(sessionId, request)),
    editorAvailable: () => {
      const apps = probe.apps.getSnapshot()
      return (apps !== null && pickIde(apps) !== undefined) || typeof ctx.sidebarRight?.openResource === 'function'
    },
    openInEditor: (sessionId: SessionId, workspace: string, title: string, file: string) => {
      const apps = probe.apps.getSnapshot()
      const ide = apps === null ? undefined : pickIde(apps)
      if (ide !== undefined) {
        // The open route takes a DIRECTORY: the manuscript folder it is.
        void probe.open(ide, `${workspace}/${title}`)
        return
      }
      try {
        ctx.sidebarRight.openResource(fileAddressFor(sessionId, workspace, `${workspace}/${title}/${file}`))
      } catch (error) {
        ctx.logger.warn('story-bible: openResource failed (no mounted session?)', error)
      }
    },
    // The plan row's 「去确认」: the reader pane at that chapter (F1-4: the
    // internal switch, then the one tab).
    openReaderAt: (n: number) => {
      store.openReaderAt(n)
      store.setTabView('reader')
      openStoryTab()
    },
    // The extract row's 「去处理」: the fragments pane with the queue pulsing.
    openPending: () => {
      store.setTabView('fragments')
      store.pulsePending()
      openStoryTab()
    },
    openCharacter: (characterId: string) => {
      store.setCmCharacter(characterId)
      store.setFragmentsView('characters')
      store.setTabView('fragments')
      openStoryTab()
    },
    setTabView: view => { store.setTabView(view) },
    // The host's directory picker (the datasets precedent: legacy
    // ctx.workspaces first, ui-workspace next; neither → the fallback input).
    pickDirectory: (() => {
      const legacy = (ctx.get('workspaces') as { pickDirectory?: () => Promise<string | null> } | undefined)?.pickDirectory
      if (legacy !== undefined) return (): Promise<string | null> => legacy.call(ctx.get('workspaces'))
      const uiWorkspace = ctx.get('uiWorkspace') as { pickDirectory?: () => Promise<string | null> } | undefined
      return uiWorkspace?.pickDirectory !== undefined ? (): Promise<string | null> => uiWorkspace.pickDirectory!() : null
    })(),
    setFragmentsView: view => { store.setFragmentsView(view) },
    setCmCharacter: id => { store.setCmCharacter(id) },
    setCmCursor: n => { store.setCmCursor(n) },
    refresh: () => { store.touch() },
    hooks: { story: store.source },
  })

  // The ONE page type (guide entry, no address claims). The cross-session
  // rule: no runtime visibility switch — it registers exactly once, and the
  // install layer decides whether the surface exists at all.
  ctx.effect(() => ctx.sidebarRightTabs.register(storyDefinition(t)), 'story-bible: story tab type')

  // The tab body under the type's key in the keyed seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: STORY_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, StoryTab)), 'story-bible: story tab body')

  // The two tool rows in the conversation. The slot is declared by
  // @deepseek-ai/dsh-client-ui-tool, which this package does not depend on —
  // its SlotMap entry is not in this type graph, so the registrations go
  // through a structural view of the registry (the canvas propose-row
  // precedent). Without that package the injects never fire and the calls
  // keep the host's generic rows.
  const toolSlots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  const rowFace = {
    openReaderAt: (n: number) => { tabFace().openReaderAt(n) },
    openPending: () => { tabFace().openPending() },
  }
  ctx.effect(() => toolSlots.inject('tool.call.toolview', () => toolSlots.register({
    name: 'tool.call.toolview',
    key: 'story_write',
    locale: NS,
    inject: () => rowFace,
  }, StoryWriteRow)), 'story-bible: story_write tool row')
  ctx.effect(() => toolSlots.inject('tool.call.toolview', () => toolSlots.register({
    name: 'tool.call.toolview',
    key: 'story_extract',
    locale: NS,
    inject: () => rowFace,
  }, StoryExtractRow)), 'story-bible: story_extract tool row')

  // The two gate chips on the official session-header utilities seat (F1-5):
  // a list slot, so a chip with nothing to show renders nothing. The seat is
  // declared by ui-conversation; the same structural probe applies.
  const visibility = new StoryChipVisibility(ctx, ctx.get('remote.pluginInventory') as {
    list: () => Promise<import('@deepseek-ai/dsh-typert-protocol').RemoteResult<import('./preset-visibility.ts').StoryPluginInventorySnapshot>>
  } | undefined)
  const conversationSlots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  ctx.effect(() => conversationSlots.inject('conversation.session.header.utilities', () => conversationSlots.register({
    name: 'conversation.session.header.utilities',
    id: 'story-plan-gate',
    order: 100,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      read: async (): Promise<{ n: number; title: string } | null> => {
        const focused = await requireRemote().getFocus(sessionId)
        if (!focused.ok || focused.value === null) return null
        const rows = await requireRemote().listChapters({ workId: focused.value.workId })
        if (!rows.ok) return null
        const row = rows.value.find(candidate =>
          candidate.phase === 'planning' && candidate.chapter.plan !== undefined && candidate.chapter.planConfirmedAt === undefined)
        return row === undefined ? null : { n: row.chapter.n, title: row.chapter.title }
      },
      jump: (n: number) => { tabFace().openReaderAt(n) },
      show: () => visibility.show(sessionId),
      hooks: { story: store.source },
    }),
  }, StoryPlanChip)), 'story-bible: plan gate chip')
  ctx.effect(() => conversationSlots.inject('conversation.session.header.utilities', () => conversationSlots.register({
    name: 'conversation.session.header.utilities',
    id: 'story-pending-gate',
    order: 101,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      read: async (): Promise<{ count: number } | null> => {
        const focused = await requireRemote().getFocus(sessionId)
        if (!focused.ok || focused.value === null) return null
        const info = await requireRemote().readWork({ workId: focused.value.workId })
        if (!info.ok || info.value.ok !== true || info.value.info === undefined) return null
        return { count: info.value.info.counts.pending }
      },
      jump: () => { tabFace().openPending() },
      show: () => visibility.show(sessionId),
      hooks: { story: store.source },
    }),
  }, StoryPendingChip)), 'story-bible: pending gate chip')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
