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
        value === 'a.md' ? { open: () => { nativeOpen(value) }, label: '打开 a.md', title: '/work/a.md' } : undefined,
    }),
  }
  return { mentions, nativeOpen }
}

const owner = { openFile: vi.fn() } as unknown as TurnTailOwnerProps

describe('wrapChatFileMentions', () => {
  it('reroutes a resolved mention into owner.openFile with the resolved path', () => {
    const { mentions, nativeOpen } = fakeMentions()
    wrapChatFileMentions(mentions)
    const resolved = mentions.forClosing(owner, 's1' as SessionId)
    expect(resolved).toBeDefined()
    const hit = resolved!.resolve('a.md')
    // Claim and copy logic stay the original implementation's.
    expect(hit?.label).toBe('打开 a.md')
    expect(hit?.title).toBe('/work/a.md')
    hit?.open()
    expect(owner.openFile).toHaveBeenCalledWith('/work/a.md')
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('passes through unclaimed values and undefined forClosing results', () => {
    const { mentions } = fakeMentions()
    wrapChatFileMentions(mentions)
    const resolved = mentions.forClosing(owner, 's1' as SessionId)
    expect(resolved!.resolve('other.md')).toBeUndefined()
    const bare = { forClosing: () => undefined } as unknown as ChatFileMentions
    wrapChatFileMentions(bare)
    expect(bare.forClosing(owner, 's1' as SessionId)).toBeUndefined()
  })

  it('is idempotent — a second wrap keeps the first', () => {
    const { mentions } = fakeMentions()
    wrapChatFileMentions(mentions)
    const wrapped = mentions.forClosing
    wrapChatFileMentions(mentions)
    expect(mentions.forClosing).toBe(wrapped)
  })
})
