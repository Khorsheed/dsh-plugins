/**
 * local-agent-claude-code dictionaries: zh is the key-set source of truth and
 * en must mirror it exactly.
 */
import { describe, expect, it } from 'vitest'
import { en, NS, zh } from '../src/client/locales.ts'

describe('local-agent-claude-code locales', () => {
  it('owns the settings namespace it binds', () => {
    expect(NS).toBe('local-agent-claude-code')
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
