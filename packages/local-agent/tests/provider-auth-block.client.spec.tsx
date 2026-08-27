// @vitest-environment jsdom
/**
 * ProviderAuthBlock — the shared per-harness auth block extracted from the
 * settings section. These tests pin the block's standalone behavior and its
 * parity with the section row it now composes (same commands, same prompts,
 * same toast), so the per-provider settings cards can embed it without
 * re-testing every state there.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import {
  LOGIN_POLL_MS, ProviderAuthBlock, type ProviderAuthBlockProps,
} from '../src/client/ProviderAuthBlock.tsx'
import { readAuthStatus, resetAuthStatuses } from '../src/client/auth-status.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetAuthStatuses()
})

const SESSION = 'session' as SessionId
const t = makeTranslate(zh)
const KIMI = { id: 'kimi', label: 'Kimi Code' }

function kimiStatus(authenticated: boolean): LocalAgentStatus {
  return { name: 'kimi', displayName: 'Kimi Code', authenticated, homeDir: '/h' }
}

function useSessionsWith<T>(current: SessionId | undefined) {
  const state = {
    ids: current === undefined ? [] : [current],
    byId: {},
    current,
    phase: 'ready',
  } as unknown as SessionListState
  return function useSessions<R>(select: (snapshot: SessionListState) => R): R {
    return select(state)
  }
}

function blockProps(over: Partial<ProviderAuthBlockProps> = {}): ProviderAuthBlockProps {
  return {
    harness: KIMI,
    useSessions: useSessionsWith(SESSION),
    status: () => Promise.resolve(kimiStatus(false)),
    runCommand: () => Promise.resolve(''),
    t,
    ...over,
  } as unknown as ProviderAuthBlockProps
}

describe('ProviderAuthBlock', () => {
  it('probes status on mount and renders the authenticated state with logout + reauthorize', async () => {
    const status = vi.fn().mockResolvedValue(kimiStatus(true))
    render(<ProviderAuthBlock {...blockProps({ status })} />)

    expect(await screen.findByText(zh['settings.authenticated'])).toBeTruthy()
    expect(status).toHaveBeenCalledWith('kimi')
    expect(screen.getByRole('button', { name: zh['settings.logout'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['settings.reauthorize'] })).toBeTruthy()
  })

  it('publishes every probe result to the auth-status bus (the card-header dot reads it)', async () => {
    const status = vi.fn().mockResolvedValue(kimiStatus(true))
    render(<ProviderAuthBlock {...blockProps({ status })} />)
    await screen.findByText(zh['settings.authenticated'])
    expect(readAuthStatus('kimi')).toBe('authenticated')
  })

  it('offers no login or logout actions for a harness without them (dsh-shaped)', async () => {
    const status = vi.fn().mockResolvedValue({
      name: 'dsh', displayName: 'dsh', authenticated: true, homeDir: '/h', loginable: false, logoutable: false,
    } satisfies LocalAgentStatus)
    render(<ProviderAuthBlock {...blockProps({ harness: { id: 'dsh', label: 'dsh' }, status })} />)

    expect(await screen.findByText(zh['settings.authenticated'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['settings.login'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['settings.reauthorize'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['settings.logout'] })).toBeNull()
  })

  it('marks the harness unavailable when the status probe reports undefined (provider absent)', async () => {
    const status = vi.fn().mockResolvedValue(undefined)
    render(<ProviderAuthBlock {...blockProps({ status })} />)
    expect(await screen.findByText(zh['error'])).toBeTruthy()
  })

  it('runs the login command and offers the authorization page link', async () => {
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://www.kimi.com/code/authorize_device?user_code=ABCD\nComplete in the browser.')
    render(<ProviderAuthBlock {...blockProps({ runCommand })} />)
    await screen.findByText(zh['settings.notAuthenticated'])

    fireEvent.click(screen.getByRole('button', { name: zh['settings.login'] }))
    expect(await screen.findByText(zh['settings.openPage'])).toBeTruthy()
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/kimi login')
    const link = screen.getByRole('link', { name: zh['settings.openPage'] })
    expect(link.getAttribute('href')).toBe('https://www.kimi.com/code/authorize_device?user_code=ABCD')
  })

  it('polls while the login is pending and surfaces the success toast on completion', async () => {
    vi.useFakeTimers()
    let authorized = false
    const status = vi.fn().mockImplementation(() => Promise.resolve(kimiStatus(authorized)))
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://www.kimi.com/code/authorize_device?user_code=ABCD')
    render(<ProviderAuthBlock {...blockProps({ status, runCommand })} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: zh['settings.login'] }))
    await act(async () => {})

    authorized = true
    await act(async () => { vi.advanceTimersByTime(LOGIN_POLL_MS) })
    expect(screen.getByText(zh['settings.authenticated'])).toBeTruthy()
    expect(screen.getByText('Kimi Code 登录成功，快去试试吧！')).toBeTruthy()
  })

  it('submits a pasted OAuth code through the code command', async () => {
    const status = vi.fn().mockResolvedValue({
      ...kimiStatus(false), loginAwaitingCode: true,
    } satisfies LocalAgentStatus)
    const runCommand = vi.fn().mockResolvedValue('code accepted')
    render(<ProviderAuthBlock {...blockProps({ status, runCommand })} />)
    const input = await screen.findByPlaceholderText(zh['settings.pasteCode'])

    fireEvent.change(input, { target: { value: '  ABCD-1234  ' } })
    fireEvent.click(screen.getByRole('button', { name: zh['settings.submitCode'] }))
    await act(async () => {})
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/kimi code ABCD-1234')
    // The command reply replaces the prompt and the awaiting flag (and with
    // it the code input) drops.
    expect(await screen.findByText('code accepted')).toBeTruthy()
    expect(screen.queryByPlaceholderText(zh['settings.pasteCode'])).toBeNull()
  })

  it('renders the contributed actions seat verbatim', async () => {
    render(<ProviderAuthBlock {...blockProps({ actions: <button type="button">row-action-marker</button> })} />)
    expect(await screen.findByText('row-action-marker')).toBeTruthy()
  })
})
