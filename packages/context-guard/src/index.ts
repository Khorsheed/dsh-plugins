/**
 * Context-guard plugin, node half. Serves the `context-guard` settings
 * section so the web settings page can render the compact-timing card and
 * the browser half can bind its scope to the same section — on rc.1 through
 * the entry's own Config (below; SettingsForms serves and edits its volatile
 * field), on 0.1.5 through an explicit `settings.register` namespace whose
 * base layer is the composition entry. The plugin's own runtime behavior is
 * purely client-side (the composer compact button); this registration only
 * exists to make the two tunables (`thresholdRatio`, `maxTokens`) editable
 * from the GUI instead of YAML.
 * @module @khorsheed/dsh-context-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
// Type-only: pulls the ctx.settings service merge.
import type {} from '@deepseek-ai/dsh-settings'
import { CONTEXT_GUARD_NS } from './namespace.ts'
import { ContextGuardSettingsSchema } from './settings.ts'

export { CONTEXT_GUARD_NS } from './namespace.ts'
export { ContextGuardSettingsSchema } from './settings.ts'

/**
 * The entry Config: rc.1's SettingsForms serves exactly this schema under the
 * row id (`context-guard` — the settings namespace by construction) and
 * persists edits to its volatile field through the profile patch. On 0.1.5
 * the same schema validates the legacy namespace instead; the volatile
 * marker is probed at schema build time and simply absent there. The bare
 * `z` annotation keeps the emitted type nameable under pnpm's layout.
 */
export const Config: z = ContextGuardSettingsSchema

/** The two faces of the settings service this plugin consumes, structurally. */
interface SettingsDualFace {
  /** 0.1.5's explicit namespace registration (absent on rc.1). */
  register?(ns: string, schema: unknown, options?: { base: Record<string, unknown> }): unknown
  /** rc.1's per-instance page policy (absent on 0.1.5). */
  configure?(presentation: { auto?: boolean }, owner?: unknown): unknown
}

/**
 * Serve the compact-timing section on whichever settings face the host line
 * carries.
 * @param ctx - Host context whose optional settings service owns the section.
 * @param config - the plugin's composition entry, the legacy path's base layer.
 */
export function apply(ctx: Context, config: Record<string, unknown> = {}): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings as unknown as SettingsDualFace
    if (typeof settings.register === 'function') {
      // 0.1.5: the explicit namespace, the composition entry as its base layer.
      settings.register(CONTEXT_GUARD_NS, ContextGuardSettingsSchema, { base: config })
      return
    }
    // rc.1: the entry's own Config (above) is the served form. Keep the
    // auto-generated page out of the settings tree — the bundle's own cards
    // (plugins.bundle.config / the legacy tab seat) edit the same field.
    if (typeof settings.configure === 'function') settings.configure({ auto: false }, ctx.fiber)
  })
}
