// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LocalAgentDelegationView, LocalAgentPromptResult } from '@khorsheed/dsh-local-agent/types'
import {
  MemberComposer, selectCliMember, type MemberComposerProps,
} from '../src/client/MemberComposer.tsx'
import {
  MEMBER_DOCK_CONTRIBUTORS, memberDockLines, statsContributor, tasksContributor,
} from '../src/client/member-dock.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const CHILD = 'child-1'
const t = makeTranslate(zh)

const MEMBER: LocalAgentDelegationView = {
  childSessionId: CHILD,
  provider: 'fake-cli',
  parentSessionId: 'parent-1',
  harnessDisplayName: 'Fake Agent',
}

/** Chain owner currency around a session snapshot fragment. */
function owner(session: Partial<ConversationSnapshot> | undefined): ComposerChainProps {
  return {
    interactions: [],
    session: session === undefined ? undefined : {
      sessionId: CHILD as SessionId,
      ...session,
    } as ConversationSnapshot,
  }
}

/** Component props: only the faces MemberComposer actually reads are real. */
function props(
  over: Partial<MemberComposerProps> = {},
  running = false,
  usage?: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  todos?: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[],
): MemberComposerProps {
  const snapshot = { running } as ConversationSnapshot
  function useSession<T>(select: (state: ConversationSnapshot) => T): T {
    return select(snapshot)
  }
  function useProjection(key: string): unknown {
    if (key === 'tokenUsage') return usage
    if (key === 'todos') return todos
    return undefined
  }
  return {
    matched: { childSessionId: CHILD },
    useSession,
    useProjection,
    memberOf: () => Promise.resolve(MEMBER),
    promptMember: () => Promise.resolve({ ok: true } satisfies LocalAgentPromptResult),
    stopMember: () => Promise.resolve(true),
    t,
    ...over,
  } as unknown as MemberComposerProps
}

describe('selectCliMember', () => {
  it('elects a one-shot subagent session, carrying its session id', () => {
    const match = selectCliMember(owner({
      subagent: {
        address: { mode: 'one-shot', parentSessionId: 'p' as SessionId, childSessionId: CHILD as SessionId },
        parentAvailable: false,
      },
    }))
    expect(match).toEqual({ childSessionId: CHILD })
  })

  it('declines a continuable subagent session', () => {
    expect(selectCliMember(owner({
      subagent: {
        address: { mode: 'continuable', parentSessionId: 'p' as SessionId, childSessionId: CHILD as SessionId },
        parentAvailable: true,
      },
    }))).toBeNull()
  })

  it('declines a plain session and an absent session', () => {
    expect(selectCliMember(owner({ subagent: null }))).toBeNull()
    expect(selectCliMember(owner(undefined))).toBeNull()
  })

  it('declines while an interaction is pending — the ApprovalPanel elects at priority 1', () => {
    const base = owner({
      subagent: {
        address: { mode: 'one-shot', parentSessionId: 'p' as SessionId, childSessionId: CHILD as SessionId },
        parentAvailable: true,
      },
    })
    const pending = { ...base, interactions: [{ kind: 'question' } as never] }
    expect(selectCliMember(pending)).toBeNull()
  })

  it('supports the 0.1.2 owner shape (singular pendingInteraction, no interactions array)', () => {
    const base = owner({
      subagent: {
        address: { mode: 'one-shot', parentSessionId: 'p' as SessionId, childSessionId: CHILD as SessionId },
        parentAvailable: true,
      },
    }) as unknown as Record<string, unknown>
    delete base['interactions']
    expect(selectCliMember(base as unknown as ComposerChainProps)).toEqual({ childSessionId: CHILD })
    const pending = { ...base, pendingInteraction: { kind: 'question' } } as unknown as ComposerChainProps
    expect(selectCliMember(pending)).toBeNull()
  })
})

describe('MemberComposer', () => {
  it('renders the read-only panel when memberOf finds no delegation record', async () => {
    const memberOf = vi.fn().mockResolvedValue(null)
    render(<MemberComposer {...props({ memberOf })} />)

    expect(await screen.findByText(zh['member.readonly.title'])).toBeTruthy()
    expect(screen.getByText(zh['member.readonly.body'])).toBeTruthy()
    expect(memberOf).toHaveBeenCalledWith(CHILD)
    // Never a writable box for a non-member session.
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('re-probes on the running flip and swaps the read-only panel for the member box when the record lands', async () => {
    // First round in flight: no delegation record yet, running=true.
    const memberOf = vi.fn().mockResolvedValue(null)
    const { rerender } = render(<MemberComposer {...props({ memberOf }, true)} />)
    expect(await screen.findByText(zh['member.readonly.title'])).toBeTruthy()
    expect(memberOf).toHaveBeenCalledTimes(1)

    // The round settles: the record lands and running flips false — the open
    // panel must pick membership up without a session re-enter.
    memberOf.mockResolvedValue(MEMBER)
    rerender(<MemberComposer {...props({ memberOf }, false)} />)
    expect(await screen.findByText(zh['member.title'].replace('{harness}', 'Fake Agent'))).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(memberOf).toHaveBeenCalledTimes(2)
  })

  it('renders the writable composer for a recorded member', async () => {
    render(<MemberComposer {...props()} />)

    expect(await screen.findByText(zh['member.title'].replace('{harness}', 'Fake Agent'))).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['member.send'] })).toBeTruthy()
  })

  it('sends the draft through promptMember and clears the draft on success', async () => {
    const promptMember = vi.fn().mockResolvedValue({ ok: true } satisfies LocalAgentPromptResult)
    render(<MemberComposer {...props({ promptMember })} />)
    await screen.findByRole('textbox')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  继续修这个测试  ' } })
    fireEvent.click(screen.getByRole('button', { name: zh['member.send'] }))
    await act(async () => {})

    expect(promptMember).toHaveBeenCalledWith(CHILD, '继续修这个测试')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('renders the structured error inline when promptMember fails', async () => {
    const promptMember = vi.fn().mockResolvedValue({
      ok: false,
      error: 'localAgent: parent session parent-1 has no live agent',
    } satisfies LocalAgentPromptResult)
    render(<MemberComposer {...props({ promptMember })} />)
    await screen.findByRole('textbox')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: zh['member.send'] }))

    expect(await screen.findByText('localAgent: parent session parent-1 has no live agent')).toBeTruthy()
    // The draft survives a failed send.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hello')
  })

  it('falls back to its own copy when the promptMember RPC itself fails', async () => {
    const promptMember = vi.fn().mockResolvedValue(undefined)
    render(<MemberComposer {...props({ promptMember })} />)
    await screen.findByRole('textbox')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: zh['member.send'] }))

    expect(await screen.findByText(zh['member.sendFailed'])).toBeTruthy()
  })

  it('disables input and shows Stop while the member run is in flight; Stop calls stopMember', async () => {
    const stopMember = vi.fn().mockResolvedValue(true)
    render(<MemberComposer {...props({ stopMember }, true)} />)
    await screen.findByText(zh['member.running'])

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: zh['member.send'] })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['member.stop'] }))
    await act(async () => {})
    expect(stopMember).toHaveBeenCalledWith(CHILD)
  })

  it('keeps the send button disabled for an empty draft', async () => {
    const promptMember = vi.fn()
    render(<MemberComposer {...props({ promptMember })} />)
    await screen.findByRole('textbox')

    const send = screen.getByRole('button', { name: zh['member.send'] }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(send.disabled).toBe(true)
    expect(promptMember).not.toHaveBeenCalled()
  })

  describe('stats line', () => {
    const USAGE = { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 0 }

    it('renders nothing when the session has no token usage', async () => {
      const { container } = render(<MemberComposer {...props()} />)
      await screen.findByRole('textbox')
      expect(container.querySelector('[data-member-stats]')).toBeNull()
    })

    it('computes the cache-hit share over the three billing buckets and shows token totals', async () => {
      // 300 cache-read over 400 billed input = 75%.
      const { container } = render(<MemberComposer {...props({}, false, USAGE)} />)
      await screen.findByRole('textbox')

      const stats = container.querySelector('[data-member-stats]')
      expect(stats).not.toBeNull()
      expect(stats!.textContent).toContain(zh['member.stats.cacheHit'].replace('{percent}', '75'))
      expect(stats!.textContent).toContain(
        zh['member.stats.tokens'].replace('{input}', '400').replace('{output}', '50'),
      )
    })

    it('formats token totals compactly and drops the cache group when no input was billed', async () => {
      const usage = { uncachedInputTokens: 0, outputTokens: 1_234_567, cacheReadTokens: 0, cacheWriteTokens: 0 }
      const { container } = render(<MemberComposer {...props({}, false, usage)} />)
      await screen.findByRole('textbox')

      const stats = container.querySelector('[data-member-stats]')
      expect(stats).not.toBeNull()
      expect(stats!.textContent).not.toContain('缓存命中')
      expect(stats!.textContent).toContain('1.2M')
    })

    it('never shows the stats line on the degraded read-only panel', async () => {
      const memberOf = vi.fn().mockResolvedValue(null)
      const { container } = render(<MemberComposer {...props({ memberOf }, false, USAGE)} />)

      expect(await screen.findByText(zh['member.readonly.title'])).toBeTruthy()
      expect(container.querySelector('[data-member-stats]')).toBeNull()
      // The whole dock stays out of the degraded branch.
      expect(container.querySelector('[data-member-dock]')).toBeNull()
    })

    it('renders the stats row inside the dock below the composer card', async () => {
      const { container } = render(<MemberComposer {...props({}, false, USAGE)} />)
      await screen.findByRole('textbox')

      const dock = container.querySelector('[data-member-dock]')
      expect(dock).not.toBeNull()
      const row = dock!.querySelector('[data-member-stats]')
      expect(row).not.toBeNull()
      expect(row!.getAttribute('data-member-dock-row')).toBe('stats')
      // The dock is a sibling AFTER the card, not inside it.
      expect(container.querySelector('[data-member-dock]')!.previousElementSibling).not.toBeNull()
    })
  })
})

describe('member dock registry', () => {
  const USAGE = { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 0 }
  const TODOS = [
    { content: '读代码', status: 'completed' },
    { content: '改实现', status: 'in_progress' },
    { content: '跑测试', status: 'pending' },
  ] as const

  it('omits null contributors and keeps registration order', () => {
    const lines = memberDockLines({}, t, [
      () => null,
      () => ({ id: 'b', text: 'B' }),
      () => ({ id: 'a', text: 'A' }),
    ])
    expect(lines).toEqual([{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }])
  })

  it('returns an empty stack when every contributor declines', () => {
    expect(memberDockLines({}, t, [() => null, () => null])).toEqual([])
    expect(memberDockLines({}, t, [])).toEqual([])
  })

  it('registers stats then tasks', () => {
    expect(MEMBER_DOCK_CONTRIBUTORS).toEqual([statsContributor, tasksContributor])
  })

  it('the stats contributor declines without usage and formats activity byte-identically to pre-dock', () => {
    expect(statsContributor({}, t)).toBeNull()
    // 300 cache-read over 400 billed input = 75%.
    expect(statsContributor({ tokenUsage: USAGE }, t)).toEqual({
      id: 'stats',
      text: `${zh['member.stats.cacheHit'].replace('{percent}', '75')} | ${
        zh['member.stats.tokens'].replace('{input}', '400').replace('{output}', '50')}`,
    })
  })

  it('the tasks contributor declines with no todos and summarizes mixed states', () => {
    expect(tasksContributor({}, t)).toBeNull()
    expect(tasksContributor({ todos: null }, t)).toBeNull()
    expect(tasksContributor({ todos: [] }, t)).toBeNull()
    expect(tasksContributor({ todos: TODOS }, t)).toEqual({
      id: 'tasks',
      text: zh['member.tasks.summary'].replace('{done}', '1').replace('{total}', '3')
        + zh['member.tasks.active'].replace('{title}', '改实现'),
    })
  })

  it('the tasks contributor drops the active segment when nothing is in progress', () => {
    const all = TODOS.map(todo => ({ ...todo, status: 'completed' as const }))
    expect(tasksContributor({ todos: all }, t)).toEqual({
      id: 'tasks',
      text: zh['member.tasks.summary'].replace('{done}', '3').replace('{total}', '3'),
    })
  })

  it('renders the tasks row below the stats row when the session carries todos', async () => {
    const { container } = render(<MemberComposer {...props({}, false, USAGE, TODOS)} />)
    await screen.findByRole('textbox')

    const rows = [...container.querySelectorAll('[data-member-dock-row]')]
    expect(rows.map(row => row.getAttribute('data-member-dock-row'))).toEqual(['stats', 'tasks'])
    expect(rows[1]!.textContent).toContain('任务 1/3')
    expect(rows[1]!.textContent).toContain('进行中：改实现')
  })
})
