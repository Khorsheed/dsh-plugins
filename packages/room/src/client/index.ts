/**
 * room client plugin, browser half. Mounts the room Remote through the
 * official `ctx.remote.$mount` channel, feeds the client-side RoomStore, and
 * registers the slot entries: the session-header「邀请 agent」action (every
 * session — inviting promotes it into a room), the `conversation.composer`
 * chain takeover (claims the composer exactly when the current session is a
 * cached room — and renders the dock capsules plus the session stats row
 * itself, because both of their official homes ride the fallback tree the
 * takeover hides), and the 成员 `conversation.view` tab. Composing this
 * plugin out of cordis.yml removes every surface it adds.
 * @module @khorsheed/dsh-room/client
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API merge for the room namespace.
import type {} from '@khorsheed/dsh-room/remote'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.composer',
// 'conversation.view', 'conversation.session.header.actions').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import roomRemote from '@khorsheed/dsh-room/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { en, zh } from './locales.ts'
import { InviteAgentAction } from './InviteAgentAction.tsx'
import { MembersView } from './MembersView.tsx'
import { RoomComposer, selectRoomComposer } from './RoomComposer.tsx'
import { RoomSpeechView } from './RoomSpeechView.tsx'
import { RoomRunView } from './RoomRunView.tsx'
import { RoomEventView } from './RoomEventView.tsx'
import { roomEventDefinition, roomRelayDefinition, roomRunDefinition, roomSpeechDefinition, roomTaskLineDefinition } from './nodes.ts'
import { RoomStore } from './room-store.ts'
import { RoomRelayView } from './RoomRelayView.tsx'
import { RoomTaskLineView } from './RoomTaskLineView.tsx'
import type {
  InviteAgentInjected, RoomComposerInjected, RoomComposerMatch, RoomInviteInjected, RoomMembersInjected, RoomMutationOutcome,
  RoomRelayInjected, RoomRunInjected, RoomSpeechInjected, RoomTaskLineInjected, RoomTasksInjected,
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

  const submit = async (sessionId: SessionId, text: string, targets?: readonly string[]): Promise<RoomMutationOutcome> => {
    if (remote === undefined) return { ok: false, message: t('composer.error.generic') }
    const carried = await remote.postMessage({
      sessionId, text, ...targets === undefined || targets.length === 0 ? {} : { targets },
    })
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
    addTask: async (member, title, blockedBy) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.addTask({
        sessionId, member, title, ...blockedBy === undefined ? {} : { blockedBy },
      })
      if (!carried.ok || !carried.value.ok) return { ok: false, message: t('invite.error.generic') }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    closeTask: async (taskId, status) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.closeTask({
        sessionId, taskId, ...status === undefined ? {} : { status },
      })
      if (!carried.ok || !carried.value.ok) return { ok: false, message: t('invite.error.generic') }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    setGoal: async (text) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.setGoal({ sessionId, text })
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
      case 'unknown-provider':
        return t('invite.error.unknownProvider', {
          provider: error.provider,
          available: error.available.join(', ') || '—',
        })
      default: return t('invite.error.generic')
    }
  }
  /**
   * The invite dialog's share (sessionId binds per entry inject), consumed by
   * both dialog hosts — the members tab and the fresh-room dock's invite
   * capsule. `browseDirectory` is the official wire primitive the native
   * directory-picker flow drives (`workspaces.pickDirectory`): the picker UI
   * itself is bound to ui-workspace's adopt-as-workspace flow holes and cannot
   * serve a pure path pick, so the dialog consumes the primitive directly.
   */
  const inviteFace = (sessionId: SessionId): RoomInviteInjected => ({
    // The room session's own cwd: the invite dialog's cwd field placeholder
    // (empty = inherit). Read at inject time; a later cwd change refreshes
    // with the next view mount.
    roomCwd: ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
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
    browseDirectory: () => ctx.workspaces.pickDirectory(),
  })
  const membersFace = (sessionId: SessionId): RoomMembersInjected => ({
    roomStore,
    ...inviteFace(sessionId),
    openSession,
    removeMember: async (member) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.removeMember({ sessionId, name: member })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
    updateMember: async (member, patch) => {
      if (remote === undefined) return { ok: false, message: t('invite.error.generic') }
      const carried = await remote.updateMember({
        sessionId,
        name: member,
        ...patch.rename === undefined ? {} : { rename: patch.rename },
        ...patch.instructions === undefined ? {} : { instructions: patch.instructions },
        ...patch.cwd === undefined ? {} : { cwd: patch.cwd },
      })
      if (!carried.ok) return { ok: false, message: t('invite.error.generic') }
      if (!carried.value.ok) return { ok: false, message: failureText(carried.value.error) }
      void roomStore.refresh(sessionId)
      return { ok: true }
    },
  })

  // The journal projections: claim the room/* events into chat nodes.
  ctx.conversationEvents.register(roomSpeechDefinition)
  ctx.conversationEvents.register(roomRunDefinition)
  ctx.conversationEvents.register(roomEventDefinition)
  ctx.conversationEvents.register(roomRelayDefinition)
  ctx.conversationEvents.register(roomTaskLineDefinition)

  // The slots are declared by ui-conversation, whose apply order
  // relative to this plugin is unconstrained: register through slots.inject so
  // each entry waits for the declaration instead of crashing the loader entry
  // at boot.
  // The 邀请 agent entry: every session's header carries it (inviting a plain
  // session promotes it into a room host-side). Ordered after the lineage and
  // jobs entries.
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'room-invite-agent',
      order: 30,
      locale: NS,
      inject: (sessionId: SessionId): InviteAgentInjected => inviteFace(sessionId),
    },
    InviteAgentAction,
  ))
  // The composer takeover: claim exactly the cached-room sessions, at the
  // ui-subagent precedence (-10). Pending interactions (the approval panel's
  // priority-1 entry) are yielded by the selector itself — election runs
  // ascending, so without the decline this entry would shadow them (the
  // member-channel rule, local-agent 84a2ed0). A cache miss declines — the
  // freshly opened room shows the official bar for the first pull's duration
  // (accepted, see room-store.ts). The injected face carries the capsule
  // actions, the invite share (the fresh-room dock's invite capsule), AND the
  // main-agent turn Stop: the takeover renders the dock
  // surfaces and the Stop button itself, because their seats hide with the
  // official fallback.
  const composerEntry = {
    name: 'conversation.composer',
    priority: -10,
    locale: NS,
    select: (owner: Parameters<typeof selectRoomComposer>[0]): RoomComposerMatch | null =>
      selectRoomComposer(owner, id => roomStore.isRoomCached(id) === true),
    inject: (sessionId: SessionId): RoomComposerInjected => ({
      ...tasksFace(sessionId),
      ...inviteFace(sessionId),
      submit,
      // The hidden official bar's Stop: the runtime session face's cancel
      // (the same verb ui-conversation's own Stop injects). A torn-down
      // binding degrades to a no-op.
      stop: () => {
        void ctx.sessions.binding(sessionId)?.session.cancel().catch(() => {
          // Stop failure surfaces via snapshot.promptError; nothing to restore.
        })
      },
    }),
  } as const
  let composerDispose: (() => void) | undefined
  ctx.slots.inject('conversation.composer', () => {
    composerDispose = ctx.slots.register(composerEntry, RoomComposer)
    return () => {
      composerDispose?.()
      composerDispose = undefined
    }
  })
  // An in-place promotion of an idle session produces no session frames after
  // the store's flip, and the chain elects at render time — re-registering
  // the entry bumps the slot version, re-rendering and re-electing the
  // outlet.
  roomStore.onPromoted = () => {
    if (composerDispose === undefined) return
    composerDispose()
    composerDispose = ctx.slots.register(composerEntry, RoomComposer)
  }
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
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'room-task-line',
      locale: NS,
      inject: (): RoomTaskLineInjected => ({ roomStore }),
    },
    RoomTaskLineView,
  ))
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
