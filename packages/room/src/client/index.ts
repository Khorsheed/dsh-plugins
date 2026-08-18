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
import { roomEventDefinition, roomRunDefinition, roomSpeechDefinition } from './nodes.ts'
import { RoomStore } from './room-store.ts'
import type {
  NewRoomInjected, RoomComposerInjected, RoomComposerMatch, RoomRunInjected, RoomSpeechInjected,
  RoomSubmitOutcome,
} from './slots.ts'

/** The room Remote namespace, as mounted by this plugin. */
export type RoomRemote = TypertRemoteNamespaceMap['room']

/** Dictionary namespace owned by this plugin. */
const NS = 'room'

/**
 * Required services: slots, sessions, the remote channel, and the locale
 * service. `remote.room` is deliberately NOT an inject: this plugin both
 * mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber — declaring it would deadlock the loader.
 */
export const inject = ['slots', 'sessions', 'remote', 'conversationEvents', 'locale']

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

  const createRoom = async (): Promise<void> => {
    if (remote === undefined) throw new Error('room: remote namespace unavailable')
    const carried = await remote.createRoom({})
    if (!carried.ok) throw new Error(`room.createRoom transport: ${carried.error.code}`)
    ctx.sessions.open(carried.value.sessionId)
    // Seed the cache immediately: the freshly opened room must not flash the
    // official composer while the list-driven first pull is in flight.
    void roomStore.refresh(carried.value.sessionId)
  }

  const submit = async (sessionId: SessionId, text: string): Promise<RoomSubmitOutcome> => {
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
    return { ok: true, dispatched: result.value.parsed.targets.length > 0 }
  }

  const openSession = (sessionId: SessionId): void => { ctx.sessions.open(sessionId) }
  const cancelMember = async (sessionId: SessionId, member: string): Promise<void> => {
    if (remote === undefined) return
    const carried = await remote.cancel({ sessionId, name: member })
    if (carried.ok) void roomStore.refresh(sessionId)
  }

  // The journal projections: claim the room/* events into chat nodes.
  ctx.conversationEvents.register(roomSpeechDefinition)
  ctx.conversationEvents.register(roomRunDefinition)
  ctx.conversationEvents.register(roomEventDefinition)

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

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
