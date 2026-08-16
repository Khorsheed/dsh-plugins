import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

interface AgentMock {
  session: { header: { parentSession: string } }
  cancel: ReturnType<typeof vi.fn>
}

/** Build a minimal ctx around the registered interrupt handler. */
function harness(agent?: AgentMock) {
  const calls = { interrupt: [] as unknown[][], cancel: [] as string[] }
  let handler: ((invocation: { rawInput: string; agent: { session: { id: string } } }) => unknown) | undefined
  const ctx = {
    commands: { register: (definition: { name: string; handler: typeof handler }) => { handler = definition.handler } },
    subagents: { interrupt: (...args: unknown[]) => { calls.interrupt.push(args) } },
    agents: { get: () => agent },
    get: () => undefined,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply(ctx as any)
  return {
    calls,
    run: (rawInput: string, agentId = 'parent-1') => handler?.({ rawInput, agent: { session: { id: agentId } } }),
  }
}

function runningAgent(parent: string): AgentMock {
  return { session: { header: { parentSession: parent } }, cancel: vi.fn() }
}

describe('taskpilot-interrupt host command', () => {
  it('routes a direct child through subagents.interrupt with the dispatching session as parent', () => {
    const h = harness()
    const result = h.run(' child-1')
    expect(h.calls.interrupt).toEqual([['child-1', { kind: 'user', parentSessionId: 'parent-1' }]])
    expect(result).toEqual({ kind: 'success', text: 'interrupt requested for subagent child-1' })
  })

  it('passes an explicit parent id for deep descendants', () => {
    const h = harness()
    h.run(' deep-child parent-2')
    expect(h.calls.interrupt).toEqual([['deep-child', { kind: 'user', parentSessionId: 'parent-2' }]])
  })

  it('cancels a one-shot child directly (no continuation activation, interrupt is a no-op)', () => {
    const agent = runningAgent('parent-1')
    const h = harness(agent)
    h.run(' one-shot-1')
    // subagents.interrupt was still attempted (silent no-op for one-shot).
    expect(h.calls.interrupt).toHaveLength(1)
    // The live agent under the matching parent was cancelled.
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' })
  })

  it('refuses to cancel an agent whose parent does not match', () => {
    const agent = runningAgent('other-parent')
    const h = harness(agent)
    h.run(' rogue')
    expect(h.calls.interrupt).toHaveLength(1)
    expect(agent.cancel).not.toHaveBeenCalled()
  })

  it('rejects empty input with usage', () => {
    const h = harness()
    expect(h.run('')).toMatchObject({ kind: 'error' })
    expect(h.run('   ')).toMatchObject({ kind: 'error' })
  })
})
