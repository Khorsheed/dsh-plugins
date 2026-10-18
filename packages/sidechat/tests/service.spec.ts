/**
 * The side-chat service core against fakes: the contextKey → agent-session
 * lifecycle (lazy creation, live reuse, cold resume, resume-failure
 * fallback), `openWith`'s update-not-recreate semantics (segment freshness,
 * by-name tool re-attach), the ref fold on send, the quote action's journal
 * lookup, the contexts document's round-trip and memory-only degrade, and
 * the re-rooted sandbox fence every state write carries.
 *
 * The fakes implement only the surfaces the service touches: a path-keyed
 * `ctx.fs` with the two guarded-write failures mirrored exactly, an agents
 * registry that runs the create/resume setup like the real factory, a
 * sessions store, a persistence backend, and a recording sandbox policy.
 */
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { FsError, type FsTarget, type FsVersion } from '@deepseek-ai/dsh-fs'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  type SideChatExecutionBackend, type SideChatExecutionCapabilities, type SideChatExecutionMessage,
  type SideChatExecutionOpenInit, type SideChatExecutionSession,
} from '../src/execution.ts'
import { SideChatDisposedError, SideChatService } from '../src/service.ts'
import { resolveSideChatStateRoot } from '../src/store.ts'
import type { SideChatContextsDoc } from '../src/types.ts'

const STATE_ROOT = '/home/user/.dsh/state/sidechat'
const SOURCE_CWD = '/home/user/work/main'

/** The fence one write carried, as the store passed it. */
type SeenPolicy = { mode: string; workspaceRoot: string; sessionId?: string } | undefined

/** The minimal `ctx.fs` the store touches, over a path → content map. */
class FakeFs {
  readonly entries = new Map<string, { content: string; version: number }>()
  private seq = 0
  sandboxMode: 'workspace-write' | undefined = 'workspace-write'
  readonly policies: SeenPolicy[] = []

  seed(path: string, content: string): void {
    this.entries.set(path, { content, version: ++this.seq })
  }

  read(path: string): string | undefined {
    return this.entries.get(path)?.content
  }

  async resolve(path: string): Promise<FsTarget> {
    return { targetKey: path, displayPath: path } as unknown as FsTarget
  }

  async stat(target: FsTarget): Promise<{ version: FsVersion; type: 'file'; size: number } | undefined> {
    const entry = this.entries.get(target.displayPath)
    if (entry === undefined) return undefined
    return { version: String(entry.version) as FsVersion, type: 'file', size: entry.content.length }
  }

  async readText(target: FsTarget): Promise<string> {
    const entry = this.entries.get(target.displayPath)
    if (entry === undefined) throw new FsError(`no file at ${target.displayPath}`, 'FS_NOT_FOUND')
    return entry.content
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: { kind: string; version?: string },
    _signal?: unknown,
    policy?: SeenPolicy,
  ): Promise<{ operation: 'create' | 'update'; version: FsVersion }> {
    this.policies.push(policy)
    const existing = this.entries.get(target.displayPath)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError('already exists', 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion' && (existing === undefined || String(existing.version) !== expected.version)) {
      throw new FsError('stale', 'FS_STALE_VERSION')
    }
    this.entries.set(target.displayPath, { content, version: ++this.seq })
    return { operation: existing === undefined ? 'create' : 'update', version: String(this.seq) as FsVersion }
  }
}

/** The recording sandbox policy home (the real resolve's shape, re-rooted by the store). */
function fakeSandboxPolicy(mode = 'workspace-write') {
  return {
    resolve: (request: { session?: Session } = {}) => ({
      mode,
      workspaceRoot: request.session?.header.cwd ?? '/deployment-cwd',
      ...request.session === undefined ? {} : { sessionId: request.session.id },
    }),
  }
}

/** A bare event envelope for the fake journals. */
function event(type: string, time: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

function userEvent(text: string, time: number): SessionEvent {
  return event('user/message', time, {
    id: `u${time}`, role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: '@khorsheed/dsh-sidechat' },
  })
}

function assistantEvent(id: string, text: string, time: number): SessionEvent {
  return event('assistant/message', time, {
    turn: 1, step: 1,
    message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
    stream: [],
  })
}

/** The agent scope the fake factory runs setups against (systemPrompt + tools recording). */
function fakeScope() {
  const sections: Array<{ name: string; order: number; text: () => string }> = []
  const tools = new Map<string, ToolDefinition>()
  const scope = {
    get(name: string): unknown {
      if (name === 'systemPrompt') return scope.systemPrompt
      if (name === 'tools') return scope.tools
      return undefined
    },
    systemPrompt: {
      section: (section: { name: string; order: number; text: () => string }) => {
        sections.push(section)
        return () => {}
      },
    },
    tools: {
      register: (def: ToolDefinition) => {
        tools.set(def.name, def)
        return () => { tools.delete(def.name) }
      },
    },
  }
  return { scope, sections, tools }
}

/** One fake live agent: its followup lands in its own journal, like the real loop. */
interface FakeAgentRec {
  readonly id: string
  readonly agent: Agent
  readonly session: Session
  readonly events: SessionEvent[]
  readonly scopeKit: ReturnType<typeof fakeScope>
  readonly followup: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
}

function makeAgentRec(id: string, cwd: string | undefined): FakeAgentRec {
  const events: SessionEvent[] = []
  const scopeKit = fakeScope()
  const session = {
    id, header: { cwd }, snapshotEvents: () => [...events],
  } as unknown as Session
  const followup = vi.fn((message: { content: Array<{ type: string; text?: string }> }) => {
    const text = message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
    events.push(userEvent(text, events.length + 1))
  })
  const cancel = vi.fn()
  const agent = { session, status: 'idle', ctx: scopeKit.scope, followup, cancel, whenIdle: async () => {} } as unknown as Agent
  return { id, agent, session, events, scopeKit, followup, cancel }
}

/** The fake agents registry: runs the create/resume setup like the real factory. */
function fakeAgents() {
  const live = new Map<string, FakeAgentRec>()
  const created: Array<{ sessionId: string; meta?: { cwd?: string; agentPreset?: string }; agentOptions?: unknown }> = []
  const resumed: string[] = []
  const resumedOpts: Array<{ agentOptions?: unknown }> = []
  /** Handles the service disposed, in order (both disposeAgents and the late-handle race guard land here). */
  const disposed: string[] = []
  let failCreate: Error | undefined
  let failResume: Error | undefined
  let holdCreate: Promise<void> | undefined
  const agents = {
    get: (id: SessionId) => live.get(String(id))?.agent,
    create: vi.fn(async (opts: { sessionId: SessionId; meta?: { cwd?: string; agentPreset?: string }; agentOptions?: unknown; setup?: (ctx: unknown, agent: Agent) => Promise<void> }) => {
      if (failCreate !== undefined) throw failCreate
      if (holdCreate !== undefined) {
        const hold = holdCreate
        holdCreate = undefined
        await hold
      }
      const rec = makeAgentRec(String(opts.sessionId), opts.meta?.cwd)
      await opts.setup?.(rec.scopeKit.scope, rec.agent)
      live.set(rec.id, rec)
      created.push({
        sessionId: rec.id,
        ...(opts.meta === undefined ? {} : { meta: opts.meta }),
        ...(opts.agentOptions === undefined ? {} : { agentOptions: opts.agentOptions }),
      })
      return { agent: rec.agent, dispose: async () => { live.delete(rec.id); disposed.push(rec.id) } }
    }),
    resume: vi.fn(async (opts: { resumeSessionId: SessionId; agentOptions?: unknown; setup?: (ctx: unknown, agent: Agent) => Promise<void> }) => {
      if (failResume !== undefined) throw failResume
      const rec = makeAgentRec(String(opts.resumeSessionId), undefined)
      await opts.setup?.(rec.scopeKit.scope, rec.agent)
      live.set(rec.id, rec)
      resumed.push(rec.id)
      resumedOpts.push({ ...(opts.agentOptions === undefined ? {} : { agentOptions: opts.agentOptions }) })
      return { agent: rec.agent, dispose: async () => { live.delete(rec.id); disposed.push(rec.id) } }
    }),
  }
  return {
    agents,
    live,
    created,
    resumed,
    resumedOpts,
    disposed,
    recOf: (id: string) => live.get(id),
    failNextCreate(error: Error): void { failCreate = error },
    failNextResume(error: Error): void { failResume = error },
    /** Gate the next create on a manual release (the spawn/dispose race bench). */
    holdNextCreate(): () => void {
      let release!: () => void
      holdCreate = new Promise<void>(resolve => { release = resolve })
      return release
    },
  }
}

/** One fake session row for the sessions store. */
function fakeSession(id: string, cwd: string, events: SessionEvent[] = []): Session {
  return { id, header: { cwd }, snapshotEvents: () => [...events] } as unknown as Session
}

interface Bench {
  readonly service: SideChatService
  readonly fs: FakeFs
  readonly agentsKit: ReturnType<typeof fakeAgents>
  readonly sessions: Map<string, Session>
  readonly calling: Agent
  readonly callingEvents: SessionEvent[]
  readonly persistence: { opened: string[] }
  readonly resolveCalls: Array<string | undefined>
}

/** Mount the service over the full fake bench. */
function bench(opts: {
  fs?: FakeFs | null
  presets?: boolean
  coldEvents?: SessionEvent[]
  callingHeader?: { provider: string; model: string; reasoningEffort?: string }
  callingPreset?: string
  defaultModel?: { provider: string; model: string; reasoningEffort?: string }
  config?: { agentRoute?: AgentOptions; cwd?: string }
} = {}): Bench {
  const ctx = new Context()
  const fs = opts.fs === null ? undefined : (opts.fs ?? new FakeFs())
  const agentsKit = fakeAgents()
  const sessions = new Map<string, Session>()
  const persistence = { opened: [] as string[] }
  const resolveCalls: Array<string | undefined> = []
  ctx.provide('agents', agentsKit.agents as never)
  ctx.provide('sessions', { get: (id: SessionId) => sessions.get(String(id)) } as never)
  if (fs !== undefined) {
    ctx.provide('fs', fs as never)
    ctx.provide('sandboxPolicy', fakeSandboxPolicy() as never)
  }
  if (opts.presets === true) {
    ctx.provide('agentPresets', {
      resolve: async (id: string | undefined) => {
        resolveCalls.push(id)
        return { id: id ?? 'default-preset' }
      },
      mount: async () => {},
    } as never)
  }
  if (opts.defaultModel !== undefined) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ ...opts.defaultModel }),
    } as never)
  }
  ctx.provide('sessionPersistence', {
    open: async (id: string, _mode: string) => {
      persistence.opened.push(id)
      return {
        header: {},
        inheritedEventCount: 0,
        read: async () => ({ events: opts.coldEvents ?? [] }),
        close: async () => {},
      }
    },
  } as never)
  const callingEvents: SessionEvent[] = []
  const calling = {
    session: {
      id: 's-main',
      header: { cwd: SOURCE_CWD, ...opts.callingPreset === undefined ? {} : { agentPreset: opts.callingPreset } },
      snapshotEvents: () => [...callingEvents],
      requestHeader: () => opts.callingHeader === undefined ? undefined : { config: { ...opts.callingHeader } },
    },
  } as unknown as Agent
  const service = new SideChatService(ctx, { stateRoot: STATE_ROOT, ...opts.config })
  return { service, fs: fs as FakeFs, agentsKit, sessions, calling, callingEvents, persistence, resolveCalls }
}

const DOC_PATH = join(STATE_ROOT, 'contexts.json')

function docOf(fs: FakeFs): SideChatContextsDoc {
  const content = fs.read(DOC_PATH)
  expect(content).toBeDefined()
  return JSON.parse(content as string) as SideChatContextsDoc
}

describe('SideChatService — the contextKey lifecycle', () => {
  it('creates the side agent lazily on the first send, inheriting the source session\'s cwd', async () => {
    const { service, fs, agentsKit, sessions, calling } = bench({ presets: true })
    sessions.set('s-main', fakeSession('s-main', SOURCE_CWD))
    const outcome = await service.send(calling, { contextKey: 's-main', text: '你好' })
    expect(outcome.ok).toBe(true)
    expect(agentsKit.created).toHaveLength(1)
    expect(agentsKit.created[0]!.meta).toEqual({ cwd: SOURCE_CWD, agentPreset: 'default-preset' })
    // The followup carries the user's text with the producer-owned source.
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    expect(rec.followup).toHaveBeenCalledTimes(1)
    expect(rec.followup.mock.calls[0]![0]).toMatchObject({ source: { kind: 'sidechat' } })
    expect(rec.events[0]).toMatchObject({ type: 'user/message' })
    // The mapping persisted: contextKey → the new session id.
    const doc = docOf(fs)
    expect(doc.contexts).toHaveLength(1)
    expect(doc.contexts[0]).toMatchObject({ contextKey: 's-main', sessionId: String(rec.id) })
  })

  it('reuses the live agent on later sends (no second create)', async () => {
    const { service, agentsKit, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '一' })
    await service.send(calling, { contextKey: 'k', text: '二' })
    expect(agentsKit.created).toHaveLength(1)
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    expect(rec.followup).toHaveBeenCalledTimes(2)
    expect(rec.events.map(e => e.type)).toEqual(['user/message', 'user/message'])
  })

  it('refuses an empty send before touching anything', async () => {
    const { service, agentsKit, calling } = bench()
    expect(await service.send(calling, { contextKey: 'k', text: '   ' })).toEqual({ ok: false, error: 'empty' })
    expect(agentsKit.created).toHaveLength(0)
  })

  it('answers agent-unavailable when the factory refuses creation', async () => {
    const { service, agentsKit, calling } = bench()
    agentsKit.failNextCreate(new Error('no agent factory registered (load an agent-loop plugin)'))
    expect(await service.send(calling, { contextKey: 'k', text: '问' })).toEqual({ ok: false, error: 'agent-unavailable' })
  })

  it('cold-resumes the recorded session after a restart, never recreating it', async () => {
    const fs = new FakeFs()
    const first = bench({ fs })
    await first.service.send(first.calling, { contextKey: 'k', text: '重启前' })
    const persistedSessionId = docOf(fs).contexts[0]!.sessionId
    expect(persistedSessionId).toBeDefined()

    // "Restart": a brand-new bench over the same fs — the live map is empty.
    const second = bench({ fs, coldEvents: [userEvent('重启前', 1)] })
    const state = await second.service.getState('k')
    expect(state).toMatchObject({ ok: true, state: { status: 'cold' } })
    const sent = await second.service.send(second.calling, { contextKey: 'k', text: '重启后' })
    expect(sent.ok).toBe(true)
    expect(second.agentsKit.created).toHaveLength(0)
    expect(second.agentsKit.resumed).toEqual([persistedSessionId])
  })

  it('falls back to a fresh session when the recorded one fails to resume', async () => {
    const fs = new FakeFs()
    const first = bench({ fs })
    await first.service.send(first.calling, { contextKey: 'k', text: '一' })
    const second = bench({ fs })
    second.agentsKit.failNextResume(new Error('torn log'))
    const sent = await second.service.send(second.calling, { contextKey: 'k', text: '二' })
    expect(sent.ok).toBe(true)
    expect(second.agentsKit.created).toHaveLength(1)
    // The mapping converged on the fresh session id.
    const doc = docOf(fs)
    expect(doc.contexts[0]!.sessionId).toBe(String(second.agentsKit.created[0]!.sessionId))
  })
})

describe('SideChatService — refs and quotes', () => {
  it('folds pending refs into the sent message and clears them', async () => {
    const { service, agentsKit, calling } = bench()
    await service.openWith({ contextKey: 'k', label: '上下文', refs: [{ label: '第一条', text: '引用一' }] })
    const outcome = await service.send(calling, { contextKey: 'k', text: '怎么看？', refs: [{ label: '第二条', text: '引用二' }] })
    expect(outcome.ok).toBe(true)
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    const text = (rec.events[0]!.data as { content: Array<{ text: string }> }).content[0]!.text
    expect(text).toContain('<quoted_context label="第一条">\n引用一\n</quoted_context>')
    expect(text).toContain('<quoted_context label="第二条">\n引用二\n</quoted_context>')
    expect(text.endsWith('怎么看？')).toBe(true)
    // Pending refs cleared, both in the returned state and the persisted doc.
    expect(outcome).toMatchObject({ ok: true, state: { refs: [] } })
  })

  it('quotes an assistant message from the calling session\'s journal by messageId', async () => {
    const { service, calling, callingEvents } = bench()
    callingEvents.push(assistantEvent('m1', '沉默并不总是金的，尤其是在需要表态的时候。', 1))
    const outcome = await service.quoteMessage(calling, { messageId: 'm1', label: '主会话' })
    expect(outcome).toEqual({ ok: true, contextKey: 's-main', refs: 1 })
    const state = await service.getState('s-main')
    expect(state).toMatchObject({
      ok: true,
      state: {
        contextKey: 's-main',
        label: '主会话',
        status: 'new',
        refs: [{ label: '沉默并不总是金的，尤其是在需要表态的时候。', text: '沉默并不总是金的，尤其是在需要表态的时候。' }],
      },
    })
  })

  it('answers message-not-found for an unknown messageId', async () => {
    const { service, calling } = bench()
    expect(await service.quoteMessage(calling, { messageId: 'nope' })).toEqual({ ok: false, error: 'message-not-found' })
  })
})

describe('SideChatService — openWith update semantics', () => {
  it('updates label, segment, refs and tools on repeat calls without creating any agent', async () => {
    const { service, agentsKit } = bench()
    await service.openWith({ contextKey: 'canvas:c1', label: '画布 A', systemPrompt: '主题：异议', tools: [] })
    await service.openWith({ contextKey: 'canvas:c1', label: '画布 B', systemPrompt: '主题：异议（更新）', refs: [{ label: '卡 1', text: '卡文' }] })
    expect(agentsKit.created).toHaveLength(0)
    const state = await service.getState('canvas:c1')
    expect(state).toMatchObject({
      ok: true,
      state: { label: '画布 B', status: 'new', refs: [{ label: '卡 1', text: '卡文' }] },
    })
  })

  it('reads the LATEST segment at prompt assembly (per-turn freshness, never a snapshot)', async () => {
    const { service, agentsKit, calling } = bench()
    await service.openWith({ contextKey: 'k', label: 'k', systemPrompt: '第一版上下文' })
    await service.send(calling, { contextKey: 'k', text: '问' })
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    const section = rec.scopeKit.sections.find(s => s.name === 'sidechat:context')
    expect(section).toBeDefined()
    expect(section!.text()).toContain('第一版上下文')
    // A consumer refresh lands WITHOUT recreating the session.
    await service.openWith({ contextKey: 'k', label: 'k', systemPrompt: '第二版上下文' })
    expect(agentsKit.created).toHaveLength(1)
    expect(section!.text()).toContain('第二版上下文')
    expect(section!.text()).not.toContain('第一版上下文')
  })

  it('attaches caller tools at creation and re-attaches a same-named replacement on the live agent', async () => {
    const { service, agentsKit, calling } = bench()
    const toolV1 = { name: 'canvas_read', description: 'v1' } as unknown as ToolDefinition
    const toolV2 = { name: 'canvas_read', description: 'v2' } as unknown as ToolDefinition
    await service.openWith({ contextKey: 'k', label: 'k', tools: [toolV1] })
    await service.send(calling, { contextKey: 'k', text: '问' })
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    expect(rec.scopeKit.tools.get('canvas_read')).toBe(toolV1)
    await service.openWith({ contextKey: 'k', label: 'k', tools: [toolV2] })
    expect(rec.scopeKit.tools.get('canvas_read')).toBe(toolV2)
  })

  it('never stamps its own origin on caller tools — a caller tag survives, an untagged tool stays untagged', async () => {
    // Origin tagging is the CALLER's responsibility (execution.ts's attachTools
    // contract): the tool's owner is the package that DEFINED it, and side-chat
    // is only the conduit.
    const { service, agentsKit, calling } = bench()
    const ORIGIN = Symbol.for('dsh.tool.origin')
    const callerOrigin = { channel: 'plugin', owner: '@khorsheed/dsh-caller' }
    const tagged = Object.assign({ name: 'caller_tagged', description: 't' } as unknown as ToolDefinition, { [ORIGIN]: callerOrigin })
    const plain = { name: 'caller_plain', description: 'u' } as unknown as ToolDefinition
    await service.openWith({ contextKey: 'k', label: 'k', tools: [tagged, plain] })
    await service.send(calling, { contextKey: 'k', text: '问' })
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    expect((rec.scopeKit.tools.get('caller_tagged')! as Record<symbol, unknown>)[ORIGIN]).toEqual(callerOrigin)
    expect((rec.scopeKit.tools.get('caller_plain')! as Record<symbol, unknown>)[ORIGIN]).toBeUndefined()
  })
})

describe('SideChatService — state, list, and the store fence', () => {
  it('round-trips the contexts document across service instances', async () => {
    const fs = new FakeFs()
    const first = bench({ fs })
    await first.service.send(first.calling, { contextKey: 'k', text: '一', label: '标签' })
    const second = bench({ fs })
    expect(await second.service.listContexts()).toMatchObject({
      items: [{ contextKey: 'k', label: '标签', status: 'cold', refs: 0 }],
    })
    // The cold transcript answers from persistence inspection, not a resume.
    const state = await second.service.getState('k')
    expect(second.persistence.opened.length).toBeGreaterThan(0)
    expect(state.ok).toBe(true)
  })

  it('reports each context\'s latest assistant time (live from the snapshot, cold from inspection)', async () => {
    const fs = new FakeFs()
    const first = bench({ fs })
    await first.service.send(first.calling, { contextKey: 'k', text: '一' })
    const firstRec = first.agentsKit.live.values().next().value as FakeAgentRec
    firstRec.events.push(assistantEvent('a1', '答', 99))
    expect(await first.service.listContexts()).toMatchObject({
      items: [{ contextKey: 'k', lastAssistantAt: 99, lastActivityAt: 99 }],
    })
    // The cold read answers the same times from persistence inspection — no resume.
    const second = bench({ fs, coldEvents: [userEvent('一', 1), assistantEvent('a1', '答', 42)] })
    expect(await second.service.listContexts()).toMatchObject({
      items: [{ contextKey: 'k', status: 'cold', lastAssistantAt: 42, lastActivityAt: 42 }],
    })
    expect(second.agentsKit.resumed).toHaveLength(0)
  })

  it('projects the live transcript from the session journal (user/assistant/tool)', async () => {
    const { service, agentsKit, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '问' })
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    rec.events.push(assistantEvent('a1', '答', 99))
    const state = await service.getState('k')
    expect(state).toMatchObject({
      ok: true,
      state: {
        status: 'idle',
        transcript: [
          { kind: 'user', text: '问' },
          { kind: 'assistant', text: '答' },
        ],
      },
    })
  })

  it('fences every state write at the plugin state root with the calling session\'s mode and id', async () => {
    const { service, fs, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '一' })
    expect(fs.policies.length).toBeGreaterThan(0)
    for (const policy of fs.policies) {
      expect(policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: STATE_ROOT, sessionId: 's-main' })
    }
  })

  it('fences host-side openWith writes with the deployment default mode and no session id', async () => {
    const { service, fs } = bench()
    await service.openWith({ contextKey: 'k', label: 'k' })
    expect(fs.policies.length).toBeGreaterThan(0)
    for (const policy of fs.policies) {
      expect(policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: STATE_ROOT })
      expect(policy?.sessionId).toBeUndefined()
    }
  })

  it('runs memory-only without a mounted filesystem, never failing a gesture', async () => {
    const { service, calling } = bench({ fs: null })
    const outcome = await service.send(calling, { contextKey: 'k', text: '问' })
    expect(outcome.ok).toBe(true)
    expect(await service.getState('k')).toMatchObject({ ok: true, state: { status: 'idle' } })
  })

  it('loads and flushes the mapping once fs arrives LATE (the 3080 persistence bug)', async () => {
    // Boot with NO fs: the deferred inject has not fired, gestures run memory-only.
    const ctx = new Context()
    const agentsKit = fakeAgents()
    const callingEvents: SessionEvent[] = []
    ctx.provide('agents', agentsKit.agents as never)
    ctx.provide('sessions', { get: () => undefined } as never)
    ctx.provide('sessionPersistence', { open: async () => { throw new Error('none') } } as never)
    const calling = {
      session: { id: 's-main', header: { cwd: SOURCE_CWD }, snapshotEvents: () => [...callingEvents] },
    } as unknown as Agent
    const service = new SideChatService(ctx, { stateRoot: STATE_ROOT })

    // Gesture one: memory-only (no contexts.json anywhere yet).
    expect((await service.send(calling, { contextKey: 'k', text: '一' })).ok).toBe(true)
    const fs = new FakeFs()
    expect(fs.read(DOC_PATH)).toBeUndefined()

    // fs mounts (the deferred door fires), and the next gesture reloads:
    // the in-memory record flushes to disk.
    ctx.provide('fs', fs as never)
    ctx.provide('sandboxPolicy', fakeSandboxPolicy() as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await service.listContexts()).toMatchObject({ items: [{ contextKey: 'k' }] })
    expect(docOf(fs).contexts).toMatchObject([{ contextKey: 'k' }])

    // And a "restart" over that disk finds the context again — persistence is real.
    const second = bench({ fs })
    expect(await second.service.listContexts()).toMatchObject({ items: [{ contextKey: 'k', status: 'cold' }] })
  })
})

describe('SideChatService — the model route (the 3080 disappearing-message fix)', () => {
  it('inherits the calling session\'s folded header route on create (provider, model, effort)', async () => {
    const { service, agentsKit, calling } = bench({
      callingHeader: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
  })

  it('falls back to the probed agentDefaultModel when the calling session has no header', async () => {
    const { service, agentsKit, calling } = bench({ defaultModel: { provider: 'deepseek', model: 'deepseek-v4' } })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
  })

  it('prefers the calling header over the deployment default', async () => {
    const { service, agentsKit, calling } = bench({
      callingHeader: { provider: 'p-call', model: 'm-call' },
      defaultModel: { provider: 'p-default', model: 'm-default' },
    })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'p-call', model: 'm-call' })
  })

  it('passes no agentOptions when neither route exists (the turn error then surfaces, never vanishes)', async () => {
    const { service, agentsKit, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(agentsKit.created[0]!.agentOptions).toBeUndefined()
  })

  it('carries the route on cold resume as well (the seed route comes from options alone there)', async () => {
    const fs = new FakeFs()
    const first = bench({ fs })
    await first.service.send(first.calling, { contextKey: 'k', text: '一' })
    const second = bench({ fs, callingHeader: { provider: 'p2', model: 'm2' } })
    const sent = await second.service.send(second.calling, { contextKey: 'k', text: '二' })
    expect(sent.ok).toBe(true)
    expect(second.agentsKit.resumed).toHaveLength(1)
    expect(second.agentsKit.resumedOpts[0]!.agentOptions).toEqual({ provider: 'p2', model: 'm2' })
  })
})

describe('SideChatService — preset inheritance', () => {
  it('CREATE inherits the calling session\'s own header preset first', async () => {
    const { service, agentsKit, calling, resolveCalls } = bench({ presets: true, callingPreset: 'dsh-standard' })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(resolveCalls).toEqual(['dsh-standard'])
    expect(agentsKit.created[0]!.meta).toMatchObject({ agentPreset: 'dsh-standard' })
  })

  it('CREATE falls back to the recorded preset when the calling header names none', async () => {
    const fs = new FakeFs()
    fs.seed(DOC_PATH, JSON.stringify({
      version: 1,
      contexts: [{ contextKey: 'k', label: 'k', agentPreset: 'recorded-preset', refs: [], createdAt: 't', updatedAt: 't' }],
    }))
    const { service, agentsKit, calling, resolveCalls } = bench({ fs, presets: true })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(resolveCalls).toEqual(['recorded-preset'])
    expect(agentsKit.created[0]!.meta).toMatchObject({ agentPreset: 'recorded-preset' })
  })

  it('CREATE resolves the deployment default when neither names a preset, and RESUME keeps the recorded one over the calling header', async () => {
    // Create path with nothing to inherit: the default.
    const first = bench({ presets: true })
    await first.service.send(first.calling, { contextKey: 'k', text: '一' })
    expect(first.resolveCalls).toEqual([undefined])
    expect(first.agentsKit.created[0]!.meta).toMatchObject({ agentPreset: 'default-preset' })
    // Resume path: the recorded preset wins even when the new calling session names another.
    const fs = new FakeFs()
    const seeded = bench({ fs, presets: true })
    await seeded.service.send(seeded.calling, { contextKey: 'k', text: '一' })
    const doc = docOf(fs)
    expect(doc.contexts[0]!.agentPreset).toBe('default-preset')
    const second = bench({ fs, presets: true, callingPreset: 'dsh-standard' })
    await second.service.send(second.calling, { contextKey: 'k', text: '二' })
    expect(second.agentsKit.resumed).toHaveLength(1)
    expect(second.resolveCalls).toEqual(['default-preset'])
  })
})

describe('SideChatService — the openWith revision (the surfacer signal)', () => {
  it('bumps rev on every openWith — never on send or quote — and persists it', async () => {
    const fs = new FakeFs()
    const { service, calling, callingEvents } = bench({ fs })
    expect((await service.surfaceHints()).items).toEqual([])
    await service.openWith({ contextKey: 'k', label: 'k' })
    expect(await service.surfaceHints()).toEqual({ items: [{ contextKey: 'k', rev: 1 }] })
    // Neither gesture from the chat itself moves the revision.
    await service.send(calling, { contextKey: 'k', text: '问' })
    callingEvents.push(assistantEvent('m1', '答', 1))
    await service.quoteMessage(calling, { messageId: 'm1' })
    expect(await service.surfaceHints()).toEqual({
      items: [{ contextKey: 'k', rev: 1 }, { contextKey: 's-main', rev: 0 }],
    })
    // A consumer refresh bumps again (the surfacer fires per call, not per change).
    await service.openWith({ contextKey: 'k', label: 'k', systemPrompt: '新' })
    expect(await service.surfaceHints()).toEqual({
      items: [{ contextKey: 'k', rev: 2 }, { contextKey: 's-main', rev: 0 }],
    })
    // The revision survives a "restart" (a new instance over the same fs).
    const second = bench({ fs })
    expect(await second.service.surfaceHints()).toEqual({
      items: [{ contextKey: 'k', rev: 2 }, { contextKey: 's-main', rev: 0 }],
    })
    // A pre-M3 record (no rev field) reads as 0 through the tolerant reader.
    fs.seed(DOC_PATH, JSON.stringify({ version: 1, contexts: [{ contextKey: 'old', label: 'o', refs: [], createdAt: 't', updatedAt: 't' }] }))
    const third = bench({ fs })
    expect(await third.service.surfaceHints()).toEqual({ items: [{ contextKey: 'old', rev: 0 }] })
  })
})

describe('SideChatService — the explicit route and cwd anchors (config seam)', () => {
  it('wins over both the calling header and the deployment default when set', async () => {
    const { service, agentsKit, calling } = bench({
      callingHeader: { provider: 'p-call', model: 'm-call' },
      defaultModel: { provider: 'p-default', model: 'm-default' },
      config: { agentRoute: { provider: 'p-explicit', model: 'm-explicit', reasoningEffort: ReasoningEffortId('high') } },
    })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'p-explicit', model: 'm-explicit', reasoningEffort: 'high' })
  })

  it('reads an unusable explicit route as unset (the legacy chain runs byte-identical)', async () => {
    const { service, agentsKit, calling } = bench({
      callingHeader: { provider: 'p-call', model: 'm-call' },
      config: { agentRoute: { provider: '', model: '' } },
    })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'p-call', model: 'm-call' })
  })

  it('wins the cwd over both the source session and the calling session when set', async () => {
    const { service, agentsKit, sessions, calling } = bench({ presets: true, config: { cwd: '/home/user/anchor' } })
    sessions.set('s-main', fakeSession('s-main', SOURCE_CWD))
    await service.send(calling, { contextKey: 's-main', text: '问' })
    expect(agentsKit.created[0]!.meta).toMatchObject({ cwd: '/home/user/anchor' })
  })

  it('sends without a calling agent once the explicit route resolves (fenced with no session)', async () => {
    const { service, agentsKit, fs } = bench({
      config: { agentRoute: { provider: 'p-explicit', model: 'm-explicit' }, cwd: '/home/user/anchor' },
    })
    const outcome = await service.send(undefined, { contextKey: 'k', text: '问' })
    expect(outcome.ok).toBe(true)
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'p-explicit', model: 'm-explicit' })
    expect(agentsKit.created[0]!.meta).toMatchObject({ cwd: '/home/user/anchor' })
    // No calling session: the write fences like a host-side openWith — the deployment mode, no session id.
    expect(fs.policies.length).toBeGreaterThan(0)
    for (const policy of fs.policies) {
      expect(policy).toMatchObject({ mode: 'workspace-write', workspaceRoot: STATE_ROOT })
      expect(policy?.sessionId).toBeUndefined()
    }
  })

  it('sends without a calling agent through the deployment-default route', async () => {
    const { service, agentsKit } = bench({ defaultModel: { provider: 'p-default', model: 'm-default' } })
    const outcome = await service.send(undefined, { contextKey: 'k', text: '问' })
    expect(outcome.ok).toBe(true)
    expect(agentsKit.created[0]!.agentOptions).toEqual({ provider: 'p-default', model: 'm-default' })
  })

  it('refuses a calling-less send with agent-unavailable when no route resolves', async () => {
    const { service, agentsKit } = bench()
    expect(await service.send(undefined, { contextKey: 'k', text: '问' })).toEqual({ ok: false, error: 'agent-unavailable' })
    expect(agentsKit.created).toHaveLength(0)
  })
})

describe('SideChatService — disposal (the terminal guard)', () => {
  it('refuses every public verb with the coded package error after disposeAgents', async () => {
    const { service, agentsKit, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '一' })
    const recId = agentsKit.created[0]!.sessionId
    await service.disposeAgents()
    expect(agentsKit.disposed).toEqual([recId])
    await expect(service.openWith({ contextKey: 'k', label: 'k' })).rejects.toBeInstanceOf(SideChatDisposedError)
    await expect(service.getState('k')).rejects.toBeInstanceOf(SideChatDisposedError)
    await expect(service.listContexts()).rejects.toBeInstanceOf(SideChatDisposedError)
    await expect(service.surfaceHints()).rejects.toBeInstanceOf(SideChatDisposedError)
    await expect(service.send(calling, { contextKey: 'k', text: '二' })).rejects.toBeInstanceOf(SideChatDisposedError)
    await expect(service.quoteMessage(calling, { messageId: 'm1' })).rejects.toBeInstanceOf(SideChatDisposedError)
    // Coded and package-named — never a bare throw of arbitrary shape.
    const error = await service.getState('k').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'SideChatDisposedError', code: 'disposed' })
  })

  it('is idempotent across repeated disposeAgents calls', async () => {
    const { service, agentsKit, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '一' })
    await service.disposeAgents()
    await service.disposeAgents()
    expect(agentsKit.disposed).toHaveLength(1)
  })

  it('an in-flight spawn racing disposal leaks no handle and refuses the caller', async () => {
    const { service, agentsKit, calling } = bench()
    const release = agentsKit.holdNextCreate()
    const sending = service.send(calling, { contextKey: 'k', text: '问' })
    const refused = expect(sending).rejects.toBeInstanceOf(SideChatDisposedError)
    await vi.waitFor(() => { expect(agentsKit.agents.create).toHaveBeenCalledTimes(1) })
    // Disposal lands while the create is still in flight: the owned set is empty.
    await service.disposeAgents()
    release()
    await refused
    // The late handle was disposed on arrival — exactly once, never leaked.
    expect(agentsKit.created).toHaveLength(1)
    expect(agentsKit.disposed).toEqual([agentsKit.created[0]!.sessionId])
    expect(agentsKit.live.size).toBe(0)
    await service.disposeAgents()
    expect(agentsKit.disposed).toHaveLength(1)
  })

  it('a same-root rebuild after dispose works (the disposed instance alone stays dead)', async () => {
    const fs = new FakeFs()
    const first = bench({ fs })
    await first.service.send(first.calling, { contextKey: 'k', text: '一' })
    await first.service.disposeAgents()
    await expect(first.service.getState('k')).rejects.toBeInstanceOf(SideChatDisposedError)
    // A NEW service instance over the same state root is ordinary business.
    const second = bench({ fs, coldEvents: [userEvent('一', 1)] })
    expect(await second.service.listContexts()).toMatchObject({ items: [{ contextKey: 'k', status: 'cold' }] })
    expect((await second.service.send(second.calling, { contextKey: 'k', text: '二' })).ok).toBe(true)
    expect(second.agentsKit.resumed).toHaveLength(1)
  })
})

/* ------------------------------------------------------- the backend port */

/** One fake execution session the fake backend opened (events are SHARED with the persisted log, like a real one). */
interface FakeExecRec {
  readonly init: SideChatExecutionOpenInit
  status: 'idle' | 'running'
  readonly events: SessionEvent[]
  readonly sent: SideChatExecutionMessage[]
  readonly syncTools: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
  releases: number
}

/**
 * The fake execution backend: an own little execution world (live sessions +
 * a persisted event log), with a per-capability switchboard. `ctx.agents`
 * never participates — the bench mounts a throwing stub for it.
 */
function fakeBackend(opts: { capabilities?: Partial<SideChatExecutionCapabilities> } = {}) {
  const capabilities: SideChatExecutionCapabilities = {
    presets: true, promptContext: true, callerTools: true, cancel: true, coldRead: true,
    ...opts.capabilities,
  }
  const opened: SideChatExecutionOpenInit[] = []
  const coldReads: string[] = []
  const recs: FakeExecRec[] = []
  const live = new Map<string, FakeExecRec>()
  const persisted = new Map<string, SessionEvent[]>()
  let holdOpen: Promise<void> | undefined
  const open = vi.fn(async (init: SideChatExecutionOpenInit): Promise<SideChatExecutionSession> => {
    if (holdOpen !== undefined) {
      const hold = holdOpen
      holdOpen = undefined
      await hold
    }
    let events = persisted.get(init.sessionId)
    if (init.resume) {
      if (events === undefined) throw new Error('torn log')
    } else {
      events = []
      persisted.set(init.sessionId, events)
    }
    const rec: FakeExecRec = {
      init, status: 'idle', events, sent: [], syncTools: vi.fn(), cancel: vi.fn(), releases: 0,
    }
    recs.push(rec)
    live.set(init.sessionId, rec)
    opened.push(init)
    return {
      sessionId: init.sessionId,
      ...(init.resume || init.presetId === undefined ? {} : { resolvedPresetId: init.presetId }),
      get status() { return rec.status },
      events: () => [...rec.events],
      send: (message: SideChatExecutionMessage) => {
        rec.sent.push(message)
        rec.events.push(userEvent(message.text, rec.events.length + 1))
      },
      syncTools: rec.syncTools as () => void,
      cancel: rec.cancel as () => void,
      release: async () => { rec.releases += 1; live.delete(init.sessionId) },
    }
  })
  const backend: SideChatExecutionBackend = {
    capabilities,
    open,
    readCold: async (sessionId: string) => {
      coldReads.push(sessionId)
      return persisted.get(sessionId)
    },
  }
  return {
    backend,
    open,
    opened,
    coldReads,
    recs,
    live,
    recOf: (sessionId: string) => live.get(sessionId),
    /** Gate the next open on a manual release (the open/dispose race bench). */
    holdNextOpen(): () => void {
      let release!: () => void
      holdOpen = new Promise<void>(resolve => { release = resolve })
      return release
    },
  }
}

/**
 * Mount the service over an INJECTED backend. `ctx.agents` and
 * `sessionPersistence` are throwing stubs: any touch of the host execution
 * world fails the test on the spot. `agentDefaultModel` can be a throwing
 * stub too (the no-deployment-defaults rule).
 */
function benchBackend(opts: {
  fs?: FakeFs
  kit?: ReturnType<typeof fakeBackend>
  capabilities?: Partial<SideChatExecutionCapabilities>
  callingHeader?: { provider: string; model: string; reasoningEffort?: string }
  callingPreset?: string
  config?: { agentRoute?: AgentOptions; cwd?: string; agentPreset?: string }
  defaultModelThrows?: boolean
} = {}) {
  const ctx = new Context()
  const fs = opts.fs ?? new FakeFs()
  const kit = opts.kit ?? fakeBackend({ capabilities: opts.capabilities })
  const buster = (): never => { throw new Error('sidechat: the host execution world must not be touched with an injected backend') }
  ctx.provide('agents', { get: buster, create: buster, resume: buster } as never)
  ctx.provide('sessionPersistence', { open: buster } as never)
  const sessions = new Map<string, Session>()
  ctx.provide('sessions', { get: (id: SessionId) => sessions.get(String(id)) } as never)
  ctx.provide('fs', fs as never)
  ctx.provide('sandboxPolicy', fakeSandboxPolicy() as never)
  if (opts.defaultModelThrows === true) {
    ctx.provide('agentDefaultModel', { currentSelection: buster } as never)
  }
  const calling = {
    session: {
      id: 's-main',
      header: { cwd: SOURCE_CWD, ...opts.callingPreset === undefined ? {} : { agentPreset: opts.callingPreset } },
      snapshotEvents: () => [] as SessionEvent[],
      requestHeader: () => opts.callingHeader === undefined ? undefined : { config: { ...opts.callingHeader } },
    },
  } as unknown as Agent
  const service = new SideChatService(ctx, { stateRoot: STATE_ROOT, ...opts.config, executionBackend: kit.backend })
  return { service, fs, kit, sessions, calling }
}

describe('SideChatService — the execution backend port (injected target)', () => {
  it('drives open/send/read/release through the port', async () => {
    const { service, kit, calling } = benchBackend()
    const outcome = await service.send(calling, { contextKey: 'k', text: '问' })
    expect(outcome.ok).toBe(true)
    expect(kit.opened).toHaveLength(1)
    expect(kit.opened[0]).toMatchObject({ contextKey: 'k', resume: false })
    const rec = kit.recs[0]!
    expect(rec.sent).toHaveLength(1)
    expect(rec.sent[0]).toMatchObject({ text: '问', source: { kind: 'sidechat' } })
    // The live read projects the session's own events.
    const state = await service.getState('k')
    expect(state).toMatchObject({ ok: true, state: { status: 'idle', transcript: [{ kind: 'user', text: '问' }] } })
    // Release lands on dispose, exactly once.
    await service.disposeAgents()
    expect(rec.releases).toBe(1)
  })

  it('carries the resolved route, preset and cwd in the open payload (explicit config wins) and records the backend-resolved preset', async () => {
    const { service, fs, kit, calling } = benchBackend({
      callingHeader: { provider: 'p-call', model: 'm-call' },
      callingPreset: 'p-call-preset',
      config: {
        agentRoute: { provider: 'p-explicit', model: 'm-explicit', reasoningEffort: ReasoningEffortId('high') },
        agentPreset: 'p-config',
        cwd: '/home/user/anchor',
      },
    })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(kit.opened[0]).toMatchObject({
      route: { provider: 'p-explicit', model: 'm-explicit', reasoningEffort: 'high' },
      presetId: 'p-call-preset',
      cwd: '/home/user/anchor',
    })
    const doc = docOf(fs)
    expect(doc.contexts[0]).toMatchObject({ sessionId: kit.opened[0]!.sessionId, agentPreset: 'p-call-preset' })
  })

  it('never probes the deployment default with an injected backend (the backend owns routing)', async () => {
    const { service, kit, calling } = benchBackend({ defaultModelThrows: true })
    await service.send(calling, { contextKey: 'k', text: '问' })
    expect(kit.opened[0]!.route).toBeUndefined()
  })

  it('a calling-less send with no route resolves through an injected backend', async () => {
    const { service, kit } = benchBackend({ defaultModelThrows: true })
    const outcome = await service.send(undefined, { contextKey: 'k', text: '问' })
    expect(outcome.ok).toBe(true)
    expect(kit.opened[0]!.route).toBeUndefined()
  })

  it('cold reads come from the backend — never a resume, never host persistence', async () => {
    const fs = new FakeFs()
    const kit = fakeBackend()
    const first = benchBackend({ fs, kit })
    await first.service.send(first.calling, { contextKey: 'k', text: '重启前' })
    const sessionId = kit.opened[0]!.sessionId
    await first.service.disposeAgents()
    // A rebuild over the same root: the cold read goes to the backend, no open fires.
    const second = benchBackend({ fs, kit })
    const opensBefore = kit.opened.length
    const state = await second.service.getState('k')
    expect(state).toMatchObject({ ok: true, state: { status: 'cold', transcript: [{ kind: 'user', text: '重启前' }] } })
    expect(kit.opened).toHaveLength(opensBefore)
    expect(kit.coldReads).toEqual([sessionId])
  })

  it('a same-root rebuild resumes through the injected backend', async () => {
    const fs = new FakeFs()
    const kit = fakeBackend()
    const first = benchBackend({ fs, kit })
    await first.service.send(first.calling, { contextKey: 'k', text: '一' })
    const sessionId = kit.opened[0]!.sessionId
    await first.service.disposeAgents()
    const second = benchBackend({ fs, kit })
    const sent = await second.service.send(second.calling, { contextKey: 'k', text: '二' })
    expect(sent.ok).toBe(true)
    expect(kit.opened).toHaveLength(2)
    expect(kit.opened[1]).toMatchObject({ sessionId, resume: true })
    const state = await second.service.getState('k')
    expect(state).toMatchObject({ ok: true, state: { transcript: [{ kind: 'user', text: '一' }, { kind: 'user', text: '二' }] } })
  })

  it('an in-flight open racing disposal releases the late session and refuses the caller', async () => {
    const { service, kit, calling } = benchBackend()
    const release = kit.holdNextOpen()
    const sending = service.send(calling, { contextKey: 'k', text: '问' })
    const refused = expect(sending).rejects.toBeInstanceOf(SideChatDisposedError)
    await vi.waitFor(() => { expect(kit.open).toHaveBeenCalledTimes(1) })
    await service.disposeAgents()
    release()
    await refused
    // The late session was released on arrival — exactly once, never leaked.
    expect(kit.recs).toHaveLength(1)
    expect(kit.recs[0]!.releases).toBe(1)
    expect(kit.live.size).toBe(0)
    await service.disposeAgents()
    expect(kit.recs[0]!.releases).toBe(1)
  })
})

describe('SideChatService — backend capabilities degrade, never crash', () => {
  it('skips the caller-tool sync silently when the backend declares no callerTools', async () => {
    const { service, kit, calling } = benchBackend({ capabilities: { callerTools: false } })
    const tool = { name: 'canvas_read', description: 'v1' } as unknown as ToolDefinition
    await service.openWith({ contextKey: 'k', label: 'k', tools: [tool] })
    await service.send(calling, { contextKey: 'k', text: '问' })
    await service.openWith({ contextKey: 'k', label: 'k', tools: [tool] })
    expect(kit.recs[0]!.syncTools).not.toHaveBeenCalled()
  })

  it('refuses the stop gesture coded when the backend declares no cancel', async () => {
    const { service, kit, calling } = benchBackend({ capabilities: { cancel: false } })
    await service.send(calling, { contextKey: 'k', text: '问' })
    kit.recs[0]!.status = 'running'
    expect(await service.stop('k')).toEqual({ ok: false, error: 'cancel-unsupported' })
    expect(kit.recs[0]!.cancel).not.toHaveBeenCalled()
  })

  it('answers the honest unknown on cold reads when the backend declares no coldRead', async () => {
    const fs = new FakeFs()
    const kit = fakeBackend()
    const first = benchBackend({ fs, kit })
    await first.service.send(first.calling, { contextKey: 'k', text: '重启前' })
    await first.service.disposeAgents()
    const blind = benchBackend({ fs, kit: fakeBackend({ capabilities: { coldRead: false } }) })
    expect(await blind.service.getState('k')).toMatchObject({
      ok: true,
      state: { status: 'cold', transcript: [], lastError: null },
    })
    expect(blind.kit.coldReads).toHaveLength(0)
    expect(await blind.service.listContexts()).toMatchObject({
      items: [{ contextKey: 'k', status: 'cold', lastAssistantAt: null, lastActivityAt: null }],
    })
  })

  it('passes the full open payload regardless of declared capabilities (the backend chooses)', async () => {
    const tool = { name: 't', description: 'd' } as unknown as ToolDefinition
    const { service, kit, calling } = benchBackend({
      capabilities: { presets: false, promptContext: false, callerTools: false, cancel: false, coldRead: false },
      callingPreset: 'p-call',
      config: { agentRoute: { provider: 'p', model: 'm' }, cwd: '/home/user/anchor' },
    })
    await service.openWith({ contextKey: 'k', label: 'k', systemPrompt: '段', tools: [tool] })
    await service.send(calling, { contextKey: 'k', text: '问' })
    const init = kit.opened[0]!
    expect(init).toMatchObject({ route: { provider: 'p', model: 'm' }, presetId: 'p-call', cwd: '/home/user/anchor' })
    expect(init.segmentText()).toContain('side-chat agent')
    expect(init.segmentText()).toContain('段')
    expect(init.tools()).toEqual([tool])
  })
})

describe('SideChatService — the stop gesture (host-side only)', () => {
  it('cancels a running turn through the port, with coded refusals otherwise', async () => {
    const { service, kit, calling } = benchBackend()
    await service.send(calling, { contextKey: 'k', text: '问' })
    const rec = kit.recs[0]!
    expect(await service.stop('k')).toEqual({ ok: false, error: 'not-running' })
    rec.status = 'running'
    expect(await service.stop('k')).toEqual({ ok: true })
    expect(rec.cancel).toHaveBeenCalledTimes(1)
    expect(await service.stop('nobody')).toEqual({ ok: false, error: 'not-found' })
  })

  it('stops through the default backend via the live agent\'s own cancel', async () => {
    const { service, agentsKit, calling } = bench()
    await service.send(calling, { contextKey: 'k', text: '问' })
    const rec = agentsKit.live.values().next().value as FakeAgentRec
    ;(rec.agent as { status: string }).status = 'running'
    expect(await service.stop('k')).toEqual({ ok: true })
    expect(rec.cancel).toHaveBeenCalledTimes(1)
    expect(rec.cancel).toHaveBeenCalledWith({ kind: 'user' })
  })

  it('refuses post-dispose with the coded disposed error', async () => {
    const { service, calling } = benchBackend()
    await service.send(calling, { contextKey: 'k', text: '问' })
    await service.disposeAgents()
    await expect(service.stop('k')).rejects.toBeInstanceOf(SideChatDisposedError)
  })
})

describe('resolveSideChatStateRoot', () => {
  it('honours the explicit override, then $DSH_HOME, then the cwd fallback', () => {
    expect(resolveSideChatStateRoot('/explicit')).toBe('/explicit')
    const home = process.env['DSH_HOME']
    process.env['DSH_HOME'] = '/home/user/.dsh'
    try {
      expect(resolveSideChatStateRoot(undefined)).toBe(join('/home/user/.dsh', 'state', 'sidechat'))
      expect(resolveSideChatStateRoot('')).toBe(join('/home/user/.dsh', 'state', 'sidechat'))
    } finally {
      if (home === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = home
    }
  })
})
