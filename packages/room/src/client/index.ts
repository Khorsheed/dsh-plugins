/**
 * room client plugin, browser half. Mounts the room Remote through the
 * official `ctx.remote.$mount` channel and registers the three Step 0 spike
 * slot entries: the sidebar footer「+ New room」action, a never-claiming
 * `conversation.composer` chain entry (registration-shape spike; the real
 * @-mention takeover is Step 5), and the placeholder 成员
 * `conversation.view` tab. Composing this plugin out of cordis.yml removes
 * every surface it adds.
 * @module @khorsheed/dsh-room/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
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
import type { NewRoomInjected } from './slots.ts'

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
export const inject = ['slots', 'sessions', 'remote', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries, and
 * inject the three slot entries.
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
  const remote = ctx.get('remote.room') as RoomRemote

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'room: dictionaries')
  const t = ctx.locale.bind(NS)

  const createRoom = async (): Promise<void> => {
    const carried = await remote.createRoom({})
    if (!carried.ok) throw new Error(`room.createRoom transport: ${carried.error.code}`)
    ctx.sessions.open(carried.value.sessionId)
  }

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
  // Step 0: registration-shape spike only — select never claims the composer.
  // TODO(step-5): parse @-mentions and take over dispatch here.
  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    { name: 'conversation.composer', select: () => null, locale: NS },
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

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
