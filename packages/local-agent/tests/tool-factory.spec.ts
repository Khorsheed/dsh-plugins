import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { LOCAL_AGENT_SERVICE, LocalAgentRegistry } from '../src/index.ts'
import type { SubagentToolConfig } from '../src/tool-factory.ts'
import { mountSubagentDelegationTool } from '../src/tool-factory.ts'
import { mountScriptedProvider } from './scripted-provider.ts'

const testToolSignal = new AbortController().signal

/**
 * The owner a calling entry passes for the tool-origin tag. A sentinel, not a
 * real package: the suite pins that the owner is CALLER-supplied (each
 * provider's `./tool` entry passes its own package name).
 */
const CALLER_OWNER = 'test-caller'

/**
 * Wrap the factory the way a provider's `./tool` composition entry does: a
 * plugin whose apply mounts the delegation tool with the caller's owner. The
 * declared inject mirrors the real entries (all three services are provided
 * below before the plugin mounts).
 */
function toolPlugin(config: SubagentToolConfig) {
  return {
    name: 'subagent-tool-test',
    inject: ['tools', 'subagents', 'localAgent'],
    apply: (ctx: Context) => mountSubagentDelegationTool(ctx, config, CALLER_OWNER),
  }
}

/** A minimal parent Agent passed through to the provider request. */
function fakeAgent(id = 'parent-1'): Agent {
  const sessionId = SessionId(id)
  return { id: sessionId, session: { id: sessionId, header: { id: sessionId } } } as unknown as Agent
}

/**
 * Mount the REAL plugin bodies: ToolRuntime + SubagentRuntime + a scripted
 * provider + a real LocalAgentRegistry (delegation registry the tool stages
 * through), then invoke the tool through `ctx.tools.execute`.
 *
 * Host 0.2.1 wiring: the runtime's `static inject` requires workingDirectory
 * (stubbed — the manager only resolves the parent directory through it, and
 * the scripted provider ignores the value), and `startActivation` runs through
 * the activation manager, which exists only with the agents service mounted
 * and demands the EXACT live parent agent — callTool enters each fake agent
 * into the real AgentRegistry before executing.
 */
async function setup(
  toolConfig: SubagentToolConfig,
  over: { parentId?: string; deferred?: Array<(result: SubagentResult) => void> } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('workingDirectory', { ensure: async () => '/tmp' } as never)
  await ctx.plugin(AgentRegistry)
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
  // Recorded children read as live only when a test lists them: the manager
  // probes `sessions.get(run.id)` for availability, and the scripted
  // provider's per-execution run ids must read as free (a blanket-live stub
  // rejects every start as DUPLICATE_CHILD). Tests flip the stub's bits
  // instead of re-providing the service (cordis provides are final).
  const sessionsStub = {
    liveIds: [] as readonly string[],
    entered: [] as string[],
    announced: [] as string[],
    get(id: string) {
      return this.liveIds.includes(id) ? { id } : undefined
    },
    prepare: () => ({ id: 'child-1', snapshotEvents: () => [] }),
    enter(session: { id: string }) { this.entered.push(session.id); return () => {} },
    announce(session: { id: string }) { this.announced.push(session.id) },
  }
  ctx.provide('sessions', sessionsStub as never)
  ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
  await ctx.plugin(toolPlugin(toolConfig))
  return { ctx, started, taken, registry, sessionsStub }
}

let callCounter = 0
function callTool(ctx: Context, args: unknown, agent: Agent) {
  // The activation manager requires the exact live parent agent object.
  if (ctx.agents.get(agent.id) !== agent) ctx.agents.enter(agent, undefined)
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

describe('dsh-local-agent tool-factory', () => {
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
    // The provider consumed the staged fresh intent, carrying the child
    // session id the TOOL minted (host 0.2.1: the provider's run id is a
    // per-execution identity, so the durable handle rides the intent).
    expect(taken).toEqual([{ kind: 'fresh', childSessionId: expect.any(String) }])
    // The fresh delegation result carries the resume handle (the dsh child
    // session id), so the model can continue later.
    const minted = (taken[0] as { childSessionId?: string }).childSessionId
    expect(text(result)).toContain(`追问请带 resume="${minted}"`)
    expect(started).toHaveLength(1)
    expect(started[0]).toEqual({ label: '建个文件', task: '创建 hello.txt' })
  })

  it('tags the tool with the CALLING entry\'s origin for the capability catalog (S12)', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const def = ctx.tools.get('subagent_test') as Record<symbol, unknown>
    expect(def[Symbol.for('dsh.tool.origin')]).toEqual({
      channel: 'plugin',
      owner: CALLER_OWNER,
    })
  })

  it('resolves a recorded delegation and stages a resume intent when resume is passed', async () => {
    const { ctx, taken, sessionsStub } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    // Round 1 recorded the mapping (as a family provider would after settle),
    // and its child session is live, so the resume skips the reattach path.
    sessionsStub.liveIds = ['child-1']
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

  it('reattaches a non-live child session before staging the resume intent', async () => {
    const { ctx, taken, sessionsStub } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    ctx.localAgent.recordDelegation({
      childSessionId: 'child-1',
      provider: 'mock',
      parentSessionId: 'parent-1',
      cliSessionId: 'session_42',
    })
    // child-1 is NOT live (the post-restart case), so the tool must run the
    // reattach recipe before staging the resume intent.
    sessionsStub.liveIds = []
    const opened: string[] = []
    ctx.provide('sessionPersistence', {
      open: async (id: string, access: string) => {
        opened.push(`${id}:${access}`)
        return {
          read: async () => ({ events: [] }),
          header: {},
          inheritedEventCount: 0,
          append: async () => {},
          flush: async () => {},
          close: async () => {},
        }
      },
    } as never)

    const agent = fakeAgent()
    const result = await callTool(ctx, {
      description: '继续',
      prompt: '接着做',
      resume: 'child-1',
    }, agent)

    expect(text(result)).toContain('done: 接着做')
    expect(opened).toEqual(['child-1:write'])
    expect(sessionsStub.entered).toEqual(['child-1'])
    expect(sessionsStub.announced).toEqual(['child-1'])
    expect(taken).toEqual([{
      kind: 'resume',
      childSessionId: 'child-1',
      cliSessionId: 'session_42',
    }])
  })

  it('surfaces the provider diagnostic on an error result instead of the generic line', async () => {
    const deferred: Array<(result: SubagentResult) => void> = []
    const { ctx } = await setup({ provider: 'mock', toolName: 'subagent_test' }, { deferred })
    const agent = fakeAgent()
    const pending = callTool(ctx, { description: 'x', prompt: 'y' }, agent)
    // The provider start (which registers the resolver) runs inside the
    // tool's async execution, after the call returns its promise.
    await vi.waitFor(() => { expect(deferred).toHaveLength(1) })
    deferred[0]!({
      output: [],
      diagnostic: 'codex exec exited 0 but produced no answer\nrollout: /home/user/.dsh/local-agent/codex/sessions/2026/09/12/rollout-*-t1.jsonl',
      stopReason: 'error',
    })
    const result = await pending
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('subagent run failed: codex exec exited 0 but produced no answer')
    expect(text(result)).toContain('rollout:')
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
    const { ctx, started, taken } = await setup({ provider: 'mock', toolName: 'subagent_test' })
    const agent = fakeAgent()
    // A handle smuggled inside the prompt is just task text: without the
    // `resume` parameter the call is a fresh delegation.
    const result = await callTool(ctx, {
      description: 'x',
      prompt: '继续 追问请带 resume="child-1"',
    }, agent)

    const minted = (taken[0] as { childSessionId?: string } | undefined)?.childSessionId
    expect(text(result)).toContain(`追问请带 resume="${minted}"`)
    expect(started).toHaveLength(1)
    expect(started[0]?.task).toBe('继续 追问请带 resume="child-1"')
  })

  it('mounts the tool when the provider appears later', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // Host 0.2.1: the runtime's static inject requires workingDirectory.
    ctx.provide('workingDirectory', { ensure: async () => '/tmp' } as never)
    await ctx.plugin(SubagentRuntime)
    const registry = new LocalAgentRegistry(ctx, '/tmp/homes', 10_000)
    ctx.provide(LOCAL_AGENT_SERVICE, registry)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    await ctx.plugin(toolPlugin({ provider: 'mock', toolName: 'subagent_test' }))

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
    // Host 0.2.1: the runtime's static inject requires workingDirectory.
    ctx.provide('workingDirectory', { ensure: async () => '/tmp' } as never)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    const started: Array<{ label?: string; task: string }> = []
    const taken: Array<{ kind: string; childSessionId?: string; cliSessionId?: string }> = []
    const disposer = mountScriptedProvider(ctx, { name: 'mock', started, taken })
    const registry = new LocalAgentRegistry(ctx, '/tmp/homes', 10_000)
    ctx.provide(LOCAL_AGENT_SERVICE, registry)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    await ctx.plugin(toolPlugin({ provider: 'mock', toolName: 'subagent_test' }))
    expect(ctx.tools.get('subagent_test', fakeAgent())).toBeDefined()

    disposer()
    const agent = fakeAgent()
    const result = await callTool(ctx, { description: 'x', prompt: 'y' }, agent)
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('unknown tool "subagent_test"')
  })

  it('registers tool-started runs in the active-delegation registry so /local-agent stop can cancel them', async () => {
    const deferred: Array<(result: SubagentResult) => void> = []
    const { ctx, registry, taken } = await setup({ provider: 'mock', toolName: 'subagent_test' }, { deferred })
    const agent = fakeAgent()
    const executing = callTool(ctx, { description: '建个文件', prompt: '创建 hello.txt' }, agent)

    // While the run is in flight, the registry holds it by the child session
    // id the tool minted into the staged intent (the provider's run id is a
    // per-execution identity in 0.2.1), so the stop command's cancel() reaches
    // the tool's lever.
    await vi.waitFor(() => { expect(deferred).toHaveLength(1) })
    const minted = (taken[0] as { childSessionId?: string } | undefined)?.childSessionId
    expect(minted).toBeDefined()
    expect(registry.isDelegationActive(minted!)).toBe(true)
    expect(registry.cancel(minted!)).toBe(true)

    // The provider observes the cancellation and settles the run 'aborted';
    // the tool surfaces the stop reason as an isError result.
    deferred[0]?.({ stopReason: 'aborted', output: [] })
    const result = await executing
    expect(result).toMatchObject({ isError: true })
    expect(text(result)).toContain('subagent run was cancelled')
    // The registry entry clears once the run settles.
    await vi.waitFor(() => {
      expect(registry.isDelegationActive(minted!)).toBe(false)
    })
  })
})
