// @vitest-environment jsdom
// The card-link route glued up from the plugin context: every open probes
// ctx.get('sidebarRightTabs') for the `browser` kind (0.1.6-alpha.2's
// ui-sidebar-browser) and opens a Sidebar tab through ctx.get('sidebarRight')
// when it is there; an older host, a missing service, or a registry race on
// open all fall back to a plain new window.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createLinkOpener } from '../src/client/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

function stubWindowOpen(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(window, 'open').mockImplementation(() => null)
}

describe('createLinkOpener', () => {
  it('opens in the Sidebar Browser tab when the host registers the browser kind', () => {
    const ctx = new Context()
    const openTab = vi.fn()
    ctx.provide('sidebarRightTabs', { get: (kind: string) => (kind === 'browser' ? { kind } : undefined) } as never)
    ctx.provide('sidebarRight', { openTab } as never)
    const windowOpen = stubWindowOpen()
    createLinkOpener(ctx)('https://example.com/a')
    expect(openTab).toHaveBeenCalledWith('browser', { params: { url: 'https://example.com/a' } })
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('falls back to a new window when the browser kind is absent (older hosts)', () => {
    const ctx = new Context()
    const openTab = vi.fn()
    ctx.provide('sidebarRightTabs', { get: () => undefined } as never)
    ctx.provide('sidebarRight', { openTab } as never)
    const windowOpen = stubWindowOpen()
    createLinkOpener(ctx)('https://example.com/a')
    expect(openTab).not.toHaveBeenCalled()
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
  })

  it('falls back to a new window when the sidebar services are absent entirely', () => {
    const ctx = new Context()
    const windowOpen = stubWindowOpen()
    expect(() => createLinkOpener(ctx)('https://example.com/a')).not.toThrow()
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
  })

  it('falls back to a new window when openTab throws (the kind raced out of the registry)', () => {
    const ctx = new Context()
    ctx.provide('sidebarRightTabs', { get: (kind: string) => (kind === 'browser' ? { kind } : undefined) } as never)
    ctx.provide('sidebarRight', {
      openTab: () => { throw new Error('sidebarRight: no tab type is registered as "browser"') },
    } as never)
    const windowOpen = stubWindowOpen()
    expect(() => createLinkOpener(ctx)('https://example.com/a')).not.toThrow()
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
  })
})
