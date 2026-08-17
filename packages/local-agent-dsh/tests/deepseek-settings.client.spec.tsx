// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { DeepSeekSettingsSection, type DeepSeekSettingsProps } from '../src/client/DeepSeekSettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: DeepSeekSettingsProps['t'] = makeTranslate(zh)

/** A fake settings scope with a controllable snapshot and set. */
function fakeScope(initial: SettingsScopeSnapshot<{ enabled: boolean }>) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    scope: {
      getSnapshot: () => snapshot,
      set: vi.fn(async (field: string, value: unknown) => {
        snapshot = { ...snapshot, value: { enabled: value === true } }
        for (const listener of listeners) listener()
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    snapshot: () => snapshot,
  }
}

function ready(value: { enabled: boolean }): SettingsScopeSnapshot<{ enabled: boolean }> {
  return { status: 'ready', value, base: {}, user: undefined, revision: 1, writable: true, mode: 'host' }
}

describe('DeepSeek settings section', () => {
  it('renders the switch in the off state by default', () => {
    const fake = fakeScope(ready({ enabled: false }))
    render(<DeepSeekSettingsSection t={t} scope={fake.scope as never} subscribe={fake.scope.subscribe as never} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('writes the namespace through the bound scope when toggled on', async () => {
    const fake = fakeScope(ready({ enabled: false }))
    render(<DeepSeekSettingsSection t={t} scope={fake.scope as never} subscribe={fake.scope.subscribe as never} />)
    const toggle = screen.getByRole('switch')
    fireEvent.click(toggle)
    expect(fake.scope.set).toHaveBeenCalledWith('enabled', true)
    // The snapshot replacement re-renders the switch on.
    await act(async () => {})
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('flips back off through the scope write', async () => {
    const fake = fakeScope(ready({ enabled: true }))
    render(<DeepSeekSettingsSection t={t} scope={fake.scope as never} subscribe={fake.scope.subscribe as never} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(fake.scope.set).toHaveBeenCalledWith('enabled', false)
    await act(async () => {})
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('disables the switch while the namespace is unavailable', () => {
    const fake = fakeScope({ status: 'unavailable', value: undefined, base: {}, user: undefined, revision: undefined, writable: false, mode: 'memory' })
    render(<DeepSeekSettingsSection t={t} scope={fake.scope as never} subscribe={fake.scope.subscribe as never} />)
    const toggle = screen.getByRole('switch')
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(toggle)
    expect(fake.scope.set).not.toHaveBeenCalled()
  })
})
