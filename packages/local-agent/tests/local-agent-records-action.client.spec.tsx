// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent/types'
import { LocalAgentRecordsAction, type LocalAgentRecordsActionProps } from '../src/client/LocalAgentRecordsAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SESSION = 'session' as SessionId
const t: LocalAgentRecordsActionProps['t'] = makeTranslate(zh)

function props(roster: LocalAgentRecordsActionProps['roster'], sessions: LocalAgentRecordsActionProps['sessions']): LocalAgentRecordsActionProps {
  return {
    sessionId: SESSION,
    useSessions: () => undefined,
    roster,
    sessions,
    t,
  } as unknown as LocalAgentRecordsActionProps
}

const KIMI_ROWS = [{ name: 'kimi', displayName: 'Kimi Code' }]
const ONE_RECORD: readonly LocalAgentSessionRecord[] = [{ id: 's1', workDir: '/w1' }]

describe('LocalAgentRecordsAction', () => {
  it('fetches the roster and renders one trigger per harness', async () => {
    const roster = vi.fn().mockResolvedValue(KIMI_ROWS)
    const sessions = vi.fn().mockResolvedValue(ONE_RECORD)
    render(<LocalAgentRecordsAction {...props(roster, sessions)} />)

    const trigger = await screen.findByRole('button', { name: 'Kimi Code 会话记录' })
    expect(roster).toHaveBeenCalled()
    fireEvent.click(trigger)
    expect(await screen.findByText('s1')).toBeTruthy()
    expect(sessions).toHaveBeenCalledWith('kimi', SESSION)
  })

  it('shows the empty state and login hint when the listing has no records', async () => {
    const sessions = vi.fn().mockResolvedValue([])
    render(<LocalAgentRecordsAction {...props(() => Promise.resolve(KIMI_ROWS), sessions)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Kimi Code 会话记录' }))
    expect(await screen.findByText('作用域内还没有 Kimi Code 会话')).toBeTruthy()
    expect(screen.getByText('运行 /kimi login 授权后开始委派')).toBeTruthy()
  })

  it('shows the unavailable state when the channel is not mounted', async () => {
    const sessions = vi.fn().mockResolvedValue(undefined)
    render(<LocalAgentRecordsAction {...props(() => Promise.resolve(KIMI_ROWS), sessions)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Kimi Code 会话记录' }))
    expect(await screen.findByText('/kimi sessions 不可用（Kimi Code 插件未安装？）')).toBeTruthy()
  })

  it('shows the error state when the fetch fails', async () => {
    const sessions = vi.fn().mockRejectedValue(new Error('boom'))
    render(<LocalAgentRecordsAction {...props(() => Promise.resolve(KIMI_ROWS), sessions)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Kimi Code 会话记录' }))
    expect(await screen.findByText('无法读取 Kimi Code 会话记录')).toBeTruthy()
  })

  it('closes on Escape and refetches on the next open', async () => {
    const sessions = vi.fn().mockResolvedValue(ONE_RECORD)
    render(<LocalAgentRecordsAction {...props(() => Promise.resolve(KIMI_ROWS), sessions)} />)

    const trigger = await screen.findByRole('button', { name: 'Kimi Code 会话记录' })
    fireEvent.click(trigger)
    expect(await screen.findByText('s1')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Kimi Code 会话记录' }), { key: 'Escape' })
    expect(screen.queryByText('s1')).toBeNull()

    fireEvent.click(trigger)
    expect(await screen.findByText('s1')).toBeTruthy()
    expect(sessions).toHaveBeenCalledTimes(2)
  })
})
