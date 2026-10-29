/**
 * Escaped line breaks from CLI members (the K3 / Kimi route): a string with
 * no real line break but a literal `\n` is unescaped; one that already holds
 * a real line break keeps its backslashes (a path, a regex, code).
 */
import { describe, expect, it } from 'vitest'
import { unescapeDeep, unescapeLineBreaks } from '../src/text-escapes.ts'

describe('unescapeLineBreaks', () => {
  it('restores escaped breaks in a string that has none of its own', () => {
    expect(unescapeLineBreaks('状态：暂定。\\n场景可以恢复\\r\\n亲历不能撤销\\t。')).toBe('状态：暂定。\n场景可以恢复\n亲历不能撤销\t。')
  })

  it('leaves a string with real breaks, or no escapes, alone', () => {
    expect(unescapeLineBreaks('第一行\n路径 C:\\new\\notes')).toBe('第一行\n路径 C:\\new\\notes')
    expect(unescapeLineBreaks('没有转义')).toBe('没有转义')
  })

  it('reaches every string inside field values', () => {
    expect(unescapeDeep({ 身份: '标注员\\n山海梦', 标签: ['a\\nb'], 年龄: 30 })).toEqual({ 身份: '标注员\n山海梦', 标签: ['a\nb'], 年龄: 30 })
  })
})
