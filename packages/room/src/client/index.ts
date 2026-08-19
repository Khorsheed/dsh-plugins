/**
 * room client plugin, browser half. Mounts the room Remote through the
 * official `ctx.remote.$mount` channel, feeds the client-side RoomStore, and
 * registers the slot entries: the sidebar footer「+ New room」action, the
 * `conversation.composer` chain takeover (claims the composer exactly when
 * the current session is a cached room), and the 成员 `conversation.view`
 * tab. Composing this plugin out of cordis.yml removes every surface it adds.
 * @module @khorsheed/dsh-room/client
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API merge for the room namespace.
import type {} from '@khorsheed/dsh-room/remote'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.composer', 'conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import roomRemote from '@khorsheed/dsh-room/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { en, zh } from './locales.ts'
import { NewRoomAction } from './NewRoomAction.tsx'
import { MembersView } from './MembersView.tsx'
import { RoomComposer } from './RoomComposer.tsx'
import { RoomSpeechView } from './RoomSpeechView.tsx'
import { RoomRunView } from './RoomRunView.tsx'
import { RoomEventView } from './RoomEventView.tsx'
import { roomEventDefinition, roomRelayDefinition, roomRunDefinition, roomSpeechDefinition } from './nodes.ts'
import { RoomStore } from './room-store.ts'
import { RoomRelayView } from './RoomRelayView.tsx'
import { RoomTaskDock } from './RoomTaskDock.tsx'
import type {
  NewRoomInjected, RoomComposerInjected, RoomComposerMatch, RoomMembersInjected, RoomMutationOutcome,
  RoomRelayInjected, RoomRunInjected, RoomSpeechInjected, RoomTasksInjected,
} from './slots.ts'
import type { RoomFailure } from '../types.ts'

/** The room Remote namespace, as mounted by this plugin. */
export type RoomRemote = TypertRemoteNamespaceMap['room']

/** Dictionary namespace owned by this plugin. */
const NS = 'room'

/**
 * Required services: slots, sessions, workspaces, the remote channel, and the
 * locale service. `remote.room` is deliberately NOT an inject: this plugin both
 * mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber — declaring it would deadlock the loader.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'conversationEvents', 'locale']

/**
 * The cwd a new room inherits, mirroring the official startSession's
 * workspace choice: the current session's own cwd, then the workspace
 * holding the current session, then the recent-workspace projection. CLI
 * members run their process in the parent (room) session's cwd, so a room
 * without one cannot host them — undefined refuses creation instead.
 */
export function inheritCwd(ctx: ClientContext): string | undefined {
  const sessions = ctx.sessions.list.getSnapshot()
  const current = sessions.current
  if (current !== undefined) {
    const entry = sessions.byId[current]
    if (entry?.cwd !== undefined && entry.cwd !== '') return entry.cwd
  }
  const workspaces = ctx.workspaces.list.getSnapshot()
  const holding = current === undefined
    ? undefined
    : workspaces.items.find(item => item.sessionIds.includes(current))
  const target = holding
    ?? workspaces.items.find(item => item.workspaceId === workspaces.recentWorkspaceId)
  return target?.path
}

/**
 * Client plugin body: mount the Remote, start the store, register the
 * dictionaries, and inject the slot entries.
 * @param ctx - client root context.
 * @returns disposer unwinding the mounted Remote namespace.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(roomRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the action would answer an
    // unmounted namespace with a typed RPC error).
    ctx.logger.error(error)
  }
  const remote = ctx.get('remote.room') as RoomRemote | undefined

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'room: dictionaries')
  const t = ctx.locale.bind(NS)

  const roomStore = new RoomStore(ctx, remote)
  ctx.effect(() => roomStore.start(), 'room: store')

  const createRoom = async (): Promise<RoomMutationOutcome> => {
    if (remote === undefined) return { ok: false, message: t('action.error.generic') }
    const cwd = inheritCwd(ctx)
    // No inheritable cwd: CLI members would fail every dispatch (the provider
    // runs in the parent session's working directory) — refuse with guidance.
    if (cwd === undefined) return { ok: false, message: t('action.error.noWorkspace') }
    const carried = await remote.createRoom({ cwd })
    if (!carried.ok) return { ok: false, message: t('action.error.generic') }
    ctx.sessions.open(carried.value.sessionId)
    // Seed the cache immediately: the freshly opened room must not flash the
    // official composer while the list-driven first pull is in flight.
    void roomStore.refresh(carried.value.sessionId)
    return { ok: true }
  }

  const submit = async (sessionId: SessionId, text: string): Promise<RoomMutationOutcome> => {
    if (remote === undefined) return { ok: false, message: t('composer.error.generic') }
    const carried = await remote.postMessage({ sessionId, text })
    if (!carried.ok) return { ok: false, message: t('composer.error.generic') }
    const result = carried.value
    if (!result.ok) {
      return result.error.code === 'unknown-targets'
        ? { ok: false, message: t('composer.error.unknownTargets', { names: result.error.names.join(' ') }) }
        : { ok: false, message: t('composer.error.generic') }
    }
    void roomStore.refresh(sessionId)
    return { ok: true }
  }

  const openSession = (sessionId: SessionId): void => { ctx.sessions.open(sessionId) }
  const cancelMember = async (sessionId: SessionId, member: string): Promise<void> => {
    if (remote === undefined) return
    const carried = await remote.cancel({ sessionId, name: member })
    if (carried.ok) void roomStore.refresh(sessionId)
  }
  /** The relay gate actions (sessionId binds per entry inject). */
  const relayFace = (sessionId: SessionId): RoomRelayInjected => ({
    roomStore,
    confirmRelay: async (relayId) => {
      if (remote === undefined) return
      const carried = await remote.confirmRelay({ sessionId, relayId })
      if (carried.ok) void roomStore.refresh(sessionId)
    },
    dismissRelay: async (relayId) => {
      if (remote === undefined) return
      const carried = await remote.dismissRelay({ sessionId, relayId })
      if (carried.ok) void roomStore.refresh(sessionId)
    },
  })

  /** The task-board actions (sessionId binds per entry inject). */
  const tasksFace = (sessionId: SessionId): RoomTasksInjected => ({
    roomStore,
    addTask: async (member, title) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.addTask({ sessionId, member, title })
      if (!carried.ok || !carried.value.ok) return { ok: false, message: t('invite.error.generic') }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    closeTask: async (taskId) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.closeTask({ sessionId, taskId })
      if (!carried.ok || !carried.value.ok) return { ok: false, message: t('invite.error.generic') }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
  })

  /** Map a structured RoomFailure to the dialog's localized copy. */
  const failureText = (error: RoomFailure): string => {
    switch (error.code) {
      case 'duplicate-name': return t('invite.error.duplicate')
      case 'invalid-name': return t('invite.error.invalid')
      case 'local-agent-unavailable': return t('invite.error.unavailable')
      default: return t('invite.error.generic')
    }
  }
  const membersFace = (sessionId: SessionId): RoomMembersInjected => ({
    roomStore,
    // The room session's own cwd: the invite dialog's cwd field placeholder
    // (empty = inherit). Read at inject time; a later cwd change refreshes
    // with the next view mount.
    roomCwd: ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
    openSession,
    cancelMember: member => cancelMember(sessionId, member),
    removeMember: async (member) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.removeMember({ sessionId, name: member })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    updateMember: async (member, instructions) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.updateMember({ sessionId, name: member, instructions })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    invite: async (values) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.invite({ sessionId, ...values })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true, pendingFirstTask: carried.value.value.pendingFirstTask }
    },
    listProviders: async () => {
      if (remote === undefined) return undefined
      const carried = await remote.listProviders({})
      return carried.ok ? carried.value : undefined
    },
  })

  // The journal projections: claim the room/* events into chat nodes.
  ctx.conversationEvents.register(roomSpeechDefinition)
  ctx.conversationEvents.register(roomRunDefinition)
  ctx.conversationEvents.register(roomEventDefinition)
  ctx.conversationEvents.register(roomRelayDefinition)

  // The slots are declared by ui-sidebar / ui-conversation, whose apply order
  // relative to this plugin is unconstrained: register through slots.inject so
  // each entry waits for the declaration instead of crashing the loader entry
  // at boot.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    {
      name: 'sidebar.footer.action',
      id: 'room-new',
      locale: NS,
      inject: (): NewRoomInjected => ({ createRoom }),
    },
    NewRoomAction,
  ))
  // The composer takeover: claim exactly the cached-room sessions, at the
  // ui-subagent precedence (-10), below pending-interaction takeovers (the
  // approval panel's priority 1 wins while a question/approval waits). A
  // cache miss declines — the freshly opened room shows the official bar for
  // the first pull's duration (accepted, see room-store.ts).
  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    {
      name: 'conversation.composer',
      priority: -10,
      locale: NS,
      select: (owner): RoomComposerMatch | null => {
        const sessionId = owner.session?.sessionId
        return sessionId !== undefined && roomStore.isRoomCached(sessionId) === true
          ? { room: true }
          : null
      },
      inject: (): RoomComposerInjected => ({ roomStore, submit }),
    },
    RoomComposer,
  ))
  // Registration-time text (the tab label) reads through the bound translate
  // as a thunk, so it follows the active locale without re-registration.
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: 'room-members',
      order: 20,
      locale: NS,
      label: () => t('view.members'),
      inject: (sessionId: SessionId): RoomMembersInjected => membersFace(sessionId),
    },
    MembersView,
  ))
  // The three chat-node renderers, keyed behind the definitions above.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-speech',
      locale: NS,
      inject: (): RoomSpeechInjected => ({ roomStore, openSession }),
    },
    RoomSpeechView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-run',
      locale: NS,
      inject: (sessionId: SessionId): RoomRunInjected => ({
        roomStore,
        openSession,
        cancelMember: member => cancelMember(sessionId, member),
      }),
    },
    RoomRunView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'room-event', locale: NS },
    RoomEventView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-relay',
      locale: NS,
      inject: (sessionId: SessionId): RoomRelayInjected => relayFace(sessionId),
    },
    RoomRelayView,
  ))
  // The task board: a `conversation.input.dock` row above the composer card —
  // the same seat as the official todo strip (which stacks: dock is a list
  // slot, entries render in ascending order, each hiding itself when empty).
  // The board is the human's journal-driven management view; it renders only
  // while the current session is a cached room.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'room-tasks',
      order: 10,
      locale: NS,
      inject: (sessionId: SessionId): RoomTasksInjected => tasksFace(sessionId),
    },
    RoomTaskDock,
  ))

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
