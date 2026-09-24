/**
 * Shared message-tools markers: the producer-owned source kind stamped on
 * every message-tools event, the `op` discriminator telling edit
 * replacements, edit triggers, and assistant-text restore replays apart from
 * withdrawals and user-message restores, the model-facing placeholder and
 * trigger texts, and the pure predicates both the Host service and the
 * browser projection consume. No new session event type is ever written — an
 * out-of-harness event type cannot carry `ignorable: true` (Session.append
 * assigns the envelope), so a persisted unknown type would make
 * session-persistence refuse the log on reload. The events themselves are the
 * durable audit trail.
 * @module @khorsheed/dsh-client-message-tools/marker
 */
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm/message'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/**
 * The producer-owned source kind identifying every message-tools event. It is
 * also the legacy wrapper's `plugin` value: released V3 logs carry
 * `{ kind: 'plugin', plugin: 'message-tools' }` (a pre-V4 host still serves
 * them verbatim), and the official V3→V4 migration rewrites those to
 * `kind: 'plugin:message-tools'` — {@link isMessageToolsSource} accepts all
 * three durable forms.
 */
export const MESSAGE_TOOLS_PLUGIN = 'message-tools'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** message-tools producer: withdrawal/edit replacements, edit triggers, restore replays. */
    'message-tools': { kind: 'message-tools'; readonly op?: MessageToolsOp } & ContextFormed
  }
}

/**
 * Model-facing placeholder left on the surface in place of the withdrawn
 * span. The span itself is hidden from the model; this minimal user message
 * keeps the surface non-empty and tells the model why the transcript jumps.
 */
export const WITHDRAWN_NOTICE = '(用户撤回了这条消息及其后的所有内容)'

/**
 * Model-facing trigger message that starts the regeneration turn after an
 * edit replacement lands (no wake-without-append path exists in the harness;
 * `agent.followup` is the sanctioned seam). It is NOT the edited text — that
 * appears exactly once, in the replacement event.
 */
export const EDIT_TRIGGER_NOTICE = '(用户编辑了上一条消息，请按编辑后的内容重新回答)'

/**
 * Model-facing frame preceding a replayed assistant text in a restore: the
 * replay lands as a user-role message (assistant/message requires the model
 * source, and the session turn/step trace forbids ad-hoc assistant
 * appends), so the frame keeps the role honest for the model. On hosts whose
 * session fold carries the S12 `user/message` projection the frame never
 * reaches the model — the projection strips it and corrects the role at
 * derivation time; everywhere else it is the role-honesty device.
 */
export const RESTORED_ASSISTANT_NOTICE = '(以下是先前被撤回、现随恢复放回的助手回复)'

/** The `op` discriminator on a message-tools source. */
export type MessageToolsOp = 'edit' | 'edit-trigger' | 'restore-assistant'

/** The producer-owned source of a withdrawal replacement or a user-message restore replay (no op). */
export function messageToolsSource(): MessageSource {
  return Object.freeze({ kind: MESSAGE_TOOLS_PLUGIN })
}

/** The producer-owned source of an edit replacement (op: 'edit'). */
export function editReplacementSource(): MessageSource {
  return Object.freeze({ kind: MESSAGE_TOOLS_PLUGIN, op: 'edit' })
}

/** The producer-owned source of an edit trigger message (op: 'edit-trigger'). */
export function editTriggerSource(): MessageSource {
  return Object.freeze({ kind: MESSAGE_TOOLS_PLUGIN, op: 'edit-trigger' })
}

/** The producer-owned source of a restored assistant-text replay (op: 'restore-assistant'). */
export function restoreAssistantSource(): MessageSource {
  return Object.freeze({ kind: MESSAGE_TOOLS_PLUGIN, op: 'restore-assistant' })
}

/** Read the op discriminator off a message source (absent on plain withdrawal/restore events). */
export function messageToolsOp(source: unknown): MessageToolsOp | undefined {
  const op = (source as { op?: unknown } | undefined)?.op
  return op === 'edit' || op === 'edit-trigger' || op === 'restore-assistant' ? op : undefined
}

/**
 * Whether a durable source belongs to message-tools, in every form the log
 * can hold: the current producer-owned kind (`message-tools`), the V3→V4
 * migrated kind (`plugin:message-tools` — released V3 files rewritten once by
 * the official migration), and the released V3 wrapper a pre-V4 host still
 * serves verbatim (`{ kind: 'plugin', plugin: 'message-tools' }`).
 * @param source - the persisted message source to test.
 * @returns true when the source names this producer.
 */
export function isMessageToolsSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const record = source as { kind?: unknown; plugin?: unknown }
  return record.kind === MESSAGE_TOOLS_PLUGIN
    || record.kind === `plugin:${MESSAGE_TOOLS_PLUGIN}`
    || (record.kind === 'plugin' && record.plugin === MESSAGE_TOOLS_PLUGIN)
}

/**
 * Strip the model-facing restore frame from a replayed assistant text for
 * DISPLAY: the frame belongs to the model context (role honesty), never to
 * the transcript row. Texts without the frame pass through unchanged.
 * @param text - the replayed content's joined text.
 * @returns the display text without the frame prefix.
 */
export function stripRestoreAssistantFrame(text: string): string {
  const prefix = `${RESTORED_ASSISTANT_NOTICE}\n`
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

/** One message-tools withdrawal replacement event, narrowed. */
export type MessageToolsReplacementEvent = SessionEvent<'user/message'> & {
  readonly surfaceOp: { readonly op: 'replace'; readonly startSeq: number; readonly endSeq: number }
}

/** One message-tools edit replacement event, narrowed (same shape, `op: 'edit'` source). */
export type MessageToolsEditEvent = MessageToolsReplacementEvent

/** One message-tools append-side event (restore or edit trigger), narrowed. */
export type MessageToolsRestoreEvent = SessionEvent<'user/message'> & {
  readonly surfaceOp: 'append'
}

/**
 * Whether the event is a message-tools WITHDRAWAL replacement: a
 * `user/message` surface replacement whose source names this producer
 * (any durable form — see {@link isMessageToolsSource}) with no `op`
 * discriminator.
 * @param event - the session event to test.
 * @returns the event narrowed to a withdrawal replacement when matched.
 */
export function isMessageToolsReplacement(event: SessionEvent): event is MessageToolsReplacementEvent {
  return event.type === 'user/message'
    && isReplacementSurfaceEvent(event)
    && isMessageToolsSource(event.data.source)
    && messageToolsOp(event.data.source) === undefined
}

/**
 * Whether the event is a message-tools EDIT replacement: a `user/message`
 * surface replacement whose content IS the edited text (`op: 'edit'`).
 * @param event - the session event to test.
 * @returns the event narrowed to an edit replacement when matched.
 */
export function isMessageToolsEdit(event: SessionEvent): event is MessageToolsEditEvent {
  return event.type === 'user/message'
    && isReplacementSurfaceEvent(event)
    && isMessageToolsSource(event.data.source)
    && messageToolsOp(event.data.source) === 'edit'
}

/**
 * Whether the event is a message-tools restore: an append-surface
 * `user/message` replaying a withdrawn message at the conversation tail.
 * @param event - the session event to test.
 * @returns the event narrowed to a message-tools restore when matched.
 */
export function isMessageToolsRestore(event: SessionEvent): event is MessageToolsRestoreEvent {
  return event.type === 'user/message'
    && event.surfaceOp === 'append'
    && isMessageToolsSource(event.data.source)
    && messageToolsOp(event.data.source) === undefined
}

/**
 * Whether the event is a message-tools edit trigger: the minimal
 * producer-sourced message that starts the regeneration turn after an edit.
 * @param event - the session event to test.
 * @returns the event narrowed to an edit trigger when matched.
 */
export function isMessageToolsTrigger(event: SessionEvent): event is MessageToolsRestoreEvent {
  return event.type === 'user/message'
    && event.surfaceOp === 'append'
    && isMessageToolsSource(event.data.source)
    && messageToolsOp(event.data.source) === 'edit-trigger'
}

/**
 * Whether the event is a message-tools ASSISTANT-text restore replay: an
 * append-surface `user/message` carrying a withdrawn assistant reply's text
 * (framed, user-role — see {@link RESTORED_ASSISTANT_NOTICE}).
 * @param event - the session event to test.
 * @returns the event narrowed to a restore-assistant replay when matched.
 */
export function isMessageToolsRestoreAssistant(event: SessionEvent): event is MessageToolsRestoreEvent {
  return event.type === 'user/message'
    && event.surfaceOp === 'append'
    && isMessageToolsSource(event.data.source)
    && messageToolsOp(event.data.source) === 'restore-assistant'
}
