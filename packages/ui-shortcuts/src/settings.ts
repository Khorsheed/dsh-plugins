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

/**
 * Pointing-device buttons a binding may claim, by DOM `MouseEvent.button`:
 * 1 = middle (auxiliary), 2 = secondary. The primary button (0) is
 * deliberately absent — a page-wide primary-button binding would consume every
 * ordinary click. The browser's back/forward buttons (3/4) are absent too:
 * engines route them to history navigation before the page sees them, so a
 * binding there could never be relied on.
 */
export const SHORTCUT_MOUSE_BUTTONS = [1, 2] as const

/** One bindable mouse button. */
export type ShortcutMouseButton = typeof SHORTCUT_MOUSE_BUTTONS[number]

/**
 * One bound pointing-device button: an exact modifier set plus the DOM button
 * code. Modifiers work the same way they do on a key chord (`primary` +
 * middle-click is a distinct binding from a bare middle-click).
 */
export interface BoundMouse {
  readonly kind: 'mouse'
  modifiers: ShortcutModifier[]
  readonly button: ShortcutMouseButton
}

/** One gesture a preference can bind: a key chord or a mouse button. */
export type ShortcutBinding = BoundKey | BoundMouse

/** One action's durable preference: a bound gesture or the explicit unbound marker. */
export type ShortcutPreference = { readonly kind: 'none' } | ShortcutBinding

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

/**
 * Default: Ctrl/Cmd+Shift+X compacts the session history (`/compact`). The
 * mnemonic chords are taken by browser chrome a page cannot intercept
 * (Ctrl/Cmd+Shift+C is DevTools inspect, Ctrl/Cmd+Shift+K is the Firefox Web
 * Console, Ctrl/Cmd+K focuses the address bar), so the binding is by
 * convention rather than by initials — and it is rebindable.
 */
export const DEFAULT_COMPACT_PREFERENCE: BoundKey = { kind: 'key', modifiers: ['primary', 'shift'], key: 'x' }

/**
 * Default: the **middle mouse button** toggles the right column. The product
 * owner chose the pointer gesture over a chord: the right column is a
 * pointer-adjacent surface (what a link or a tool row opens lands there), so
 * the button that opens links also gives the column its room back. The cost is
 * deliberate and documented in both READMEs — a `global` middle-click owns
 * autoscroll (Windows), primary-selection paste (Linux), and the
 * open-link-in-new-tab default on every link in the page — and a trackpad-only
 * machine rebinds it to a chord in one click.
 */
export const DEFAULT_TOGGLE_SIDEBAR_PREFERENCE: BoundMouse = { kind: 'mouse', modifiers: [], button: 1 }

/** Default bindings of the plugin's built-in actions, keyed by action id. */
export const DEFAULT_PREFERENCES: Record<string, ShortcutBinding> = {
  pause: DEFAULT_PAUSE_PREFERENCE,
  steerSend: DEFAULT_STEER_SEND_PREFERENCE,
  newSession: DEFAULT_NEW_SESSION_PREFERENCE,
  compact: DEFAULT_COMPACT_PREFERENCE,
  toggleSidebar: DEFAULT_TOGGLE_SIDEBAR_PREFERENCE,
}

const ModifiersSchema = z.array(z.union([z.const('primary'), z.const('alt'), z.const('shift')])).required()
const KeySchema = z.object({
  kind: z.const('key').required(),
  modifiers: ModifiersSchema,
  key: z.string().required(),
})
const MouseSchema = z.object({
  kind: z.const('mouse').required(),
  modifiers: ModifiersSchema,
  button: z.union([z.const(1), z.const(2)]).required(),
})
const NoneSchema = z.object({ kind: z.const('none').required() })
const PreferenceSchema = z.union([NoneSchema, KeySchema, MouseSchema])

const dictField = z.dict(PreferenceSchema).default({})

/**
 * Durable shortcut schema: an open action-id → preference dict; also the wire
 * envelope the browser scope validates against. The whole dict is marked
 * `.volatile()` when the running schemastery supports it (3.18.4, host rc.1 —
 * SettingsForms serves and edits ONLY volatile fields, and a volatile root
 * makes every action-id path writable); 0.1.5's schemastery has no such
 * method, the probe leaves the dict plain, and the legacy `settings.register`
 * path carries the section. The probe reads the typed method directly (3.18.4
 * declares `Schema.prototype.volatile`). The bare `z` annotation keeps the
 * emitted type nameable under pnpm's layout (the probed call's mode parameter
 * defeats the old `z<ShortcutSettings>` one).
 */
export const ShortcutSettingsSchema: z = typeof dictField.volatile === 'function'
  ? dictField.volatile()
  : dictField

