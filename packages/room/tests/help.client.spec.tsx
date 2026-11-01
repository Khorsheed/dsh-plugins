// @vitest-environment jsdom
/** Cross-session help rows: the thread folds its messages and state in place; the helper's card names the asking room. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { roomHelpDefinition, roomHelpInDefinition, roomHelpReplyDefinition, roomHelpRequestDefinition, type RoomHelpData, type RoomHelpReplyData, type RoomHelpRequestData } from '../src/client/nodes.ts'
import { RoomHelpReplyView, RoomHelpRequestView, RoomHelpView } from '../src/client/RoomHelpView.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomHelpReplyViewProps, RoomHelpRequestViewProps, RoomHelpViewProps } from '../src/client/slots.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as RoomHelpViewProps['t']
const ev = (seq: number, type: string, data: unknown, extra: object = {}) => ({ seq, time: 1000 + seq, type, data, ...extra }) as never

describe('room-help', () => {
  it('folds the thread\'s messages and state into one row', () => {
    const opened = ev(5, 'room/help', { id: 'h1', from: 'm', fromName: 'dsh', target: { sessionId: 's-a', title: '开发剪辑插件' }, text: '导出报错' })
    expect(roomHelpDefinition.match(opened)).toEqual({ id: 'h1', role: 'start' })
    expect(roomHelpDefinition.match(ev(6, 'room/help-state', { help: 'h1', state: 'running' }))).toEqual({ id: 'h1', role: 'update' })
    let state = roomHelpDefinition.start({} as never, { event: opened, role: 'start' } as never, undefined as never) as RoomHelpData
    for (const event of [
      ev(6, 'room/help-state', { help: 'h1', state: 'failed', error: 'x' }),
      ev(7, 'room/help-state', { help: 'h1', state: 'running' }),
      ev(8, 'room/help-message', { help: 'h1', kind: 'reply', text: '已修', handoff: '分支 fix/x' }),
      ev(9, 'room/help-state', { help: 'h1', state: 'replied' }),
    ]) state = roomHelpDefinition.update({ state } as never, { event, role: 'update' } as never) as RoomHelpData
    expect(state.help).toMatchObject({ state: 'replied', messages: [{ kind: 'reply', text: '已修' }] })
    expect(state.help.error).toBeUndefined()

    const openSession = vi.fn()
    render(<RoomHelpView {...{ node: { data: state }, openSession, t } as unknown as RoomHelpViewProps} />)
    expect(screen.getByText('dsh 向「开发剪辑插件」求助')).toBeDefined()
    expect(screen.getByText('已回信')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '看求助内容' }))
    expect(screen.getByText('导出报错')).toBeDefined()
    expect(screen.getByText('分支 fix/x')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '打开对方会话 →' }))
    expect(openSession).toHaveBeenCalledWith('s-a')
  })
})

describe('room-help reply row', () => {
  it('marks where the answer is handed back to the member, with the answer one click away', () => {
    const handBack = ev(20, 'room/dispatch', { id: 'd', origin: 'report', reportFor: 'help:h1', targets: ['人物建模大师'], text: '[Help reply …]' })
    expect(roomHelpReplyDefinition.match(handBack)).toEqual({ id: '20', role: 'start' })
    // Ordinary reports and the member-to-member rows are not its.
    expect(roomHelpReplyDefinition.match(ev(21, 'room/dispatch', { id: 'e', origin: 'report', reportFor: 'run:x', targets: ['a'], text: 'x' }))).toBeNull()
    expect(roomHelpReplyDefinition.match(ev(22, 'room/help-message', { help: 'h1', kind: 'reply', text: 'x' }))).toBeNull()
    const data = roomHelpReplyDefinition.start({} as never, { event: handBack, role: 'start' } as never, undefined as never) as RoomHelpReplyData
    expect(data).toMatchObject({ help: 'h1', member: '人物建模大师' })
    const help = {
      id: 'h1', from: 'm', fromName: '人物建模大师', target: { sessionId: 's-a', title: '与尼尔盖曼共创《潜梦者》', room: true, member: '尼尔盖曼' }, text: 'q',
      state: 'replied', since: 0, time: 0,
      messages: [{ help: 'h1', kind: 'question', text: '先问一句', time: 1005 }, { help: 'h1', kind: 'reply', text: '设定如下', handoff: '见附件', time: 1019 }],
    }
    const cached = { helps: [help] }
    const roomStore = { subscribe: () => () => {}, getCached: () => cached }
    const openSession = vi.fn()
    render(<RoomHelpReplyView {...{ node: { data }, sessionId: 'room', roomStore, openSession, t } as unknown as RoomHelpReplyViewProps} />)
    expect(screen.getByText('尼尔盖曼 回信了，交给 人物建模大师 继续')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '看回信' }))
    expect(screen.getByText('设定如下')).toBeDefined()
    expect(screen.queryByText('先问一句')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开对方会话 →' }))
    expect(openSession).toHaveBeenCalledWith('s-a')
  })

  it('a follow-up question reads as one, and a plain session goes by its title', () => {
    const help = { id: 'h2', from: 'm', fromName: 'dsh', target: { sessionId: 's-b', title: '开发剪辑插件' }, text: 'q', state: 'asking', since: 0, time: 0,
      messages: [{ help: 'h2', kind: 'question', text: '要哪个分支？', time: 1009 }] }
    const cached = { helps: [help] }
    const roomStore = { subscribe: () => () => {}, getCached: () => cached }
    render(<RoomHelpReplyView {...{ node: { data: { seq: 10, time: 1010, help: 'h2', member: 'dsh' } }, sessionId: 'room', roomStore, openSession: vi.fn(), t } as unknown as RoomHelpReplyViewProps} />)
    expect(screen.getByText('「开发剪辑插件」 追问 dsh')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '看追问' }))
    expect(screen.getByText('要哪个分支？')).toBeDefined()
  })
})

describe('room-help reminder', () => {
  it('turns amber with the minutes waited once an unanswered request passes the room\'s reminder', () => {
    const help = { id: 'h1', from: 'm', fromName: 'dsh', target: { sessionId: 's-a', title: 'A' }, text: 'x', state: 'queued', since: Date.now() - 41 * 60_000, messages: [], time: 0 }
    const cached = { settings: { helpReminderMinutes: 40 } }
    const roomStore = { subscribe: () => () => {}, getCached: () => cached }
    const { container, rerender } = render(<RoomHelpView {...{ node: { data: { seq: 1, time: 0, help } }, sessionId: 'room', roomStore, openSession: vi.fn(), t } as unknown as RoomHelpViewProps} />)
    expect(container.querySelector('[data-overdue]')).not.toBeNull()
    expect(screen.getByText(/已等 41 分钟/)).toBeDefined()
    rerender(<RoomHelpView {...{ node: { data: { seq: 1, time: 0, help: { ...help, state: 'replied' } } }, sessionId: 'room', roomStore, openSession: vi.fn(), t } as unknown as RoomHelpViewProps} />)
    expect(container.querySelector('[data-overdue]')).toBeNull()
  })
})

describe('room-help third-ask hint', () => {
  it('suggests keeping a plain session on the member list once, under its third answered ask', () => {
    const ask = (id: string) => ({ id, from: 'm', fromName: 'dsh', target: { sessionId: 's-a', title: 'A' }, text: id, state: 'replied', since: 0, messages: [], time: 0 })
    const helps = [ask('h1'), ask('h2'), ask('h3')]
    const cached = { helps }
    const roomStore = { subscribe: () => () => {}, getCached: () => cached }
    const linkSession = vi.fn()
    const dismissNudge = vi.fn()
    const view = (help: (typeof helps)[number]) => <RoomHelpView {...{ node: { data: { seq: 1, time: 0, help } }, sessionId: 'room', roomStore, openSession: vi.fn(), linkSession, dismissNudge, t } as unknown as RoomHelpViewProps} />
    const { rerender } = render(view(helps[1]!))
    expect(screen.queryByText(/要不要加入房间成员/)).toBeNull()
    rerender(view(helps[2]!))
    expect(screen.getByText('已经向它求助 3 次了，要不要加入房间成员？')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '加入房间成员' }))
    expect(linkSession).toHaveBeenCalledWith('s-a', 'A')
    fireEvent.click(screen.getByRole('button', { name: '不用了' }))
    expect(dismissNudge).toHaveBeenCalledWith('s-a')
  })
})

describe('room-help-in', () => {
  it('shows another room\'s request with the member it went to and a held tag', () => {
    const event = ev(4, 'room/help-in', { id: 'h1', room: 'room-y', roomTitle: '剪辑第 3 期', from: 'dsh', member: '游戏大师', text: '帮忙', op: 'request', held: true })
    expect(roomHelpInDefinition.match(event)).toEqual({ id: '4', role: 'start' })
    const data = roomHelpInDefinition.start({} as never, { event, role: 'start' } as never, undefined as never) as RoomHelpRequestData
    render(<RoomHelpRequestView {...{ node: { data }, openSession: vi.fn(), t } as unknown as RoomHelpRequestViewProps} />)
    expect(screen.getByText(/来自协作间「剪辑第 3 期」· dsh 的求助/).textContent).toContain('→ 交给 游戏大师')
    expect(screen.getByText('房间暂停中，恢复后处理')).toBeDefined()
  })
})

describe('room-help-request', () => {
  it('claims only room-help messages and renders the asking room with a way back', () => {
    const source = { kind: 'room-help', plugin: '@khorsheed/dsh-room', help: 'h1', room: 'room-y', roomTitle: '剪辑第 3 期', from: 'dsh', op: 'request', text: '导出时报 segment too short' }
    const message = ev(3, 'user/message', { id: 'm', content: [{ type: 'text', text: '[Help request …]' }], source }, { surfaceOp: 'append' })
    expect(roomHelpRequestDefinition.match(message)).toEqual({ id: '3', role: 'start' })
    expect(roomHelpRequestDefinition.match(ev(4, 'user/message', { id: 'u', content: [], source: { kind: 'user' } }, { surfaceOp: 'append' }))).toBeNull()
    const data = roomHelpRequestDefinition.start({} as never, { event: message, role: 'start' } as never, undefined as never) as RoomHelpRequestData
    const openSession = vi.fn()
    render(<RoomHelpRequestView {...{ node: { data }, openSession, t } as unknown as RoomHelpRequestViewProps} />)
    expect(screen.getByText('来自协作间「剪辑第 3 期」· dsh 的求助')).toBeDefined()
    expect(screen.getByText('导出时报 segment too short')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '回到协作间 →' }))
    expect(openSession).toHaveBeenCalledWith('room-y')
  })
})
