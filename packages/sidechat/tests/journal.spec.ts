/**
 * The transcript projection: a side-chat session's journal folds into user
 * and assistant text rows plus one-line tool statuses — the same fold over a
 * live snapshot and a cold read, which is what restart-complete history
 * hangs on.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { messageTextOf, projectTranscript } from '../src/journal.ts'

/** A bare event envelope for the fold (seq/time/data are all it reads). */
function event<T extends Record<string, unknown>>(type: string, time: number, data: T): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

const USER = (text: string, time = 1) => event('user/message', time, {
  id: `u${time}`,
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin: '@khorsheed/dsh-sidechat' },
})

const ASSISTANT = (text: string, time = 2, extra: readonly unknown[] = []) => event('assistant/message', time, {
  turn: 1,
  step: 1,
  message: {
    id: `a${time}`,
    role: 'assistant',
    content: [{ type: 'text', text }, ...extra],
    source: { kind: 'model', provider: 'p', model: 'm' },
  },
  stream: [],
})

describe('messageTextOf', () => {
  it('joins text blocks and skips reasoning, file, and tool blocks', () => {
    expect(messageTextOf([
      { type: 'reasoning', text: '想一下' } as never,
      { type: 'text', text: '第一段' },
      { type: 'file', attachment: {} } as never,
      { type: 'text', text: '第二段' },
    ])).toBe('第一段\n第二段')
  })
})

describe('projectTranscript', () => {
  it('projects user and assistant text in log order', () => {
    const rows = projectTranscript([
      USER('你好', 1),
      ASSISTANT('你好，有什么可以帮你？', 2),
      USER('引用这句话', 3),
    ])
    expect(rows).toEqual([
      { kind: 'user', text: '你好', refs: [], time: 1 },
      { kind: 'assistant', text: '你好，有什么可以帮你？', time: 2 },
      { kind: 'user', text: '引用这句话', refs: [], time: 3 },
    ])
  })

  it('lifts our own folded refs back out of user messages (chips, not markup)', () => {
    const folded = '<quoted_context label="第一条">\n引用一\n</quoted_context>\n\n'
      + '<quoted_context label="带\\"引号\\"">\n引用二\n</quoted_context>\n\n怎么看？'
    const rows = projectTranscript([USER(folded, 1)])
    expect(rows).toEqual([{
      kind: 'user',
      text: '怎么看？',
      refs: [{ label: '第一条', text: '引用一' }, { label: '带"引号"', text: '引用二' }],
      time: 1,
    }])
  })

  it('leaves a stray quoted_context marker mid-body verbatim (only the leading run parses)', () => {
    const rows = projectTranscript([USER('前文 <quoted_context label="x">\n不是引用\n</quoted_context> 后文', 1)])
    expect(rows).toEqual([{ kind: 'user', text: '前文 <quoted_context label="x">\n不是引用\n</quoted_context> 后文', refs: [], time: 1 }])
  })

  it('skips messages whose visible text is empty and every other event type', () => {
    const rows = projectTranscript([
      event('turn/start', 1, { turn: 1 }),
      event('system/message', 2, { turn: 1, step: 1, message: { id: 's', role: 'system', content: [{ type: 'text', text: 'sys' }], source: { kind: 'plugin', plugin: 'p' } } }),
      USER('  ', 3),
      ASSISTANT('', 4, [{ type: 'reasoning', text: '只在想' }]),
      USER('问', 5),
    ])
    expect(rows).toEqual([{ kind: 'user', text: '问', refs: [], time: 5 }])
  })

  it('folds a tool call and its result into one one-line status', () => {
    const rows = projectTranscript([
      USER('读一下 a.ts', 1),
      event('tool/call', 2, { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' }),
      event('tool/result', 3, { turn: 1, step: 1, message: { id: 'r1', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }], source: { kind: 'tool', tool: 'read' } } }),
      ASSISTANT('读完了', 4),
    ])
    expect(rows).toEqual([
      { kind: 'user', text: '读一下 a.ts', refs: [], time: 1 },
      { kind: 'tool', name: 'read', state: 'done', time: 2 },
      { kind: 'assistant', text: '读完了', time: 4 },
    ])
  })

  it('marks a result carrying an error identity or an isError block as error', () => {
    const rows = projectTranscript([
      event('tool/call', 1, { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{}' }),
      event('tool/result', 2, {
        turn: 1, step: 1,
        message: { id: 'r1', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [], isError: true }], source: { kind: 'tool', tool: 'write' } },
        error: { name: 'FsError', code: 'FS_SANDBOX_DENIED' },
      }),
      event('tool/call', 3, { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{}' }),
      event('tool/result', 4, { turn: 1, step: 1, message: { id: 'r2', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c2', content: [], isError: true }], source: { kind: 'tool', tool: 'read' } } }),
    ])
    expect(rows).toEqual([
      { kind: 'tool', name: 'write', state: 'error', time: 1 },
      { kind: 'tool', name: 'read', state: 'error', time: 3 },
    ])
  })

  it('keeps an unanswered call running and skips an orphan result', () => {
    const rows = projectTranscript([
      event('tool/call', 1, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
      event('tool/result', 2, { turn: 1, step: 1, message: { id: 'r0', role: 'user', content: [{ type: 'tool-result', toolCallId: 'unknown', content: [] }], source: { kind: 'tool', tool: 'bash' } } }),
    ])
    expect(rows).toEqual([{ kind: 'tool', name: 'bash', state: 'running', time: 1 }])
  })
})
