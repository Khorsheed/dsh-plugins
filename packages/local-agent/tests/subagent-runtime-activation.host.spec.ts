import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { NO_START_CAPABILITIES } from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('workingDirectory', { ensure: async () => '/home/user/work' } as never)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  const session = Session.create(SessionId('parent-runtime'))
  const parent = { id: session.id, session } as unknown as Agent
  ctx.agents.enter(parent, undefined)
  return { ctx, parent }
}

describe('real SubagentRuntime activation', () => {
  it('accepts the compatibility payload and returns a named completed activation', async () => {
    const { ctx, parent } = await boot()
    const dispose = vi.fn(async () => {})
    ctx.subagents.registerProvider({
      name: 'scripted',
      capabilities: NO_START_CAPABILITIES,
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('execution-success'),
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'done: hello' }] }),
        dispose,
      }),
    })
    const activation = await ctx.subagents.startActivation({
      provider: 'scripted',
      label: 'probe',
      prompt: [{ type: 'text', text: 'hello' }],
      parent,
      request: { prompt: [{ type: 'text', text: 'hello' }], parent },
      signal: new AbortController().signal,
      delivery: 'caller',
    } as never)
    expect(activation.childId).toBe('execution-success')
    expect(activation.name).toBe('execution-success')
    expect((await activation.result).output).toEqual([{ type: 'text', text: 'done: hello' }])
    await activation.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('settles a disposed activation through the provider cancel path', async () => {
    const { ctx, parent } = await boot()
    let settle!: (result: SubagentResult) => void
    const result = new Promise<SubagentResult>((resolve) => { settle = resolve })
    const dispose = vi.fn(async () => { settle({ stopReason: 'aborted', output: [] }) })
    ctx.subagents.registerProvider({
      name: 'scripted-cancel',
      capabilities: NO_START_CAPABILITIES,
      inheritsParentContext: false,
      start: async () => ({ id: SessionId('execution-cancel'), result, dispose }),
    })
    const activation = await ctx.subagents.startActivation({
      provider: 'scripted-cancel',
      label: 'probe cancel',
      prompt: [{ type: 'text', text: 'hold' }],
      parent,
      request: { prompt: [{ type: 'text', text: 'hold' }], parent },
      signal: new AbortController().signal,
      delivery: 'caller',
    } as never)
    await activation.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect((await activation.result).stopReason).toBe('aborted')
  })
})
