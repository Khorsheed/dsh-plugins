// @vitest-environment jsdom
/**
 * The kimi settings card in the plugin configuration tab: collapsible chrome,
 * the family core's shared ProviderAuthBlock embedded for the auth states, and
 * the resident-mode block (live switch, granularity radios, override badge)
 * writing through the bound settingsScope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { zh as coreZh } from '@khorsheed/dsh-local-agent/src/client/locales.ts'
import { resetAuthStatuses } from '@khorsheed/dsh-local-agent/src/client/auth-status.ts'
import {
  KimiSettingsCard, type KimiLiveSettings, type KimiSettingsCardProps,
} from '../src/client/SettingsCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  resetAuthStatuses()
})

const SESSION = 'session' as SessionId
const t = makeTranslate(zh)
const authT = makeTranslate(coreZh)

function makeSnapshot(
  value: KimiLiveSettings | undefined,
  user?: Record<string, unknown>,
  base?: Record<string, unknown>,
): SettingsScopeSnapshot<KimiLiveSettings> {
  return {
    status: 'ready',
    value,
    base,
    user,
    revision: 1,
    writable: true,
    mode: 'host',
  }
}

function kimiStatus(authenticated: boolean): LocalAgentStatus {
  return { name: 'kimi', displayName: 'Kimi Code', authenticated, homeDir: '/h' }
}

interface CardHarness {
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
  }
}

/** Render the card over a scope whose writes update the snapshot reactively. */
function renderCard(options: {
  value?: KimiLiveSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<KimiLiveSettings>
  authenticated?: boolean
  authStatus?: LocalAgentStatus | undefined
  runCommand?: (sessionId: SessionId, line: string) => Promise<string | undefined>
}): CardHarness {
  let snapshot: SettingsScopeSnapshot<KimiLiveSettings> = options.snapshot
    ?? makeSnapshot(options.value ?? { live: false, liveMirrorGranularity: 'event' }, options.user, options.base)
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, next: unknown) => {
    snapshot = makeSnapshot(
      { live: false, liveMirrorGranularity: 'event', ...(snapshot.value ?? {}), [field]: next },
      { ...(snapshot.user !== undefined && typeof snapshot.user === 'object' && snapshot.user !== null ? snapshot.user : {}), [field]: next },
      typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base as Record<string, unknown> : undefined,
    )
    for (const listener of listeners) listener()
  })
  const unset = vi.fn(async (field: string) => {
    const user = { ...(snapshot.user !== undefined && typeof snapshot.user === 'object' && snapshot.user !== null ? snapshot.user : {}) }
    delete user[field]
    const baseValue = (typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base : {}) as Partial<KimiLiveSettings>
    snapshot = makeSnapshot(
      { live: false, liveMirrorGranularity: 'event', ...baseValue, ...(user as KimiLiveSettings) },
      Object.keys(user).length === 0 ? undefined : user,
      typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base as Record<string, unknown> : undefined,
    )
    for (const listener of listeners) listener()
  })
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset,
  }
  const state = {
    ids: [SESSION], byId: {}, current: SESSION, phase: 'ready',
  } as unknown as SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  const status = vi.fn().mockResolvedValue(
    'authStatus' in options ? options.authStatus : kimiStatus(options.authenticated ?? false),
  )
  const runCommand = vi.fn(options.runCommand ?? (() => Promise.resolve('')))
  const props = {
    useSettings: <T,>(select: (value: SettingsScopeSnapshot<KimiLiveSettings>) => T): T => select(snapshot),
    useSessions,
    scope,
    auth: { status, runCommand },
    authT,
    t,
  } as unknown as KimiSettingsCardProps
  render(<KimiSettingsCard {...props} />)
  return { scope: { set, unset } }
}

/** The disclosure header: the only button carrying aria-expanded. */
function headerButton(): HTMLButtonElement {
  const header = document.body.querySelector('button[aria-expanded]')
  if (header === null) throw new Error('card header button missing')
  return header as HTMLButtonElement
}

/** Open the card and flush the auth block's mount probe. */
async function openCard(): Promise<void> {
  fireEvent.click(headerButton())
  await act(async () => {})
}

describe('KimiSettingsCard', () => {
  it('renders the three states: unauthenticated with live off', async () => {
    renderCard({})
    await openCard()

    expect(screen.getByText(coreZh['settings.notAuthenticated'])).toBeTruthy()
    expect(screen.getByRole('button', { name: coreZh['settings.login'] })).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: zh['live.enable'] })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: zh['live.granularity.event'] })).toBeTruthy()
    expect(screen.getByRole('radio', { name: zh['live.granularity.token'] })).toBeTruthy()
  })

  it('renders authenticated state and a live-on card', async () => {
    renderCard({ authenticated: true, value: { live: true, liveMirrorGranularity: 'token' } })
    await openCard()

    expect(screen.getByText(coreZh['settings.authenticated'])).toBeTruthy()
    expect(screen.getByRole('button', { name: coreZh['settings.logout'] })).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: zh['live.enable'] })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('radio', { name: zh['live.granularity.token'] }) as HTMLInputElement).checked).toBe(true)
  })

  it('shows the credential dot in the collapsed header, fed by the status bus', async () => {
    renderCard({ authenticated: true })
    // The dot probes on mount (no expand needed) and lands on authenticated.
    await act(async () => {})
    const dot = document.body.querySelector('[data-auth-status]')
    expect(dot?.getAttribute('data-auth-status')).toBe('authenticated')
    expect(dot?.getAttribute('aria-label')).toBe(coreZh['settings.authenticated'])
  })

  it('the header dot lands on the not-authenticated color when the probe says anonymous', async () => {
    renderCard({ authenticated: false })
    await act(async () => {})
    const dot = document.body.querySelector('[data-auth-status]')
    expect(dot?.getAttribute('data-auth-status')).toBe('anonymous')
    expect(dot?.getAttribute('aria-label')).toBe(coreZh['settings.notAuthenticated'])
  })

  it('marks the auth block unavailable when the probe reports undefined (core absent)', async () => {
    renderCard({ authStatus: undefined })
    await openCard()
    expect(screen.getByText(coreZh['error'])).toBeTruthy()
  })

  it('writes the live switch through the scope and shows the applied hint', async () => {
    const { scope } = renderCard({})
    await openCard()

    fireEvent.click(screen.getByRole('switch', { name: zh['live.enable'] }))
    await act(async () => {})
    expect(scope.set).toHaveBeenCalledWith('live', true)
    expect(screen.getByRole('switch', { name: zh['live.enable'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh['live.applied'])).toBeTruthy()
  })

  it('writes the granularity radio through the scope', async () => {
    const { scope } = renderCard({})
    await openCard()

    fireEvent.click(screen.getByRole('radio', { name: zh['live.granularity.token'] }))
    await act(async () => {})
    expect(scope.set).toHaveBeenCalledWith('liveMirrorGranularity', 'token')
    expect((screen.getByRole('radio', { name: zh['live.granularity.token'] }) as HTMLInputElement).checked).toBe(true)
  })

  it('shows the override badge only while the user layer carries a field, and 恢复默认 clears it', async () => {
    const { scope } = renderCard({
      value: { live: true, liveMirrorGranularity: 'event' },
      user: { live: true },
      base: { live: false, liveMirrorGranularity: 'event' },
    })
    await openCard()

    // The badge names the yaml value being shadowed.
    expect(screen.getByText('已覆盖部署默认（yaml：live=false）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['live.reset'] }))
    await act(async () => {})
    expect(scope.unset).toHaveBeenCalledWith('live')
    expect(scope.unset).not.toHaveBeenCalledWith('liveMirrorGranularity')
    // The user layer cleared → the badge disappears and the value re-inherits base.
    expect(screen.queryByText(/已覆盖部署默认/)).toBeNull()
    expect(screen.getByRole('switch', { name: zh['live.enable'] }).getAttribute('aria-checked')).toBe('false')
  })

  it('renders no override badge when the user layer is empty', async () => {
    renderCard({ value: { live: true, liveMirrorGranularity: 'event' }, base: { live: true, liveMirrorGranularity: 'event' } })
    await openCard()
    expect(screen.queryByText(/已覆盖部署默认/)).toBeNull()
  })

  it('disables the live controls and explains while the namespace is unavailable', async () => {
    renderCard({
      snapshot: { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' },
    })
    await openCard()

    expect((screen.getByRole('switch', { name: zh['live.enable'] }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: zh['live.granularity.token'] }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(zh['live.unavailable'])).toBeTruthy()
  })

  it('runs the auth login flow from the card (device-code prompt + open page link)', async () => {
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://www.kimi.com/code/authorize_device?user_code=ABCD\nComplete in the browser.')
    renderCard({ runCommand })
    await openCard()

    fireEvent.click(screen.getByRole('button', { name: coreZh['settings.login'] }))
    await act(async () => {})
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/kimi login')
    const link = screen.getByRole('link', { name: coreZh['settings.openPage'] })
    expect(link.getAttribute('href')).toBe('https://www.kimi.com/code/authorize_device?user_code=ABCD')
    // (Full login/poll/toast parity is pinned by the core package's block spec.)
  })
})
