// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LocalAgentDelegationView, LocalAgentModelInfo, LocalAgentPromptResult } from '@khorsheed/dsh-local-agent/types'
import {
  MemberComposer, resetMembershipCache, selectCliMember, type MemberComposerProps,
} from '../src/client/MemberComposer.tsx'
import {
  MEMBER_DOCK_CONTRIBUTORS, memberDockLines, statsContributor, tasksContributor,
} from '../src/client/member-dock.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  resetMembershipCache()
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

/** A pickable model surface (settings layer effective, two choices). */
function modelInfo(over: Partial<LocalAgentModelInfo> = {}): LocalAgentModelInfo {
  return {
    effective: 'm1',
    source: 'settings',
    settings: 'm1',
    choices: ['m1', 'm2'],
    live: false,
    switchable: true,
    ...over,
  }
}

/** Chain owner currency around a session snapshot fragment. */
function owner(session: Partial<SessionSnapshot> | undefined): ComposerChainProps {
  return {
    interactions: [],
    sessionId: CHILD as SessionId,
    pendingInteraction: undefined,
    session: session === undefined ? undefined : {
      sessionId: CHILD as SessionId,
      ...session,
    } as SessionSnapshot,
  } as ComposerChainProps
}

/** Component props: only the faces MemberComposer actually reads are real. */
function props(
  over: Partial<MemberComposerProps> = {},
  running = false,
  usage?: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  todos?: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[],
): MemberComposerProps {
  const snapshot = { running } as SessionSnapshot
  function useSession<T>(select: (state: SessionSnapshot) => T): T {
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
    activeDelegations: () => Promise.resolve([]),
    memberModel: () => Promise.resolve(null),
    setMemberModel: () => Promise.resolve({ ok: true } satisfies LocalAgentPromptResult),
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

  it('an RPC failure stays on the neutral checking state and retries — never the read-only panel', async () => {
    const memberOf = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(MEMBER)
    render(<MemberComposer {...props({ memberOf })} />)

    // The failed probe leaves the neutral checking state, not the one-shot copy.
    expect(await screen.findByText(zh['member.checking'])).toBeTruthy()
    expect(screen.queryByText(zh['member.readonly.title'])).toBeNull()

    // The retry (300ms) resolves real membership: writable, no flash.
    expect(await screen.findByRole('textbox', {}, { timeout: 2000 })).toBeTruthy()
    expect(screen.queryByText(zh['member.readonly.title'])).toBeNull()
    expect(memberOf).toHaveBeenCalledTimes(2)
  })

  it('degrades to the read-only panel only after the RPC retry budget is spent', async () => {
    const memberOf = vi.fn().mockResolvedValue(undefined)
    render(<MemberComposer {...props({ memberOf })} />)

    expect(await screen.findByText(zh['member.checking'])).toBeTruthy()
    expect(await screen.findByText(zh['member.readonly.title'], {}, { timeout: 2000 })).toBeTruthy()
    // Initial probe + MEMBER_PROBE_RETRIES (2) retries.
    expect(memberOf).toHaveBeenCalledTimes(3)
  })

  it('serves a re-entered member session from the cache — first frame writable, no re-probe', async () => {
    const first = render(<MemberComposer {...props()} />)
    await screen.findByRole('textbox')
    first.unmount()

    const memberOf = vi.fn()
    render(<MemberComposer {...props({ memberOf })} />)
    // No checking flash, no RPC: the cached answer renders on the first frame.
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.queryByText(zh['member.checking'])).toBeNull()
    expect(memberOf).not.toHaveBeenCalled()
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

  it('shows Stop from the in-flight delegation poll even when the summary flag is false (external CLI runs)', async () => {
    const stopMember = vi.fn().mockResolvedValue(true)
    const activeDelegations = vi.fn().mockResolvedValue([CHILD])
    render(<MemberComposer {...props({ stopMember, activeDelegations }, false)} />)

    // The official summary flag is false (agent-based; no live host agent for
    // external CLI runs) — the polled registry alone drives the running UI.
    expect(await screen.findByText(zh['member.running'])).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: zh['member.stop'] }))
    await act(async () => {})
    expect(stopMember).toHaveBeenCalledWith(CHILD)
  })

  it('keeps the running bit on a poll RPC failure instead of flapping Stop off', async () => {
    const activeDelegations = vi.fn()
      .mockResolvedValueOnce([CHILD])
      .mockResolvedValue(undefined)
    render(<MemberComposer {...props({ activeDelegations }, false)} />)
    await screen.findByText(zh['member.running'])

    // Past the next poll (1.5s), which fails: the bit must hold.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_800)) })
    expect(screen.getByText(zh['member.running'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['member.stop'] })).toBeTruthy()
  })

  it('flips the read-only panel to the member box when the first round settles (in-flight bit drops)', async () => {
    // First round in flight: no delegation record yet, the registry says active.
    let active: readonly string[] = [CHILD]
    const activeDelegations = vi.fn(() => Promise.resolve(active))
    const memberOf = vi.fn().mockResolvedValue(null)
    render(<MemberComposer {...props({ memberOf, activeDelegations }, false)} />)
    expect(await screen.findByText(zh['member.readonly.title'])).toBeTruthy()

    // The round settles: the record lands and the in-flight bit drops on the
    // next poll (1.5s) — the running flip re-probes and the panel turns writable.
    active = []
    memberOf.mockResolvedValue(MEMBER)
    expect(await screen.findByText(zh['member.title'].replace('{harness}', 'Fake Agent'), {}, { timeout: 4_000 })).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(memberOf.mock.calls.length).toBeGreaterThanOrEqual(2)
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

  describe('model picker', () => {
    it('renders no picker when the memberModel answer is null (brokerless harness)', async () => {
      const memberModel = vi.fn().mockResolvedValue(null)
      render(<MemberComposer {...props({ memberModel })} />)
      await screen.findByRole('textbox')
      await act(async () => {})

      expect(memberModel).toHaveBeenCalledWith(CHILD)
      expect(screen.queryByRole('button', { name: zh['member.model.picker'] })).toBeNull()
    })

    it('shows the effective model on the chip, and the localized Default when no layer names one', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo())
      render(<MemberComposer {...props({ memberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })
      expect(chip.textContent).toBe('m1')
      expect(chip.getAttribute('title')).toBe(
        zh['member.model.title']
          .replace('{model}', 'm1')
          .replace('{source}', zh['member.model.source.settings']),
      )
    })

    it('labels the chip Default for the cli-builtin source (the CLI names nothing)', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo({
        effective: undefined, source: 'cli-builtin', settings: undefined, choices: [],
      }))
      render(<MemberComposer {...props({ memberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })
      expect(chip.textContent).toBe(zh['member.model.default'])
    })

    it('applies a choice through setMemberModel and re-reads the surface on success', async () => {
      const memberModel = vi.fn()
        .mockResolvedValueOnce(modelInfo())
        .mockResolvedValue(modelInfo({ effective: 'm2', source: 'override', override: 'm2' }))
      const setMemberModel = vi.fn().mockResolvedValue({ ok: true } satisfies LocalAgentPromptResult)
      render(<MemberComposer {...props({ memberModel, setMemberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })

      fireEvent.click(chip)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'm2' }))
      await waitFor(() => { expect(chip.textContent).toBe('m2') })
      expect(setMemberModel).toHaveBeenCalledWith(CHILD, 'm2')
    })

    it('renders the structured error inline and keeps the displayed value on a refused switch', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo())
      const setMemberModel = vi.fn().mockResolvedValue({ ok: false, error: 'localAgent: a round is in flight' } satisfies LocalAgentPromptResult)
      render(<MemberComposer {...props({ memberModel, setMemberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })

      fireEvent.click(chip)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'm2' }))
      expect(await screen.findByText('localAgent: a round is in flight')).toBeTruthy()
      expect(chip.textContent).toBe('m1')
    })

    it('falls back to its own copy when the setMemberModel RPC itself fails', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo())
      const setMemberModel = vi.fn().mockResolvedValue(undefined)
      render(<MemberComposer {...props({ memberModel, setMemberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })

      fireEvent.click(chip)
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'm2' }))
      expect(await screen.findByText(zh['member.model.failed'])).toBeTruthy()
      expect(chip.textContent).toBe('m1')
    })

    it('disables the picker with the reason in the title when switchable is false', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo({
        switchable: false, reason: '成员有一轮正在运行',
      }))
      render(<MemberComposer {...props({ memberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] }) as HTMLButtonElement
      expect(chip.disabled).toBe(true)
      expect(chip.getAttribute('title')).toBe('成员有一轮正在运行')
    })

    it('disables the picker while the member run is in flight', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo())
      render(<MemberComposer {...props({ memberModel }, true)} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] }) as HTMLButtonElement
      expect(chip.disabled).toBe(true)
    })

    it('offers the follow-settings reset only while an override is active, clearing it with undefined', async () => {
      const memberModel = vi.fn()
        .mockResolvedValueOnce(modelInfo({ effective: 'm2', source: 'override', override: 'm2' }))
        .mockResolvedValue(modelInfo())
      const setMemberModel = vi.fn().mockResolvedValue({ ok: true } satisfies LocalAgentPromptResult)
      render(<MemberComposer {...props({ memberModel, setMemberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })

      fireEvent.click(chip)
      fireEvent.click(screen.getByRole('menuitem', { name: zh['member.model.followSettings'] }))
      await waitFor(() => { expect(chip.textContent).toBe('m1') })
      expect(setMemberModel).toHaveBeenCalledWith(CHILD, undefined)
    })

    it('hides the follow-settings reset when no override is active', async () => {
      const memberModel = vi.fn().mockResolvedValue(modelInfo())
      render(<MemberComposer {...props({ memberModel })} />)
      const chip = await screen.findByRole('button', { name: zh['member.model.picker'] })

      fireEvent.click(chip)
      expect(screen.getByRole('menuitemradio', { name: 'm1' })).toBeTruthy()
      expect(screen.queryByRole('menuitem', { name: zh['member.model.followSettings'] })).toBeNull()
    })
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
