// @vitest-environment jsdom
/**
 * The dsh settings surfaces: the 0.1.5 plugin-configuration-tab card
 * (collapsible chrome, the family core's shared ProviderAuthBlock — status
 * only, the DeepSeek delegation switch, the resident-mode block (live
 * switch) writing through the bound settingsScope, and the default-model
 * block reading the harness's broker surface with a bare-input degrade) and
 * the alpha.2 plugins.bundle.config entry (the summary one-liner, the bare
 * page form).
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
  DshBundleConfig, DshSettingsCard,
  type DshCardSettings, type DshBundleConfigProps, type DshSettingsCardProps,
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
  value: DshCardSettings | undefined,
  user?: Record<string, unknown>,
  base?: Record<string, unknown>,
): SettingsScopeSnapshot<DshCardSettings> {
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

/** The dsh probe: authenticated through the host credentials — never loginable. */
function dshStatus(authenticated: boolean): LocalAgentStatus {
  return {
    name: 'dsh', displayName: 'dsh', authenticated, homeDir: '/h',
    loginable: false, logoutable: false,
  }
}

interface CardHarness {
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
  }
}

interface CardOptions {
  value?: DshCardSettings
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  snapshot?: SettingsScopeSnapshot<DshCardSettings>
  authenticated?: boolean
  authStatus?: LocalAgentStatus | undefined
  harnessModel?: () => Promise<LocalAgentModelInfo | null | undefined>
}

/** The card props over a scope whose writes update the snapshot reactively. */
function makeCardProps(options: CardOptions): { props: Record<string, unknown> } & CardHarness {
  const defaults: DshCardSettings = { enabled: false, live: false }
  let snapshot: SettingsScopeSnapshot<DshCardSettings> = options.snapshot
    ?? makeSnapshot(options.value ?? defaults, options.user, options.base)
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, next: unknown) => {
    snapshot = makeSnapshot(
      { ...defaults, ...(snapshot.value ?? {}), [field]: next },
      { ...(snapshot.user !== undefined && typeof snapshot.user === 'object' && snapshot.user !== null ? snapshot.user : {}), [field]: next },
      typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base as Record<string, unknown> : undefined,
    )
    for (const listener of listeners) listener()
  })
  const unset = vi.fn(async (field: string) => {
    const user = { ...(snapshot.user !== undefined && typeof snapshot.user === 'object' && snapshot.user !== null ? snapshot.user : {}) }
    delete user[field]
    const baseValue = (typeof snapshot.base === 'object' && snapshot.base !== null ? snapshot.base : {}) as Partial<DshCardSettings>
    snapshot = makeSnapshot(
      { ...defaults, ...baseValue, ...(user as DshCardSettings) },
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
    'authStatus' in options ? options.authStatus : dshStatus(options.authenticated ?? false),
  )
  const runCommand = vi.fn(() => Promise.resolve(''))
  const harnessModel = vi.fn(options.harnessModel ?? (() => Promise.resolve(null)))
  const props = {
    useSettings: <T,>(select: (value: SettingsScopeSnapshot<DshCardSettings>) => T): T => select(snapshot),
    useSessions,
    scope,
    auth: { status, runCommand },
    authT,
    harnessModel,
    t,
  }
  return { props, scope: { set, unset } }
}

/** Render the 0.1.5 card over a scope whose writes update the snapshot reactively. */
function renderCard(options: CardOptions): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<DshSettingsCard {...props as unknown as DshSettingsCardProps} />)
  return { scope }
}

/** Render the alpha.2 bundle-config entry over the same reactive scope. */
function renderBundleConfig(entryView: 'summary' | 'page', options: CardOptions = {}): CardHarness {
  const { props, scope } = makeCardProps(options)
  render(<DshBundleConfig {...{ view: entryView, ...props } as unknown as DshBundleConfigProps} />)
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

describe('DshSettingsCard', () => {
  it('renders the default states: unauthenticated, delegation off, live off — and NO login action', async () => {
    renderCard({})
    await openCard()

    expect(screen.getByText(coreZh['settings.notAuthenticated'])).toBeTruthy()
    // dsh authenticates through the host credentials: no login/reauthorize button.
    expect(screen.queryByRole('button', { name: coreZh['settings.login'] })).toBeNull()
    expect(screen.getByText(zh['auth.host'])).toBeTruthy()
    const enable = screen.getByRole('switch', { name: zh['enable.switch.aria'] })
    expect(enable.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(zh['enable.off'])).toBeTruthy()
    const live = screen.getByRole('switch', { name: zh['live.title'] })
    expect(live.getAttribute('aria-checked')).toBe('false')
  })

  it('renders authenticated state with delegation and live on, still without login actions', async () => {
    renderCard({
      authenticated: true,
      value: { enabled: true, live: true },
    })
    await openCard()

    expect(screen.getByText(coreZh['settings.authenticated'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: coreZh['settings.logout'] })).toBeNull()
    expect(screen.queryByRole('button', { name: coreZh['settings.reauthorize'] })).toBeNull()
    expect(screen.getByRole('switch', { name: zh['enable.switch.aria'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh['enable.on'])).toBeTruthy()
    expect(screen.getByRole('switch', { name: zh['live.title'] }).getAttribute('aria-checked')).toBe('true')
  })

  it('marks the auth block unavailable when the probe reports undefined (core absent)', async () => {
    renderCard({ authStatus: undefined })
    await openCard()
    expect(screen.getByText(coreZh['error'])).toBeTruthy()
  })

  it('writes the delegation switch through the scope', async () => {
    const { scope } = renderCard({})
    await openCard()

    fireEvent.click(screen.getByRole('switch', { name: zh['enable.switch.aria'] }))
    await act(async () => {})
    expect(scope.set).toHaveBeenCalledWith('enabled', true)
    expect(screen.getByRole('switch', { name: zh['enable.switch.aria'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(zh['enable.on'])).toBeTruthy()
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

  it('disables every control and explains while the namespace is unavailable', async () => {
    renderCard({
      snapshot: { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' },
    })
    await openCard()

    expect((screen.getByRole('switch', { name: zh['enable.switch.aria'] }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: zh['live.title'] }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(zh['live.unavailable'])).toBeTruthy()
  })
})

describe('DshSettingsCard default-model block', () => {
  it('shows the stored model and saves an edited one as the model key', async () => {
    const harness = renderCard({ value: { enabled: true, live: false, model: 'model-a' } })
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
    const harness = renderCard({ value: { enabled: true, live: false, model: 'model-a' } })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.unset).toHaveBeenCalledWith('model')
    // An unset must not also write an empty string over the base.
    expect(harness.scope.set).not.toHaveBeenCalledWith('model', '')
  })

  it('a saved model joins the suggestions most-recent-first, deduplicated', async () => {
    const harness = renderCard({
      value: { enabled: true, live: false, recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['model.save'] })) })
    expect(harness.scope.set).toHaveBeenCalledWith('recentModels', ['model-b', 'model-a'])
  })

  it('offers the saved suggestions through the menu without hardcoding any model catalog', async () => {
    renderCard({
      value: { enabled: true, live: false, recentModels: ['model-a', 'model-b'] },
    })
    await openCard()
    // No datalist anywhere: the chevron menu is the single choice list.
    expect(document.body.querySelector('datalist')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'model-a', 'model-b'])
  })

  it('save stays disabled while the field still matches what is stored', async () => {
    renderCard({ value: { enabled: true, live: false, model: 'model-a' } })
    await openCard()
    const save = screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['model.title']), { target: { value: 'model-b' } })
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('DshSettingsCard model surface (harness broker)', () => {
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
      value: { enabled: true, live: false, model: 'deepseek-official/deepseek-chat' },
      harnessModel: () => Promise.resolve(info({
        effective: 'deepseek-official/deepseek-chat',
        source: 'settings',
        settings: 'deepseek-official/deepseek-chat',
        choices: ['deepseek-official/deepseek-chat'],
      })),
    })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('deepseek-official/deepseek-chat')
  })

  it('an unset field displays the host default model dimmed (placeholder), never as a pinned value', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({
        effective: 'deepseek-official/deepseek-chat',
        source: 'cli-config',
        cliDefault: 'deepseek-official/deepseek-chat',
        choices: ['deepseek-official/deepseek-chat'],
      })),
    })
    await openCard()
    const input = screen.getByLabelText(zh['model.title']) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('deepseek-official/deepseek-chat')
  })

  it('keeps the generic placeholder when the broker knows no default', async () => {
    renderCard({ harnessModel: () => Promise.resolve(info()) })
    await openCard()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder)
      .toBe(zh['model.placeholder'])
  })

  it('renders no separate effective-model line — the information lives inside the control', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({
        effective: 'deepseek-official/deepseek-chat',
        source: 'cli-config',
        cliDefault: 'deepseek-official/deepseek-chat',
        choices: ['deepseek-official/deepseek-chat'],
      })),
    })
    await openCard()
    expect(screen.queryByText(/跟随宿主/)).toBeNull()
    expect(screen.queryByText(/当前生效/)).toBeNull()
  })

  it('the menu vocabulary is the broker choices, not only the recent memory', async () => {
    renderCard({
      value: { enabled: true, live: false, recentModels: ['recent/model'] },
      harnessModel: () => Promise.resolve(info({ choices: ['config/model', 'deepseek-official/deepseek-chat', 'recent/model'] })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual([zh['model.menuDefault'] + '✓', 'config/model', 'deepseek-official/deepseek-chat', 'recent/model'])
  })

  it('degrades to the bare input when the gateway answers null (recent models stay)', async () => {
    renderCard({
      value: { enabled: true, live: false, recentModels: ['model-a'] },
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
      harnessModel: () => Promise.resolve(info({
        effective: 'deepseek-official/deepseek-chat', source: 'cli-config',
        cliDefault: 'deepseek-official/deepseek-chat',
        choices: ['deepseek-official/deepseek-chat', 'config/model'],
      })),
    })
    await openCard()
    const menuButton = screen.getByRole('button', { name: zh['model.menu'] })
    fireEvent.click(menuButton)
    const items = screen.getAllByRole('menuitemradio')
    // The leading item is the follow-default choice, checked while unset.
    expect(items[0].textContent).toBe('默认（跟随宿主默认模型：deepseek-official/deepseek-chat）✓')
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    expect(items.slice(1).map(item => item.textContent)).toEqual(['deepseek-official/deepseek-chat', 'config/model'])
    expect(items[1].getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'config/model' }))
    // A pick is exactly a typed value: the menu closes, the draft waits for 保存.
    expect(screen.queryByRole('menu')).toBeNull()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).value).toBe('config/model')
    expect((screen.getByRole('button', { name: zh['model.save'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the default item clears the draft back to follow-default; a save then unsets the key', async () => {
    const harness = renderCard({
      value: { enabled: true, live: false, model: 'config/model' },
      harnessModel: () => Promise.resolve(info({
        effective: 'config/model', source: 'settings', settings: 'config/model',
        cliDefault: 'deepseek-official/deepseek-chat',
        choices: ['deepseek-official/deepseek-chat', 'config/model'],
      })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    // The stored model reads checked, the default item does not.
    expect(screen.getByRole('menuitemradio', { name: 'config/model' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '默认（跟随宿主默认模型：deepseek-official/deepseek-chat）' }))
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

    // Rung 2: a cli-builtin source that still names its default beats the
    // last-observed annotation.
    renderCard({
      harnessModel: () => Promise.resolve(info({ effective: 'catalog/model', lastObserved: 'observed/model', choices: ['x'] })),
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随宿主默认：catalog\/model）/ })).toBeTruthy()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('catalog/model')
    cleanup()
    document.body.innerHTML = ''

    // Rung 3: nothing names a model, but the records observed one.
    renderCard({
      harnessModel: () => Promise.resolve(info({ lastObserved: 'observed/model', choices: ['x'] })),
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随宿主实例默认（最近：observed\/model））/ })).toBeTruthy()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('observed/model')
    cleanup()
    document.body.innerHTML = ''

    // Rung 1: the host's default-model selection outranks both.
    renderCard({
      harnessModel: () => Promise.resolve(info({
        effective: 'deepseek-official/deepseek-chat', source: 'cli-config',
        cliDefault: 'deepseek-official/deepseek-chat', lastObserved: 'observed/model',
        choices: ['deepseek-official/deepseek-chat'],
      })),
    })
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /默认（跟随宿主默认模型：deepseek-official\/deepseek-chat）/ })).toBeTruthy()
    expect((screen.getByLabelText(zh['model.title']) as HTMLInputElement).placeholder).toBe('deepseek-official/deepseek-chat')
  })

  it('closes the menu on Esc', async () => {
    renderCard({
      harnessModel: () => Promise.resolve(info({ choices: ['deepseek-official/deepseek-chat'] })),
    })
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: zh['model.menu'] }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu from the recent-models memory too (broker absent)', async () => {
    renderCard({
      value: { enabled: true, live: false, recentModels: ['model-a', 'model-b'] },
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

describe('DshBundleConfig', () => {
  it('renders the one-liner alone in the summary view and never reads the model surface', async () => {
    const harnessModel = vi.fn(() => Promise.resolve(null))
    renderBundleConfig('summary', { harnessModel })
    await act(async () => {})
    expect(document.body.textContent).toContain(zh['card.description'])
    expect(document.body.querySelector('button')).toBeNull()
    expect(document.body.querySelector('input')).toBeNull()
    expect(harnessModel).not.toHaveBeenCalled()
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
