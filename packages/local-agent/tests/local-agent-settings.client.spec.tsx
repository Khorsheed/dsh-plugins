// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { LocalAgentSettingsSection, LOGIN_POLL_LIMIT_MS, LOGIN_POLL_MS, parseLoginUrl, type LocalAgentSettingsProps } from '../src/client/LocalAgentSettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SESSION = 'session' as SessionId
const t: LocalAgentSettingsProps['t'] = makeTranslate(zh)

const KIMI_ROWS = [{ name: 'kimi', displayName: 'Kimi Code' }]

function kimiStatus(authenticated: boolean): LocalAgentStatus {
  return { name: 'kimi', displayName: 'Kimi Code', authenticated, homeDir: '/h' }
}

/** A dsh-shaped harness: authenticated through host credentials, no login/logout. */
function dshStatus(authenticated: boolean): LocalAgentStatus {
  return {
    name: 'dsh',
    displayName: 'dsh',
    authenticated,
    homeDir: '/h',
    loginable: false,
    logoutable: false,
  }
}

function props(
  over: Partial<LocalAgentSettingsProps> = {},
  current: SessionId | null = SESSION,
): LocalAgentSettingsProps {
  const resolved = current === null ? undefined : current
  const state = {
    ids: resolved === undefined ? [] : [resolved],
    byId: {},
    current: resolved,
    phase: 'ready',
  } as unknown as SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return {
    useSessions,
    roster: () => Promise.resolve(KIMI_ROWS),
    status: () => Promise.resolve(kimiStatus(false)),
    runCommand: () => Promise.resolve(''),
    t,
    ...over,
  } as unknown as LocalAgentSettingsProps
}

describe('parseLoginUrl', () => {
  it('extracts the device-code URL from a login prompt', () => {
    expect(parseLoginUrl('Open https://www.kimi.com/code/authorize_device?user_code=ABCD now')).toBe('https://www.kimi.com/code/authorize_device?user_code=ABCD')
    expect(parseLoginUrl('no link here')).toBeUndefined()
  })
})

describe('LocalAgentSettingsSection', () => {
  it('shows the no-session hint when no session is current', () => {
    const roster = vi.fn()
    render(<LocalAgentSettingsSection {...props({ roster }, null)} />)
    expect(screen.getByText(zh['settings.noSession'])).toBeTruthy()
    expect(roster).not.toHaveBeenCalled()
  })

  it('checks status on mount and renders authenticated state', async () => {
    const status = vi.fn().mockResolvedValue(kimiStatus(true))
    render(<LocalAgentSettingsSection {...props({ status })} />)

    expect(await screen.findByText(zh['settings.authenticated'])).toBeTruthy()
    expect(status).toHaveBeenCalledWith('kimi')
  })

  it('renders not-authenticated when the status probe says no', async () => {
    render(<LocalAgentSettingsSection {...props()} />)

    expect(await screen.findByText(zh['settings.notAuthenticated'])).toBeTruthy()
  })

  it('offers no login or logout actions for a harness without them (dsh-shaped)', async () => {
    const status = vi.fn().mockResolvedValue(dshStatus(true))
    const runCommand = vi.fn()
    render(<LocalAgentSettingsSection {...props({ status, runCommand })} />)

    // Authenticated through host credentials: no login button, no logout
    // button — the actions /dsh login|logout would answer with an error.
    expect(await screen.findByText(zh['settings.authenticated'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['settings.login'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['settings.reauthorize'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['settings.logout'] })).toBeNull()
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('runs the login command and offers the authorization page link', async () => {
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://www.kimi.com/code/authorize_device?user_code=ABCD\nComplete in the browser.')
    render(<LocalAgentSettingsSection {...props({ runCommand })} />)
    await screen.findByText(zh['settings.notAuthenticated'])

    fireEvent.click(screen.getByRole('button', { name: zh['settings.login'] }))
    expect(await screen.findByText(zh['settings.openPage'])).toBeTruthy()
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/kimi login')
    const link = screen.getByRole('link', { name: zh['settings.openPage'] })
    expect(link.getAttribute('href')).toBe('https://www.kimi.com/code/authorize_device?user_code=ABCD')
  })

  it('renders known-but-unregistered harnesses as pending with a disabled login', async () => {
    render(<LocalAgentSettingsSection {...props()} />)

    expect(await screen.findByText('Codex')).toBeTruthy()
    expect(screen.getByText('Claude Code')).toBeTruthy()
    const pendingButtons = screen.getAllByRole('button', { name: zh['settings.unsupported'] })
    expect(pendingButtons).toHaveLength(2)
    for (const button of pendingButtons) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    // The live harness keeps its login button enabled.
    const loginButton = screen.getByRole('button', { name: zh['settings.login'] }) as HTMLButtonElement
    expect(loginButton.disabled).toBe(false)
  })

  it('marks the harness unavailable when the status probe fails', async () => {
    const status = vi.fn().mockRejectedValue(new Error('boom'))
    render(<LocalAgentSettingsSection {...props({ status })} />)
    expect(await screen.findByText(zh['error'])).toBeTruthy()
  })

  it('polls status while a login is pending and flips to authenticated', async () => {
    vi.useFakeTimers()
    let authorized = false
    const status = vi.fn().mockImplementation(() => Promise.resolve(kimiStatus(authorized)))
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://www.kimi.com/code/authorize_device?user_code=ABCD\nComplete in the browser.')
    render(<LocalAgentSettingsSection {...props({ status, runCommand })} />)
    // Flush the roster fetch and the mount status probe.
    await act(async () => {})
    expect(screen.getByText(zh['settings.notAuthenticated'])).toBeTruthy()

    const loginButton = screen.getByRole('button', { name: zh['settings.login'] }) as HTMLButtonElement
    fireEvent.click(loginButton)
    await act(async () => {})
    expect(screen.getByText(zh['settings.openPage'])).toBeTruthy()
    // The button stays disabled while its login is pending.
    expect(loginButton.disabled).toBe(true)

    // The browser flow completes; the next poll sees the fresh credentials.
    authorized = true
    await act(async () => { vi.advanceTimersByTime(LOGIN_POLL_MS) })
    expect(screen.getByText(zh['settings.authenticated'])).toBeTruthy()
    // The prompt is dropped once the login completes.
    expect(screen.queryByText(zh['settings.openPage'])).toBeNull()
    // The pending→authenticated transition surfaced a success toast.
    expect(screen.getByText('Kimi Code 登录成功，快去试试吧！')).toBeTruthy()
  })

  it('stops polling when the login window expires without credentials', async () => {
    vi.useFakeTimers()
    const status = vi.fn().mockResolvedValue(kimiStatus(false))
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://www.kimi.com/code/authorize_device?user_code=ABCD\nComplete in the browser.')
    render(<LocalAgentSettingsSection {...props({ status, runCommand })} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: zh['settings.login'] }))
    await act(async () => {})

    const statusCalls = (): number => status.mock.calls.length
    const before = statusCalls()
    // The interval polls until the window expires, then goes silent.
    await act(async () => { vi.advanceTimersByTime(LOGIN_POLL_LIMIT_MS + LOGIN_POLL_MS) })
    expect(statusCalls()).toBeGreaterThan(before)
    const afterExpiry = statusCalls()
    await act(async () => { vi.advanceTimersByTime(LOGIN_POLL_LIMIT_MS) })
    expect(statusCalls()).toBe(afterExpiry)
  })

  it('signs out an authenticated harness and flips the row back', async () => {
    let signedOut = false
    const status = vi.fn().mockImplementation(() => Promise.resolve(kimiStatus(!signedOut)))
    const runCommand = vi.fn().mockImplementation((_s: SessionId, line: string) => {
      if (line === '/kimi logout') signedOut = true
      return Promise.resolve('kimi signed out of the scoped home.')
    })
    render(<LocalAgentSettingsSection {...props({ status, runCommand })} />)
    expect(await screen.findByText(zh['settings.authenticated'])).toBeTruthy()
    // The authenticated row offers sign-out and relabels login.
    expect(screen.getByRole('button', { name: zh['settings.logout'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['settings.reauthorize'] })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['settings.logout'] }))
    expect(await screen.findByText('kimi signed out of the scoped home.')).toBeTruthy()
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/kimi logout')
    // The follow-up status probe reports anonymous, so the row flips back.
    expect(await screen.findByText(zh['settings.notAuthenticated'])).toBeTruthy()
  })

  it('surfaces a failed roster fetch with a working retry', async () => {
    let rosterCalls = 0
    const roster = vi.fn().mockImplementation(() => {
      rosterCalls += 1
      if (rosterCalls === 1) return Promise.reject(new Error('roster down'))
      return Promise.resolve(KIMI_ROWS)
    })
    render(<LocalAgentSettingsSection {...props({ roster })} />)
    expect(await screen.findByText(zh['settings.rosterFailed'])).toBeTruthy()
    // Every row reads as pending while the roster is unknown.
    expect(screen.getAllByText(zh['settings.unsupported']).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: zh['settings.retry'] }))
    expect(await screen.findByText(zh['settings.notAuthenticated'])).toBeTruthy()
    expect(screen.queryByText(zh['settings.rosterFailed'])).toBeNull()
  })
})
