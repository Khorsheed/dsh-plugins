/**
 * The game tab's injected face and props.
 * @module @khorsheed/dsh-game/client
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls ui-session's SessionStandardProps merge (sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the right-Sidebar SlotMap seats ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.input.dock').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from './locales.ts'
import type { DeleteProjectResult, GameResult, PlayBundle, ProjectCard, SessionGameState, TurnReport, VersionDiff } from '../types.ts'

type R<T> = Promise<RemoteResult<T>>
type Ok<T extends object = object> = GameResult<{ readonly ok: true } & T>

/** Every call the panel makes, already bound to the Remote. */
export interface GameApi {
  state: (sid: SessionId) => R<SessionGameState>
  projectCards: () => R<ProjectCard[]>
  turnReport: (sid: SessionId, turn: number) => R<TurnReport | null>
  bind: (sid: SessionId, projectId: string | null) => R<Ok>
  deleteProject: (sid: SessionId, projectId: string, mode: 'trash' | 'forget') => R<DeleteProjectResult>
  bundle: (projectId: string, which: 'current' | 'candidate') => R<Ok<{ readonly bundle: PlayBundle }>>
  versionBundle: (projectId: string, version: number) => R<Ok<{ readonly bundle: PlayBundle }>>
  confirm: (sid: SessionId, projectId: string) => R<Ok<{ readonly version: number }>>
  reject: (sid: SessionId, projectId: string, reason: string) => R<Ok>
  rollback: (sid: SessionId, projectId: string, version: number) => R<Ok>
  diff: (projectId: string, from: number, to: number) => R<Ok<{ readonly diff: VersionDiff }>>
  checkShot: (projectId: string, version?: number) => R<Ok<{ readonly webp: string }>>
  setAutoConfirm: (sid: SessionId, projectId: string, on: boolean) => R<Ok>
  logPlay: (sid: SessionId, entry: { projectId: string; version: number; seconds: number; errors: string[] }) => R<Ok>
  setParam: (sid: SessionId, projectId: string, key: string, value: number) => R<Ok>
  finalizeParams: (sid: SessionId, projectId: string) => R<Ok>
  resetParams: (sid: SessionId, projectId: string) => R<Ok>
  editElement: (sid: SessionId, projectId: string, elementId: string, patch: { look?: string; fields?: string }) => R<Ok<{ readonly elementJson: string }>>
  pickProposal: (sid: SessionId, projectId: string, elementId: string, at: string, index: number) => R<Ok>
  writeChapter: (sid: SessionId, projectId: string, chapterId: string, text: string) => R<Ok>
  requestRestyle: (sid: SessionId, projectId: string, styleId: string) => R<Ok>
  setOnePager: (sid: SessionId, projectId: string, patch: { pitch?: string; elementTypes?: string; pillars?: string }) => R<Ok>
  dropPending: (sid: SessionId, projectId: string, key: string) => R<Ok>
}

/** Where a jump into the game tab lands. */
export interface NavTarget {
  readonly view: 'play' | 'elements' | 'design' | 'versions'
  readonly elementId?: string
  readonly chapterId?: string
}

/** What the tab body and the dock get from the plugin. */
export interface GameTabInjected {
  /** Open the game tab at a place (the turn card's 查看). */
  openAt: (target: NavTarget) => void
  /** The tab body follows jumps; returns the unsubscribe. */
  subscribeNav: (listener: (target: NavTarget) => void) => () => void
  /** A jump made before the tab body mounted, taken once. */
  takeNav: () => NavTarget | null
  api: GameApi
  /** Put text into the session's composer draft (appended; never sent). False when there is no composer. */
  insertDraft: (sessionId: SessionId, text: string) => boolean
  /**
   * Put a reference into the session's composer as one chip (`label` shown,
   * `text` what the model receives); falls back to appending `text` as plain
   * draft text where the host has no chip seam. Never sends.
   */
  insertRef: (sessionId: SessionId, ref: { readonly label: string; readonly text: string }) => boolean
  /** Turn-boundary pushes, plus the panel's own mutations, per session id. */
  subscribeSessionEvents: (listener: (sessionId: string) => void) => () => void
  /** Tell every game surface of this page that a session's state moved. */
  touch: (sessionId: SessionId) => void
}

/** Full props of the game tab body. */
export type GameTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<GameTabInjected>
  & PropsLocale<'game'>

/** Full props of the composer dock (将附上). */
export type GameDockProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<GameTabInjected>
  & PropsLocale<'game'>

/** What every view inside the tab receives. */
export interface ViewProps {
  readonly t: GameTabProps['t']
  readonly sessionId: GameTabProps['sessionId']
  readonly api: GameApi
  readonly insertDraft: (text: string) => boolean
  /** Insert a reference chip into the composer (see `GameTabInjected.insertRef`). */
  readonly insertRef: (ref: { readonly label: string; readonly text: string }) => boolean
  /** Re-read the state after a mutation (and tell the dock). */
  readonly refresh: () => void
  /** Show a short confirmation line at the panel's foot. */
  readonly toast: (text: string) => void
  /** A change landed that the agent may want to hear about: offer to send it (pending key + a short title). */
  readonly changed: (key: string, title: string) => void
}

/** A Remote call's game-level failure code, or undefined on success. */
export function failureOf(result: RemoteResult<{ ok: boolean; error?: string }>): string | undefined {
  if (!result.ok) return result.error.message
  return result.value.ok ? undefined : (result.value as { error?: string }).error ?? 'io'
}
