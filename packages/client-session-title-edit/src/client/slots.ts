/**
 * Slot-facing types of the session-title-edit client half: the injected
 * rename action face and the composed props of its one
 * `conversation.session.header.actions` entry.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.actions').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'

/** Rename failure carrying the wire error code for localized surfacing. */
export interface RenameFailure extends Error {
  /** Wire error code (`session/title-invalid` on the 0.1.2 line, `title-invalid` before); transport failures keep the code the runtime reported. */
  code: string
}

/**
 * Narrow an unknown thrown value to a {@link RenameFailure}.
 * @param error - the value caught from a rename attempt.
 * @returns true when the value is an Error carrying a string `code`.
 */
export function isRenameFailure(error: unknown): error is RenameFailure {
  return error instanceof Error && typeof (error as RenameFailure).code === 'string'
}

/** Injected action face of the header entry. */
export interface SessionTitleEditInjected {
  /**
   * Rename the current session through the official session.rename RPC. The
   * accepted user title pins the session against automatic regeneration.
   * @param title - raw user input; the host normalizes and caps it.
   * @returns when the host accepted the title.
   * @throws {RenameFailure} carrying the wire error code on host rejection.
   */
  renameSession: (title: string) => Promise<void>
}

/** Full props of the session-header title-edit entry. */
export type TitleEditActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<SessionTitleEditInjected>
  & PropsLocale<'session-title-edit'>
