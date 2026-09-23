/**
 * Slot-facing types of the context-guard client half: the injected faces of
 * the composer-tool-row compact button and the settings surfaces, both
 * carrying the shared `context-guard` settings scope as a hooks source so the
 * button and the card react to the same live section. The settings surface
 * has one face per host line: the alpha.2 Plugins page renders the bundle's
 * configuration (`plugins.bundle.config`, keyed by package name, owner prop
 * `view`); the 0.1.5 configurable-plugins tab renders the card
 * (`settings.plugin.item`, keyed by the settings namespace, owner props
 * intentionally empty — the structural type below is exact).
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GuardScope } from './scope.ts'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.input.right' and its InputZone owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-plugin-manager's SlotMap merge
// ('plugins.bundle.config' keyed slot).
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

/** Injected face of both settings surfaces: the same shared section, read and written here. */
export interface ContextGuardSettingsCardInjected {
  /** The live section handle; the card stages edits and writes through it on save. */
  scope: GuardScope
  hooks: {
    /** The shared `context-guard` settings section; the card binds `useConfig` to it. */
    config: GuardScope
  }
}

/**
 * Full props of the 0.1.5 settings.plugin.item card entry. The removed slot's
 * owner share was intentionally empty, so the props are the injected face and
 * the locale seat alone; the registration goes through a duck-typed narrow of
 * the slots service (see client/index.ts).
 */
export type ContextGuardSettingsCardProps =
  InjectFace<ContextGuardSettingsCardInjected>
  & PropsLocale<'context-guard'>

/** Full props of the alpha.2 plugins.bundle.config entry (owner prop `view`). */
export type ContextGuardBundleConfigProps =
  PropsRuntime<'plugins.bundle.config'>
  & InjectFace<ContextGuardSettingsCardInjected>
  & PropsLocale<'context-guard'>
