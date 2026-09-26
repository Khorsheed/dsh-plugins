/**
 * Built-in preset display names: the four shipped presets publish no name, so
 * their copy must resolve through the host's locale keys — never the raw id —
 * while a user-authored preset keeps the name it published. Pins the fold's
 * three branches against both dictionaries.
 */
import { describe, expect, it } from 'vitest'
import { presetName } from '../src/client/preset-display.ts'
import { en, zh } from '../src/client/locales.ts'

const tZh = (key: keyof typeof zh): string => zh[key]
const tEn = (key: keyof typeof en): string => en[key]

describe('presetName', () => {
  it('localizes a shipped preset that publishes no name', () => {
    expect(presetName({ id: 'standard' }, tZh)).toBe('标准模式')
    expect(presetName({ id: 'cordis' }, tEn)).toBe('Creator mode')
  })

  it('keeps a user-authored preset’s published name in every locale', () => {
    expect(presetName({ id: 'dev', name: '开发模式' }, tZh)).toBe('开发模式')
    expect(presetName({ id: 'dev', name: '开发模式' }, tEn)).toBe('开发模式')
  })

  it('falls back to the id for a nameless preset the host does not ship', () => {
    expect(presetName({ id: 'custom-lab' }, tZh)).toBe('custom-lab')
  })

  it('ignores a published name that collides with a shipped id (the declaration owns its copy)', () => {
    expect(presetName({ id: 'standard', name: '我的标准' }, tZh)).toBe('我的标准')
  })
})
