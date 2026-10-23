// @vitest-environment jsdom
/** The in-card removal confirmation and the impact it reads from room state. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RemoveMemberConfirm, removalImpact } from '../src/client/RemoveMemberConfirm.tsx'
import { zh } from '../src/client/locales.ts'
import type { MembersViewProps } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as MembersViewProps['t']

const BUSY: RoomState = {
  members: [
    { id: 'm-dsh', name: 'dsh', kind: 'main-agent', invitedBy: 'human' },
    { id: 'm-ada', name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', childSessionId: 'child-1' as SessionId },
    { id: 'm-bill', name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'human' },
  ],
  relays: [],
  runs: [{ member: 'ada', state: 'running', startedAt: 1, runId: '5:m-ada' }],
  deliveries: [
    { id: '5:m-ada', dispatchSeq: 5, memberId: 'm-ada', status: 'running', origin: 'coordinator', replyTo: 'm-dsh', text: '补迁移脚本' },
    { id: '7:m-ada', dispatchSeq: 7, memberId: 'm-ada', status: 'queued', origin: 'human', text: '再看一下' },
    { id: '8:m-ada', dispatchSeq: 8, memberId: 'm-ada', status: 'queued', origin: 'coordinator', replyTo: 'm-bill', text: '对一下接口' },
  ],
  tasks: [],
}

describe('removalImpact', () => {
  it('reads the running work, queued messages and who waits for a report', () => {
    expect(removalImpact(BUSY, BUSY.members[1]!)).toEqual({
      running: '补迁移脚本', queued: 2, waiting: ['dsh', 'bill'],
    })
  })

  it('an idle member with nothing open has no impact', () => {
    expect(removalImpact(BUSY, BUSY.members[2]!)).toEqual({ running: undefined, queued: 0, waiting: [] })
  })
})

describe('RemoveMemberConfirm', () => {
  it('lists every consequence and stops-and-removes', async () => {
    const onConfirm = vi.fn(async () => {})
    render(<RemoveMemberConfirm member={BUSY.members[1]!} impact={removalImpact(BUSY, BUSY.members[1]!)} coordinator={false}
      onConfirm={onConfirm} onCancel={() => {}} t={t} />)
    screen.getByText('正在运行「补迁移脚本」，会先停止')
    screen.getByText('2 条排队中的消息将取消')
    screen.getByText('dsh、bill 在等它的回报，会收到「未完成：已移除」')
    fireEvent.click(screen.getByRole('button', { name: '停止并移除' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('an idle member gets one sentence', () => {
    render(<RemoveMemberConfirm member={BUSY.members[2]!} impact={removalImpact(BUSY, BUSY.members[2]!)} coordinator={false}
      onConfirm={async () => {}} onCancel={() => {}} t={t} />)
    screen.getByText('它现在空闲，没有排队的消息和未完成的任务。')
    screen.getByRole('button', { name: '移除' })
  })

  it('the coordinator is explained, never offered a removal that would fail', () => {
    const onCancel = vi.fn()
    render(<RemoveMemberConfirm member={BUSY.members[1]!} impact={removalImpact(BUSY, BUSY.members[1]!)} coordinator
      onConfirm={async () => {}} onCancel={onCancel} t={t} />)
    expect(screen.queryByRole('button', { name: '停止并移除' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Escape and an outside click cancel', () => {
    const onCancel = vi.fn()
    render(<RemoveMemberConfirm member={BUSY.members[2]!} impact={removalImpact(BUSY, BUSY.members[2]!)} coordinator={false}
      onConfirm={async () => {}} onCancel={onCancel} t={t} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
