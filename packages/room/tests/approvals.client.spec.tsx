// @vitest-environment jsdom
/** The member tool approval line: the definition folds the answer in place; the buttons answer once. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { roomApprovalDefinition, type RoomApprovalData } from '../src/client/nodes.ts'
import { RoomApprovalView } from '../src/client/RoomApprovalView.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomApprovalViewProps } from '../src/client/slots.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as RoomApprovalViewProps['t']
const ev = (seq: number, type: string, data: unknown) => ({ seq, time: 1000 + seq, type, data }) as never

describe('room-approval', () => {
  it('starts pending and folds the answer in place', () => {
    const asked = ev(3, 'room/approval', { id: 'p1', member: 'coco', memberId: 'm', tool: 'video_render', reason: '导出视频' })
    expect(roomApprovalDefinition.match(asked)).toEqual({ id: 'p1', role: 'start' })
    const started = roomApprovalDefinition.start({} as never, { event: asked, role: 'start' } as never, undefined as never)
    expect(started).toMatchObject({ approvalId: 'p1', member: 'coco', tool: 'video_render', state: 'pending' })
    const done = roomApprovalDefinition.update({ state: started } as never, { event: ev(4, 'room/approval-resolved', { id: 'p1', outcome: 'rejected' }), role: 'update' } as never)
    expect(done.state).toBe('rejected')
  })

  it('answers through the buttons and shows the outcome once resolved', async () => {
    const answerApproval = vi.fn(async () => undefined)
    const data: RoomApprovalData = { seq: 3, time: 1003, approvalId: 'p1', member: 'coco', tool: 'video_render', state: 'pending' }
    const { rerender } = render(<RoomApprovalView {...{ node: { data }, answerApproval, t } as unknown as RoomApprovalViewProps} />)
    expect(screen.getByText(/coco 要你确认：调用 video_render/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    await vi.waitFor(() => expect(answerApproval).toHaveBeenCalledWith('p1', 'allowed-once'))
    rerender(<RoomApprovalView {...{ node: { data: { ...data, state: 'allowed-once' } }, answerApproval, t } as unknown as RoomApprovalViewProps} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/已允许/)).toBeDefined()
  })
})
