// @vitest-environment jsdom
/** Cross-session help rows: the thread folds its messages and state in place; the helper's card names the asking room. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { roomHelpDefinition, roomHelpInDefinition, roomHelpRequestDefinition, type RoomHelpData, type RoomHelpRequestData } from '../src/client/nodes.ts'
import { RoomHelpRequestView, RoomHelpView } from '../src/client/RoomHelpView.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomHelpRequestViewProps, RoomHelpViewProps } from '../src/client/slots.ts'

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
