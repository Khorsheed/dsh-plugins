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
 * Register the durable shortcut section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      UI_SHORTCUTS_NAMESPACE,
      ShortcutSettingsSchema,
    )
  })
}
