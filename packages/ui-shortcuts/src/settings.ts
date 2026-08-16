/** Shortcut preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the shortcuts plugin. */
export const UI_SHORTCUTS_NAMESPACE = 'ui-shortcuts'

/** Key-modifier vocabulary; `primary` means Ctrl on Windows/Linux and Cmd on macOS. */
export const SHORTCUT_MODIFIERS = ['primary', 'alt', 'shift'] as const

/** One recorded key modifier. */
export type ShortcutModifier = typeof SHORTCUT_MODIFIERS[number]

/** One bound key: an exact modifier set plus a canonical action key (single
 * characters normalized lowercase; named keys like `Escape` verbatim).
 * `primary` matches either Ctrl or Cmd, mirroring the composer's Ctrl/Cmd
 * chord convention.
 */
export interface BoundKey {
  readonly kind: 'key'
  modifiers: ShortcutModifier[]
  readonly key: string
}

/** One action's durable preference: a bound key or the explicit unbound marker. */
export type ShortcutPreference = { readonly kind: 'none' } | BoundKey

/**
 * Durable shortcut section: action id → preference. The map is open — any
 * plugin can register actions (see client/contract.ts) — so the schema is a
 * dict and only entries the user actually changed are persisted; a missing
 * id falls back to the registered action's default binding at read time.
 */
export type ShortcutSettings = Record<string, ShortcutPreference>

/** Default: bare Escape pauses. */
export const DEFAULT_PAUSE_PREFERENCE: BoundKey = { kind: 'key', modifiers: [], key: 'Escape' }

/** Default: Ctrl/Cmd+S steer-sends the draft. */
export const DEFAULT_STEER_SEND_PREFERENCE: BoundKey = { kind: 'key', modifiers: ['primary'], key: 's' }

/**
 * Default: Ctrl/Cmd+O starts a new session. Ctrl/Cmd+N is browser-reserved
 * (new window) and cannot be intercepted, Ctrl/Cmd+Shift+N is incognito;
 * Ctrl/Cmd+Shift+O stays reserved for a future new-session-and-split action.
 */
export const DEFAULT_NEW_SESSION_PREFERENCE: BoundKey = { kind: 'key', modifiers: ['primary'], key: 'o' }

/** Default bindings of the plugin's built-in actions, keyed by action id. */
export const DEFAULT_PREFERENCES: Record<string, BoundKey> = {
  pause: DEFAULT_PAUSE_PREFERENCE,
  steerSend: DEFAULT_STEER_SEND_PREFERENCE,
  newSession: DEFAULT_NEW_SESSION_PREFERENCE,
}

const KeySchema = z.object({
  kind: z.const('key').required(),
  modifiers: z.array(z.union([z.const('primary'), z.const('alt'), z.const('shift')])).required(),
  key: z.string().required(),
})
const NoneSchema = z.object({ kind: z.const('none').required() })
const PreferenceSchema = z.union([NoneSchema, KeySchema])

/** Durable shortcut schema: an open action-id → preference dict; also the wire envelope the browser scope validates against. */
export const ShortcutSettingsSchema: z<ShortcutSettings> = z.dict(PreferenceSchema).default({})
