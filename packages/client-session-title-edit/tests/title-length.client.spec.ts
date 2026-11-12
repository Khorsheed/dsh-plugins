/**
 * session-title-edit title-length helpers: UTF-8 byte counting, the host-
 * faithful cleaned length the over-limit gate measures, and the pinned host
 * byte cap.
 */
import { describe, expect, it } from 'vitest'
import { MAX_TITLE_BYTES, normalizedTitleByteLength, utf8ByteLength } from '../src/client/title-length.ts'

describe('utf8ByteLength', () => {
  it('counts encoded bytes, not characters', () => {
    expect(utf8ByteLength('')).toBe(0)
    expect(utf8ByteLength('hello')).toBe(5)
    expect(utf8ByteLength('你好')).toBe(6)
    expect(utf8ByteLength('😀')).toBe(4)
  })
})

describe('normalizedTitleByteLength', () => {
  it('trims and collapses whitespace exactly like the host clean step', () => {
    expect(normalizedTitleByteLength('  a  b  ')).toBe(3) // 'a b'
    expect(normalizedTitleByteLength('   ')).toBe(0)
    expect(normalizedTitleByteLength('你好世界')).toBe(12)
  })

  it('strips escape and control sequences the host would strip', () => {
    expect(normalizedTitleByteLength('\u001B[31mred\u001B[0m')).toBe(3) // 'red'
    expect(normalizedTitleByteLength('a\u200Bb')).toBe(2) // zero-width space removed
    expect(normalizedTitleByteLength('a\u0000b')).toBe(2)
  })
})

describe('MAX_TITLE_BYTES', () => {
  it('pins the host production default of 80 UTF-8 bytes', () => {
    expect(MAX_TITLE_BYTES).toBe(80)
    // 26 CJK chars fit (78 bytes); 27 exceed (81).
    expect(normalizedTitleByteLength('汉'.repeat(26))).toBeLessThanOrEqual(MAX_TITLE_BYTES)
    expect(normalizedTitleByteLength('汉'.repeat(27))).toBeGreaterThan(MAX_TITLE_BYTES)
  })
})
