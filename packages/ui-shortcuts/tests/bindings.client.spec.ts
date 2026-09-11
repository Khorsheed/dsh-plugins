// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  bindingOfEvent, bindingParts, equalPreference, formatBinding, isBindingButton, isBindingKey, keyLabel, matches,
  matchesMouse, mouseBindingOfEvent, normalizeKey, partLabel,
} from '../src/client/bindings.ts'
import type { ShortcutPreference } from '../src/settings.ts'

function event(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('binding canonicalization', () => {
  it('normalizes single-character keys to lowercase and keeps named keys verbatim', () => {
    expect(normalizeKey('s')).toBe('s')
    expect(normalizeKey('S')).toBe('s')
    expect(normalizeKey('Escape')).toBe('Escape')
    expect(normalizeKey(' ')).toBe(' ')
  })

  it('collapses Ctrl and Cmd into the primary modifier and records the rest', () => {
    expect(bindingOfEvent(event({ key: 's', ctrlKey: true }))).toEqual({ kind: 'key', modifiers: ['primary'], key: 's' })
    expect(bindingOfEvent(event({ key: 's', metaKey: true }))).toEqual({ kind: 'key', modifiers: ['primary'], key: 's' })
    expect(bindingOfEvent(event({ key: 'Escape' }))).toEqual({ kind: 'key', modifiers: [], key: 'Escape' })
    expect(bindingOfEvent(event({ key: 's', ctrlKey: true, altKey: true, shiftKey: true })))
      .toEqual({ kind: 'key', modifiers: ['primary', 'alt', 'shift'], key: 's' })
  })
})

describe('binding matching', () => {
  it('matches exact modifier sets and the normalized key', () => {
    const binding: ShortcutPreference = { kind: 'key', modifiers: ['primary'], key: 's' }
    expect(matches(event({ key: 's', ctrlKey: true }), binding)).toBe(true)
    expect(matches(event({ key: 's', metaKey: true }), binding)).toBe(true)
    expect(matches(event({ key: 'S', ctrlKey: true }), binding)).toBe(true)
    expect(matches(event({ key: 't', ctrlKey: true }), binding)).toBe(false)
    // A bare key never matches a chord and a chord never matches a bare key.
    expect(matches(event({ key: 's' }), binding)).toBe(false)
    expect(matches(event({ key: 'Escape', ctrlKey: true }), { kind: 'key', modifiers: [], key: 'Escape' })).toBe(false)
    expect(matches(event({ key: 'Escape' }), { kind: 'key', modifiers: [], key: 'Escape' })).toBe(true)
    // Extra modifiers are not ignored.
    expect(matches(event({ key: 's', ctrlKey: true, shiftKey: true }), binding)).toBe(false)
    // An unbound preference never matches.
    expect(matches(event({ key: 'Escape' }), { kind: 'none' })).toBe(false)
  })
})

describe('binding display', () => {
  it('formats named keys and modifier chords for the settings row', () => {
    expect(keyLabel('Escape')).toBe('Esc')
    expect(keyLabel(' ')).toBe('Space')
    expect(keyLabel('Enter')).toBe('Enter')
    expect(keyLabel('Tab')).toBe('Tab')
    expect(keyLabel('Backspace')).toBe('Backspace')
    expect(keyLabel('Delete')).toBe('Delete')
    expect(keyLabel('s')).toBe('S')
    expect(keyLabel('F5')).toBe('F5')
    expect(formatBinding({ kind: 'key', modifiers: [], key: 'Escape' })).toBe('Esc')
    expect(formatBinding({ kind: 'key', modifiers: ['primary'], key: 's' })).toBe('Ctrl/Cmd+S')
    expect(formatBinding({ kind: 'key', modifiers: ['primary', 'shift'], key: 'e' })).toBe('Ctrl/Cmd+Shift+E')
    // The same gesture split per keycap for the settings row's keycap cluster.
    expect(bindingParts({ kind: 'key', modifiers: [], key: 'Escape' }))
      .toEqual([{ kind: 'key', key: 'Escape' }])
    expect(bindingParts({ kind: 'key', modifiers: ['primary'], key: 's' }))
      .toEqual([{ kind: 'modifier', modifier: 'primary' }, { kind: 'key', key: 's' }])
    expect(bindingParts({ kind: 'key', modifiers: ['primary', 'shift'], key: 'e' }))
      .toEqual([
        { kind: 'modifier', modifier: 'primary' },
        { kind: 'modifier', modifier: 'shift' },
        { kind: 'key', key: 'e' },
      ])
    // The locale-free legends the row falls back to.
    expect(partLabel({ kind: 'key', modifiers: [], key: 'Escape' })).toBe('Esc')
    expect(partLabel({ kind: 'modifier', modifier: 'primary' })).toBe('Ctrl/Cmd')
    expect(partLabel({ kind: 'mouse', modifiers: [], button: 1 })).toBe('Middle')
    expect(partLabel({ kind: 'mouse', modifiers: [], button: 2 })).toBe('Right')
  })

  it('compares preferences structurally, including both-unbound', () => {
    const a: ShortcutPreference = { kind: 'key', modifiers: ['primary'], key: 's' }
    expect(equalPreference(a, { kind: 'key', modifiers: ['primary'], key: 's' })).toBe(true)
    expect(equalPreference(a, { kind: 'key', modifiers: [], key: 's' })).toBe(false)
    expect(equalPreference(a, { kind: 'key', modifiers: ['primary'], key: 't' })).toBe(false)
    expect(equalPreference({ kind: 'none' }, { kind: 'none' })).toBe(true)
    expect(equalPreference(a, { kind: 'none' })).toBe(false)
  })

  it('treats modifier keys as non-binding keys', () => {
    expect(isBindingKey(event({ key: 'Control', ctrlKey: true }))).toBe(false)
    expect(isBindingKey(event({ key: 'Meta' }))).toBe(false)
    expect(isBindingKey(event({ key: 'Alt' }))).toBe(false)
    expect(isBindingKey(event({ key: 'Shift' }))).toBe(false)
    expect(isBindingKey(event({ key: 'x' }))).toBe(true)
  })
})

describe('mouse bindings', () => {
  function mousedown(init: MouseEventInit): MouseEvent {
    return new MouseEvent('mousedown', init)
  }

  it('snapshots a bindable button and refuses the primary and reserved ones', () => {
    expect(mouseBindingOfEvent(mousedown({ button: 1 }))).toEqual({ kind: 'mouse', modifiers: [], button: 1 })
    expect(mouseBindingOfEvent(mousedown({ button: 2, ctrlKey: true, shiftKey: true })))
      .toEqual({ kind: 'mouse', modifiers: ['primary', 'shift'], button: 2 })
    // The primary button and the browser-reserved back/forward buttons never bind.
    expect(mouseBindingOfEvent(mousedown({ button: 0 }))).toBeNull()
    expect(mouseBindingOfEvent(mousedown({ button: 3 }))).toBeNull()
    expect(isBindingButton(1)).toBe(true)
    expect(isBindingButton(2)).toBe(true)
    expect(isBindingButton(0)).toBe(false)
    expect(isBindingButton(4)).toBe(false)
  })

  it('matches a mouse preference exactly, and never across gesture kinds', () => {
    const binding: ShortcutPreference = { kind: 'mouse', modifiers: [], button: 1 }
    expect(matchesMouse(mousedown({ button: 1 }), binding)).toBe(true)
    expect(matchesMouse(mousedown({ button: 2 }), binding)).toBe(false)
    // Extra modifiers are not ignored.
    expect(matchesMouse(mousedown({ button: 1, ctrlKey: true }), binding)).toBe(false)
    expect(matchesMouse(mousedown({ button: 1 }), { kind: 'none' })).toBe(false)
    // A mouse binding never answers a keydown, and a key chord never answers a mouse event.
    expect(matchesMouse(mousedown({ button: 1 }), { kind: 'key', modifiers: [], key: 'Escape' })).toBe(false)
    expect(matches(event({ key: 'Escape' }), binding)).toBe(false)
  })

  it('formats mouse gestures and compares them structurally', () => {
    expect(bindingParts({ kind: 'mouse', modifiers: [], button: 1 })).toEqual([{ kind: 'mouse', button: 1 }])
    expect(bindingParts({ kind: 'mouse', modifiers: ['primary'], button: 2 }))
      .toEqual([{ kind: 'modifier', modifier: 'primary' }, { kind: 'mouse', button: 2 }])
    expect(formatBinding({ kind: 'mouse', modifiers: [], button: 1 })).toBe('Middle')
    // The settings row passes its translator: the mouse word is the one slot a
    // locale owns, so the same binding reads "中键" there.
    expect(formatBinding(
      { kind: 'mouse', modifiers: ['primary'], button: 1 },
      part => part.kind === 'mouse' ? '中键' : partLabel(part),
    )).toBe('Ctrl/Cmd+中键')
    expect(equalPreference({ kind: 'mouse', modifiers: [], button: 1 }, { kind: 'mouse', modifiers: [], button: 1 })).toBe(true)
    expect(equalPreference({ kind: 'mouse', modifiers: [], button: 1 }, { kind: 'mouse', modifiers: [], button: 2 })).toBe(false)
    expect(equalPreference({ kind: 'mouse', modifiers: ['primary'], button: 1 }, { kind: 'mouse', modifiers: [], button: 1 })).toBe(false)
    // Gesture kinds are never interchangeable.
    expect(equalPreference({ kind: 'mouse', modifiers: [], button: 1 }, { kind: 'key', modifiers: [], key: 'Escape' })).toBe(false)
  })
})
