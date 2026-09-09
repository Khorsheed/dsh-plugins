/**
 * Context-guard plugin, node half. Registers the `context-guard` settings
 * namespace so the web settings page can render the compact-timing card and
 * the browser half can bind its `settingsScope` to the same section. The
 * plugin's own runtime behavior is purely client-side (the composer compact
 * button); this registration only exists to make the two tunables
 * (`thresholdRatio`, `maxTokens`) editable from the GUI instead of YAML.
 * @module @khorsheed/dsh-context-guard
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.settings service merge.
import type {} from '@deepseek-ai/dsh-settings'
import { CONTEXT_GUARD_NS } from './namespace.ts'
import { ContextGuardSettingsSchema } from './settings.ts'

export { CONTEXT_GUARD_NS } from './namespace.ts'
export { ContextGuardSettingsSchema } from './settings.ts'

/**
 * Register the compact-timing section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 * @param config - the plugin's composition entry, used as the section's base layer.
 */
export function apply(ctx: Context, config: Record<string, unknown> = {}): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      CONTEXT_GUARD_NS,
      ContextGuardSettingsSchema,
      { base: config },
    )
  })
}
