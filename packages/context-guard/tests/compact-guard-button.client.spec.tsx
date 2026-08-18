// @vitest-environment jsdom
/**
 * The composer-tool-row compact button: appears automatically once the
 * context occupancy (the same figure the composer's ring shows) crosses the
 * threshold (and not before), stays in the amber tint at every level, and
 * drives the injected /compact verb.
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
  compactNow?: () => Promise<string | null>
  /** Settings-scope snapshot the `useConfig` hook serves; undefined value falls back to the props. */
  configValue?: { thresholdRatio: number }
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
    const { view } = renderGuard({ pressure: { projectedTokens: 300_000, contextWindow: WINDOW } })
    // 300k / 400k = 75% — below 80%.
    expect(buttonOf(view.container)).toBeNull()
  })

  it('appears automatically once occupancy crosses the threshold', () => {
    const { view } = renderGuard({ pressure: { projectedTokens: 320_001, contextWindow: WINDOW } })
    // 320k / 400k = 80.0% — warning, the same occupancy the ring would show.
    const button = buttonOf(view.container)
    expect(button).not.toBeNull()
    expect(button?.className).toContain('warning')
  })

  it('uses the provider-projected figure when present', () => {
    // projectedTokens carries the surface's movement since the sample; the
    // button must react to it, not to the stale bare sample. At a 20%
    // threshold, projected 85k (21.25%) crosses while bare-sample 60k would not.
    const { view } = renderGuard({
      pressure: { pressureTokens: 60_000, projectedTokens: 85_000, contextWindow: WINDOW },
      thresholdRatio: 0.2,
    })
    expect(buttonOf(view.container)).not.toBeNull()
  })

  it('stays amber even when occupancy reaches the whole window', () => {
    const { view } = renderGuard({
      pressure: { projectedTokens: 410_000, contextWindow: WINDOW },
    })
    // 410k / 400k = 102.5% — overdue floor, but the tint stays warning and the
    // aria carries the single occupancy-based label (template, params stubbed).
    const button = buttonOf(view.container)
    expect(button).not.toBeNull()
    expect(button?.className).toContain('warning')
    expect(button?.getAttribute('aria-label')).toContain('Context at')
  })

  it('reads the threshold from the live settings section when served', () => {
    // The fallback threshold (0.8) would show the button at 320k/400k = 80%;
    // the settings section raises it to 0.9, so the same occupancy stays below
    // and the button must NOT appear.
    const { view } = renderGuard({
      pressure: { projectedTokens: 320_000, contextWindow: WINDOW },
      configValue: { thresholdRatio: 0.9 },
    })
    expect(buttonOf(view.container)).toBeNull()
  })

  it('runs the injected compact verb on click', () => {
    const compactNow = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)
    const { view } = renderGuard({
      pressure: { projectedTokens: 340_000, contextWindow: WINDOW },
      compactNow,
    })
    fireEvent.click(buttonOf(view.container)!)
    expect(compactNow).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected compact as an error status', async () => {
    const compactNow = vi.fn<() => Promise<string | null>>()
      .mockResolvedValue('agent is busy (BUSY)')
    const { view } = renderGuard({
      pressure: { projectedTokens: 340_000, contextWindow: WINDOW },
      compactNow,
    })
    fireEvent.click(buttonOf(view.container)!)
    await act(async () => { await Promise.resolve() })
    const status = view.container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.getAttribute('title')).toBe('agent is busy (BUSY)')
  })
})
