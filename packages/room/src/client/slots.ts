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
import type { RoomProviderList } from '../types.ts'
import type { RoomStore } from './room-store.ts'

/** A mutation outcome with a localized failure message. */
export type RoomMutationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Injected action face of the sidebar footer action. */
export interface NewRoomInjected {
  /**
   * Create a room session through the Remote and open it. The request carries
   * the inherited workspace cwd (CLI members need the parent session's
   * working directory); without one the outcome carries the localized
   * guidance and nothing is created.
   */
  createRoom: () => Promise<RoomMutationOutcome>
}

/** Full props of the 'sidebar.footer.action' entry. */
export type NewRoomActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<NewRoomInjected>
  & PropsLocale<'room'>

/** Injected face of the input-dock task board. */
export interface RoomTasksInjected {
  /** The client-side room state store (tasks ride the replayed state). */
  readonly roomStore: RoomStore
  /** Add a pending task to a member's lane. */
  readonly addTask: (member: string, title: string) => Promise<RoomMutationOutcome>
  /** Close an open task (done). */
  readonly closeTask: (taskId: string) => Promise<RoomMutationOutcome>
}

/**
 * Injected face of the composer takeover entry: the dispatch submit plus the
 * task-board actions (sessionId binds at inject time), because the takeover
 * renders the task board itself — the `conversation.input.dock` seat rides
 * the hidden official fallback.
 */
export interface RoomComposerInjected extends RoomTasksInjected {
  /**
   * Dispatch an @-message into the room and refresh the store on success.
   * Bare messages never reach here — the composer releases them to the
   * official submit path (useInput/inputActions) itself.
   */
  readonly submit: (sessionId: SessionId, text: string) => Promise<RoomMutationOutcome>
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
  & InjectFace<RoomMembersInjected>
  & PropsLocale<'room'>

/** The invite form's values (sessionId binds at inject time). */
export interface RoomInviteValues {
  readonly provider: string
  readonly name: string
  readonly instructions?: string
  /** Member-level working directory (omitted = inherits the room session's cwd). */
  readonly cwd?: string
  readonly firstTask?: string
}

/** The invite outcome: the receipt's pendingFirstTask picks the success copy. */
export type RoomInviteOutcome =
  | { readonly ok: true; readonly pendingFirstTask: boolean }
  | { readonly ok: false; readonly message: string }

/** Injected face of the members tab. */
export interface RoomMembersInjected {
  /** The client-side room state store (roster + runs). */
  readonly roomStore: RoomStore
  /** The room session's own cwd (the invite dialog's cwd placeholder). */
  readonly roomCwd?: string | undefined
  /** Open a session (the member's child-session trajectory jump). */
  readonly openSession: (sessionId: SessionId) => void
  /** Cancel the named member's in-flight run. */
  readonly cancelMember: (member: string) => Promise<void>
  /** Remove the named member from the roster. */
  readonly removeMember: (member: string) => Promise<RoomMutationOutcome>
  /** Rewrite the named member's role instructions. */
  readonly updateMember: (member: string, instructions: string) => Promise<RoomMutationOutcome>
  /** Invite a CLI member. */
  readonly invite: (values: RoomInviteValues) => Promise<RoomInviteOutcome>
  /** List the invitable providers (undefined on transport failure). */
  readonly listProviders: () => Promise<RoomProviderList | undefined>
}

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

/** Injected face of the relay (member notification) chat node. */
export interface RoomRelayInjected {
  /** The client-side room state store (member colors come from the roster order). */
  readonly roomStore: RoomStore
  /** Confirm a pending relay (dispatches the notification to the recipient). */
  readonly confirmRelay: (relayId: string) => Promise<void>
  /** Dismiss a pending relay (the notification never reaches anyone). */
  readonly dismissRelay: (relayId: string) => Promise<void>
}

/** Full props of the 'room-relay' chat-node renderer. */
export type RoomRelayViewProps =
  PropsRuntime<'conversation.chat.node', 'room-relay'>
  & InjectFace<RoomRelayInjected>
  & PropsLocale<'room'>

/**
 * Props of the task-board strip, rendered by the RoomComposer itself above
 * the input card — NOT a slot entry: `conversation.input.dock` lives inside
 * the official composer fallback, which the takeover hides.
 */
export type RoomTaskDockProps =
  { readonly sessionId: SessionId }
  & RoomTasksInjected
  & PropsLocale<'room'>
