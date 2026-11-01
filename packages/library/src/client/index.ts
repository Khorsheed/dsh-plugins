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
import type { LibraryNavParams } from '../nav-line.ts'
import { LIBRARY_KIND, LIBRARY_TAB_ID, libraryDefinition } from './definition.tsx'
import { LibraryPane } from './LibraryPane.tsx'
import { LibraryBindChip, type LibraryBindInjected } from './bind/BindChip.tsx'
import { createLibraryStore } from './store.ts'
import { followerHostOf, registerDestinationCards, releaseInteraction, startNavFollower, updateCards } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
import { RECORD_KIND } from '../nav-line.ts'
import { en, NS, zh } from './locales.ts'
import { DESK_OWNER, DESK_ROW_KIND, deskDestinationsOf, deskRowDefinition, setDeskRowSeated } from './desk/desk-row.ts'
import { DeskOpenRow, type DeskOpenRowFace } from './desk/DeskOpenRow.tsx'
import { DeskAttachment } from './desk/DeskAttachment.tsx'
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

  /**
   * Open the library tab at one address (proposal
   * 2026-10-30-agent-sidebar-navigation): the tab kind with its navigation
   * params, which the pane applies once per revision. Every way in from
   * outside — a destination, a room's desk row — lands here.
   */
  const go = (params: LibraryNavParams): void => {
    try {
      (ctx.get('sidebarRight') as { openTab?: (kind: string, options?: { params?: unknown }) => void } | undefined)
        ?.openTab?.(LIBRARY_KIND, { params })
    } catch (error) {
      // No on-screen sidebar surface, or the tab is not offered here.
      ctx.logger.warn('library: openTab failed (tab type not registered?)', error)
    }
  }

  // The follower: a library tool's answer names where it wrote; watched
  // live, the tab goes there, otherwise the conversation's card waits.
  const followerHost = followerHostOf(name => (ctx.get.bind(ctx) as (key: string) => unknown)(name))
  if (followerHost !== undefined) {
    ctx.effect(() => startNavFollower(followerHost, {
      kinds: [LIBRARY_KIND],
      open: destination => { go(destination.params as unknown as LibraryNavParams) },
      events: event => deskDestinationsOf(LIBRARY_KIND, event),
    }), 'library: destination follower')
    // A noted weak point (library_cards) names the cards list but never moves
    // the sidebar — the learner is mid-reading; its write signal is what the
    // pane's 「已记下 · 撤销」 toast listens to.
    ctx.effect(() => startNavFollower(followerHost, {
      kinds: [RECORD_KIND],
      cardsOnly: true,
      open: () => {},
    }), 'library: record follower')
  }

  /** A Remote answer that landed (the outer call and, where present, the domain outcome). */
  const settled = (result: unknown): boolean => {
    const outer = result as { ok?: boolean; value?: { ok?: boolean } } | undefined
    return outer?.ok === true && outer.value?.ok !== false
  }

  /** The injected business face, identical for whichever session mounts it. */
  const face = (sessionId: SessionId): LibraryPaneInjected => ({
    listProjects: () => remote.listProjects(),
    getProject: id => remote.getProject({ id }),
    createProject: request => remote.createProject(request),
    updateProject: (projectId, patch) => remote.updateProject({ id: projectId, patch }),
    deleteProject: projectId => remote.deleteProject({ id: projectId }),
    removeResource: (projectId, resourceId) => remote.removeResource({ projectId, resourceId }),
    moveResource: (projectId, resourceId, seq) => remote.moveResource({ projectId, resourceId, seq }),
    setBookKind: (projectId, resourceId, bookKind) => remote.setBookKind({ projectId, resourceId, bookKind }),
    getRoadmap: (projectId, resourceId) => remote.getRoadmap({ projectId, resourceId }),
    // The roadmap card in the conversation hears it was adopted (shown while live).
    adoptRoadmap: async (projectId, resourceId) => {
      const result = await remote.adoptRoadmap({ projectId, resourceId })
      if (settled(result)) updateCards(LIBRARY_KIND, { view: 'book', projectId, resourceId, draft: true }, { status: t('card.adopted'), awaiting: false, door: t('card.open') })
      return result
    },
    discardDraft: (projectId, resourceId) => remote.discardDraft({ projectId, resourceId }),
    markNodeRead: (projectId, resourceId, nodeId) => remote.markNodeRead(resourceId === undefined ? { projectId, nodeId } : { projectId, resourceId, nodeId }),
    listPages: (projectId, resourceId, nodeId) => remote.listPages(nodeId === undefined ? { projectId, resourceId } : { projectId, resourceId, nodeId }),
    readPagePhoto: (projectId, pageId) => remote.readPagePhoto({ projectId, pageId }),
    listResources: projectId => remote.listResources({ projectId }),
    listAttempts: (projectId, nodeId, assessmentId) => remote.listAttempts({ projectId, ...(nodeId === undefined ? {} : { nodeId }), ...(assessmentId === undefined ? {} : { assessmentId }) }),
    listCards: query => remote.listCards(query),
    dueCards: projectId => remote.dueCards(projectId === undefined ? {} : { projectId }),
    editCard: (projectId, cardId, patch) => remote.editCard({ projectId, cardId, patch }),
    undoCards: (projectId, ids, at) => remote.undoCards({ projectId, ids, at }),
    reviewCard: (projectId, cardId, rating) => remote.reviewCard({ projectId, cardId, rating }),
    listAssessments: (projectId, resourceId, nodeId, type) => remote.listAssessments({ projectId, ...(resourceId === undefined ? {} : { resourceId }), ...(nodeId === undefined ? {} : { nodeId }), ...(type === undefined ? {} : { type }) }),
    getAssessment: (projectId, assessmentId) => remote.getAssessment({ projectId, assessmentId }),
    // …and the quiz card, that it was handed in.
    putAttempt: async (projectId, assessmentId, verdicts) => {
      const result = await remote.putAttempt({ projectId, assessmentId, verdicts })
      if (settled(result)) updateCards(LIBRARY_KIND, { view: 'quiz', projectId, quizId: assessmentId }, { status: t('card.submitted'), awaiting: false, door: t('card.open') })
      return result
    },
    recentRecords: () => remote.recentRecords({ limit: 3 }),
    recentChanges: () => remote.recentChanges({ limit: 5 }),
    createRetake: (projectId, resourceId, nodeId, keys) => remote.createRetake({ projectId, ...(resourceId === undefined ? {} : { resourceId }), ...(nodeId === undefined ? {} : { nodeId }), ...(keys === undefined ? {} : { keys }) }),
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
        // Handed to the coach: the page it records may follow at once.
        releaseInteraction()
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
      // A panel button handed the work to the coach: what it writes (讲义, a
      // quiz) is not held back as 「the learner is working in the panel」.
      releaseInteraction()
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
  // Structural slot reach: the header, chat-node and room card seats are
  // declared by packages this one does not depend on.
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
  // The conversation cards (proposal 2026-10-30-agent-sidebar-navigation):
  // the one shell under each write tool and in the Turn tail; the door opens
  // the answer's destination. Library cards are the compact line.
  registerDestinationCards(
    (body, label) => { ctx.effect(body, label) },
    headerSlots,
    () => (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as { events?: { register?: (definition: unknown) => () => void } } | undefined,
    {
      owner: '@khorsheed/dsh-library',
      tools: ['library_project', 'library_textbook', 'library_roadmap', 'library_notes', 'library_quiz', 'library_page', 'library_cards'],
      locale: NS,
      face: () => ({
        copy: () => ({ kind: t('card.kind'), running: t('card.running'), failed: t('card.failed'), open: t('card.open') }),
        go: () => destination => { go(destination.params as unknown as LibraryNavParams) },
      }),
    },
  )
  ctx.effect(() => headerSlots.inject('conversation.session.header.actions', () => headerSlots.register({
    name: 'conversation.session.header.actions',
    id: 'library-bind',
    // After room's invite (30) and canvas's work chip (40).
    order: 50,
    locale: NS,
    inject: bindFace,
  }, LibraryBindChip)), 'library: session binding chip')

  // In a room, a member's bind writes room's `room/desk-opened` (owner: this
  // package) into the ROOM (../desk.ts): its row tells the room who opened
  // which book, and the coordinator's opens the library on it (desk/desk-row.ts).
  // ui-chat declares the node seat and composes ui-conversation, so
  // `uiConversation` is read only once the seat exists; without them the room
  // just has no row.
  const deskFace: DeskOpenRowFace = {
    openBook: (projectId, resourceId) => {
      go(resourceId === undefined ? { view: 'project', projectId } : { view: 'book', projectId, resourceId })
    },
  }
  ctx.effect(() => headerSlots.inject('conversation.chat.node', () => {
    const conversation = (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as {
      events?: { register?: (definition: unknown) => () => void }
    } | undefined
    const register = conversation?.events?.register
    if (register === undefined) return () => undefined
    const disposeDefinition = register.call(conversation?.events, deskRowDefinition)
    const disposeEntry = headerSlots.register({
      name: 'conversation.chat.node',
      key: DESK_ROW_KIND,
      locale: NS,
      inject: () => deskFace,
    }, DeskOpenRow)
    return () => {
      disposeEntry()
      disposeDefinition()
    }
  }), 'library: room desk row')
  // The same row at the end of the member's card, where the room seats it
  // (`room.member.attachment` on the reply, `room.run.attachment` on the
  // running card): the row's own node then steps aside for every event that
  // names a run.
  for (const seat of ['room.member.attachment', 'room.run.attachment'] as const) {
    ctx.effect(() => headerSlots.inject(seat, () => {
      const dispose = headerSlots.register({
        name: seat,
        key: DESK_OWNER,
        locale: NS,
        inject: () => deskFace,
      }, DeskAttachment)
      if (seat === 'room.member.attachment') setDeskRowSeated(true)
      return () => {
        if (seat === 'room.member.attachment') setDeskRowSeated(false)
        dispose()
      }
    }), `library: room card desk row (${seat})`)
  }

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
