// @vitest-environment jsdom
/**
 * The claude-code settings card in the plugin configuration tab: collapsible
 * chrome, the family core's shared ProviderAuthBlock embedded for the auth
 * states, the resident-mode switch writing through the bound settingsScope,
 * and the default-model block — free-text write plus the gateway's model
 * surface (effective-model line, suggestion vocabulary), degrading to the
 * bare input when the surface is absent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LocalAgentModelInfo, LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
import { zh as coreZh } from '@khorsheed/dsh-local-agent/src/client/locales.ts'
import {
  ClaudeCodeSettingsCard, type ClaudeLiveSettings, type ClaudeCodeSettingsCardProps,
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
  return { name: 'claude-code', displayName: 'Claude Code', authenticated, homeDir: '/h' }
}

interface CardHarness {
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
  }
}

/** Render the card over a scope whose writes update the snapshot reactively. */
function renderCard(options: {
  value?: ClaudeLiveSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<ClaudeLiveSettings>
  authenticated?: boolean
  authStatus?: LocalAgentStatus | undefined
  runCommand?: (sessionId: SessionId, line: string) => Promise<string | undefined>
  modelInfo?: () => Promise<LocalAgentModelInfo | null | undefined>
}): CardHarness {
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
    ...options.modelInfo === undefined ? {} : { modelInfo: options.modelInfo },
    authT,
    t,
  } as unknown as ClaudeCodeSettingsCardProps
  render(<ClaudeCodeSettingsCard {...props} />)
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

describe('ClaudeCodeSettingsCard', () => {
  it('renders the three states: unauthenticated with live off', async () => {
    renderCard({})
    await openCard()

    expect(screen.getByText(coreZh['settings.notAuthenticated'])).toBeTruthy()
    expect(screen.getByRole('button', { name: coreZh['settings.login'] })).toBeTruthy()
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

  it('runs the auth login flow from the card (manual-handoff prompt)', async () => {
    // claude ≥2.1 prints no OAuth URL off a TTY: the login reply is the exact
    // terminal command to run, not a device-code URL.
    const runCommand = vi.fn().mockResolvedValue('在终端执行：claude auth login（浏览器会打开授权页面），完成后用 /claude-code code <值> 粘贴授权码')
    renderCard({ runCommand })
    await openCard()

    fireEvent.click(screen.getByRole('button', { name: coreZh['settings.login'] }))
    await act(async () => {})
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/claude-code login')
    // (Full login/poll/toast parity — the manual handoff and code paste
    // included — is pinned by the core package's block spec.)
  })
})

describe('ClaudeCodeSettingsCard default-model block', () => {
  it('shows the stored model and saves an edited one as the model key', async () => {
    const harness = renderCard({ value: { live: false, liveMirrorGranularity: 'event', model: 'model-a' } })
    await openCard()
    const input = screen.getByLabelText(zh['model.title']) as HTMLInputElement
    expect(input.value).toBe('model-a')
    fireEvent.change(input, { target: { value: 'model-b' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.set).toHaveBeenCalledWith('model', 'model-b')
    expect(screen.getByText(zh['model.applied'])).toBeTruthy()
  })

  it('trims the typed value rather than storing the spaces around it', async () => {
    const harness = renderCard({})
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: '  model-b  ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.set).toHaveBeenCalledWith('model', 'model-b')
  })

  it('clearing the field UNSETS the key, so the YAML base decides again', async () => {
    const harness = renderCard({ value: { live: false, liveMirrorGranularity: 'event', model: 'model-a' } })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.unset).toHaveBeenCalledWith('model')
    // An unset must not also write an empty string over the base.
    expect(harness.scope.set).not.toHaveBeenCalledWith('model', '')
  })

  it('a saved model joins the suggestions most-recent-first, deduplicated', async () => {
    const harness = renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.set).toHaveBeenCalledWith('recentModels', ['model-b', 'model-a'])
  })

  it('offers the saved suggestions without hardcoding any model catalog', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title'])
    const list = document.getElementById(input.getAttribute('list') ?? '')
    expect([...list!.querySelectorAll('option')].map(option => option.getAttribute('value')))
      .toEqual(['model-a', 'model-b'])
  })

  it('save stays disabled while the field still matches what is stored', async () => {
    renderCard({ value: { live: false, liveMirrorGranularity: 'event', model: 'model-a' } })
    await openCard()
    const save = screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })
})

/** A memberless model surface, as the gateway's harnessModel answers it. */
function modelSurface(over: Partial<LocalAgentModelInfo> = {}): LocalAgentModelInfo {
  return { source: 'cli-builtin', choices: [], live: false, switchable: true, ...over }
}

describe('ClaudeCodeSettingsCard model surface', () => {
  it('names the settings value as the effective model when one is stored', async () => {
    renderCard({
      value: { live: false, model: 'model-a' },
      modelInfo: () => Promise.resolve(modelSurface({ source: 'settings', effective: 'model-a', settings: 'model-a', choices: ['model-a'] })),
    })
    await openCard()
    expect(screen.getByText('当前生效：model-a')).toBeTruthy()
  })

  it('falls to 跟随 CLI 配置 with the scoped-file model when the field is blank', async () => {
    renderCard({
      modelInfo: () => Promise.resolve(modelSurface({ source: 'cli-config', effective: 'scoped-model', cliDefault: 'scoped-model', choices: ['scoped-model'] })),
    })
    await openCard()
    expect(screen.getByText('跟随 CLI 配置：scoped-model')).toBeTruthy()
  })

  it('falls to 跟随 CLI 内置默认 when no layer names a model', async () => {
    renderCard({ modelInfo: () => Promise.resolve(modelSurface()) })
    await openCard()
    expect(screen.getByText(zh['model.followCliBuiltin'])).toBeTruthy()
  })

  it('the surface choices become the input suggestions, ahead of the recent-models memory', async () => {
    renderCard({
      value: { live: false, recentModels: ['recent-a'] },
      modelInfo: () => Promise.resolve(modelSurface({ choices: ['model-a', 'scoped-model'] })),
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title'])
    const list = document.getElementById(input.getAttribute('list') ?? '')
    expect([...list!.querySelectorAll('option')].map(option => option.getAttribute('value')))
      .toEqual(['model-a', 'scoped-model'])
  })

  it('degrades to the bare input when the remote answers null (a brokerless core)', async () => {
    renderCard({
      value: { live: false, recentModels: ['recent-a'] },
      modelInfo: () => Promise.resolve(null),
    })
    await openCard()
    expect(screen.queryByText(zh['model.followCliBuiltin'])).toBeNull()
    const input = screen.getByLabelText(zh['model.title'])
    const list = document.getElementById(input.getAttribute('list') ?? '')
    expect([...list!.querySelectorAll('option')].map(option => option.getAttribute('value')))
      .toEqual(['recent-a'])
  })

  it('keeps the bare input when no model surface was injected at all', async () => {
    renderCard({})
    await openCard()
    expect(screen.queryByText(zh['model.followCliBuiltin'])).toBeNull()
    expect(screen.getByLabelText(zh['model.title'])).toBeTruthy()
  })

  it('refetches the surface after a save (the settings layer changed)', async () => {
    const modelInfo = vi.fn(() => Promise.resolve(modelSurface()))
    const harness = renderCard({ modelInfo })
    await openCard()
    expect(modelInfo).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.set).toHaveBeenCalledWith('model', 'model-b')
    expect(modelInfo).toHaveBeenCalledTimes(2)
  })

  it('shows an always-visible chevron that opens a menu; a pick fills the input as a draft', async () => {
    renderCard({
      modelInfo: () => Promise.resolve(modelSurface({ source: 'cli-config', effective: 'scoped-model', cliDefault: 'scoped-model', choices: ['scoped-model', 'discovered/x'] })),
    })
    await openCard()
    const menuButton = screen.getByRole('button', { name: zh['model.menu'] })
    fireEvent.click(menuButton)
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map(item => item.textContent)).toEqual(['scoped-model', 'discovered/x'])
    // The current input value reads as the checked item.
    expect(items[0].getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'discovered/x' }))
    // A pick is exactly a typed value: the menu closes, the draft waits for 保存.
    expect(screen.queryByRole('menu')).toBeNull()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('discovered/x')
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('closes the menu on Esc', async () => {
    renderCard({
      modelInfo: () => Promise.resolve(modelSurface({ choices: ['scoped-model'] })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu from the recent-models memory too (broker absent)', async () => {
    renderCard({
      value: { live: false, recentModels: ['recent-a', 'recent-b'] },
      modelInfo: () => Promise.resolve(null),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['recent-a', 'recent-b'])
  })

  it('renders no menu affordance when nothing names a model (a fresh install)', async () => {
    renderCard({ modelInfo: () => Promise.resolve(modelSurface()) })
    await openCard()
    expect(screen.queryByRole('button', { name: zh['model.menu'] })).toBeNull()
  })

  it('the empty field\'s placeholder names the CLI config default the broker read', async () => {
    renderCard({
      modelInfo: () => Promise.resolve(modelSurface({ source: 'cli-config', effective: 'scoped-model', cliDefault: 'scoped-model', choices: ['scoped-model'] })),
    })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder)
      .toBe('留空 = 跟随 CLI 配置：scoped-model')
  })

  it('keeps the generic placeholder when the broker knows no default', async () => {
    renderCard({ modelInfo: () => Promise.resolve(modelSurface()) })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder)
      .toBe(zh['model.placeholder'])
  })
})
