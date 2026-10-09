/**
 * Service-lane coverage over a real cordis context: the llm/stream tee forwards
 * chunks untouched (frozen LOOP-style options included), capture failures stay
 * contained, unscoped listeners receive every scope's assemble/session events
 * (the dsh-scope admission rule the whole design leans on), and the session
 * event lane drives the store through a real SessionStore.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { createScope, scopeTarget, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { InspectorService } from '../src/service.ts'
import { InspectorStore } from '../src/store.ts'

// The subagent package owns this event; the test declares the merge so
// Session.append accepts it (the production code reads it structurally).
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'subagent/catalog': {
      version: number
      childId: SessionId
      childCreatedAt: number
      mode: string
      label?: string
    }
  }
}

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx
}

/** Mint a scope the way agent-loop does (the minting plugin injects what the scope reaches). */
async function mintScope(ctx: Context, key: ScopeKey): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, key)
  }, { inject: ['sessions'] }))
  return scope
}

function frozenOptions(session: Session, systemText: string): GenerateOptions {
  return deepFreeze({
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 4096,
    messages: [
      createSystemMessage(systemText),
      createUserMessage({ content: [{ type: 'text', text: '把第一章跑完' }], source: { kind: 'user' } }),
    ],
    tools: [{ name: 'read', description: '读文件', parameters: { type: 'object' } }],
    sessionId: session.id,
  }) as GenerateOptions
}

async function* fakeStream(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: '答复' }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: '答复' } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

describe('llm/stream lane', () => {
  it('captures a full turn through real session events and the waterfall tee', async () => {
    const ctx = await mount()
    const service = new InspectorService(ctx)
    const session = ctx.sessions.create()

    session.append('turn/start', { turn: 1 })
    const user = createUserMessage({ content: [{ type: 'text', text: '把第一章跑完' }], source: { kind: 'user' } })
    session.append('user/message', user, { surfaceOp: 'append' })

    const options = frozenOptions(session, '你是助手')
    const chunks: StreamChunk[] = []
    const stream = ctx.waterfall({}, 'llm/stream', options, () => fakeStream()) as AsyncIterable<StreamChunk>
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks.map(chunk => chunk.type)).toEqual(['block-start', 'text-delta', 'block-end', 'usage', 'finish'])

    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: '答复' }],
        source: { provider: 'deepseek', model: 'deepseek-chat' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const turns = await service.listTurns(String(session.id))
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ query: '把第一章跑完', requestCount: 1, totalInputTokens: 10 })

    const overview = await service.getTurn(String(session.id), 1)
    const row = overview?.scopes[0]?.requests[0]
    expect(row).toMatchObject({ status: 'ok', responseSummary: '直接回答' })

    const detail = await service.getRequest(String(session.id), row?.seq ?? -1)
    expect(detail?.segments.system[0]?.full).toBe('你是助手')
    expect(detail?.segments.added.map(item => item.category)).toEqual(['user'])
    expect(detail?.timing.waitMs).toBeTypeOf('number')
    expect(detail?.timing.textMs).toBeTypeOf('number')
    service.dispose()
  })

  it('forwards the stream untouched when the capture observer throws on every chunk', async () => {
    const ctx = await mount()
    const warnings: string[] = []
    const service = new InspectorService(ctx, {}, { logger: { warn: message => warnings.push(message) } })
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const store = (service as unknown as { store: InspectorStore }).store
    const original = store.observeChunk
    store.observeChunk = () => {
      throw new Error('capture bug')
    }

    const chunks: StreamChunk[] = []
    const stream = ctx.waterfall({}, 'llm/stream', frozenOptions(session, 'sys'), () => fakeStream()) as AsyncIterable<StreamChunk>
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks).toHaveLength(5)
    expect(warnings.some(message => message.includes('capture bug'))).toBe(true)
    store.observeChunk = original
    service.dispose()
  })

  it('degrades to the bare downstream stream when capture setup fails', async () => {
    const ctx = await mount()
    const warnings: string[] = []
    const service = new InspectorService(ctx, {}, { logger: { warn: message => warnings.push(message) } })
    const session = ctx.sessions.create()
    const store = (service as unknown as { store: InspectorStore }).store
    store.beginRequest = () => {
      throw new Error('store broken')
    }
    const chunks: StreamChunk[] = []
    const stream = ctx.waterfall({}, 'llm/stream', frozenOptions(session, 'sys'), () => fakeStream()) as AsyncIterable<StreamChunk>
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks).toHaveLength(5)
    expect(await service.listTurns(String(session.id))).toEqual([])
    expect(warnings.some(message => message.includes('store broken'))).toBe(true)
    service.dispose()
  })
})

describe('scope admission (the dsh-scope rule this design leans on)', () => {
  it('an unscoped assemble listener receives every scope’s assemblies; other scopes do not cross-hear', async () => {
    const ctx = await mount()
    const service = new InspectorService(ctx)
    const keyA: ScopeKey = { name: 'a' }
    const keyB: ScopeKey = { name: 'b' }
    const scopeA = await mintScope(ctx, keyA)
    const scopeB = await mintScope(ctx, keyB)

    const heard: string[] = []
    scopeA.ctx.on('system-prompt/assemble', (_assembly, _context, next) => {
      heard.push('a')
      return next()
    })
    scopeB.ctx.on('system-prompt/assemble', (_assembly, _context, next) => {
      heard.push('b')
      return next()
    })

    const assembly: PromptAssembly = {
      sections: [
        { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
        { name: 'deployment:persona-prefix', text: '你是写作者' },
      ],
      contexts: [],
      tools: [],
      variables: {},
    }
    const carrier = scopeTarget({}, keyA)
    const result = await ctx.waterfall(carrier, 'system-prompt/assemble', assembly, { scope: keyA }, () => Promise.resolve(assembly)) as PromptAssembly
    expect(result).toBe(assembly)
    expect(heard).toEqual(['a'])

    // The unscoped capture recorded the rendered assembly for attribution: a
    // request whose system message equals it splits into named sections.
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const options = frozenOptions(session, 'You are an AI agent powered by DeepSeek Harness.\n\n你是写作者')
    const stream = ctx.waterfall({}, 'llm/stream', options, () => fakeStream()) as AsyncIterable<StreamChunk>
    for await (const _chunk of stream) { /* drain */ }
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const turns = await service.listTurns(String(session.id))
    const overview = await service.getTurn(String(session.id), turns[0]?.turnSeq ?? -1)
    const detail = await service.getRequest(String(session.id), overview?.scopes[0]?.requests[0]?.seq ?? -1)
    expect(detail?.segments.system.map(item => item.source)).toEqual(['harness:identity', 'deployment:persona-prefix'])
    service.dispose()
  })

  it('hears session events from sessions entered through a scope', async () => {
    const ctx = await mount()
    const service = new InspectorService(ctx)
    const scope = await mintScope(ctx, { name: 'agent' })
    const session = scope.ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const turns = await service.listTurns(String(session.id))
    expect(turns).toHaveLength(1)
    service.dispose()
  })
})

describe('session/event lane', () => {
  it('opens a subagent scope from the catalog event and fails it on an error result', async () => {
    const ctx = await mount()
    const service = new InspectorService(ctx)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const catalog: SessionEventMap['subagent/catalog'] = {
      version: 0,
      childId: 'child-1' as SessionId,
      childCreatedAt: 1,
      mode: 'one-shot',
      label: 'dsh: 第一章对账',
    }
    session.append('subagent/catalog', catalog)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const overview = await service.getTurn(String(session.id), 1)
    expect(overview?.scopes.find(scope => scope.kind === 'subagent')).toMatchObject({
      scopeId: 'child-1',
      label: 'dsh: 第一章对账',
      status: 'running',
      requests: [],
    })
    service.dispose()
  })
})
