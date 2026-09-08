import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { LOCAL_AGENT_SERVICE, LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import * as tool from '../src/index.ts'
import { mountScriptedProvider } from './scripted-provider.ts'

const testToolSignal = new AbortController().signal

/** A minimal parent Agent passed through to the provider request. */
function fakeAgent(id = 'parent-1'): Agent {
  return { id: SessionId(id), session: { id: SessionId(id) } } as unknown as Agent
}

/**
 * Mount the REAL plugin bodies: ToolRuntime + SubagentRuntime + a scripted
 * provider + a real LocalAgentRegistry (delegation registry the tool stages
 * through), then invoke the tool through `ctx.tools.execute`.
 */
async function setup(
  toolConfig: tool.Config,
  over: { parentId?: string; deferred?: Array<(result: SubagentResult) => void> } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  const started: Array<{ label?: string; task: string }> = []
  const taken: Array<{ kind: string; childSessionId?: string; cliSessionId?: string }> = []
  mountScriptedProvider(ctx, {
    name: toolConfig.provider,
    started,
    taken,
    ...over.deferred === undefined ? {} : { deferred: over.deferred },
  })
  const registry = new LocalAgentRegistry(ctx, '/tmp/homes', 10_000)
  ctx.provide(LOCAL_AGENT_SERVICE, registry)
  ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
  await ctx.plugin(tool, toolConfig)
  return { ctx, started, taken, registry }
}

let callCounter = 0
function callTool(ctx: Context, args: unknown, agent: Agent) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `call-${++callCounter}` as ToolExecutionInput['callId'],
    name: 'subagent_test',
    arguments: args,
    agent,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-local-agent-tool-subagent', () => {
  it('registers the tool with the official subset plus an optional resume parameter', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const toolDef = ctx.tools.get('subagent_test', fakeAgent())
    const schema = toolDef?.parameters as {
      properties?: Record<string, { type?: string }>
      required?: string[]
    }
    expect(Object.keys(schema.properties ?? {})).toEqual(['description', 'prompt', 'resume'])
    expect(schema.required).toEqual(['description', 'prompt'])
    expect(schema.properties?.['resume']?.type).toBe('string')
  })

  it('stages a fresh intent and the fresh result self-describes the resume handle', async () => {
    const { ctx, started, taken } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const agent = fakeAgent()
    const result = await callTool(ctx, { description: '建个文件', prompt: '创建 hello.txt' }, agent)

    expect(text(result)).toContain('done: 创建 hello.txt')
    // The fresh delegation result carries the resume handle (the dsh child
    // session id, equal to the run id), so the model can continue later.
    expect(text(result)).toContain('追问请带 resume="scripted-child"')
    expect(started).toHaveLength(1)
    expect(started[0]).toEqual({ label: '建个文件', task: '创建 hello.txt' })
    // The provider consumed the staged fresh intent.
    expect(taken).toEqual([{ kind: 'fresh' }])
  })

  it('tags the tool with its origin for the capability catalog (S12)', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const def = ctx.tools.get('subagent_test') as Record<symbol, unknown>
    expect(def[Symbol.for('dsh.tool.origin')]).toEqual({
      channel: 'plugin',
      owner: '@khorsheed/dsh-local-agent-tool-subagent',
    })
  })

  it('resolves a recorded delegation and stages a resume intent when resume is passed', async () => {
    const { ctx, taken } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    // Round 1 recorded the mapping (as a family provider would after settle).
    ctx.localAgent.recordDelegation({
      childSessionId: 'child-1',
      provider: 'mock',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    const agent = fakeAgent()
    const result = await callTool(ctx, {
      description: '继续',
      prompt: '接着做',
      resume: 'child-1',
    }, agent)

    expect(text(result)).toContain('done: 接着做')
    // A resumed round does not re-describe the handle (the model already has it).
    expect(text(result)).not.toContain('追问请带 resume="child-1"')
    // The provider consumed the staged resume intent with the resolved target.
    expect(taken).toEqual([{
      kind: 'resume',
      childSessionId: 'child-1',
      cliSessionId: 'session_42',
    }])
  })

  it('rejects a forged resume handle naming an unknown child session', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const agent = fakeAgent()
    const result = await callTool(ctx, { description: 'x', prompt: 'y', resume: 'child-forged' }, agent)
    // The tools registry converts the tool's thrown error into an isError result.
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('no delegation recorded for child session child-forged')
  })

  it('rejects a resume handle owned by another parent session', async () => {
    const { ctx, registry } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'mock',
      parentSessionId: 'parent-other',
      cliSessionId: 'session_42',
    })

    const agent = fakeAgent('parent-1')
    const result = await callTool(ctx, { description: 'x', prompt: 'y', resume: 'child-1' }, agent)
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('belongs to another parent')
  })

  it('rejects a resume handle claimed through the wrong provider', async () => {
    const { ctx, registry } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    registry.recordDelegation({
      childSessionId: 'child-1',
      provider: 'other-provider',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })

    const agent = fakeAgent()
    const result = await callTool(ctx, { description: 'x', prompt: 'y', resume: 'child-1' }, agent)
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('was delegated through other-provider')
  })

  it('never reads the resume handle out of the prompt text', async () => {
    const { ctx, started } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const agent = fakeAgent()
    // A handle smuggled inside the prompt is just task text: without the
    // `resume` parameter the call is a fresh delegation.
    const result = await callTool(ctx, {
      description: 'x',
      prompt: '继续 追问请带 resume="child-1"',
    }, agent)

    expect(text(result)).toContain('追问请带 resume="scripted-child"')
    expect(started).toHaveLength(1)
    expect(started[0]?.task).toBe('继续 追问请带 resume="child-1"')
  })

  it('mounts the tool when the provider appears later', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const registry = new LocalAgentRegistry(ctx, '/tmp/homes', 10_000)
    ctx.provide(LOCAL_AGENT_SERVICE, registry)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    await ctx.plugin(tool, { provider: 'mock', toolName: 'subagent_test' })

    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeUndefined()
    const started: Array<{ label?: string; task: string }> = []
    const taken: Array<{ kind: string; childSessionId?: string; cliSessionId?: string }> = []
    mountScriptedProvider(ctx, { name: 'mock', started, taken })
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeDefined()
  })

  it('unmounts the tool when the provider leaves', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const started: Array<{ label?: string; task: string }> = []
    const taken: Array<{ kind: string; childSessionId?: string; cliSessionId?: string }> = []
    const disposer = mountScriptedProvider(ctx, { name: 'mock', started, taken })
    const registry = new LocalAgentRegistry(ctx, '/tmp/homes', 10_000)
    ctx.provide(LOCAL_AGENT_SERVICE, registry)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    await ctx.plugin(tool, { provider: 'mock', toolName: 'subagent_test' })
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeDefined()

    disposer()
    const agent = fakeAgent()
    const result = await callTool(ctx, { description: 'x', prompt: 'y' }, agent)
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('unknown tool "subagent_test"')
  })

  it('registers the tool under an explicit tools: all, exactly as the default does', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test', tools: 'all' })
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeDefined()
    const agent = fakeAgent()
    const result = await callTool(ctx, { description: '建个文件', prompt: '创建 hello.txt' }, agent)
    expect(text(result)).toContain('done: 创建 hello.txt')
  })

  it('registers nothing model-visible under tools: none, with the provider already present', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test', tools: 'none' })
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeUndefined()
    // Nothing model-visible from this row at all — not a renamed or disabled
    // registration the registry would still list.
    expect(ctx.tools.schemas(fakeAgent()).map(schema => schema.name)).not.toContain('subagent_test')
    // The provider face is untouched: the row only ever owned the tool.
    expect(ctx.subagents.getProvider('mock')).toBeDefined()
  })

  it('stays unregistered under tools: none when the provider appears after the mount', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const registry = new LocalAgentRegistry(ctx, '/tmp/homes', 10_000)
    ctx.provide(LOCAL_AGENT_SERVICE, registry)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    await ctx.plugin(tool, { provider: 'mock', toolName: 'subagent_test', tools: 'none' })
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeUndefined()

    // The `all` mount registers on this very event (see the sibling case), so
    // this pins that `none` does not re-open the tool through the late path.
    const started: Array<{ label?: string; task: string }> = []
    const taken: Array<{ kind: string; childSessionId?: string; cliSessionId?: string }> = []
    mountScriptedProvider(ctx, { name: 'mock', started, taken })
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeUndefined()
  })

  it('registers tool-started runs in the active-delegation registry so /local-agent stop can cancel them', async () => {
    const deferred: Array<(result: SubagentResult) => void> = []
    const { ctx, registry } = await setup({ provider: 'mock', toolName: 'subagent_test' }, { deferred })
    const agent = fakeAgent()
    const executing = callTool(ctx, { description: '建个文件', prompt: '创建 hello.txt' }, agent)

    // While the run is in flight, the registry holds it by child session id
    // (the run id), so the stop command's cancel() reaches the tool's lever.
    await vi.waitFor(() => {
      expect(registry.isDelegationActive('scripted-child')).toBe(true)
    })
    expect(registry.cancel('scripted-child')).toBe(true)

    // The provider observes the cancellation and settles the run 'aborted';
    // the tool surfaces the stop reason as an isError result.
    deferred[0]?.({ stopReason: 'aborted', output: [] })
    const result = await executing
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('subagent run was cancelled')
    // The registry entry clears once the run settles.
    await vi.waitFor(() => {
      expect(registry.isDelegationActive('scripted-child')).toBe(false)
    })
  })
})
