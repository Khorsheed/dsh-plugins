/**
 * Pure binding helpers: canonicalization, exact matching, and display
 * formatting. Zero React / DOM / cordis — every function is a pure function
 * of its inputs so the keydown/mousedown wiring, the settings row, and the
 * capture recorder share one model.
 */
import type { BoundKey, BoundMouse, ShortcutBinding, ShortcutModifier, ShortcutMouseButton, ShortcutPreference } from '../settings.ts'
import { SHORTCUT_MOUSE_BUTTONS } from '../settings.ts'

/** Normalize one event key to the canonical stored form. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/**
 * Snapshot one event's modifier set. `primary` collapses Ctrl and Cmd (the
 * composer's Ctrl/Cmd chord convention); the returned list is in canonical
 * order. Shared by key and mouse gestures — a modifier means the same thing
 * on either.
 * @param event - the key or mouse event.
 * @returns the recorded modifiers.
 */
function modifiersOfEvent(event: KeyboardEvent | MouseEvent): ShortcutModifier[] {
  const modifiers: ShortcutModifier[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('primary')
  if (event.altKey) modifiers.push('alt')
  if (event.shiftKey) modifiers.push('shift')
  return modifiers
}

/**
 * Snapshot one keydown event as a bound key.
 * @param event - the keydown event.
 * @returns the bound key the event represents.
 */
export function bindingOfEvent(event: KeyboardEvent): BoundKey {
  return { kind: 'key', modifiers: modifiersOfEvent(event), key: normalizeKey(event.key) }
}

/**
 * Whether a DOM button code can complete a binding (see
 * {@link SHORTCUT_MOUSE_BUTTONS}: the primary button never can).
 * @param button - the `MouseEvent.button` code.
 * @returns whether the button is part of the binding vocabulary.
 */
export function isBindingButton(button: number): button is ShortcutMouseButton {
  return (SHORTCUT_MOUSE_BUTTONS as readonly number[]).includes(button)
}

/**
 * Snapshot one mousedown event as a bound mouse button.
 * @param event - the mousedown event.
 * @returns the bound button, or null when the button is not bindable (the
 * primary button, or a browser-reserved back/forward button).
 */
export function mouseBindingOfEvent(event: MouseEvent): BoundMouse | null {
  if (!isBindingButton(event.button)) return null
  return { kind: 'mouse', modifiers: modifiersOfEvent(event), button: event.button }
}

/** Whether an event's modifier set is exactly the stored one (no extras, no gaps). */
function sameModifiers(event: KeyboardEvent | MouseEvent, modifiers: readonly ShortcutModifier[]): boolean {
  const candidate = modifiersOfEvent(event)
  return candidate.length === modifiers.length
    && modifiers.every(modifier => candidate.includes(modifier))
}

/**
 * Exact match of one preference against a keydown event: an unbound (or
 * mouse-bound) preference never matches; otherwise the normalized key and the
 * full modifier set must agree (a bare Escape never matches a Ctrl chord, and
 * a `primary` binding matches Ctrl or Cmd, not both at once).
 * @param event - the keydown event.
 * @param preference - the stored preference.
 * @returns whether the event triggers the preference.
 */
export function matches(event: KeyboardEvent, preference: ShortcutPreference): boolean {
  if (preference.kind !== 'key') return false
  return normalizeKey(event.key) === preference.key && sameModifiers(event, preference.modifiers)
}

/**
 * Exact match of one preference against a mousedown event: only a mouse-bound
 * preference can match, and the button code plus the full modifier set must
 * agree.
 * @param event - the mousedown event.
 * @param preference - the stored preference.
 * @returns whether the event triggers the preference.
 */
export function matchesMouse(event: MouseEvent, preference: ShortcutPreference): boolean {
  if (preference.kind !== 'mouse') return false
  return event.button === preference.button && sameModifiers(event, preference.modifiers)
}

/** Display label for one modifier slot. */
const MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  primary: 'Ctrl/Cmd',
  alt: 'Alt',
  shift: 'Shift',
}

/** Display label for one bindable mouse button. */
const MOUSE_BUTTON_LABELS: Record<ShortcutMouseButton, string> = {
  1: 'Middle Click',
  2: 'Right Click',
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
 * Display labels for one bound gesture, one entry per keycap (e.g.
 * ["Ctrl/Cmd", "S"], ["Esc"], ["Middle Click"]).
 * @param binding - the bound gesture to display.
 * @returns the per-keycap labels in display order.
 */
export function bindingParts(binding: ShortcutBinding): string[] {
  const gesture = binding.kind === 'mouse' ? MOUSE_BUTTON_LABELS[binding.button] : keyLabel(binding.key)
  return [...binding.modifiers.map(modifier => MODIFIER_LABELS[modifier]), gesture]
}

/**
 * Human-readable bound-gesture text for accessible names and hints (e.g.
 * "Ctrl/Cmd+S", "Esc", "Middle Click").
 * @param binding - the bound gesture to display.
 * @returns the display text.
 */
export function formatBinding(binding: ShortcutBinding): string {
  return bindingParts(binding).join('+')
}

/** Whether two modifier lists agree element by element (canonical order). */
function sameModifierList(left: readonly ShortcutModifier[], right: readonly ShortcutModifier[]): boolean {
  return left.length === right.length && left.every((modifier, index) => right[index] === modifier)
}

/**
 * Whether two preferences are structurally equal (canonical modifier order).
 * A key chord and a mouse button are never equal, and both-unbound is equal.
 * @param left - one preference.
 * @param right - the other preference.
 * @returns true when both are unbound or agree on gesture and modifier set.
 */
export function equalPreference(left: ShortcutPreference, right: ShortcutPreference): boolean {
  if (left.kind === 'none' || right.kind === 'none') return left.kind === right.kind
  if (left.kind !== right.kind) return false
  if (left.kind === 'key') {
    return right.kind === 'key' && left.key === right.key && sameModifierList(left.modifiers, right.modifiers)
  }
  return right.kind === 'mouse' && left.button === right.button && sameModifierList(left.modifiers, right.modifiers)
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
