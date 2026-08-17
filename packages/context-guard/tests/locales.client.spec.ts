/**
 * context-guard dictionaries: zh is the key-set source of truth and en must
 * mirror it exactly.
 */
import { describe, expect, it } from 'vitest'
import { en, NS, zh } from '../src/client/locales.ts'

describe('context-guard locales', () => {
  it('owns a dedicated namespace', () => {
    expect(NS).toBe('context-guard')
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('covers the button surface', () => {
    expect(zh['button.label']).toBe('压缩')
    expect(en['button.label']).toBe('compact')
  })
})
