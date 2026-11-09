import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { formatMessageClock } from '../src/client/format.ts'
import { en, zh } from '../src/client/locales.ts'
import type { RoomSpeechViewProps } from '../src/client/slots.ts'

const NOW = new Date(2026, 10, 8, 13, 47).getTime()
const translate = (locale: Record<string, string>): RoomSpeechViewProps['t'] => makeTranslate(locale) as unknown as RoomSpeechViewProps['t']

describe('formatMessageClock', () => {
  it('keeps a same-day message clock compact', () => {
    expect(formatMessageClock(new Date(2026, 10, 8, 9, 5).getTime(), translate(zh), NOW)).toBe('09:05')
  })

  it('prefixes month and day earlier in the same year', () => {
    expect(formatMessageClock(new Date(2026, 9, 10, 13, 47).getTime(), translate(zh), NOW)).toBe('10月10日 13:47')
  })

  it('prefixes the year across calendar years', () => {
    expect(formatMessageClock(new Date(2025, 11, 31, 9, 5).getTime(), translate(zh), NOW)).toBe('2025年12月31日 09:05')
  })

  it('uses the host date templates in English', () => {
    expect(formatMessageClock(new Date(2026, 9, 10, 13, 47).getTime(), translate(en), NOW)).toBe('10/10 13:47')
    expect(formatMessageClock(new Date(2025, 11, 31, 9, 5).getTime(), translate(en), NOW)).toBe('2025-12-31 09:05')
  })
})
