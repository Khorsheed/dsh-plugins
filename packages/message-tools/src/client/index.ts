/**
 * message-tools client plugin, browser half. Shadows the official
 * user-message renderer (`conversation.chat.node`, key 'user', priority -1)
 * with a visual clone that adds edit/withdraw actions and a real
 * model-switch chip in the editor (over ui-model-selection's shared
 * per-session directory, read optionally through `ctx.get`), registers the
 * withdrawal divider Definition so a landed withdrawal leaves a marker row,
 * and installs the DOM hider that drops every chat row inside a withdrawn
 * span (all node kinds, with probe-based degradation). The messageTools
 * Remote is mounted here through the official `ctx.remote.$mount` channel, so
 * the plugin distributes as an independent package with no edits to core
 * packages. Composing this plugin out of cordis.yml removes every surface it
 * adds.
 * @module @khorsheed/dsh-client-message-tools/client
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API merge for the messageTools namespace.
import type {} from '@khorsheed/dsh-client-message-tools/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.chat.node')
// and the conversation service merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.modelDirectories service merge.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import messageToolsRemote from '@khorsheed/dsh-client-message-tools/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { installDomHider } from './dom-hider.ts'
import { mergedDraft } from './backfill.ts'
import { editInPlace } from './edit-in-place.ts'
import { en, zh } from './locales.ts'
import {
  editedMessageDefinition, restoredAssistantMessageDefinition, restoredMessageDefinition, withdrawnDividerDefinition,
} from './withdrawn-node.ts'
import { UserMessageView } from './UserMessageView.tsx'
import { RestoredMessageView } from './RestoredMessageView.tsx'
import { WithdrawnDividerView } from './WithdrawnDividerView.tsx'
import type { MessageToolsInjected, WithdrawnDividerInjected } from './slots.ts'

/** The messageTools Remote namespace, as mounted by this plugin. */
export type MessageToolsRemote = TypertRemoteNamespaceMap['messageTools']

/** Dictionary namespace owned by this plugin. */
const NS = 'message-tools'

/** Never-changing directory stub used when ui-model-selection is not composed; the chip is never rendered then. */
const EMPTY_MODEL_DIRECTORY: HostObservable<ModelDirectoryState> = {
  getSnapshot: () => EMPTY_MODEL_DIRECTORY_STATE,
  subscribe: () => () => {},
}
const EMPTY_MODEL_DIRECTORY_STATE: ModelDirectoryState = Object.freeze({
  current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
})

/**
 * Required services: slots, sessions, the remote channel, the scope-addressed
 * conversation service, conversation node registration, and the copy.
 * `remote.messageTools` is deliberately NOT an inject: this plugin both
 * mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber. Declaring it would deadlock the loader; the
 * namespace is read back from the global store with `ctx.get` after the
 * awaited mount.
 */
export const inject = ['slots', 'sessions', 'remote', 'conversation', 'conversationEvents', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries, the
 * withdrawal divider Definition, and the two `conversation.chat.node` entries
 * (the divider row and the shadowed user renderer).
 * @param ctx - client root context.
 * @returns disposer unwinding the mounted Remote namespace.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(messageToolsRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the actions would answer an
    // unmounted namespace with a typed RPC error, surfaced inline).
    ctx.logger.error(error)
  }
  const remote = ctx.get('remote.messageTools') as MessageToolsRemote
  const restore = async (sessionId: Parameters<MessageToolsRemote['restore']>[0]['sessionId'], targetSeq: number): Promise<void> => {
    const carried = await remote.restore({ sessionId, targetSeq })
    if (!carried.ok) throw new Error(`messageTools.restore transport: ${carried.error.code}`)
    if (!carried.value.ok) throw new Error(`messageTools.restore rejected: ${carried.value.error.code}`)
  }
  /**
   * The draft-backfill path of the automatic post-withdrawal backfill:
   * setDraft is the single public draft write path; the notice lands on this
   * session's composer even across a session switch. Never sends.
   */
  const backfill = (sessionId: SessionId, text: string): void => {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`message-tools: session "${sessionId}" resolved no scope`)
    const conversation = actx.get('conversation')
    if (conversation === undefined) throw new Error('message-tools: conversation service unavailable')
    const input = conversation.input.for(actx)
    input.setDraft(mergedDraft(input.state.getSnapshot().draft, text))
    input.notify('info', t('withdrawn.backfilled'))
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'message-tools: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.conversationEvents.register(withdrawnDividerDefinition)
  ctx.conversationEvents.register(restoredMessageDefinition)
  ctx.conversationEvents.register(restoredAssistantMessageDefinition)
  ctx.conversationEvents.register(editedMessageDefinition)
  ctx.effect(() => installDomHider(ctx), 'message-tools: dom hider')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    {
      name: 'conversation.chat.node',
      key: 'message-tools-withdrawn',
      locale: NS,
      inject: (sessionId): WithdrawnDividerInjected => ({
        restoreMessage: targetSeq => restore(sessionId, targetSeq),
      }),
    },
    WithdrawnDividerView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'message-tools-restored-assistant', locale: NS },
    RestoredMessageView,
  ))

  // The slot is declared by ui-conversation, whose apply order relative to
  // this plugin is unconstrained: register through slots.inject so the shadow
  // waits for the declaration instead of crashing the loader entry at boot.
  // 'user' and 'steering' share the official renderer upstream, so both keys
  // get the same shadow here (an admitted steering message is an append
  // surface user/message; edit/withdraw work identically).
  const entryInject = (sessionId: SessionId): MessageToolsInjected => {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`message-tools: session "${sessionId}" resolved no scope`)
    const conversation = actx.get('conversation')
    if (conversation === undefined) throw new Error('message-tools: conversation service unavailable')
    // The model chip rides ui-model-selection's shared per-session
    // directory — an optional service (ctx.get, never an inject edge, so a
    // composition without it degrades to no chip instead of a loader wait).
    const models = ctx.get('modelDirectories')
    const directory = models === undefined || ctx.sessions.subagentAddress(sessionId) !== undefined
      ? undefined
      : models.directoryFor(sessionId)
    const withdraw = async (targetSeq: number): Promise<void> => {
      const carried = await remote.withdraw({ sessionId, targetSeq })
      if (!carried.ok) throw new Error(`messageTools.withdraw transport: ${carried.error.code}`)
      if (!carried.value.ok) throw new Error(`messageTools.withdraw rejected: ${carried.value.error.code}`)
    }
    const edit = async (targetSeq: number, text: string): Promise<void> => {
      const carried = await remote.edit({ sessionId, targetSeq, text })
      if (!carried.ok) throw new Error(`messageTools.edit transport: ${carried.error.code}`)
      if (!carried.value.ok) throw new Error(`messageTools.edit rejected: ${carried.value.error.code}`)
    }
    // After a cancel, the turn's teardown writes land within moments; wait
    // (bounded) so the edit replacement's span covers them instead of racing
    // them onto the surface.
    const waitIdle = async (): Promise<void> => {
      const deadline = Date.now() + 5_000
      for (;;) {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined || !session.getSnapshot().running) return
        if (Date.now() >= deadline) return
        await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
      }
    }
    return {
      editMessage: (targetSeq, text) => editInPlace({
        cancel: () => conversation.cancel(),
        waitIdle,
        edit: () => edit(targetSeq, text),
      }, ctx.sessions.binding(sessionId)?.session.getSnapshot().running === true),
      withdrawMessage: withdraw,
      backfillDraft: (text) => { backfill(sessionId, text) },
      modelsAvailable: directory !== undefined,
      loadModels: () => {
        // Load failures surface on the directory store itself.
        directory?.load().catch(() => undefined)
      },
      selectModel: selection => directory === undefined
        ? Promise.resolve(false)
        : directory.select(selection).then(() => true, () => false),
      hooks: {
        modelDirectory: directory === undefined ? EMPTY_MODEL_DIRECTORY : directory.store,
      },
    }
  }
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    priority: -1,
    locale: NS,
    inject: entryInject,
  }, UserMessageView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'steering',
    priority: -1,
    locale: NS,
    inject: entryInject,
  }, UserMessageView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'message-tools-edited',
    locale: NS,
    inject: entryInject,
  }, UserMessageView))
  // Restored user-message replays get the same full renderer (bubble plus the
  // copy/edit/withdraw action row): a restored row edits and withdraws like
  // the message it replays.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'message-tools-restored',
    locale: NS,
    inject: entryInject,
  }, UserMessageView))

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
