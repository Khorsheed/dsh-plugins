/**
 * The library's browser half: mount the Remote, register the dictionaries and
 * the right-Sidebar tab, and hand the pane the gestures it cannot perform for
 * itself (priming the conversation, binding the session).
 *
 * Failure policy is the repo's "degrade, don't explode": genuinely required
 * wiring (`slots`, `remote`, `locale`, `sidebarRightTabs`, `sessions`) is
 * declared in `inject` and logged when it fails, while every optional surface
 * is probed per gesture — a session without a conversation input makes the
 * re-split gesture answer false instead of throwing.
 *
 * @module @khorsheed/dsh-library/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and the ctx.remote merge.
import type {} from '@khorsheed/dsh-library/remote'
// Type-only: pulls the ctx.sidebarRightTabs merge and the pane seat.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import libraryRemote from '@khorsheed/dsh-library/remote'
import type { LibraryPaneInjected } from './contract.ts'
import { LIBRARY_TAB_ID, libraryDefinition } from './definition.tsx'
import { LibraryPane } from './LibraryPane.tsx'
import { LibraryBindChip, type LibraryBindInjected } from './bind/BindChip.tsx'
import { createLibraryStore } from './store.ts'
import { en, NS, zh } from './locales.ts'
import {
  LibraryTabVisibility, RegistrationToggle, type LibraryPluginInventorySnapshot,
} from './preset-visibility.ts'

export { LibraryPane }
export { LIBRARY_KIND, LIBRARY_TAB_ID } from './definition.tsx'

/**
 * Required services: the pane seat, the wire channel, the locale, the tab-type
 * registry, and sessions (the re-split's conversation draft lives behind a
 * session scope, and the tab type's preset-visibility criterion reads the
 * current session). `remote.library` is deliberately NOT an inject: this
 * plugin both mounts the namespace and consumes it — the canvas pattern (a
 * declared inject would deadlock the loader).
 */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs', 'sessions']

/**
 * The on-screen session across host lines: 0.1.6-alpha.2 dropped
 * `SessionListState.current` for per-row `retainedBy.mainView` counts, while
 * 0.1.5 publishes only `current`. One build reads both (the canvas shape).
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

/** The slice of ui-conversation's per-session input the pane drives (structural). */
interface ConversationInput {
  readonly state: { getSnapshot(): { draft: string } }
  setDraft(value: string): void
  addAttachments?(ids: readonly unknown[]): boolean
  submit?(mode?: 'queue'): void
}

/** The slice of ui-conversation's service that turns a picked file into a draft attachment (structural). */
interface ConversationDrafts {
  createDrafts?(sessionId: SessionId, files: readonly File[]): readonly { id: unknown }[]
  releaseDraftAttachments?(drafts: readonly { id: unknown }[]): void
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type (gated by the preset-visibility criterion) and its body.
 *
 * @param ctx - client root context.
 * @returns the teardown for everything this body registered.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(libraryRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud; the rest of
    // the plugin still registers, so the tab shows its empty state rather than
    // disappearing.
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'library: dictionaries')
  const t = ctx.locale.bind(NS)

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the pane's reads answer a refusal instead of
  // pending forever on an inject it cannot satisfy.
  const remote = ctx.get('remote.library')

  /** The session's conversation input, when the composition has one (the reader's structural reach). */
  const inputFor = (sessionId: SessionId): ConversationInput | undefined => {
    try {
      const scope = ctx.get('sessions')?.scope(sessionId)
      const input = (scope?.get('conversation') as { input?: { for(actx: unknown): unknown } } | undefined)
        ?.input?.for(scope)
      const face = input as Partial<ConversationInput> | undefined
      return typeof face?.setDraft === 'function' && typeof face.state?.getSnapshot === 'function'
        ? face as ConversationInput
        : undefined
    } catch {
      return undefined
    }
  }

  /** The injected business face, identical for whichever session mounts it. */
  const face = (sessionId: SessionId): LibraryPaneInjected => ({
    listProjects: () => remote.listProjects(),
    getProject: id => remote.getProject({ id }),
    createProject: request => remote.createProject(request),
    updateProject: (projectId, patch) => remote.updateProject({ id: projectId, patch }),
    getRoadmap: (projectId, bookId) => remote.getRoadmap({ projectId, bookId }),
    adoptRoadmap: (projectId, bookId) => remote.adoptRoadmap({ projectId, bookId }),
    discardDraft: (projectId, bookId) => remote.discardDraft({ projectId, bookId }),
    markNodeRead: (projectId, bookId, nodeId) => remote.markNodeRead({ projectId, bookId, nodeId }),
    listPages: (projectId, bookId, nodeId) => remote.listPages(nodeId === undefined ? { projectId, bookId } : { projectId, bookId, nodeId }),
    readPagePhoto: (projectId, pageId) => remote.readPagePhoto({ projectId, pageId }),
    listCards: query => remote.listCards(query),
    dueCards: projectId => remote.dueCards(projectId === undefined ? {} : { projectId }),
    editCard: (projectId, cardId, patch) => remote.editCard({ projectId, cardId, patch }),
    undoCards: (projectId, ids, at) => remote.undoCards({ projectId, ids, at }),
    reviewCard: (projectId, cardId, rating) => remote.reviewCard({ projectId, cardId, rating }),
    listQuizzes: (projectId, bookId, nodeId) => remote.listQuizzes(nodeId === undefined ? { projectId, bookId } : { projectId, bookId, nodeId }),
    getQuiz: (projectId, quizId) => remote.getQuiz({ projectId, quizId }),
    putAttempt: (projectId, quizId, verdicts) => remote.putAttempt({ projectId, quizId, verdicts }),
    recentRecords: () => remote.recentRecords({ limit: 3 }),
    boundTarget: () => remote.boundTarget(sessionId),
    bindTarget: binding => remote.bindTarget(sessionId, { binding }),
    sendMessage: text => {
      const input = inputFor(sessionId)
      if (input?.submit === undefined) return false
      input.setDraft(text)
      input.submit('queue')
      return true
    },
    sendPhoto: (file, text) => {
      const input = inputFor(sessionId)
      const conversation = ctx.get('sessions')?.scope(sessionId)?.get('conversation') as ConversationDrafts | undefined
      if (input?.submit === undefined || input.addAttachments === undefined || conversation?.createDrafts === undefined) return false
      try {
        const drafts = conversation.createDrafts(sessionId, [file])
        input.setDraft(text)
        if (!input.addAttachments(drafts.map(draft => draft.id))) {
          conversation.releaseDraftAttachments?.(drafts)
          return false
        }
        input.submit('queue')
        return true
      } catch {
        return false
      }
    },
    primeConversation: text => {
      const input = inputFor(sessionId)
      if (input === undefined) return false
      const current = input.state.getSnapshot().draft
      input.setDraft(current.trim() === '' ? text : `${current}\n\n${text}`)
      return true
    },
  })

  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The type registers exactly while the current
  // session can reach the library tools — a root-mounted tool row (the
  // community default) OR the session's preset composition naming it (the
  // learning-mode recipe); every unreadable path fails open. Hidden means NOT
  // registered: the guide enumerates the registry, opened tabs are stored per
  // session, and an unregistered kind renders the host's tab.unavailable
  // fallback.
  const pluginInventory = ctx.get('remote.pluginInventory') as {
    list: () => Promise<RemoteResult<LibraryPluginInventorySnapshot>>
  } | undefined
  const tabVisibility = new LibraryTabVisibility(ctx, pluginInventory)
  ctx.effect(() => {
    const toggle = new RegistrationToggle(
      () => ctx.sidebarRightTabs.register(libraryDefinition(t)),
      () => tabVisibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
    )
    toggle.setReady(true)
    const unsubscribe = tabVisibility.subscribe(() => { toggle.sync() })
    return () => { unsubscribe(); toggle.setReady(false) }
  }, 'library: tab type visibility')

  // Stage two: the tab body, under this package's id in the keyed pane seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: LIBRARY_TAB_ID,
    locale: NS,
    store: createLibraryStore,
    inject: face,
  }, LibraryPane)), 'library: sidebar tab body')

  // The session header's library chip: shown only in sessions that hold the
  // library tools (the strict half of the criterion). The header seat is
  // declared by ui-conversation, which this package does not depend on —
  // without it the inject never fires.
  const headerSlots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  const bindFace = (sessionId: SessionId): LibraryBindInjected => ({
    offered: () => tabVisibility.grants(sessionId),
    subscribe: listener => tabVisibility.subscribe(listener),
    boundTarget: () => remote.boundTarget(sessionId),
    bindTarget: binding => remote.bindTarget(sessionId, { binding }),
    listProjects: () => remote.listProjects(),
  })
  ctx.effect(() => headerSlots.inject('conversation.session.header.actions', () => headerSlots.register({
    name: 'conversation.session.header.actions',
    id: 'library-bind',
    // After room's invite (30) and canvas's work chip (40).
    order: 50,
    locale: NS,
    inject: bindFace,
  }, LibraryBindChip)), 'library: session binding chip')

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
