/** Host registration for the durable shortcut preferences. */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.settings service merge.
import type {} from '@deepseek-ai/dsh-settings'
import { UI_SHORTCUTS_NAMESPACE, ShortcutSettingsSchema } from './settings.ts'

export {
  DEFAULT_NEW_SESSION_PREFERENCE, DEFAULT_PAUSE_PREFERENCE, DEFAULT_PREFERENCES, DEFAULT_STEER_SEND_PREFERENCE,
  SHORTCUT_MODIFIERS, UI_SHORTCUTS_NAMESPACE,
  type BoundKey, type ShortcutModifier, type ShortcutPreference, type ShortcutSettings,
} from './settings.ts'

/**
 * The entry Config: rc.1's SettingsForms serves exactly this schema under the
 * row id (`ui-shortcuts` — the settings namespace by construction) and
 * persists per-action edits through the profile patch. On 0.1.5 the same
 * schema validates the legacy namespace instead; the volatile marker is
 * probed at schema build time and simply absent there.
 */
export const Config = ShortcutSettingsSchema

/** The two faces of the settings service this plugin consumes, structurally. */
interface SettingsDualFace {
  /** 0.1.5's explicit namespace registration (absent on rc.1). */
  register?(ns: string, schema: unknown): unknown
  /** rc.1's per-instance page policy (absent on 0.1.5). */
  configure?(presentation: { auto?: boolean }, owner?: unknown): unknown
}

/**
 * Serve the durable shortcut section on whichever settings face the host line
 * carries.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings as unknown as SettingsDualFace
    if (typeof settings.register === 'function') {
      // 0.1.5: the explicit namespace.
      settings.register(UI_SHORTCUTS_NAMESPACE, ShortcutSettingsSchema)
      return
    }
    // rc.1: the entry's own Config (above) is the served form. Keep the
    // auto-generated page out of the settings tree — the shortcuts tab in the
    // Plugins settings section is this plugin's real page.
    if (typeof settings.configure === 'function') settings.configure({ auto: false }, ctx.fiber)
  })
}
