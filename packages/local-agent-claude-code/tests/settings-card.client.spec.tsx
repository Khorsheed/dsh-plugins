// @vitest-environment jsdom
/**
 * The claude-code settings surfaces: the 0.1.5 plugin-configuration-tab card
 * (collapsible chrome, the family core's shared ProviderAuthBlock embedded
 * for the auth states, the resident-mode switch writing through the bound
 * settingsScope, and the family core's shared ModelListSection wired over the
 * injected faces) and the plugins.item entry (the summary one-liner, the
 * bare page form).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SettingsScopeSnapshot } from '@khorsheed/dsh-local-agent/src/client/settings-scope.ts'
import type { LocalAgentModelDirectory, LocalAgentModelInfo, LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { zh as coreZh } from '@khorsheed/dsh-local-agent/src/client/locales.ts'
import {
  ClaudeCodeBundleConfig, ClaudeCodeSettingsCard,
  type ClaudeLiveSettings, type ClaudeCodeBundleConfigProps, type ClaudeCodeSettingsCardProps,
} from '../src/client/SettingsCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const SESSION = 'session' as SessionId
const t = makeTranslate(zh)
const authT = makeTranslate(coreZh)

function makeSnapshot(
  value: ClaudeLiveSettings | undefined,
  user?: Record<string, unknown>,
  base?: Record<string, unknown>,
): SettingsScopeSnapshot<ClaudeLiveSettings> {
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

function claudeStatus(authenticated: boolean): LocalAgentStatus {
  // The endpoint-key era: no login flow is declared, so the core reports the
  // harness as not loginable; logout (clearing the scope's endpoint file)
  // still exists.
  return { name: 'claude-code', displayName: 'Claude Code', authenticated, homeDir: '/h', loginable: false, logoutable: true }
}

interface CardHarness {
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
  }
}

interface CardOptions {
  value?: ClaudeLiveSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<ClaudeLiveSettings>
  authenticated?: boolean
  authStatus?: LocalAgentStatus | undefined
  runCommand?: (sessionId: SessionId, line: string) => Promise<string | undefined>
  checkEndpoint?: () => Promise<string | null | undefined>
  endpointAuth?: {
    read: () => Promise<{ baseUrl?: string; apiKeySet: boolean; authTokenSet: boolean } | null | undefined>
    write: (fields: Record<string, string | null>) => Promise<{ baseUrl?: string; apiKeySet: boolean; authTokenSet: boolean } | null | undefined>
  }
  modelList?: {
    read: () => Promise<readonly string[] | null | undefined>
    write: (models: readonly string[]) => Promise<readonly string[] | null | undefined>
  }
  modelDirectory?: (refresh?: boolean) => Promise<LocalAgentModelDirectory | null | undefined>
  modelInfo?: () => Promise<LocalAgentModelInfo | null | undefined>
}

/** The card props over a scope whose writes update the snapshot reactively. */
function makeCardProps(options: CardOptions): { props: Record<string, unknown> } & CardHarness {
  let snapshot: SettingsScopeSnapshot<ClaudeLiveSettings> = options.snapshot
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
    const baseValue = (typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base : {}) as Partial<ClaudeLiveSettings>
    snapshot = makeSnapshot(
      { live: false, liveMirrorGranularity: 'event', ...baseValue, ...(user as ClaudeLiveSettings) },
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
    'authStatus' in options ? options.authStatus : claudeStatus(options.authenticated ?? false),
  )
  const runCommand = vi.fn(options.runCommand ?? (() => Promise.resolve('')))
  const props = {
    useSettings: <T,>(select: (value: SettingsScopeSnapshot<ClaudeLiveSettings>) => T): T => select(snapshot),
    useSessions,
    scope,
    auth: { status, runCommand },
    ...options.checkEndpoint === undefined ? {} : { checkEndpoint: options.checkEndpoint },
    ...options.endpointAuth === undefined ? {} : { endpointAuth: options.endpointAuth },
    ...options.modelList === undefined ? {} : { modelList: options.modelList },
    ...options.modelDirectory === undefined ? {} : { modelDirectory: options.modelDirectory },
    ...options.modelInfo === undefined ? {} : { modelInfo: options.modelInfo },
    authT,
    t,
  }
  return { props, scope: { set, unset } }
}

/** Render the 0.1.5 card over a scope whose writes update the snapshot reactively. */
function renderCard(options: CardOptions): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<ClaudeCodeSettingsCard {...props as unknown as ClaudeCodeSettingsCardProps} />)
  return { scope }
}

/** Render the alpha.2 bundle-config entry over the same reactive scope. */
function renderBundleConfig(entryView: 'summary' | 'page', options: CardOptions = {}): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<ClaudeCodeBundleConfig {...{ view: entryView, ...props } as unknown as ClaudeCodeBundleConfigProps} />)
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

describe('ClaudeCodeSettingsCard', () => {
  it('renders the three states: unauthenticated with live off', async () => {
    renderCard({ endpointAuth: { read: vi.fn(async () => ({ apiKeySet: false, authTokenSet: false })), write: vi.fn(async () => ({ apiKeySet: false, authTokenSet: false })) } })
    await openCard()

    expect(screen.getByText(coreZh['settings.notAuthenticated'])).toBeTruthy()
    // No login flow exists to offer: the endpoint credential form is the
    // authentication surface.
    expect(screen.queryByRole('button', { name: coreZh['settings.login'] })).toBeNull()
    expect(screen.getByLabelText(zh['endpoint.baseUrl'])).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: zh['live.title'] })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('renders authenticated state and a live-on card', async () => {
    renderCard({ authenticated: true, value: { live: true } })
    await openCard()

    expect(screen.getByText(coreZh['settings.authenticated'])).toBeTruthy()
    expect(screen.getByRole('button', { name: coreZh['settings.logout'] })).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: zh['live.title'] })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('marks the auth block unavailable when the probe reports undefined (core absent)', async () => {
    renderCard({ authStatus: undefined })
    await openCard()
    expect(screen.getByText(coreZh['error'])).toBeTruthy()
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

  it('offers no login action — the harness has no login flow to run', async () => {
    const runCommand = vi.fn().mockResolvedValue('')
    renderCard({ runCommand })
    await openCard()

    expect(screen.queryByRole('button', { name: coreZh['settings.login'] })).toBeNull()
    expect(runCommand).not.toHaveBeenCalled()
  })
})

describe('ClaudeCodeSettingsCard model list section', () => {
  // The section's behavior (rows, delete, drag, the add dialog) is pinned by
  // the family core's own ModelListSection spec; here only the wiring: the
  // card renders the core section over the injected faces.
  it('renders the family core\'s model-list section over the injected faces (rows with the default chip on the first)', async () => {
    const modelList = {
      read: vi.fn(async () => ['claude-opus-5-5', 'claude-haiku-5-5'] as const),
      write: vi.fn(async (next: readonly string[]) => next),
    }
    renderCard({ modelList, modelDirectory: vi.fn(async () => null) })
    await openCard()
    const rows = document.body.querySelectorAll('[draggable="true"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('claude-opus-5-5')
    expect(rows[0]?.textContent).toContain(coreZh['models.defaultChip'])
  })
})

describe('ClaudeCodeBundleConfig', () => {
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
})

describe('ClaudeCodeSettingsCard endpoint credential block', () => {
  /** A reactive endpointAuth face over a mutable resolved state. */
  function endpointFace(initial: { baseUrl?: string; apiKeySet: boolean; authTokenSet: boolean }) {
    let state = initial
    const read = vi.fn(async () => state)
    const write = vi.fn(async (fields: Record<string, string | null>) => {
      const next = { baseUrl: state.baseUrl, apiKey: state.apiKeySet ? 'set' : undefined as string | undefined, authToken: state.authTokenSet ? 'set' : undefined as string | undefined }
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'baseUrl') next.baseUrl = value === null ? undefined : value ?? next.baseUrl
        if (key === 'apiKey') next.apiKey = value === null ? undefined : value ?? next.apiKey
        if (key === 'authToken') next.authToken = value === null ? undefined : value ?? next.authToken
      }
      state = {
        ...next.baseUrl === undefined ? {} : { baseUrl: next.baseUrl },
        apiKeySet: next.apiKey !== undefined,
        authTokenSet: next.authToken !== undefined,
      }
      return state
    })
    return { read, write }
  }

  it('echoes the resolved baseUrl but never the secrets (set shows as a chip and placeholder)', async () => {
    const endpointAuth = endpointFace({ baseUrl: 'https://relay.example.com/claude', apiKeySet: true, authTokenSet: false })
    renderCard({ endpointAuth })
    await openCard()

    const baseUrl = screen.getByLabelText(zh['endpoint.baseUrl']) as HTMLInputElement
    expect(baseUrl.value).toBe('https://relay.example.com/claude')
    const apiKey = screen.getByLabelText(zh['endpoint.apiKey']) as HTMLInputElement
    expect(apiKey.value).toBe('')
    expect(apiKey.placeholder).toBe(zh['endpoint.secret.configured'])
    expect(screen.getAllByText(zh['endpoint.configured'])).not.toHaveLength(0)
    const authToken = screen.getByLabelText(zh['endpoint.authToken']) as HTMLInputElement
    expect(authToken.placeholder).toBe(zh['endpoint.secret.placeholder'])
  })

  it('writes only the dirty fields through the endpointAuth face and shows the post-write state', async () => {
    const endpointAuth = endpointFace({})
    renderCard({ endpointAuth })
    await openCard()

    fireEvent.change(screen.getByLabelText(zh['endpoint.baseUrl']), { target: { value: ' https://relay.example.com/claude ' } })
    fireEvent.change(screen.getByLabelText(zh['endpoint.apiKey']), { target: { value: ' sk-new ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.save'] })) })

    expect(endpointAuth.write).toHaveBeenCalledWith({ baseUrl: 'https://relay.example.com/claude', apiKey: 'sk-new' })
    expect(screen.getByText(zh['endpoint.applied'])).toBeTruthy()
    // The write's answer flips the chip without a re-read; the draft clears.
    expect((screen.getByLabelText(zh['endpoint.apiKey']) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(zh['endpoint.apiKey']) as HTMLInputElement).placeholder).toBe(zh['endpoint.secret.configured'])
  })

  it('a blank key write clears the field (null, not an empty string)', async () => {
    const endpointAuth = endpointFace({ apiKeySet: true })
    renderCard({ endpointAuth })
    await openCard()

    const input = screen.getByLabelText(zh['endpoint.apiKey'])
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.change(input, { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.save'] })) })
    expect(endpointAuth.write).toHaveBeenCalledWith({ apiKey: null })
    expect((screen.getByLabelText(zh['endpoint.apiKey']) as HTMLInputElement).placeholder).toBe(zh['endpoint.secret.placeholder'])
  })

  it('keeps save disabled until a draft exists', async () => {
    renderCard({ endpointAuth: endpointFace({}) })
    await openCard()
    const save = screen.getByRole('button', { name: zh['endpoint.save'] }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['endpoint.baseUrl']), { target: { value: 'https://relay.example.com' } })
    expect(save.disabled).toBe(false)
  })

  it('an unchanged baseUrl is not re-written', async () => {
    const endpointAuth = endpointFace({ baseUrl: 'https://relay.example.com' })
    renderCard({ endpointAuth })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['endpoint.apiKey']), { target: { value: 'sk-new' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.save'] })) })
    const fields = endpointAuth.write.mock.calls[0]?.[0] as Record<string, unknown>
    expect('baseUrl' in fields).toBe(false)
    expect(fields['apiKey']).toBe('sk-new')
  })

  it('shows the unavailable hint instead of the form on a core without the face', async () => {
    renderCard({})
    await openCard()
    expect(screen.getByText(zh['endpoint.unavailable'])).toBeTruthy()
    expect(screen.queryByLabelText(zh['endpoint.apiKey'])).toBeNull()
  })
})

describe('ClaudeCodeSettingsCard endpoint verify button', () => {
  const face = (): { read: () => Promise<{ apiKeySet: boolean; authTokenSet: boolean }>; write: () => Promise<{ apiKeySet: boolean; authTokenSet: boolean }> } => ({
    read: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })),
    write: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })),
  })

  it('runs the endpoint check against the saved endpoint and shows the verdict', async () => {
    const checkEndpoint = vi.fn().mockResolvedValue('Endpoint reachable (https://relay.example.com): 2 model(s) served — claude-a, claude-b')
    renderCard({ checkEndpoint, endpointAuth: face() })
    await openCard()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.check'] })) })
    expect(checkEndpoint).toHaveBeenCalled()
    expect(screen.getByText(/Endpoint reachable/)).toBeTruthy()
  })

  it('stays disabled while drafts are unsaved (it verifies the SAVED configuration)', async () => {
    const checkEndpoint = vi.fn().mockResolvedValue('')
    renderCard({ checkEndpoint, endpointAuth: face() })
    await openCard()

    const check = screen.getByRole('button', { name: zh['endpoint.check'] }) as HTMLButtonElement
    expect(check.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText(zh['endpoint.apiKey']), { target: { value: 'sk-draft' } })
    expect(check.disabled).toBe(true)
    expect(checkEndpoint).not.toHaveBeenCalled()
  })

  it('hides the button on a core that predates the checkEndpoint Remote', async () => {
    renderCard({ endpointAuth: face() })
    await openCard()
    expect(screen.queryByRole('button', { name: zh['endpoint.check'] })).toBeNull()
  })
})
