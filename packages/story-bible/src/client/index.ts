/**
 * story-bible, browser half (M3): TWO right-Sidebar tab types — `story-
 * fragments` (灵感碎片: the five views plus the pinned pending queue) and
 * `story-reader` (章节阅读: the plan card, the phase lamp, the manuscript)
 * — over the M1 `story` Remote face, plus the two keyed tool rows
 * (`story_write`'s plan card, `story_extract`'s reconciliation card).
 *
 * It mounts the Remote through the official `ctx.remote.$mount` channel and
 * registers the tab types on the registry and the tab bodies on the keyed
 * `sidebar.right.pane.tab` seat. Mode visibility follows the cross-session
 * rule (docs/plugin-visibility.md): the works store is deployment-level
 * content, so there is NO runtime switch — the install layer decides. Every
 * seat is probed, never assumed: registrations ride `ctx.slots.inject`, the
 * editor door degrades to hidden when no open-in-app probe resolves, and
 * with no `remote.story` mounted the tabs still register and report the
 * missing half instead of throwing through boot.
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
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { OpenInAppProbe, pickIde } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import storyRemote from '@khorsheed/dsh-story-bible/remote'
import type { StoryRemote, StoryTabInjected } from './contract.ts'
import {
  STORY_FRAGMENTS_KIND, STORY_READER_KIND, STORY_READER_TAB_ID, STORY_TAB_ID,
  storyFragmentsDefinition, storyReaderDefinition,
} from './definition.ts'
import { en, zh } from './locales.ts'
import { StoryUiStore } from './store.ts'
import { FragmentsTab } from './FragmentsTab.tsx'
import { ReaderTab } from './ReaderTab.tsx'
import { StoryWriteRow } from './toolview/StoryWriteRow.tsx'
import { StoryExtractRow } from './toolview/StoryExtractRow.tsx'

export { STORY_FRAGMENTS_KIND, STORY_READER_KIND } from './definition.ts'
export { StoryUiStore } from './store.ts'
export { FragmentsTab } from './FragmentsTab.tsx'
export { ReaderTab } from './ReaderTab.tsx'
export { StoryWriteRow } from './toolview/StoryWriteRow.tsx'
export { StoryExtractRow } from './toolview/StoryExtractRow.tsx'
export type { StoryRemote, StoryTabInjected, StoryTabProps } from './contract.ts'

/** The locale namespace the dictionaries register under. */
export const NS = 'story'

/**
 * Required services: slots, the remote channel, the locale, and the
 * right-Sidebar faces (the tab-type registry and the navigation service the
 * tool rows' doors go through). `remote.story` is deliberately NOT an inject:
 * this plugin both mounts the namespace and consumes it, and the Cordis
 * property proxy only resolves services declared in `inject` or provided by
 * an ancestor fiber — declaring it would deadlock the loader (the canvas
 * precedent).
 */
export const inject = ['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * two tab types, their bodies, and the two tool rows.
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

  // The shared layout/freshness store: one instance, published into both tabs' faces.
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
    openReaderAt: (n: number) => {
      store.openReaderAt(n)
      try {
        ctx.sidebarRight.openTab(STORY_READER_KIND)
      } catch (error) {
        ctx.logger.warn('story-bible: openTab(story-reader) failed', error)
      }
    },
    openPending: () => {
      store.pulsePending()
      try {
        ctx.sidebarRight.openTab(STORY_FRAGMENTS_KIND)
      } catch (error) {
        ctx.logger.warn('story-bible: openTab(story-fragments) failed', error)
      }
    },
    openCharacter: (characterId: string) => {
      store.setCmCharacter(characterId)
      store.setFragmentsView('characters')
      try {
        ctx.sidebarRight.openTab(STORY_FRAGMENTS_KIND)
      } catch (error) {
        ctx.logger.warn('story-bible: openTab(story-fragments) failed', error)
      }
    },
    setFragmentsView: view => { store.setFragmentsView(view) },
    setCmCharacter: id => { store.setCmCharacter(id) },
    setCmCursor: n => { store.setCmCursor(n) },
    refresh: () => { store.touch() },
    hooks: { story: store.source },
  })

  // Stage one: the two page types (guide entries, no address claims). The
  // cross-session rule: no runtime visibility switch — they register exactly
  // once, and the install layer decides whether the surface exists at all.
  ctx.effect(() => ctx.sidebarRightTabs.register(storyFragmentsDefinition(t)), 'story-bible: fragments tab type')
  ctx.effect(() => ctx.sidebarRightTabs.register(storyReaderDefinition(t)), 'story-bible: reader tab type')

  // Stage two: the two tab bodies, each under its own type's key in the
  // keyed seat. Both take the same injected face — the work strip atop each
  // reads and switches the same registry/focus.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: STORY_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, FragmentsTab)), 'story-bible: fragments tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: STORY_READER_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, ReaderTab)), 'story-bible: reader tab body')

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

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
