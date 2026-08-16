/**
 * Pure binding helpers: canonicalization, exact matching, and display
 * formatting. Zero React / DOM / cordis — every function is a pure function
 * of its inputs so the keydown wiring and the settings row share one model.
 */
import type { BoundKey, ShortcutModifier, ShortcutPreference } from '../settings.ts'

/** Normalize one event key to the canonical stored form. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/**
 * Snapshot one keydown event as a bound key. `primary` collapses Ctrl and Cmd
 * (the composer's Ctrl/Cmd chord convention); the returned modifier list is
 * in canonical order.
 * @param event - the keydown event.
 * @returns the bound key the event represents.
 */
export function bindingOfEvent(event: KeyboardEvent): BoundKey {
  const modifiers: ShortcutModifier[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('primary')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  return { kind: 'key', modifiers, key: normalizeKey(event.key) }
}

/**
 * Exact match of one preference against a keydown event: an unbound
 * preference never matches; otherwise the normalized key and the full
 * modifier set must agree (a bare Escape never matches a Ctrl chord, and a
 * `primary` binding matches Ctrl or Cmd, not both at once).
 * @param event - the keydown event.
 * @param preference - the stored preference.
 * @returns whether the event triggers the preference.
 */
export function matches(event: KeyboardEvent, preference: ShortcutPreference): boolean {
  if (preference.kind === 'none') return false
  const candidate = bindingOfEvent(event)
  return candidate.key === preference.key
    && candidate.modifiers.length === preference.modifiers.length
    && preference.modifiers.every(modifier => candidate.modifiers.includes(modifier))
}

/** Display label for one modifier slot. */
const MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  primary: 'Ctrl/Cmd',
  alt: 'Alt',
  shift: 'Shift',
}

/** Display label for one action key. */
export function keyLabel(key: string): string {
  switch (key) {
    case 'Escape': return 'Esc'
    case ' ': return 'Space'
    case 'Enter': return 'Enter'
    case 'Tab': return 'Tab'
    case 'Backspace': return 'Backspace'
    case 'Delete': return 'Delete'
    default: return key.length === 1 ? key.toUpperCase() : key
  }
}

/**
 * Display labels for one bound key, one entry per keycap (e.g.
 * ["Ctrl/Cmd", "S"], ["Esc"]).
 * @param binding - the bound key to display.
 * @returns the per-keycap labels in display order.
 */
export function bindingParts(binding: BoundKey): string[] {
  return [...binding.modifiers.map(modifier => MODIFIER_LABELS[modifier]), keyLabel(binding.key)]
}

/**
 * Human-readable bound-key text for accessible names and hints (e.g.
 * "Ctrl/Cmd+S", "Esc").
 * @param binding - the bound key to display.
 * @returns the display text.
 */
export function formatBinding(binding: BoundKey): string {
  return bindingParts(binding).join('+')
}

/**
 * Whether two preferences are structurally equal (canonical modifier order).
 * @param left - one preference.
 * @param right - the other preference.
 * @returns true when both are unbound or agree on key and modifier set.
 */
export function equalPreference(left: ShortcutPreference, right: ShortcutPreference): boolean {
  if (left.kind === 'none' || right.kind === 'none') return left.kind === right.kind
  return left.key === right.key
    && left.modifiers.length === right.modifiers.length
    && left.modifiers.every((modifier, index) => right.modifiers[index] === modifier)
}

/** The modifier keys that never complete a binding on their own. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])

/**
 * Whether a keydown event can complete a binding (a non-modifier action key).
 * @param event - the keydown event.
 * @returns false for modifier-only chords, which keep the capture open.
 */
export function isBindingKey(event: KeyboardEvent): boolean {
  return !MODIFIER_KEYS.has(event.key)
}
