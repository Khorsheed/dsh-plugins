// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  bindingOfEvent, bindingParts, equalPreference, formatBinding, isBindingKey, keyLabel, matches, normalizeKey,
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
    // The same labels split per keycap for the settings row's keycap cluster.
    expect(bindingParts({ kind: 'key', modifiers: [], key: 'Escape' })).toEqual(['Esc'])
    expect(bindingParts({ kind: 'key', modifiers: ['primary'], key: 's' })).toEqual(['Ctrl/Cmd', 'S'])
    expect(bindingParts({ kind: 'key', modifiers: ['primary', 'shift'], key: 'e' })).toEqual(['Ctrl/Cmd', 'Shift', 'E'])
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
