/** A tool_use input's mirrored arguments: one scalar when it names the call, whole JSON when it is structured. */
import { describe, expect, it } from 'vitest'
import { inputDetail } from '../src/claude-cli-provider.ts'

describe('inputDetail', () => {
  it('keeps a structured input whole and parseable (a member\'s ask_user_question)', () => {
    const input = { questions: [{ id: 'god', header: '神祇', question: '第一批你希望先深化哪一组神灵？这一段问题文字足够长，会超过以前 160 个字符的截断长度', options: [{ label: '阿努比斯、托特、玛阿特（推荐）', description: '冥界引路、文字、审判' }, { label: '拉、荷鲁斯、伊西斯' }] }] }
    expect(JSON.parse(inputDetail(input)!)).toEqual(input)
    expect(inputDetail({ command: 'ls -la' })).toBe('ls -la')
    expect(inputDetail({ prompt: 'x'.repeat(400) })!.length).toBe(161)
  })
})
