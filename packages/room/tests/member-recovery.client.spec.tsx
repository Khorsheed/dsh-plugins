// @vitest-environment jsdom
/**
 * The edit dialog's recovery block (11-04): a member whose last start failed
 * offers 对账并重试 in the room, a round a restart interrupted offers the
 * members page's 待对账 verdicts, and 立即载入 recovers a failed start first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LocalAgentMemberControlState, LocalAgentMemberInbox, LocalAgentMemberToolsStatus } from '@khorsheed/dsh-local-agent/types'
import { InviteDialog } from '../src/client/InviteDialog.tsx'
import { MemberRecoveryLine } from '../src/client/MemberRecoveryLine.tsx'
import { memberRecovery, plainReason, type MemberRecoveryRead } from '../src/client/member-recovery-view.ts'
import { memberToolsLine } from '../src/client/member-tools-view.ts'
import { en, zh } from '../src/client/locales.ts'
import type { RoomMember } from '../src/types.ts'

afterEach(() => { cleanup() })

const REASON = 'This session is in use by another Kimi Code CLI instance'
function control(patch: Partial<LocalAgentMemberControlState> = {}): LocalAgentMemberControlState {
  return {
    memberId: 'child-gm', revision: 4, status: 'idle',
    current: { revision: 3, selection: { model: { mode: 'inherit' }, effort: { mode: 'inherit' } }, resolved: { model: 'k2' } },
    ...patch,
  }
}
const failed = (patch: Partial<LocalAgentMemberControlState> = {}) => control({ status: 'failed', error: REASON, ...patch })
function inbox(rows: LocalAgentMemberInbox['messages'] = []): LocalAgentMemberInbox {
  return { memberId: 'child-gm', paused: rows.length > 0, messages: rows }
}
const uncertainRow = { id: 'exec-1', caller: 'room' as const, key: 'd1', status: 'uncertain' as const, createdAt: 1, updatedAt: 2 }

describe('memberRecovery (the block\'s state)', () => {
  it('a failed start, a failed selection, interrupted rounds, or nothing', () => {
    expect(memberRecovery(undefined)).toBeUndefined()
    expect(memberRecovery({ configuration: control(), inbox: inbox() })).toBeUndefined()
    expect(memberRecovery({ configuration: failed() })).toEqual({ failed: { cause: 'start', reason: REASON, revision: 4 }, uncertain: [] })
    const pending = { revision: 4, requestId: 'r', kind: 'selection' as const, selection: control().current.selection }
    expect(memberRecovery({ configuration: failed({ pending }) })?.failed?.cause).toBe('selection')
    expect(memberRecovery({ inbox: inbox([uncertainRow, { ...uncertainRow, id: 'done', status: 'done' }]) })).toEqual({ uncertain: [{ id: 'exec-1', caller: 'room' }] })
  })

  it('reads the reason without an error prefix, one short paragraph', () => {
    expect(plainReason('Error: boom')).toBe('boom')
    expect(plainReason('subagent-kimi live: This session is in use')).toBe('This session is in use')
    expect(plainReason(undefined)).toBe('')
    expect(plainReason('x'.repeat(400)).length).toBe(280)
  })
})

function block(reads: MemberRecoveryRead[], options: { retry?: () => Promise<{ ok: true } | { ok: false; message: string }>; reconcile?: boolean; locale?: Record<string, string> } = {}) {
  let index = 0
  const read = vi.fn(async () => reads[Math.min(index, reads.length - 1)])
  const retry = vi.fn(options.retry ?? (async () => { index++; return { ok: true as const } }))
  const reconcile = vi.fn(async () => { index++; return { ok: true as const } })
  render(<MemberRecoveryLine childSessionId="child-gm" read={read} retry={retry} reconcile={options.reconcile === false ? undefined : reconcile} t={makeTranslate(options.locale ?? zh)} />)
  return { read, retry, reconcile }
}

describe('MemberRecoveryLine', () => {
  it('a failed start: the reason in plain words and 对账并重试, which retries at the read revision', async () => {
    const m = block([{ configuration: failed() }, { configuration: control({ revision: 5 }) }])
    await screen.findByText(/上次启动没有成功/)
    expect(screen.getByText(REASON)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '对账并重试' }))
    await screen.findByText('已恢复，下一条消息会正常送达')
    expect(m.retry).toHaveBeenCalledWith('child-gm', 4)
    expect(screen.queryByRole('button', { name: '对账并重试' })).toBeNull()
  })

  it('a retry that fails again says so, with the new reason', async () => {
    block([{ configuration: failed() }, { configuration: failed({ error: 'still busy', revision: 5 }) }], { retry: async () => ({ ok: false, message: 'x' }) })
    await screen.findByText(REASON)
    fireEvent.click(screen.getByRole('button', { name: '对账并重试' }))
    // The scripted retry does not advance the reads: the member still reads failed.
    await screen.findByText(/重试后仍没有成功/)
  })

  it('a selection that did not apply is worded as such', async () => {
    const pending = { revision: 4, requestId: 'r', kind: 'selection' as const, selection: control().current.selection }
    block([{ configuration: failed({ pending }) }])
    await screen.findByText(/上次的模型设置没有生效/)
  })

  it('an interrupted round: 待对账 with the members page\'s verdicts, evidence required', async () => {
    const m = block([{ inbox: inbox([uncertainRow]) }, { inbox: inbox([{ ...uncertainRow, status: 'done' }]) }])
    await screen.findByText('待对账')
    expect(screen.getByText('协作间派活')).toBeTruthy()
    const done = screen.getByRole('button', { name: '确认已完成' }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('填写核对结果或证据'), { target: { value: '看过会话，已经发布' } })
    expect(done.disabled).toBe(false)
    fireEvent.click(done)
    await waitFor(() => { expect(m.reconcile).toHaveBeenCalledWith('child-gm', 'exec-1', 'done', '看过会话，已经发布') })
    await waitFor(() => { expect(screen.queryByText('待对账')).toBeNull() })
  })

  it('nothing to recover renders nothing; English copy in sync', async () => {
    const m = block([{ configuration: control(), inbox: inbox() }])
    await waitFor(() => { expect(m.read).toHaveBeenCalled() })
    expect(screen.queryByTestId('member-recovery')).toBeNull()
    cleanup()
    block([{ configuration: failed() }], { locale: en })
    await screen.findByText(/The last start did not succeed/)
    expect(screen.getByRole('button', { name: 'Reconcile and retry' })).toBeTruthy()
  })
})

describe('the edit dialog', () => {
  const member: RoomMember = { id: 'm1', name: 'gm', kind: 'cli', provider: 'kimi-cli', preset: 'dsh-gamedev', invitedBy: 'human', childSessionId: 'child-gm' as never }
  const noProcess: LocalAgentMemberToolsStatus = { preset: 'dsh-gamedev', expected: [], expectedUnknown: true, process: 'none', received: [], reloadable: false, startable: true }
  function dialog(options: { recovery?: boolean; retryWorks?: boolean } = {}) {
    let recovered = false
    const order: string[] = []
    const retry = vi.fn(async () => { order.push('retry'); recovered = options.retryWorks ?? true; return { ok: true as const } })
    const reload = vi.fn(async () => { order.push('reload'); return { ok: true as const, when: 'now' as const } })
    render(
      <InviteDialog
        mode="edit"
        member={member}
        presets={[{ id: 'dsh-gamedev', name: '游戏开发模式', isDefault: false }]}
        localAgentAvailable
        existingNames={['gm']}
        browseDirectory={async () => null}
        memberTools={async () => noProcess}
        reloadMemberTools={reload}
        {...options.recovery === false ? {} : {
          memberRecovery: async () => ({ configuration: recovered ? control({ revision: 5 }) : failed() }),
          retryMemberStart: retry,
          reconcileMemberExecution: async () => ({ ok: true as const }),
        }}
        onSubmit={async () => ({ ok: true })}
        onClose={() => {}}
        t={makeTranslate(zh)}
      />,
    )
    return { retry, reload, order }
  }

  it('shows the failed start next to the 模式工具 line, without leaving the room', async () => {
    dialog()
    await screen.findByText(REASON)
    expect(screen.getByRole('button', { name: '对账并重试' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '立即载入' })).toBeTruthy()
  })

  it('立即载入 retries the failed start first, then loads', async () => {
    const m = dialog()
    fireEvent.click(await screen.findByRole('button', { name: '立即载入' }))
    await waitFor(() => { expect(m.reload).toHaveBeenCalledOnce() })
    expect(m.order).toEqual(['retry', 'reload'])
    expect(m.retry).toHaveBeenCalledWith('child-gm', 4)
  })

  it('立即载入 whose retry fails again shows the new reason and does not load', async () => {
    const m = dialog({ retryWorks: false })
    fireEvent.click(await screen.findByRole('button', { name: '立即载入' }))
    await screen.findByText(`上次启动没有成功：${REASON}`)
    expect(m.reload).not.toHaveBeenCalled()
  })

  it('without the family\'s recovery reads there is no block, and 立即载入 just loads', async () => {
    const m = dialog({ recovery: false })
    fireEvent.click(await screen.findByRole('button', { name: '立即载入' }))
    await waitFor(() => { expect(m.reload).toHaveBeenCalledOnce() })
    expect(screen.queryByTestId('member-recovery')).toBeNull()
  })
})

describe('the 模式工具 line carries a failed start\'s reason', () => {
  it('lastReload.error becomes startError for the dialog that asked', () => {
    const status: LocalAgentMemberToolsStatus = { preset: 'p', expected: [], process: 'none', received: [], reloadable: false, startable: true, lastReload: { at: 10, by: 'manual', outcome: 'failed', error: 'exited at once' } }
    expect(memberToolsLine(status, 5)).toMatchObject({ startFailed: true, startError: 'exited at once' })
    expect(memberToolsLine(status)).not.toHaveProperty('startError')
  })
})
