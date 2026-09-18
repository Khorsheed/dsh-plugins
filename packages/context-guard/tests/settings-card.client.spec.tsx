// @vitest-environment jsdom
/**
 * The settings surfaces: the 0.1.5 plugin-configuration-tab card (collapsible
 * chrome, staged single-field editing, save writes through the shared
 * settingsScope, reset reverts to the composition layer, the overridden badge
 * tracks the user layer) and the alpha.2 plugins.bundle.config entry (the
 * summary one-liner, the bare page form).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { ContextGuardBundleConfig, ContextGuardSettingsCard } from '../src/client/SettingsCard.tsx'
import type { ContextGuardBundleConfigProps, ContextGuardSettingsCardProps } from '../src/client/slots.ts'
import type { ContextGuardConfig } from '../src/client/config.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const t = ((key: string) => en[key as keyof typeof en] ?? key) as ContextGuardSettingsCardProps['t']

interface CardHarness {
  view: ReturnType<typeof render>
  scope: {
    set: ReturnType<typeof vi.fn>
    unset: ReturnType<typeof vi.fn>
    getSnapshot: () => SettingsScopeSnapshot<ContextGuardConfig>
  }
}

function makeSnapshot(value: ContextGuardConfig | undefined, user?: Record<string, unknown>): SettingsScopeSnapshot<ContextGuardConfig> {
  return {
    status: 'ready',
    value,
    base: undefined,
    user,
    revision: 1,
    writable: true,
    mode: 'host',
  }
}

/** A scope stub whose writes update the snapshot reactively. */
function makeScope(initial?: Partial<ContextGuardConfig>): CardHarness['scope'] & { scope: ContextGuardSettingsCardProps['scope'] } {
  const set = vi.fn(async (field: string, next: unknown) => {
    snapshot = makeSnapshot(
      { thresholdRatio: 0.8, ...(snapshot.value ?? {}), [field]: next },
      { ...(snapshot.user ?? {}), [field]: next },
    )
    for (const listener of listeners) listener()
  })
  const unset = vi.fn(async (field: string) => {
    const nextValue = { ...(snapshot.value ?? { thresholdRatio: 0.8 }) }
    delete (nextValue as Record<string, unknown>)[field]
    const nextUser = { ...(snapshot.user ?? {}) }
    delete nextUser[field]
    snapshot = makeSnapshot(nextValue as ContextGuardConfig, nextUser)
    for (const listener of listeners) listener()
  })
  let snapshot: SettingsScopeSnapshot<ContextGuardConfig> = makeSnapshot(
    { thresholdRatio: 0.8, ...initial },
    initial === undefined ? undefined : {},
  )
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset,
  }
  return { scope: scope as ContextGuardSettingsCardProps['scope'], set, unset, getSnapshot: () => snapshot }
}

/** Render the 0.1.5 card over a scope whose writes update the snapshot reactively. */
function renderCard(initial?: Partial<ContextGuardConfig>): CardHarness {
  const { scope, set, unset, getSnapshot } = makeScope(initial)
  const useConfig = () => getSnapshot()
  const props = { useConfig, scope, t } as unknown as ContextGuardSettingsCardProps
  const view = render(<ContextGuardSettingsCard {...props} />)
  return { view, scope: { set, unset, getSnapshot } }
}

/** Render the alpha.2 bundle-config entry over the same reactive scope. */
function renderBundleConfig(entryView: 'summary' | 'page', initial?: Partial<ContextGuardConfig>): CardHarness {
  const { scope, set, unset, getSnapshot } = makeScope(initial)
  const useConfig = () => getSnapshot()
  const props = { view: entryView, useConfig, scope, t } as unknown as ContextGuardBundleConfigProps
  const view = render(<ContextGuardBundleConfig {...props} />)
  return { view, scope: { set, unset, getSnapshot } }
}

function inputsOf(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="number"]'))
}

/** The disclosure header: the only button carrying aria-expanded. */
function headerButton(container: HTMLElement): HTMLButtonElement {
  const header = container.querySelector('button[aria-expanded]')
  if (header === null) throw new Error('card header button missing')
  return header as HTMLButtonElement
}

/** Buttons by their localized label text (class names are CSS-module hashed). */
function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.trim() === text)
  if (button === undefined) throw new Error(`button "${text}" missing`)
  return button
}

/** A scope stub for tests that never write: the snapshot value stays undefined. */
const IDLE_SCOPE = {
  getSnapshot: () => makeSnapshot(undefined),
  subscribe: () => () => {},
  set: vi.fn(async () => {}),
  unset: vi.fn(async () => {}),
}

describe('ContextGuardSettingsCard', () => {
  it('renders nothing while the namespace is not served', () => {
    const useConfig = () => ({ ...makeSnapshot(undefined), status: 'unavailable' as const })
    const view = render(<ContextGuardSettingsCard {...{ useConfig, scope: IDLE_SCOPE, t } as unknown as ContextGuardSettingsCardProps} />)
    expect(view.container.querySelector('li')).toBeNull()
  })

  it('discloses the single field on open, prefilled from the section', () => {
    const { view } = renderCard({ thresholdRatio: 0.6 })
    fireEvent.click(headerButton(view.container))
    const inputs = inputsOf(view.container)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]!.value).toBe('0.6')
  })

  it('writes the ratio through the scope on save', async () => {
    const { view, scope } = renderCard()
    fireEvent.click(headerButton(view.container))
    const inputs = inputsOf(view.container)
    fireEvent.change(inputs[0]!, { target: { value: '0.7' } })
    fireEvent.click(buttonByText(view.container, 'Save'))
    await act(async () => { await Promise.resolve() })
    expect(scope.set).toHaveBeenCalledWith('thresholdRatio', 0.7)
  })

  it('reverts the ratio to the composition layer through unset', async () => {
    const { view, scope } = renderCard()
    fireEvent.click(headerButton(view.container))
    fireEvent.click(buttonByText(view.container, 'Reset'))
    await act(async () => { await Promise.resolve() })
    expect(scope.unset).toHaveBeenCalledWith('thresholdRatio')
  })

  it('marks the field as overridden when the user layer carries it', () => {
    const useConfig = () => makeSnapshot(
      { thresholdRatio: 0.7 },
      { thresholdRatio: 0.7 },
    )
    const view = render(<ContextGuardSettingsCard {...{ useConfig, scope: IDLE_SCOPE, t } as unknown as ContextGuardSettingsCardProps} />)
    fireEvent.click(headerButton(view.container))
    const badges = Array.from(view.container.querySelectorAll('[class*="adge"]'))
    expect(badges).toHaveLength(1)
  })

  it('blocks saving while a draft is out of range', async () => {
    const { view, scope } = renderCard()
    fireEvent.click(headerButton(view.container))
    const inputs = inputsOf(view.container)
    fireEvent.change(inputs[0]!, { target: { value: '2' } }) // > 1
    fireEvent.click(buttonByText(view.container, 'Save'))
    await act(async () => { await Promise.resolve() })
    expect(scope.set).not.toHaveBeenCalled()
  })
})

describe('ContextGuardBundleConfig', () => {
  it('renders the one-liner alone in the summary view', () => {
    const { view } = renderBundleConfig('summary', { thresholdRatio: 0.6 })
    expect(view.container.textContent).toContain(en['settings.description'])
    expect(inputsOf(view.container)).toHaveLength(0)
    expect(view.container.querySelector('button')).toBeNull()
  })

  it('renders the bare form in the page view, prefilled from the section, without the collapsible chrome', () => {
    const { view } = renderBundleConfig('page', { thresholdRatio: 0.6 })
    const inputs = inputsOf(view.container)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]!.value).toBe('0.6')
    expect(view.container.querySelector('button[aria-expanded]')).toBeNull()
    expect(view.container.querySelector('li')).toBeNull()
  })

  it('writes the ratio through the scope on save in the page view', async () => {
    const { view, scope } = renderBundleConfig('page')
    fireEvent.change(inputsOf(view.container)[0]!, { target: { value: '0.7' } })
    fireEvent.click(buttonByText(view.container, 'Save'))
    await act(async () => { await Promise.resolve() })
    expect(scope.set).toHaveBeenCalledWith('thresholdRatio', 0.7)
  })

  it('renders nothing in the page view while the namespace is not served', () => {
    const useConfig = () => ({ ...makeSnapshot(undefined), status: 'unavailable' as const })
    const view = render(<ContextGuardBundleConfig {...{ view: 'page', useConfig, scope: IDLE_SCOPE, t } as unknown as ContextGuardBundleConfigProps} />)
    expect(view.container.textContent).toBe('')
  })
})
