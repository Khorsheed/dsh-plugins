/**
 * Slot-facing types of the context-guard client half: the injected compact
 * action face and the composed props of its one `conversation.input.right`
 * entry.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.input.right' and its InputZone owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'

/** Injected action face of the composer-tool-row entry. */
export interface ContextGuardInjected {
  /** Resolved window fraction at which the guard turns on. */
  thresholdRatio: number
  /** Resolved output budget the next request reserves, in tokens. */
  maxTokens: number
  /**
   * Run the official `/compact` command against this session's agent —
   * the same command the user would type, so the host owns the lifecycle
   * (idle-gating, the compaction lock, and the flow node presentation).
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  compactNow: () => Promise<string | null>
}

/** Full props of the composer-tool-row compact entry. */
export type CompactGuardButtonProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<ContextGuardInjected>
  & PropsLocale<'context-guard'>
