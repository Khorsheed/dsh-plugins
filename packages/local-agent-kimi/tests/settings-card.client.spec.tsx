// @vitest-environment jsdom
/**
 * The kimi settings card in the plugin configuration tab: collapsible chrome,
 * the family core's shared ProviderAuthBlock embedded for the auth states, the
 * default-model block (a free-text field that DISPLAYS the followed default
 * dimmed while unset, a chevron menu with a leading follow-default item plus
 * the broker's full unfiltered vocabulary), and the resident-mode switch
 * writing through the bound settingsScope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LocalAgentModelInfo, LocalAgentStatus } from '@khorsheed/dsh-local-agent/types'
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
  modelInfo?: LocalAgentModelInfo | undefined
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
  const harnessModel = vi.fn(async () => options.modelInfo)
  const props = {
    useSettings: <T,>(select: (value: SettingsScopeSnapshot<KimiLiveSettings>) => T): T => select(snapshot),
    useSessions,
    scope,
    auth: { status, runCommand },
    authT,
    harnessModel,
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

describe('KimiSettingsCard default-model block', () => {
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

  it('offers the saved suggestions through the menu without hardcoding any model catalog', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    // No datalist anywhere: the chevron menu is the single choice list.
    expect(document.body.querySelector('datalist')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a', 'model-b'])
  })

  it('save stays disabled while the field still matches what is stored', async () => {
    renderCard({ value: { live: false, liveMirrorGranularity: 'event', model: 'model-a' } })
    await openCard()
    const save = screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('an unset field displays the CLI config default dimmed (placeholder), never as a pinned value', async () => {
    renderCard({
      modelInfo: { effective: 'cli-model', source: 'cli-config', cliDefault: 'cli-model', choices: ['cli-model'], live: false, switchable: true },
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title']) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('cli-model')
  })

  it('a set field shows the stored model as a real value, not a placeholder', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', model: 'model-a' },
      modelInfo: { effective: 'model-a', source: 'settings', settings: 'model-a', cliDefault: 'cli-model', choices: ['model-a', 'cli-model'], live: false, switchable: true },
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title']) as HTMLInputElement
    expect(input.value).toBe('model-a')
  })

  it('renders no separate effective-model line — the information lives inside the control', async () => {
    renderCard({
      modelInfo: { effective: 'cli-model', source: 'cli-config', cliDefault: 'cli-model', choices: ['cli-model'], live: false, switchable: true },
    })
    await openCard()
    expect(screen.queryByText(/跟随 CLI/)).toBeNull()
  })

  it('suggests the broker choices through the menu instead of only the recent saves', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['recent-one'] },
      modelInfo: { effective: 'cli-model', source: 'cli-config', cliDefault: 'cli-model', choices: ['cli-model', 'discovered/x', 'recent-one'], live: false, switchable: true },
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['默认（跟随 CLI 配置：cli-model）✓', 'cli-model', 'discovered/x', 'recent-one'])
  })

  it('degrades to the bare field when the broker answers null (no menu, recent suggestions only)', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['model-a'] },
      modelInfo: undefined,
    })
    await openCard()
    expect(screen.queryByText(/跟随/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a'])
  })

  it('shows an always-visible chevron that opens a menu; a pick fills the input as a draft', async () => {
    renderCard({
      modelInfo: { effective: 'cli-model', source: 'cli-config', cliDefault: 'cli-model', choices: ['cli-model', 'discovered/x'], live: false, switchable: true },
    })
    await openCard()
    const menuButton = screen.getByRole('button', { name: zh['model.menu'] })
    fireEvent.click(menuButton)
    const items = screen.getAllByRole('menuitemradio')
    // The leading item is the follow-default choice, checked while unset.
    expect(items[0].textContent).toBe('默认（跟随 CLI 配置：cli-model）✓')
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    expect(items.slice(1).map(item => item.textContent)).toEqual(['cli-model', 'discovered/x'])
    expect(items[1].getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'discovered/x' }))
    // A pick is exactly a typed value: the menu closes, the draft waits for 保存.
    expect(screen.queryByRole('menu')).toBeNull()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('discovered/x')
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the default item clears the draft back to follow-default; a save then unsets the key', async () => {
    const harness = renderCard({
      value: { live: false, liveMirrorGranularity: 'event', model: 'model-a' },
      modelInfo: { effective: 'model-a', source: 'settings', settings: 'model-a', cliDefault: 'cli-model', choices: ['model-a', 'cli-model'], live: false, switchable: true },
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    // The stored model reads checked, the default item does not.
    expect(screen.getByRole('menuitemradio', { name: 'model-a' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '默认（跟随 CLI 配置：cli-model）' }))
    // The field goes blank (displaying the inherited default again) and 保存 arms.
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.unset).toHaveBeenCalledWith('model')
  })

  it('closes the menu on Esc', async () => {
    renderCard({
      modelInfo: { effective: 'cli-model', source: 'cli-config', cliDefault: 'cli-model', choices: ['cli-model'], live: false, switchable: true },
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu from the recent-models memory too (no broker surface)', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['model-a', 'model-b'] },
      modelInfo: undefined,
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a', 'model-b'])
  })

  it('renders no menu affordance when nothing names a model (a fresh install)', async () => {
    renderCard({
      modelInfo: { source: 'cli-builtin', choices: [], live: false, switchable: true },
    })
    await openCard()
    expect(screen.queryByRole('button', { name: zh['model.menu'] })).toBeNull()
  })

  it('the menu default item walks the same chain the old placeholder did', async () => {
    const openMenu = async (): Promise<void> => {
      await openCard()
      fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    }

    // Rung 2: a cli-builtin source that still names its default (a catalog's
    // isDefault entry) beats the last-observed annotation.
    renderCard({
      modelInfo: { effective: 'catalog-default', source: 'cli-builtin', lastObserved: 'observed-model', choices: ['x'], live: false, switchable: true },
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随 CLI 默认：catalog-default）/ })).toBeTruthy()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('catalog-default')
    cleanup()
    document.body.innerHTML = ''

    // Rung 3: nothing names a model, but the records observed one.
    renderCard({
      modelInfo: { source: 'cli-builtin', lastObserved: 'observed-model', choices: ['x'], live: false, switchable: true },
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随 CLI 内置默认（最近：observed-model））/ })).toBeTruthy()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('observed-model')
    cleanup()
    document.body.innerHTML = ''

    // Rung 1: the scoped config's default outranks both.
    renderCard({
      modelInfo: { effective: 'cli-model', source: 'cli-config', cliDefault: 'cli-model', lastObserved: 'observed-model', choices: ['cli-model'], live: false, switchable: true },
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随 CLI 配置：cli-model）/ })).toBeTruthy()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('cli-model')
  })

  it('keeps the generic placeholder and generic default item when the broker knows no default', async () => {
    renderCard({
      value: { live: false, liveMirrorGranularity: 'event', recentModels: ['model-a'] },
      modelInfo: { source: 'cli-builtin', choices: ['model-a'], live: false, switchable: true },
    })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder)
      .toBe(zh['model.placeholder'])
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio')[0].textContent).toContain(zh['model.menuDefault'])
  })
})
