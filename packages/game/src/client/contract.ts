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
import type {} from './locales.ts'
import type { GameResult, PlayBundle, SessionGameState } from '../types.ts'

/** What the tab body gets from the plugin. */
export interface GameTabInjected {
  fetchState: (sessionId: SessionId) => Promise<RemoteResult<SessionGameState>>
  bind: (sessionId: SessionId, projectId: string | null) => Promise<RemoteResult<GameResult>>
  fetchBundle: (projectId: string, which: 'current' | 'candidate') => Promise<RemoteResult<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>>>
  confirm: (sessionId: SessionId, projectId: string) => Promise<RemoteResult<GameResult<{ readonly ok: true; readonly version: number }>>>
  setAutoConfirm: (sessionId: SessionId, projectId: string, on: boolean) => Promise<RemoteResult<GameResult>>
  logPlay: (sessionId: SessionId, entry: { projectId: string; version: number; seconds: number; errors: string[] }) => Promise<RemoteResult<GameResult>>
  /** Turn-boundary pushes for any session (the tab filters its own). */
  subscribeSessionEvents: (listener: (sessionId: string) => void) => () => void
}

/** Full props of the game tab body. */
export type GameTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<GameTabInjected>
  & PropsLocale<'game'>
