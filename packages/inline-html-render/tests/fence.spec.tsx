// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { CardFence, registerCardFence } from '../src/client/fence.tsx'
import { apply as applyClient } from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('CardFence', () => {
  it('keeps the plain code block while streaming and mounts the sandbox on settle', () => {
    const openLink = vi.fn()
    const view = render(
      <CardFence lang="dsh-card" code="<h1>partial</h1>" streaming openLink={openLink}>
        <span>plain code</span>
      </CardFence>,
    )
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(view.getByText('plain code')).toBeTruthy()

    view.rerender(
      <CardFence lang="dsh-card" code="<h1>settled</h1>" streaming={false} openLink={openLink}>
        <span>plain code</span>
      </CardFence>,
    )
    const frame = view.container.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.srcdoc).toContain('<h1>settled</h1>')
    expect(frame?.srcdoc).toContain('window.dshBridge')

    view.unmount()
    expect(view.container.querySelector('iframe')).toBeNull()
  })

  it('keeps an empty fence as ordinary code', () => {
    const view = render(
      <CardFence lang="dsh-card" code="" streaming={false} openLink={vi.fn()}>
        <span>empty code</span>
      </CardFence>,
    )
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(view.getByText('empty code')).toBeTruthy()
  })
})

describe('registerCardFence', () => {
  it('registers the dsh-card language through slots.inject', () => {
    const register = vi.fn(() => () => {})
    const inject = vi.fn((_key, callback: () => () => void) => { callback() })
    const ctx = {
      slots: { inject, register },
      get: () => undefined,
    } as unknown as Context
    registerCardFence(ctx)
    expect(inject).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith({
      name: 'conversation.chat.markdown.fence',
      key: 'dsh-card',
      id: '@khorsheed/dsh-inline-html-render/fence/dsh-card',
    }, expect.any(Function))
  })

  it('waits for the fence declaration before disabling the legacy renderer', () => {
    let activate: (() => () => void) | undefined
    const register = vi.fn(() => () => {})
    const onRegistered = vi.fn()
    const ctx = {
      slots: { inject: vi.fn((_key, callback: () => () => void) => { activate = callback }), register },
      get: () => undefined,
    } as unknown as Context
    registerCardFence(ctx, onRegistered)
    expect(register).not.toHaveBeenCalled()
    expect(onRegistered).not.toHaveBeenCalled()
    activate?.()
    expect(register).toHaveBeenCalledOnce()
    expect(onRegistered).toHaveBeenCalledOnce()
  })

  it('accesses slots from a nested injected Cordis scope', async () => {
    const ctx = new Context()
    const register = vi.fn(() => () => {})
    ctx.provide('slots', {
      inject: (_key: string, callback: () => () => void) => callback(),
      register,
    } as never)
    try {
      applyClient(ctx)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(register).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
