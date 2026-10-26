/** The coordinator handoff text: the conversation as it happened, without the reports that repeat a reply. */
import { describe, expect, it } from 'vitest'
import { handoffText } from '../src/index.ts'
import type { RoomState } from '../src/types.ts'

const ev = (seq: number, type: string, data: unknown) => ({ seq, time: seq, type, data }) as never

describe('handoffText', () => {
  it('names the handover, the goal and the open tasks, and replays no conversation', () => {
    const state = {
      members: [{ id: 'm-dsh', name: 'dsh', kind: 'main-agent' }, { id: 'm-kimi', name: 'kimi', kind: 'cli' }, { id: 'm-cc', name: 'claude-code', kind: 'cli' }],
      relays: [], tasks: [], runs: [], goal: '登录上线',
      jobs: [{ id: 'u1', number: 1, title: '打招呼', status: 'running' }],
    } as unknown as RoomState
    const events = [
      ev(1, 'room/member-added', { id: 'm-kimi', name: 'kimi' }),
      ev(2, 'user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: '让大家打招呼' }], source: { kind: 'user' } }),
      ev(3, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'reasoning', text: '想一想' }, { type: 'tool-call', id: 'c', name: 'room_message', arguments: '{}' }] } }),
      ev(4, 'room/dispatch', { targets: ['kimi'], text: '打个招呼', origin: 'coordinator', replyTo: 'm-dsh' }),
      ev(5, 'room/speech', { member: 'kimi', text: '大家好，我是 Kimi' }),
      ev(6, 'room/dispatch', { targets: ['dsh'], text: '大家好，我是 Kimi', origin: 'report' }),
      ev(7, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'kimi 打过招呼了' }] } }),
    ]
    const text = handoffText(events, state, 'room-1', 'dsh', 'claude-code')
    expect(text).toContain('【协调者交接】dsh 把协调者交给了你（claude-code）')
    expect(text).toContain('房间目标：登录上线')
    expect(text).toContain('进行中的任务 1（进行中）：打招呼')
    expect(text).not.toContain('让大家打招呼')
    expect(text).not.toContain('大家好，我是 Kimi')
    expect(text).toContain('之前的对话没有附上')
  })
})
