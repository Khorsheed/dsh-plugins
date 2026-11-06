// @vitest-environment jsdom
/**
 * Replacing a member's process while it runs background work asks first
 * (member-self-started-rounds C①, Kimi M3): 重新载入 / 立即载入 answered
 * `background-tasks` confirm in place and retry with the confirmation; a
 * model save in the edit dialog reads the live count first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LocalAgentBackgroundTasks, LocalAgentMemberToolsReload, LocalAgentMemberToolsStatus } from '@khorsheed/dsh-local-agent/types'
import { MemberToolsLine } from '../src/client/MemberToolsLine.tsx'
import { InviteDialog } from '../src/client/InviteDialog.tsx'
import { runningBackground } from '../src/client/member-activity-view.ts'
import { reloadThroughGateway } from '../src/client/member-tools-view.ts'
import { MemberActivityStore } from '../src/client/MemberActivity.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { RoomMember } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as never
const GAME = ['game_open', 'game_read', 'game_publish']
const missing: LocalAgentMemberToolsStatus = { preset: 'dsh-gamedev', expected: GAME, process: 'placeholder', received: [], loadedAt: 1, reloadable: true }
const start: LocalAgentMemberToolsStatus = { ...missing, process: 'none', expected: [], expectedUnknown: true, startable: true } as never
const REFUSED: LocalAgentMemberToolsReload = { ok: false, reason: 'background-tasks', running: 2 }

function line(status: LocalAgentMemberToolsStatus) {
  const reload = vi.fn(async (_child: string, options?: { confirmBackgroundTasks?: boolean }) =>
    options?.confirmBackgroundTasks === true ? { ok: true as const, when: 'now' as const } : REFUSED)
  render(<MemberToolsLine childSessionId="child-gm" modeName="游戏开发" provider="kimi-cli" running={false} read={async () => status} reload={reload} t={t} />)
  return reload
}

describe('重新载入 / 立即载入 with background work', () => {
  it('a refusal confirms in place; 继续 asks again with the confirmation', async () => {
    const reload = line(missing)
    fireEvent.click(await screen.findByText('重新载入'))
    const confirm = await screen.findByTestId('background-confirm')
    expect(confirm.textContent).toContain('会让 2 项后台工作失去联系，继续吗？')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenLastCalledWith('child-gm')
    fireEvent.click(screen.getByText('继续'))
    await waitFor(() => { expect(reload).toHaveBeenLastCalledWith('child-gm', { confirmBackgroundTasks: true }) })
    await waitFor(() => { expect(screen.queryByTestId('background-confirm')).toBeNull() })
  })

  it('取消 drops the confirmation and asks nothing more', async () => {
    const reload = line(missing)
    fireEvent.click(await screen.findByText('重新载入'))
    await screen.findByTestId('background-confirm')
    fireEvent.click(screen.getByText('取消'))
    expect(screen.queryByTestId('background-confirm')).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('立即载入 confirms the same way', async () => {
    const reload = line(start)
    fireEvent.click(await screen.findByText('立即载入'))
    await screen.findByTestId('background-confirm')
    fireEvent.click(screen.getByText('继续'))
    await waitFor(() => { expect(reload).toHaveBeenLastCalledWith('child-gm', { confirmBackgroundTasks: true }) })
  })

  it('reads in English too', () => {
    expect(makeTranslate(en)('bg.confirm.text' as never, { count: '1' } as never)).toBe('This will lose contact with 1 background job(s). Continue?')
  })
})

describe('saving a model change in the edit dialog', () => {
  const member: RoomMember = { id: 'm1', name: 'gm', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-gm' as never, model: 'kimi-code/k3' }
  function dialog(running: number) {
    const onSubmit = vi.fn(async () => ({ ok: true as const }))
    const count = vi.fn(async () => running)
    const view = render(
      <InviteDialog
        mode="edit"
        member={member}
        localAgentAvailable
        existingNames={['gm']}
        browseDirectory={async () => null}
        runningBackgroundTasks={count}
        onSubmit={onSubmit}
        onClose={() => {}}
        t={t}
      />,
    )
    return { onSubmit, count, view }
  }
  const changeModel = (): void => { fireEvent.change(screen.getByLabelText(zh['invite.model']), { target: { value: 'kimi-code/k3.1-pro' } }) }

  it('a live process with background work: confirm first, nothing saved until 继续', async () => {
    const { onSubmit, count } = dialog(2)
    changeModel()
    fireEvent.click(screen.getByText(zh['invite.save']))
    const confirm = await screen.findByTestId('background-confirm')
    expect(confirm.textContent).toContain('会让 2 项后台工作失去联系，继续吗？')
    expect(count).toHaveBeenCalledWith('child-gm')
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByText('继续'))
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1) })
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('取消 keeps the dialog and saves nothing', async () => {
    const { onSubmit } = dialog(1)
    changeModel()
    fireEvent.click(screen.getByText(zh['invite.save']))
    fireEvent.click(within(await screen.findByTestId('background-confirm')).getByText('取消'))
    expect(screen.queryByTestId('background-confirm')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('no background work: saves at once', async () => {
    const { onSubmit } = dialog(0)
    changeModel()
    fireEvent.click(screen.getByText(zh['invite.save']))
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1) })
    expect(screen.queryByTestId('background-confirm')).toBeNull()
  })

  it('no model change: no read, no confirmation', async () => {
    const { onSubmit, count } = dialog(3)
    fireEvent.change(screen.getByPlaceholderText(zh['invite.rolePlaceholder']), { target: { value: '画布' } })
    fireEvent.click(screen.getByText(zh['invite.save']))
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1) })
    expect(count).not.toHaveBeenCalled()
  })
})

describe('the live count', () => {
  const live = (patch: Partial<LocalAgentBackgroundTasks>): LocalAgentBackgroundTasks => ({
    supported: true, processAlive: true,
    tasks: [
      { id: 'a', label: 'a', kind: 'shell', startedAt: 1, state: 'running' },
      { id: 'b', label: 'b', kind: 'agent', startedAt: 1, state: 'running' },
      { id: 'c', label: 'c', kind: 'shell', startedAt: 1, state: 'completed', endedAt: 2 },
    ],
    ...patch,
  })

  it('counts running tasks of a live process only; anything else is 0', () => {
    expect(runningBackground(live({}))).toBe(2)
    expect(runningBackground(live({ processAlive: false }))).toBe(0)
    expect(runningBackground(live({ supported: false }))).toBe(0)
    expect(runningBackground(null)).toBe(0)
    expect(runningBackground(undefined)).toBe(0)
  })

  it('readNow reads fresh, outside the poll, and a failed read is undefined', async () => {
    const read = vi.fn(async (id: string) => { if (id === 'bad') throw new Error('x'); return live({}) })
    const store = new MemberActivityStore(read)
    expect(runningBackground(await store.readNow('child-gm'))).toBe(2)
    expect(await store.readNow('bad')).toBeUndefined()
    expect(store.get('child-gm')).toBeUndefined()
  })
})

describe('the reload request', () => {
  it('passes the confirmation to the gateway, and degrades without the family or on a failure', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: REFUSED }))
    expect(await reloadThroughGateway({ reloadMemberTools: call }, 'child-gm')).toEqual(REFUSED)
    expect(call).toHaveBeenLastCalledWith('child-gm')
    await reloadThroughGateway({ reloadMemberTools: call }, 'child-gm', { confirmBackgroundTasks: true })
    expect(call).toHaveBeenLastCalledWith('child-gm', { confirmBackgroundTasks: true })
    expect(await reloadThroughGateway(undefined, 'child-gm')).toBeUndefined()
    expect(await reloadThroughGateway({}, 'child-gm')).toBeUndefined()
    expect(await reloadThroughGateway({ reloadMemberTools: async () => ({ ok: false }) }, 'child-gm')).toBeUndefined()
    expect(await reloadThroughGateway({ reloadMemberTools: async () => { throw new Error('x') } }, 'child-gm')).toBeUndefined()
  })
})
