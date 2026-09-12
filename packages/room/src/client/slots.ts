/**
 * Slot-facing types of the room client half: the injected action faces and
 * the composed props of its slot entries.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.composer',
// 'conversation.view', 'conversation.session.header.actions').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.node').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'
import type { RoomProviderList } from '../types.ts'
import type { RoomChromeVisibility } from './preset-visibility.ts'
import type { RoomStore } from './room-store.ts'

/** A mutation outcome with a localized failure message. */
export type RoomMutationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Injected action face of the session-header 邀请 agent action. */
export type InviteAgentInjected = RoomInviteInjected

/** Full props of the 'conversation.session.header.actions' entry. */
export type InviteAgentActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<InviteAgentInjected>
  & PropsLocale<'room'>

/** Injected face of the dock capsules (goal capsule + task capsule). */
export interface RoomTasksInjected {
  /** The client-side room state store (tasks and the goal ride the replayed state). */
  readonly roomStore: RoomStore
  /** Add a pending task to a member's lane, optionally waiting on another member. */
  readonly addTask: (member: string, title: string, blockedBy?: string) => Promise<RoomMutationOutcome>
  /**
   * Close an open task. The status is the closing state: 'done' by default;
   * the failed row's [关闭] passes 'cancelled' — the failure already speaks
   * for itself, and a failed task must not count as goal progress.
   */
  readonly closeTask: (taskId: string, status?: 'done' | 'cancelled') => Promise<RoomMutationOutcome>
  /** Set (or, with a blank text, clear) the room's goal. */
  readonly setGoal: (text: string) => Promise<RoomMutationOutcome>
}

/**
 * The invite dialog's injected share (sessionId binds at inject time). The
 * three dialog hosts — the members tab, the session-header 邀请 agent action,
 * and the fresh-room dock's invite capsule — take exactly this face; none
 * inherits another's surface actions.
 */
export interface RoomInviteInjected {
  /** The room session's own cwd (the invite dialog's empty-cwd placeholder). */
  readonly roomCwd?: string | undefined
  /** Invite a CLI member. */
  readonly invite: (values: RoomInviteValues) => Promise<RoomInviteOutcome>
  /** List the invitable providers (undefined on transport failure). */
  readonly listProviders: () => Promise<RoomProviderList | undefined>
  /**
   * Pick a member-level working directory through the official picker call
   * (`uiWorkspace.pickDirectory` on host 0.1.2 — the picker UI itself is not
   * reusable: ui-workspace's flow holes adopt the pick as a workspace).
   * Resolves null on cancel or when the host serves no native
   * directory-picking capability.
   */
  readonly browseDirectory: () => Promise<string | null>
  /**
   * The roster's current names, read from the store cache at call time (the
   * invite dialog's name dice never rolls one of these). Empty on a cache
   * miss — the host's duplicate check stays the backstop.
   */
  readonly listNames: () => readonly string[]
  /**
   * The pickable model identifiers of one harness (the localAgentGateway
   * `harnessModel` read), feeding the invite dialog's model datalist.
   * Undefined = no datalist (a composition without the local-agent family's
   * client half, or a brokerless harness): the field stays a plain text
   * input, blank following the harness default.
   */
  readonly modelChoices: (harness: string) => Promise<readonly string[] | undefined>
  /**
   * The preset-composition visibility of room's session chrome (M3'
   * self-hide): the invite chip returns null when this says no, and the
   * members tab's registration toggle reads it. Every unreadable path fails
   * open, and an actual room always shows.
   */
  readonly roomChrome: RoomChromeVisibility
}

/**
 * The main agent's durable per-session model selection (the host's
 * session-controller vocabulary, duck-typed so room never imports
 * ui-model-selection — the service is probed through `ctx.get`).
 */
export interface RoomModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One adapter-owned reasoning effort of an exact model route. */
export interface RoomModelEffort {
  readonly id: string
  readonly name: string
}

/** One catalog model inside its provider group. */
export interface RoomCatalogModel {
  readonly id: string
  readonly name: string
  readonly reasoning?: {
    readonly efforts: readonly RoomModelEffort[]
    readonly defaultEffort?: string
  }
}

/** One provider and its successfully loaded model catalog. */
export interface RoomModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly RoomCatalogModel[]
}

/** The directory snapshot the room's main-agent model picker renders from. */
export interface RoomModelDirectoryState {
  /** Effective selection: the durable next-request projection, then the host default. */
  readonly current: RoomModelSelection | null
  /** Successfully loaded provider groups (last good load). */
  readonly groups: readonly RoomModelGroup[]
  /** Lifecycle of the in-flight operation. */
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Whole-request or selection failure text; null when none. */
  readonly error: string | null
}

/**
 * The duck-typed slice of ui-model-selection's per-session ModelDirectory
 * (`ctx.modelDirectories.directoryFor(sessionId)`) the composer's main-agent
 * model picker consumes — the SAME directory the official composer seat
 * (`conversation.input.model`) renders, so a switch here is exactly the
 * official seat's switch: `select()` writes the durable per-session selection
 * through the session controller's selectModel remote and the shared store
 * notifies every reader. Absent service = no picker (degrade, never throw).
 */
export interface RoomModelDirectory {
  /** The shared snapshot store (useSyncExternalStore-safe). */
  readonly store: {
    readonly subscribe: (listener: () => void) => () => void
    readonly getSnapshot: () => RoomModelDirectoryState
  }
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  readonly load: () => Promise<unknown>
  /** Select the complete provider/model/reasoning selection; rejects on a refused switch. */
  readonly select: (selection: RoomModelSelection) => Promise<void>
}

/**
 * Injected face of the composer takeover entry: the dispatch submit plus the
 * task-board actions (sessionId binds at inject time), because the takeover
 * renders the task board itself — the `conversation.input.dock` seat rides
 * the hidden official fallback. The takeover also inherits the official bar's
 * Stop duty: the fallback's Stop button hides with it, so `stop` re-homes the
 * main agent's turn cancel (the runtime session face's `cancel()`). The
 * invite share rides along for the fresh-room dock's invite capsule.
 * `modelDirectory` is the official per-session model directory for the room's
 * own main agent (bare messages ARE its turns); undefined on a host without
 * ui-model-selection — the picker simply does not render.
 */
export interface RoomComposerInjected extends RoomTasksInjected, RoomInviteInjected {
  /**
   * Dispatch an @-message into the room and refresh the store on success.
   * Bare messages never reach here — the composer releases them to the
   * official submit path (useInput/inputActions) itself. `targets` carries
   * the mention-menu picks (explicit addressing wherever the `@name` sits in
   * the sentence); the host unions them with the parsed leading tokens.
   */
  readonly submit: (sessionId: SessionId, text: string, targets?: readonly string[]) => Promise<RoomMutationOutcome>
  /** Interrupt the room's own main-agent turn (the hidden official bar's Stop). */
  readonly stop: () => void
  /**
   * The official per-session model directory of the room's main agent (the
   * session's root agent). The picker writes the SESSION selection only — an
   * @-addressed member dispatch rides room's own submit remote and is never
   * touched by it. undefined = host without ui-model-selection: no picker.
   */
  readonly modelDirectory?: RoomModelDirectory | undefined
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
  /** The delegation's invite-time model (omitted = follow the harness default). */
  readonly model?: string
}

/** The invite outcome: the receipt's pendingFirstTask picks the success copy. */
export type RoomInviteOutcome =
  | { readonly ok: true; readonly pendingFirstTask: boolean }
  | { readonly ok: false; readonly message: string }

/** Injected face of the members tab. */
export interface RoomMembersInjected extends RoomInviteInjected {
  /** The client-side room state store (roster + runs). */
  readonly roomStore: RoomStore
  /** Open a session (the member's child-session trajectory jump). */
  readonly openSession: (sessionId: SessionId) => void
  /** Remove the named member from the roster. */
  readonly removeMember: (member: string) => Promise<RoomMutationOutcome>
  /**
   * Edit the named member: rename, cwd override (null clears back to
   * inheriting the room cwd), role instructions (null clears them). Only the
   * present fields change.
   */
  readonly updateMember: (member: string, patch: RoomMemberPatch) => Promise<RoomMutationOutcome>
}

/** One member edit (every field optional; null clears the field). */
export interface RoomMemberPatch {
  /** New @-addressing name (unique, no whitespace, no "@"). */
  readonly rename?: string
  /** New role instructions; null clears them. */
  readonly instructions?: string | null
  /** New cwd override; null clears back to inheriting the room cwd. */
  readonly cwd?: string | null
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

/** Injected face of the task-advance chat node. */
export interface RoomTaskLineInjected {
  /** The client-side room state store (the goal-progress suffix). */
  readonly roomStore: RoomStore
}

/** Full props of the 'room-task-line' chat-node renderer. */
export type RoomTaskLineViewProps =
  PropsRuntime<'conversation.chat.node', 'room-task-line'>
  & InjectFace<RoomTaskLineInjected>
  & PropsLocale<'room'>

/**
 * Props of the dock capsules (goal capsule + task capsule), rendered by the
 * RoomComposer itself above the input card — NOT a slot entry:
 * `conversation.input.dock` lives inside the official composer fallback,
 * which the takeover hides. The invite share serves the fresh-room state:
 * a room with neither a goal nor any task renders a single 「＋ 邀请成员」
 * capsule instead of the pair, opening the invite dialog straight from the
 * dock.
 */
export type RoomDockCapsulesProps =
  { readonly sessionId: SessionId }
  & RoomTasksInjected
  & RoomInviteInjected
  & PropsLocale<'room'>
