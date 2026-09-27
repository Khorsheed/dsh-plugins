// @vitest-environment jsdom
/** wrapChatFileMentions: the S1-tail in-place wrap — the original service
 * keeps its claim/copy logic, and every resolved mention's open routes to
 * `owner.openFile` (the sidebar document tab) instead of the native default
 * application. */

import { describe, expect, it, vi } from 'vitest'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { wrapChatFileMentions } from '../src/client/mentions-wrap.ts'

/** A fake official service: claims 'a.md' only, native-open spy inside. */
function fakeMentions() {
  const nativeOpen = vi.fn()
  const mentions: ChatFileMentions = {
    forClosing: (_owner, _sessionId) => ({
      resolve: (value: string) =>
        value === 'a.md' ? { open: () => { nativeOpen(value) }, label: '在默认程序中打开 a.md', title: '/work/a.md' } : undefined,
    }),
  }
  return { mentions, nativeOpen }
}

const owner = { openFile: vi.fn() } as unknown as TurnTailOwnerProps

function reroute() {
  return { open: vi.fn(), label: vi.fn((path: string) => `在侧边栏打开 ${path}`) }
}

describe('wrapChatFileMentions', () => {
  it('reroutes a resolved mention into the injected open with a fixed label', () => {
    const { mentions, nativeOpen } = fakeMentions()
    const route = reroute()
    wrapChatFileMentions(mentions, route)
    const resolved = mentions.forClosing(owner, 's1' as SessionId)
    expect(resolved).toBeDefined()
    const hit = resolved!.resolve('a.md')
    // The claim logic stays the original implementation's; the label is ours.
    expect(hit?.title).toBe('/work/a.md')
    expect(hit?.label).toBe('在侧边栏打开 /work/a.md')
    hit?.open()
    expect(route.open).toHaveBeenCalledWith('s1', '/work/a.md')
    expect(nativeOpen).not.toHaveBeenCalled()
    expect(owner.openFile).not.toHaveBeenCalled()
  })

  it('falls back to owner.openFile when the reroute throws', () => {
    const { mentions } = fakeMentions()
    const route = reroute()
    route.open.mockImplementation(() => { throw new Error('sidebarRight: no session surface is mounted') })
    wrapChatFileMentions(mentions, route)
    const hit = mentions.forClosing(owner, 's1' as SessionId)!.resolve('a.md')
    hit?.open()
    expect(owner.openFile).toHaveBeenCalledWith('/work/a.md')
  })

  it('passes through unclaimed values and undefined forClosing results', () => {
    const { mentions } = fakeMentions()
    wrapChatFileMentions(mentions, reroute())
    const resolved = mentions.forClosing(owner, 's1' as SessionId)
    expect(resolved!.resolve('other.md')).toBeUndefined()
    const bare = { forClosing: () => undefined } as unknown as ChatFileMentions
    wrapChatFileMentions(bare, reroute())
    expect(bare.forClosing(owner, 's1' as SessionId)).toBeUndefined()
  })

  it('is idempotent — a second wrap keeps the first', () => {
    const { mentions } = fakeMentions()
    wrapChatFileMentions(mentions, reroute())
    const wrapped = mentions.forClosing
    wrapChatFileMentions(mentions, reroute())
    expect(mentions.forClosing).toBe(wrapped)
  })
})
