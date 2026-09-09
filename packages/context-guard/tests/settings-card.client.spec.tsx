// @vitest-environment jsdom
/**
 * The settings card in the plugin configuration tab: collapsible chrome,
 * staged single-field editing, save writes through the shared settingsScope,
 * reset reverts to the composition layer, and the overridden badge tracks the
 * user layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { ContextGuardSettingsCard } from '../src/client/SettingsCard.tsx'
import type { ContextGuardSettingsCardProps } from '../src/client/slots.ts'
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

/** Render the card over a scope whose writes update the snapshot reactively. */
function renderCard(initial?: Partial<ContextGuardConfig>): CardHarness {
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
  const useConfig = () => snapshot
  const props = { useConfig, scope, t } as unknown as ContextGuardSettingsCardProps
  const view = render(<ContextGuardSettingsCard {...props} />)
  return { view, scope: { set, unset, getSnapshot: () => snapshot } }
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
