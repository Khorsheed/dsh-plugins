/**
 * Slot-facing types of the context-guard client half: the injected faces of
 * the composer-tool-row compact button and the settings card, both carrying
 * the shared `context-guard` settings scope as a hooks source so the button
 * and the card react to the same live section. The settings surface is the
 * Plugins page's `plugins.item` entry (owner prop `view`), registered by
 * client/index.ts while the Host serves the `context-guard` namespace.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GuardScope } from './scope.ts'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.input.right' and its InputZone owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-plugin-manager's SlotMap merge ('plugins.item' list
// slot).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'

/** Injected action face of the composer-tool-row entry. */
export interface ContextGuardInjected {
  /** Resolved context-occupancy fraction at which the guard turns on; the boot-time fallback. */
  thresholdRatio: number
  /**
   * Run the official `/compact` command against this session's agent —
   * the same command the user would type, so the host owns the lifecycle
   * (idle-gating, the compaction lock, and the flow node presentation).
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  compactNow: () => Promise<string | null>
  hooks: {
    /** The shared `context-guard` settings section; the button binds `useConfig` to it. */
    config: GuardScope
  }
}

/** Full props of the composer-tool-row compact entry. */
export type CompactGuardButtonProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<ContextGuardInjected>
  & PropsLocale<'context-guard'>

/** Injected face of the settings card: the same shared section, read and written here. */
export interface ContextGuardSettingsCardInjected {
  /** The live section handle; the card stages edits and writes through it on save. */
  scope: GuardScope
  hooks: {
    /** The shared `context-guard` settings section; the card binds `useConfig` to it. */
    config: GuardScope
  }
}

/** Full props of the plugins.item card entry (owner prop `view`). */
export type ContextGuardBundleConfigProps =
  PropsRuntime<'plugins.item'>
  & InjectFace<ContextGuardSettingsCardInjected>
  & PropsLocale<'context-guard'>
