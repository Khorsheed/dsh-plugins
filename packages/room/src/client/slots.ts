/**
 * Slot-facing types of the room client half: the injected action faces and
 * the composed props of its slot entries.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.composer', 'conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'
import type { RoomStore } from './room-store.ts'

/** Injected action face of the sidebar footer action. */
export interface NewRoomInjected {
  /** Create a room session through the Remote and open it. */
  createRoom: () => Promise<void>
}

/** Full props of the 'sidebar.footer.action' entry. */
export type NewRoomActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<NewRoomInjected>
  & PropsLocale<'room'>

/** What a composer submit made of the message. */
export type RoomSubmitOutcome =
  | { readonly ok: true; readonly dispatched: boolean }
  | { readonly ok: false; readonly message: string }

/** Injected face of the composer takeover entry. */
export interface RoomComposerInjected {
  /** The client-side room state store (sync reads + subscription). */
  readonly roomStore: RoomStore
  /** Post a message into the room and refresh the store on success. */
  readonly submit: (sessionId: SessionId, text: string) => Promise<RoomSubmitOutcome>
}

/** The composer takeover match: the session is a cached room. */
export interface RoomComposerMatch {
  readonly room: true
}

/** Full props of the 'conversation.composer' chain entry. */
export type RoomComposerProps =
  PropsRuntime<'conversation.composer'>
  & { matched: RoomComposerMatch }
  & InjectFace<RoomComposerInjected>
  & PropsLocale<'room'>

/** Full props of the 'conversation.view' members-tab entry. */
export type MembersViewProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'room'>

/** Injected face of the member-speech chat node. */
export interface RoomSpeechInjected {
  /** The client-side room state store (provider/kind lookup for the identity row). */
  readonly roomStore: RoomStore
  /** Open a session (the speech's child-session jump). */
  readonly openSession: (sessionId: SessionId) => void
}

/** Full props of the 'room-speech' chat-node renderer. */
export type RoomSpeechViewProps =
  PropsRuntime<'conversation.chat.node', 'room-speech'>
  & InjectFace<RoomSpeechInjected>
  & PropsLocale<'room'>

/** Injected face of the member-run chat node. */
export interface RoomRunInjected {
  /** The client-side room state store (the roster carries the jump target). */
  readonly roomStore: RoomStore
  /** Open a session (the whole-row jump into the member's child session). */
  readonly openSession: (sessionId: SessionId) => void
  /** Cancel the named member's in-flight run through the Remote. */
  readonly cancelMember: (member: string) => Promise<void>
}

/** Full props of the 'room-run' chat-node renderer. */
export type RoomRunViewProps =
  PropsRuntime<'conversation.chat.node', 'room-run'>
  & InjectFace<RoomRunInjected>
  & PropsLocale<'room'>

/** Full props of the 'room-event' chat-node renderer. */
export type RoomEventViewProps =
  PropsRuntime<'conversation.chat.node', 'room-event'>
  & PropsLocale<'room'>
