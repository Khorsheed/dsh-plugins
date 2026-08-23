import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

interface AgentMock {
  session: { header: { parentSession: string } }
  cancel: ReturnType<typeof vi.fn>
}

/** The shape of the result the commands seam would return for a dispatch. */
interface CommandResultLike {
  kind: 'success' | 'error'
  text?: string
}

/**
 * Build a minimal ctx around the registered interrupt handler. `execute` is
 * the commands-seam stub the no-live-agent path dispatches `/local-agent
 * stop` through; returning undefined simulates an absent local-agent core.
 */
function harness(
  agent?: AgentMock,
  execute?: (line: string) => CommandResultLike | undefined,
) {
  const calls = {
    interrupt: [] as unknown[][],
    cancel: [] as string[],
    execute: [] as string[],
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: ((invocation: any) => unknown) | undefined
  const ctx = {
    commands: {
      register: (definition: { name: string; handler: typeof handler }) => { handler = definition.handler },
      execute: async (_agent: unknown, line: string) => {
        calls.execute.push(line)
        const result = execute?.(line)
        return result === undefined ? undefined : { commandId: 'cmd-1', result }
      },
    },
    subagents: { interrupt: (...args: unknown[]) => { calls.interrupt.push(args) } },
    agents: { get: () => agent },
    get: () => undefined,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply(ctx as any)
  return {
    calls,
    run: async (rawInput: string, agentId = 'parent-1') => {
      const out = handler?.({
        rawInput,
        agent: { session: { id: agentId } },
        signal: new AbortController().signal,
      })
      return out
    },
  }
}

function runningAgent(parent: string): AgentMock {
  return { session: { header: { parentSession: parent } }, cancel: vi.fn() }
}

describe('taskpilot-interrupt host command', () => {
  it('routes a direct child through subagents.interrupt with the dispatching session as parent', async () => {
    const h = harness(undefined, () => ({ kind: 'success', text: 'child session child-1 has no in-flight local-agent run to stop' }))
    const result = await h.run(' child-1')
    expect(h.calls.interrupt).toEqual([['child-1', { kind: 'user', parentSessionId: 'parent-1' }]])
    // No live agent: the stop is routed to the local-agent seam.
    expect(h.calls.execute).toEqual(['/local-agent stop child-1'])
    expect(result).toEqual({ kind: 'success', text: 'child session child-1 has no in-flight local-agent run to stop' })
  })

  it('passes an explicit parent id for deep descendants', async () => {
    const h = harness(undefined, () => ({ kind: 'success', text: 'no-op' }))
    await h.run(' deep-child parent-2')
    expect(h.calls.interrupt).toEqual([['deep-child', { kind: 'user', parentSessionId: 'parent-2' }]])
    expect(h.calls.execute).toEqual(['/local-agent stop deep-child'])
  })

  it('cancels a one-shot child directly (no continuation activation, interrupt is a no-op)', async () => {
    const agent = runningAgent('parent-1')
    const h = harness(agent)
    await h.run(' one-shot-1')
    // subagents.interrupt was still attempted (silent no-op for one-shot).
    expect(h.calls.interrupt).toHaveLength(1)
    // The live agent under the matching parent was cancelled; no seam dispatch.
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(h.calls.execute).toEqual([])
  })

  it('refuses to cancel an agent whose parent does not match', async () => {
    const agent = runningAgent('other-parent')
    const h = harness(agent)
    await h.run(' rogue')
    expect(h.calls.interrupt).toHaveLength(1)
    expect(agent.cancel).not.toHaveBeenCalled()
    // A live agent under another parent is not this session's child to stop.
    expect(h.calls.execute).toEqual([])
  })

  it('forwards the local-agent stop result for a one-shot row without a live agent', async () => {
    const h = harness(undefined, line => line === '/local-agent stop one-shot-1'
      ? { kind: 'success', text: 'stop requested for child session one-shot-1' }
      : undefined)
    const result = await h.run(' one-shot-1')
    expect(h.calls.execute).toEqual(['/local-agent stop one-shot-1'])
    expect(result).toEqual({ kind: 'success', text: 'stop requested for child session one-shot-1' })
  })

  it('degrades when the local-agent command does not resolve (core absent)', async () => {
    const h = harness(undefined, () => undefined)
    const result = await h.run(' orphan-1')
    expect(h.calls.execute).toEqual(['/local-agent stop orphan-1'])
    expect(result).toEqual({
      kind: 'error',
      text: 'cannot stop subagent orphan-1: no live agent to cancel and the local-agent integration is not mounted',
    })
  })

  it('rejects empty input with usage', async () => {
    const h = harness()
    expect(await h.run('')).toMatchObject({ kind: 'error' })
    expect(await h.run('   ')).toMatchObject({ kind: 'error' })
    expect(h.calls.execute).toEqual([])
  })
})
