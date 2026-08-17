// @vitest-environment jsdom
/**
 * The composer-tool-row compact button: appears automatically once the next
 * request's budget crosses the threshold (and not before), carries the
 * warning/overdue states, and drives the injected /compact verb.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { CompactGuardButton } from '../src/client/CompactGuardButton.tsx'
import type { CompactGuardButtonProps } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const WINDOW = 400_000
/** Mirrors the plugin's injected default: the main request's 256k output reservation. */
const DEFAULT_MAX_TOKENS = 256_000

/** Locale seat stub: the English dictionary, params ignored (presence tests). */
const t = ((key: string) => en[key as keyof typeof en] ?? key) as CompactGuardButtonProps['t']

interface Pressure {
  projectedTokens?: number
  pressureTokens?: number
  contextWindow?: number
}

function renderGuard(overrides: {
  pressure?: Pressure
  thresholdRatio?: number
  maxTokens?: number
  compactNow?: () => Promise<string | null>
  /** Settings-scope snapshot the `useConfig` hook serves; undefined value falls back to the props. */
  configValue?: { thresholdRatio: number; maxTokens: number }
} = {}) {
  const pressure = overrides.pressure
  const useProjection = (key: string) => (key === 'contextPressure' ? pressure : undefined)
  const compactNow = overrides.compactNow ?? vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
  const useConfig = () => ({
    status: 'ready' as const,
    value: overrides.configValue,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host' as const,
  })
  const props = {
    useProjection,
    useConfig,
    thresholdRatio: overrides.thresholdRatio ?? 0.8,
    maxTokens: overrides.maxTokens ?? DEFAULT_MAX_TOKENS,
    compactNow,
    t,
  } as unknown as CompactGuardButtonProps
  const view = render(<CompactGuardButton {...props} />)
  return { view, compactNow }
}

function buttonOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('button')
}

describe('CompactGuardButton', () => {
  it('renders nothing while the context pressure is unknown', () => {
    const { view } = renderGuard({ pressure: undefined })
    expect(buttonOf(view.container)).toBeNull()
    const { view: partial } = renderGuard({ pressure: { projectedTokens: 50_000 } })
    expect(buttonOf(partial.container)).toBeNull()
    const { view: noWindow } = renderGuard({ pressure: { projectedTokens: 50_000, contextWindow: undefined } })
    expect(buttonOf(noWindow.container)).toBeNull()
  })

  it('renders nothing below the threshold', () => {
    const { view } = renderGuard({ pressure: { projectedTokens: 60_000, contextWindow: WINDOW } })
    // 60k + 256k = 316k < 320k — below 80%.
    expect(buttonOf(view.container)).toBeNull()
  })

  it('appears automatically once context + maxTokens crosses the threshold', () => {
    const { view } = renderGuard({ pressure: { projectedTokens: 72_000, contextWindow: WINDOW } })
    // 72k + 256k = 328k >= 320k — warning, even though context alone is 18%.
    const button = buttonOf(view.container)
    expect(button).not.toBeNull()
    expect(button?.className).toContain('warning')
  })

  it('uses the provider-projected figure when present', () => {
    // projectedTokens carries the surface's movement since the sample; the
    // button must react to it, not to the stale bare sample. At a 20%
    // threshold, the projected 85k crosses while the bare-sample 70k would not.
    const { view } = renderGuard({
      pressure: { pressureTokens: 60_000, projectedTokens: 75_000, contextWindow: WINDOW },
      maxTokens: 10_000,
      thresholdRatio: 0.2,
    })
    expect(buttonOf(view.container)).not.toBeNull()
  })

  it('turns red once the budget already exceeds the window', () => {
    const { view } = renderGuard({
      pressure: { projectedTokens: 390_000, contextWindow: WINDOW },
      maxTokens: 20_000,
    })
    // 390k + 20k = 410k > 400k — overdue.
    const button = buttonOf(view.container)
    expect(button).not.toBeNull()
    expect(button?.className).toContain('overdue')
  })

  it('reads the threshold and budget from the live settings section when served', () => {
    // The fallback maxTokens (256k) would show the button at 72k+256k = 328k;
    // the settings section overrides it with 10k, so 72k+10k = 82k stays below
    // the 80% threshold (320k) and the button must NOT appear.
    const { view } = renderGuard({
      pressure: { projectedTokens: 72_000, contextWindow: WINDOW },
      configValue: { thresholdRatio: 0.8, maxTokens: 10_000 },
    })
    expect(buttonOf(view.container)).toBeNull()
  })

  it('runs the injected compact verb on click', () => {
    const compactNow = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
    const { view } = renderGuard({
      pressure: { projectedTokens: 72_000, contextWindow: WINDOW },
      compactNow,
    })
    fireEvent.click(buttonOf(view.container)!)
    expect(compactNow).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected compact as an error status', async () => {
    const compactNow = vi.fn<() => Promise<string | null>>()
      .mockResolvedValue('agent is busy (BUSY)')
    const { view } = renderGuard({
      pressure: { projectedTokens: 72_000, contextWindow: WINDOW },
      compactNow,
    })
    fireEvent.click(buttonOf(view.container)!)
    await act(async () => { await Promise.resolve() })
    const status = view.container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.getAttribute('title')).toBe('agent is busy (BUSY)')
  })
})
