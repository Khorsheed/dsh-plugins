// @vitest-environment jsdom
/**
 * The codex settings surfaces: the 0.1.5 plugin-configuration-tab card
 * (collapsible chrome, the family core's shared ProviderAuthBlock embedded
 * for the auth states, the resident-mode block (live switch) writing through
 * the bound settingsScope, the endpoint credential form, and the family
 * core's shared ModelListSection wired over the injected faces) and the
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
import {
  CodexBundleConfig, CodexSettingsCard,
  type CodexLiveSettings, type CodexBundleConfigProps, type CodexSettingsCardProps,
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
  value: CodexLiveSettings | undefined,
  user?: Record<string, unknown>,
  base?: Record<string, unknown>,
): SettingsScopeSnapshot<CodexLiveSettings> {
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

function codexStatus(authenticated: boolean): LocalAgentStatus {
  // Endpoint-key only: the harness declares no login flow, so the status
  // reports not-loginable and the auth block renders no login button.
  return { name: 'codex', displayName: 'Codex', authenticated, homeDir: '/h', loginable: false }
}

interface CardHarness {
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
  }
}

interface CardOptions {
  value?: CodexLiveSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<CodexLiveSettings>
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
  let snapshot: SettingsScopeSnapshot<CodexLiveSettings> = options.snapshot
    ?? makeSnapshot(options.value ?? { live: false }, options.user, options.base)
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, next: unknown) => {
    snapshot = makeSnapshot(
      { live: false, ...(snapshot.value ?? {}), [field]: next },
      { ...(snapshot.user !== undefined && typeof snapshot.user === 'object' && snapshot.user !== null ? snapshot.user : {}), [field]: next },
      typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base as Record<string, unknown> : undefined,
    )
    for (const listener of listeners) listener()
  })
  const unset = vi.fn(async (field: string) => {
    const user = { ...(snapshot.user !== undefined && typeof snapshot.user === 'object' && snapshot.user !== null ? snapshot.user : {}) }
    delete user[field]
    const baseValue = (typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base : {}) as Partial<CodexLiveSettings>
    snapshot = makeSnapshot(
      { live: false, ...baseValue, ...(user as CodexLiveSettings) },
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
    'authStatus' in options ? options.authStatus : codexStatus(options.authenticated ?? false),
  )
  const runCommand = vi.fn(options.runCommand ?? (() => Promise.resolve('')))
  const props = {
    useSettings: <T,>(select: (value: SettingsScopeSnapshot<CodexLiveSettings>) => T): T => select(snapshot),
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
  render(<CodexSettingsCard {...props as unknown as CodexSettingsCardProps} />)
  return { scope }
}

/** Render the alpha.2 bundle-config entry over the same reactive scope. */
function renderBundleConfig(entryView: 'summary' | 'page', options: CardOptions = {}): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<CodexBundleConfig {...{ view: entryView, ...props } as unknown as CodexBundleConfigProps} />)
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

describe('CodexSettingsCard', () => {
  it('renders the three states: unauthenticated with live off, and no login affordance', async () => {
    renderCard({})
    await openCard()

    expect(screen.getByText(coreZh['settings.notAuthenticated'])).toBeTruthy()
    // Endpoint-key only: no login button anywhere (loginable: false).
    expect(screen.queryByRole('button', { name: coreZh['settings.login'] })).toBeNull()
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

  it('verifies the saved endpoint from the card and shows the verdict', async () => {
    const checkEndpoint = vi.fn().mockResolvedValue('Endpoint reachable (https://relay.example.com/openai/v1): 3 model(s) served — gpt-a, gpt-b, gpt-c')
    const endpointAuth = { read: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })), write: vi.fn() }
    renderCard({ checkEndpoint, endpointAuth })
    await openCard()
    // The card's own mount read of the endpoint state lands before the button.
    await act(async () => {})

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.check'] })) })
    expect(checkEndpoint).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Endpoint reachable/)).toBeTruthy()
  })

  it('stays disabled while drafts are unsaved (it verifies the SAVED configuration)', async () => {
    const checkEndpoint = vi.fn().mockResolvedValue('')
    const endpointAuth = { read: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })), write: vi.fn() }
    renderCard({ checkEndpoint, endpointAuth })
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
    const endpointAuth = { read: vi.fn(async () => ({ apiKeySet: true, authTokenSet: false })), write: vi.fn() }
    renderCard({ endpointAuth })
    await openCard()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: zh['endpoint.check'] })).toBeNull()
  })
})

describe('CodexSettingsCard endpoint credential block', () => {
  /** A reactive endpointAuth face over a mutable resolved state. */
  function endpointFace(initial: { baseUrl?: string; apiKeySet: boolean }) {
    let state = { authTokenSet: false, ...initial }
    const read = vi.fn(async () => state)
    const write = vi.fn(async (fields: Record<string, string | null>) => {
      const next = { baseUrl: state.baseUrl, apiKey: state.apiKeySet ? 'set' : undefined as string | undefined }
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'baseUrl') next.baseUrl = value === null ? undefined : value ?? next.baseUrl
        if (key === 'apiKey') next.apiKey = value === null ? undefined : value ?? next.apiKey
      }
      state = {
        ...next.baseUrl === undefined ? {} : { baseUrl: next.baseUrl },
        apiKeySet: next.apiKey !== undefined,
        authTokenSet: false,
      }
      return state
    })
    return { read, write }
  }

  it('echoes the resolved baseUrl but never the key (set shows as a chip and placeholder)', async () => {
    const endpointAuth = endpointFace({ baseUrl: 'https://relay.example.com/openai/v1', apiKeySet: true })
    renderCard({ endpointAuth })
    await openCard()

    const baseUrl = screen.getByLabelText(zh['endpoint.baseUrl']) as HTMLInputElement
    expect(baseUrl.value).toBe('https://relay.example.com/openai/v1')
    const apiKey = screen.getByLabelText(zh['endpoint.apiKey']) as HTMLInputElement
    expect(apiKey.value).toBe('')
    expect(apiKey.placeholder).toBe(zh['endpoint.secret.configured'])
    expect(screen.getAllByText(zh['endpoint.configured'])).not.toHaveLength(0)
  })

  it('writes only the dirty fields through the endpointAuth face and shows the post-write state', async () => {
    const endpointAuth = endpointFace({ apiKeySet: false })
    renderCard({ endpointAuth })
    await openCard()

    fireEvent.change(screen.getByLabelText(zh['endpoint.baseUrl']), { target: { value: ' https://relay.example.com/openai/v1 ' } })
    fireEvent.change(screen.getByLabelText(zh['endpoint.apiKey']), { target: { value: ' sk-new ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.save'] })) })

    expect(endpointAuth.write).toHaveBeenCalledWith({ baseUrl: 'https://relay.example.com/openai/v1', apiKey: 'sk-new' })
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
    // The draft starts at the configured placeholder; typing a space and
    // clearing leaves an empty draft, which the save maps to null.
    fireEvent.change(input, { target: { value: ' ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['endpoint.save'] })) })
    expect(endpointAuth.write).toHaveBeenCalledWith({ apiKey: null })
    expect((screen.getByLabelText(zh['endpoint.apiKey']) as HTMLInputElement).placeholder).toBe(zh['endpoint.secret.placeholder'])
  })
})

describe('CodexSettingsCard model list section', () => {
  // The section's behavior (rows, delete, drag, the add dialog) is pinned by
  // the family core's own ModelListSection spec; here only the wiring: the
  // card renders the core section over the injected faces.
  it('renders the family core\'s model-list section over the injected faces (rows with the default chip on the first)', async () => {
    const modelList = {
      read: vi.fn(async () => ['gpt-5.3-codex', 'gpt-5.2-codex'] as const),
      write: vi.fn(async (next: readonly string[]) => next),
    }
    renderCard({ modelList, modelDirectory: vi.fn(async () => null) })
    await openCard()
    const rows = document.body.querySelectorAll('[draggable="true"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('gpt-5.3-codex')
    expect(rows[0]?.textContent).toContain(coreZh['models.defaultChip'])
  })
})


describe('CodexBundleConfig', () => {
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
