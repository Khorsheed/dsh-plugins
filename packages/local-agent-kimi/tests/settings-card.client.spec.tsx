// @vitest-environment jsdom
/**
 * The kimi settings surfaces: the 0.1.5 plugin-configuration-tab card
 * (collapsible chrome, the family core's shared ProviderAuthBlock embedded
 * for the auth states, the endpoint credential form, the family core's
 * shared ModelListSection wired over the injected faces, and the
 * resident-mode switch writing through the bound settingsScope) and the
 * plugins.item entry (the summary one-liner, the bare page form).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SettingsScopeSnapshot } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
import type { LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { zh as coreZh } from '@khorsheed/dsh-local-agent/src/client/locales.ts'
import { publishAuthStatus, resetAuthStatuses } from '@khorsheed/dsh-local-agent/src/client/auth-status.ts'
import {
  KimiBundleConfig, KimiSettingsCard,
  type KimiLiveSettings, type KimiBundleConfigProps, type KimiSettingsCardProps,
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

interface CardOptions {
  value?: KimiLiveSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<KimiLiveSettings>
  authenticated?: boolean
  authStatus?: LocalAgentStatus | undefined
  runCommand?: (sessionId: SessionId, line: string) => Promise<string | undefined>
  modelList?: {
    read: () => Promise<readonly string[] | null | undefined>
    write: (models: readonly string[]) => Promise<readonly string[] | null | undefined>
  }
  modelDirectory?: (refresh?: boolean) => Promise<null>
  endpointAuth?: {
    read: () => Promise<{ baseUrl?: string; apiKeySet: boolean; authTokenSet: boolean }>
    write: (fields: Record<string, string | null>) => Promise<{ baseUrl?: string; apiKeySet: boolean; authTokenSet: boolean }>
  }
  checkEndpoint?: () => Promise<string | null | undefined>
}

/** The card props over a scope whose writes update the snapshot reactively. */
function makeCardProps(options: CardOptions): { props: Record<string, unknown> } & CardHarness {
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
    ...options.modelList === undefined ? {} : { modelList: options.modelList },
    ...options.modelDirectory === undefined ? {} : { modelDirectory: options.modelDirectory },
    ...options.endpointAuth === undefined ? {} : { endpointAuth: options.endpointAuth },
    ...options.checkEndpoint === undefined ? {} : { checkEndpoint: options.checkEndpoint },
    t,
  }
  return { props, scope: { set, unset } }
}

/** Render the 0.1.5 card over a scope whose writes update the snapshot reactively. */
function renderCard(options: CardOptions): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<KimiSettingsCard {...props as unknown as KimiSettingsCardProps} />)
  return { scope }
}

/** Render the alpha.2 bundle-config entry over the same reactive scope. */
function renderBundleConfig(entryView: 'summary' | 'page', options: CardOptions = {}): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<KimiBundleConfig {...{ view: entryView, ...props } as unknown as KimiBundleConfigProps} />)
  return { scope }
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
    const toggle = screen.getByRole('switch', { name: zh['live.title'] })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('renders authenticated state and a live-on card', async () => {
    renderCard({ authenticated: true, value: { live: true, liveMirrorGranularity: 'token' } })
    await openCard()

    expect(screen.getByText(coreZh['settings.authenticated'])).toBeTruthy()
    expect(screen.getByRole('button', { name: coreZh['settings.logout'] })).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: zh['live.title'] })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
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
    expect(screen.getByText(coreZh['settings.statusFailed'])).toBeTruthy()
  })

  it('writes the live switch through the scope and shows the applied hint', async () => {
    const { scope } = renderCard({})
    await openCard()

    fireEvent.click(screen.getByRole('switch', { name: zh['live.title'] }))
    await act(async () => {})
    expect(scope.set).toHaveBeenCalledWith('live', true)
    expect(screen.getByRole('switch', { name: zh['live.title'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh['live.applied'])).toBeTruthy()
  })

  it('disables the live controls and explains while the namespace is unavailable', async () => {
    renderCard({
      snapshot: { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' },
    })
    await openCard()

    expect((screen.getByRole('switch', { name: zh['live.title'] }) as HTMLButtonElement).disabled).toBe(true)
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

describe('KimiSettingsCard model list section', () => {
  // The section's behavior (rows, delete, drag, the add dialog) is pinned by
  // the family core's own ModelListSection spec; here only the wiring: the
  // card renders the core section over the injected faces.
  it('renders the family core\'s model-list section over the injected faces (rows with the default chip on the first)', async () => {
    const modelList = {
      read: vi.fn(async () => ['kimi-for-coding', 'k3'] as const),
      write: vi.fn(async (next: readonly string[]) => next),
    }
    renderCard({ modelList, modelDirectory: vi.fn(async () => null) })
    await openCard()
    const rows = document.body.querySelectorAll('[draggable="true"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('kimi-for-coding')
    expect(rows[0]?.textContent).toContain(coreZh['models.defaultChip'])
  })
})

describe('KimiSettingsCard endpoint verify button', () => {
  /** A settled endpointAuth face (credential saved), so the form renders. */
  const face = (): { read: () => Promise<{ apiKeySet: boolean; authTokenSet: boolean }>; write: () => Promise<{ apiKeySet: boolean; authTokenSet: boolean }> } => ({
    read: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })),
    write: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })),
  })

  it('runs the endpoint check against the saved endpoint and shows the verdict', async () => {
    const checkEndpoint = vi.fn().mockResolvedValue('Endpoint reachable (https://api.kimi.com/coding/v1): 2 model(s) served — kimi-for-coding, k3')
    renderCard({ checkEndpoint, endpointAuth: face() })
    await openCard()
    // The card's own mount read of the endpoint state lands before the button.
    await act(async () => {})

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.check'] })) })
    expect(checkEndpoint).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Endpoint reachable/)).toBeTruthy()
  })

  it('stays disabled while drafts are unsaved (it verifies the SAVED configuration)', async () => {
    const checkEndpoint = vi.fn().mockResolvedValue('')
    renderCard({ checkEndpoint, endpointAuth: face() })
    await openCard()
    await act(async () => {})

    const check = screen.getByRole('button', { name: zh['endpoint.check'] }) as HTMLButtonElement
    expect(check.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText(zh['endpoint.apiKey']), { target: { value: 'sk-draft' } })
    expect(check.disabled).toBe(true)
    expect(check.title).toBe(zh['endpoint.checkDirtyHint'])
    expect(checkEndpoint).not.toHaveBeenCalled()
  })

  it('hides the button on a core that predates the checkEndpoint Remote', async () => {
    renderCard({ endpointAuth: face() })
    await openCard()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: zh['endpoint.check'] })).toBeNull()
  })
})


describe('KimiBundleConfig', () => {
  it('renders the one-liner alone in the summary view and never reads the model list', async () => {
    const modelList = { read: vi.fn(async () => []), write: vi.fn(async () => []) }
    renderBundleConfig('summary', { modelList })
    await act(async () => {})
    expect(document.body.textContent).toContain(zh['card.description'])
    expect(document.body.querySelector('button')).toBeNull()
    expect(document.body.querySelector('input')).toBeNull()
    expect(modelList.read).not.toHaveBeenCalled()
  })

  it('renders the bare form in the page view without the collapsible chrome and writes the live switch through the scope', async () => {
    const { scope } = renderBundleConfig('page')
    await act(async () => {})
    expect(document.body.querySelector('li')).toBeNull()
    expect(document.body.querySelector('button[aria-expanded]')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: zh['live.title'] }))
    await act(async () => {})
    expect(scope.set).toHaveBeenCalledWith('live', true)
  })
  it('re-reads the endpoint credential when the sign-in status changes (logout deletes the saved key)', async () => {
    let apiKeySet = true
    const read = vi.fn(async () => ({ baseUrl: 'https://api.kimi.com/coding/v1', apiKeySet, authTokenSet: false }))
    renderCard({ endpointAuth: { read, write: vi.fn(async () => ({ apiKeySet, authTokenSet: false })) } })
    await openCard()
    await act(async () => {})
    expect(screen.queryAllByText(zh['endpoint.configured']).length).toBeGreaterThan(0)
    await act(async () => { publishAuthStatus('kimi', 'authenticated') })
    const before = read.mock.calls.length
    apiKeySet = false
    // The auth block's logout publishes the signed-out status.
    await act(async () => { publishAuthStatus('kimi', 'anonymous') })
    expect(read.mock.calls.length).toBeGreaterThan(before)
    expect(screen.queryAllByText(zh['endpoint.configured'])).toHaveLength(0)
  })
})
