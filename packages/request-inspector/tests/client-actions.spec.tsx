// @vitest-environment jsdom
/**
 * The two entry points under composed-props fakes: the assistant message's
 * turn action resolves messageId → turnSeq (closingMessageId match, latest
 * fallback) through the injected `open`, and the session-header utility opens
 * the tab at the latest turn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { InspectorActionProps, InspectorUtilityProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { HeaderInspectUtility } from '../src/client/HeaderUtility.tsx'
import { TurnInspectAction } from '../src/client/TurnAction.tsx'

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh): string => zh[key]) as InspectorActionProps['t']

afterEach(() => {
  cleanup()
})

describe('TurnInspectAction', () => {
  it('hands the click to the resolve-and-open face with the message id', async () => {
    const open = vi.fn(async () => undefined)
    const props = {
      messageId: 'm-2',
      sessionId: 's1',
      open,
      t,
    } as unknown as InspectorActionProps
    render(<TurnInspectAction {...props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['action.inspect'] }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('s1', 'm-2'))
  })

  it('debounces a double click while the resolution is in flight', async () => {
    let release: (() => void) | undefined
    const open = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const props = { messageId: 'm-2', sessionId: 's1', open, t } as unknown as InspectorActionProps
    render(<TurnInspectAction {...props} />)
    const button = screen.getByRole('button', { name: zh['action.inspect'] })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(open).toHaveBeenCalledTimes(1)
    release?.()
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('HeaderInspectUtility', () => {
  it('opens the tab at the latest turn', () => {
    const openLatest = vi.fn()
    const props = { sessionId: 's1', openLatest, t } as unknown as InspectorUtilityProps
    render(<HeaderInspectUtility {...props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['action.inspect'] }))
    expect(openLatest).toHaveBeenCalledWith('s1')
  })
})
