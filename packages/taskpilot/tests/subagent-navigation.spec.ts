import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { openSubagent, type SubagentNavigation } from '../src/client/subagent-navigation.ts'

const CHILD = 'child-1' as SessionId
const PARENT = 'parent-1' as SessionId

function navigation(address: SubagentAddress | undefined, overrides: Partial<SubagentNavigation> = {}) {
  return {
    subagentAddress: vi.fn(() => address),
    openResource: vi.fn(),
    openSession: vi.fn(),
    ...overrides,
  }
}

describe('openSubagent', () => {
  it.each(['one-shot', 'continuable', 'unknown'] as const)('opens the %s address as a tab in the active sidebar pane', (mode) => {
    const nav = navigation({ parentSessionId: PARENT, childSessionId: CHILD, mode })

    openSubagent(nav, CHILD)

    expect(nav.subagentAddress).toHaveBeenCalledWith(CHILD)
    expect(nav.openResource).toHaveBeenCalledWith(
      `dsh-resource://subagentchat/session/child-1?parent=parent-1&mode=${mode}`,
      { kind: 'subagentchat' },
    )
    expect(nav.openSession).not.toHaveBeenCalled()
  })

  it('keeps the conversation-page route when no subagent address is available', () => {
    const nav = navigation(undefined)

    openSubagent(nav, CHILD)

    expect(nav.openResource).not.toHaveBeenCalled()
    expect(nav.openSession).toHaveBeenCalledWith(CHILD)
  })

  it('keeps the conversation-page route when the host has no Sidebar chat claim', () => {
    const nav = navigation(
      { parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' },
      { openResource: vi.fn(() => { throw new Error('no registered tab type') }) },
    )

    openSubagent(nav, CHILD)

    expect(nav.openResource).toHaveBeenCalledOnce()
    expect(nav.openSession).toHaveBeenCalledWith(CHILD)
  })
})
