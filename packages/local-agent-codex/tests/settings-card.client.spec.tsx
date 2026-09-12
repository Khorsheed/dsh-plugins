// @vitest-environment jsdom
/**
 * The codex settings card in the plugin configuration tab: collapsible chrome,
 * the family core's shared ProviderAuthBlock embedded for the auth states, the
 * resident-mode block (live switch) writing through the bound settingsScope,
 * and the default-model block reading the harness's broker surface (an unset
 * field DISPLAYS the followed default dimmed; the chevron menu leads with a
 * follow-default item over the full unfiltered vocabulary) with a bare-input
 * degrade.
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
  CodexSettingsCard, type CodexLiveSettings, type CodexSettingsCardProps,
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
  return { name: 'codex', displayName: 'Codex', authenticated, homeDir: '/h' }
}

interface CardHarness {
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
  }
}

/** Render the card over a scope whose writes update the snapshot reactively. */
function renderCard(options: {
  value?: CodexLiveSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<CodexLiveSettings>
  authenticated?: boolean
  authStatus?: LocalAgentStatus | undefined
  runCommand?: (sessionId: SessionId, line: string) => Promise<string | undefined>
  harnessModel?: () => Promise<LocalAgentModelInfo | null | undefined>
}): CardHarness {
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
  const harnessModel = vi.fn(options.harnessModel ?? (() => Promise.resolve(null)))
  const props = {
    useSettings: <T,>(select: (value: SettingsScopeSnapshot<CodexLiveSettings>) => T): T => select(snapshot),
    useSessions,
    scope,
    auth: { status, runCommand },
    authT,
    harnessModel,
    t,
  } as unknown as CodexSettingsCardProps
  render(<CodexSettingsCard {...props} />)
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

describe('CodexSettingsCard', () => {
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
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(zh['live.unavailable'])).toBeTruthy()
  })

  it('runs the auth login flow from the card (device-code prompt + open page link)', async () => {
    const runCommand = vi.fn().mockResolvedValue('Device login started.\nhttps://auth.openai.com/codex/device?user_code=ABCD\nComplete in the browser.')
    renderCard({ runCommand })
    await openCard()

    fireEvent.click(screen.getByRole('button', { name: coreZh['settings.login'] }))
    await act(async () => {})
    expect(runCommand).toHaveBeenCalledWith(SESSION, '/codex login')
    const link = screen.getByRole('link', { name: coreZh['settings.openPage'] })
    expect(link.getAttribute('href')).toBe('https://auth.openai.com/codex/device?user_code=ABCD')
    // (Full login/poll/toast parity is pinned by the core package's block spec.)
  })
})

describe('CodexSettingsCard default-model block', () => {
  it('shows the stored model and saves an edited one as the model key', async () => {
    const harness = renderCard({ value: { live: false, model: 'model-a' } })
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
    const harness = renderCard({ value: { live: false, model: 'model-a' } })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.unset).toHaveBeenCalledWith('model')
    // An unset must not also write an empty string over the base.
    expect(harness.scope.set).not.toHaveBeenCalledWith('model', '')
  })

  it('a saved model joins the suggestions most-recent-first, deduplicated', async () => {
    const harness = renderCard({
      value: { live: false, recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.set).toHaveBeenCalledWith('recentModels', ['model-b', 'model-a'])
  })

  it('offers the saved suggestions through the menu without hardcoding any model catalog', async () => {
    renderCard({
      value: { live: false, recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    // No datalist anywhere: the chevron menu is the single choice list.
    expect(document.body.querySelector('datalist')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a', 'model-b'])
  })

  it('save stays disabled while the field still matches what is stored', async () => {
    renderCard({ value: { live: false, model: 'model-a' } })
    await openCard()
    const save = screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('CodexSettingsCard model surface (harness broker)', () => {
  /** One broker answer, with every layer overridable. */
  function info(over: Partial<LocalAgentModelInfo> = {}): LocalAgentModelInfo {
    return {
      source: 'cli-builtin',
      choices: [],
      live: false,
      switchable: true,
      ...over,
    }
  }

  it('a set field shows the stored model as a real value, not a placeholder', async () => {
    renderCard({
      value: { live: false, model: 'model-a' },
      harnessModel: () => Promise.resolve(info({ effective: 'model-a', source: 'settings', settings: 'model-a', choices: ['model-a'] })),
    })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('model-a')
  })

  it('an unset field displays the CLI config default dimmed (placeholder), never as a pinned value', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({ effective: 'gpt-5.2', source: 'cli-config', cliDefault: 'gpt-5.2', choices: ['gpt-5.2'] })),
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title']) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('gpt-5.2')
  })

  it('an unset field displays the catalog default when cli-builtin carries an effective model', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({
        effective: 'gpt-5.6-sol', source: 'cli-builtin', choices: ['gpt-5.6-sol'],
      })),
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title']) as HTMLInputElement
    expect(input.placeholder).toBe('gpt-5.6-sol')
  })

  it('an unset field displays the last observed model when nothing names one', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({ lastObserved: 'gpt-5.5' })),
    })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('gpt-5.5')
  })

  it('keeps the generic placeholder when the broker knows no default', async () => {
    renderCard({ harnessModel: () => Promise.resolve(info()) })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder)
      .toBe(zh['model.placeholder'])
  })

  it('renders no separate effective-model line — the information lives inside the control', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({ effective: 'gpt-5.2', source: 'cli-config', cliDefault: 'gpt-5.2', choices: ['gpt-5.2'] })),
    })
    await openCard()
    expect(screen.queryByText(/跟随 CLI/)).toBeNull()
    expect(screen.queryByText(/当前生效/)).toBeNull()
  })

  it('the menu vocabulary is the broker choices, not only the recent memory', async () => {
    renderCard({
      value: { live: false, recentModels: ['model-a'] },
      harnessModel: () => Promise.resolve(info({ choices: ['gpt-5.2', 'gpt-5.1', 'model-a'] })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'gpt-5.2', 'gpt-5.1', 'model-a'])
  })

  it('degrades to the bare input when the gateway answers null (recent models stay)', async () => {
    renderCard({
      value: { live: false, recentModels: ['model-a'] },
      harnessModel: () => Promise.resolve(null),
    })
    await openCard()
    expect(screen.queryByText(/跟随/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a'])
  })

  it('shows an always-visible chevron that opens a menu; a pick fills the input as a draft', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({ effective: 'gpt-5.2', source: 'cli-config', cliDefault: 'gpt-5.2', choices: ['gpt-5.2', 'gpt-5.1'] })),
    })
    await openCard()
    const menuButton = screen.getByRole('button', { name: zh['model.menu'] })
    fireEvent.click(menuButton)
    const items = screen.getAllByRole('menuitemradio')
    // The leading item is the follow-default choice, checked while unset.
    expect(items[0].textContent).toBe('默认（跟随 CLI 配置：gpt-5.2）✓')
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    expect(items.slice(1).map(item => item.textContent)).toEqual(['gpt-5.2', 'gpt-5.1'])
    expect(items[1].getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'gpt-5.1' }))
    // A pick is exactly a typed value: the menu closes, the draft waits for 保存.
    expect(screen.queryByRole('menu')).toBeNull()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('gpt-5.1')
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the default item clears the draft back to follow-default; a save then unsets the key', async () => {
    const harness = renderCard({
      value: { live: false, model: 'gpt-5.1' },
      harnessModel: () => Promise.resolve(info({ effective: 'gpt-5.1', source: 'settings', settings: 'gpt-5.1', cliDefault: 'gpt-5.2', choices: ['gpt-5.2', 'gpt-5.1'] })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    // The stored model reads checked, the default item does not.
    expect(screen.getByRole('menuitemradio', { name: 'gpt-5.1' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '默认（跟随 CLI 配置：gpt-5.2）' }))
    // The field goes blank (displaying the inherited default again) and 保存 arms.
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.unset).toHaveBeenCalledWith('model')
  })

  it('the menu default item walks the same chain the old placeholder did', async () => {
    const openMenu = async (): Promise<void> => {
      await openCard()
      fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    }

    // Rung 2: the catalog's cli-builtin default beats the last-observed one.
    renderCard({
      harnessModel: () => Promise.resolve(info({ effective: 'gpt-5.6-sol', lastObserved: 'gpt-5.5', choices: ['x'] })),
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随 CLI 默认：gpt-5.6-sol）/ })).toBeTruthy()
    cleanup()
    document.body.innerHTML = ''

    // Rung 3: nothing names a model, but the records observed one.
    renderCard({
      harnessModel: () => Promise.resolve(info({ lastObserved: 'gpt-5.5', choices: ['x'] })),
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随 CLI 内置默认（最近：gpt-5.5））/ })).toBeTruthy()
    cleanup()
    document.body.innerHTML = ''

    // Rung 1: the scoped config's default outranks both.
    renderCard({
      harnessModel: () => Promise.resolve(info({ effective: 'gpt-5.2', source: 'cli-config', cliDefault: 'gpt-5.2', lastObserved: 'gpt-5.5', choices: ['gpt-5.2'] })),
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随 CLI 配置：gpt-5.2）/ })).toBeTruthy()
  })

  it('closes the menu on Esc', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({ choices: ['gpt-5.2'] })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu from the recent-models memory too (broker absent)', async () => {
    renderCard({
      value: { live: false, recentModels: ['model-a', 'model-b'] },
      harnessModel: () => Promise.resolve(null),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a', 'model-b'])
  })

  it('renders no menu affordance when nothing names a model (a fresh install)', async () => {
    renderCard({ harnessModel: () => Promise.resolve(info()) })
    await openCard()
    expect(screen.queryByRole('button', { name: zh['model.menu'] })).toBeNull()
  })
})
