/**
 * Serve mode: the resident sub-dsh loop behind the live-driver wire —
 * handshake, turn accept/idle flow, live event push, graceful interrupt,
 * shutdown, and wire-level error hygiene.
 */

import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { runServe, type ServeIo } from '../src/serve.ts'

/** What one serve session observed on the wire and process surfaces. */
interface Observed {
  lines: Record<string, unknown>[]
  err: string
  exits: number[]
}

interface ServeBench {
  ctx: Context
  io: ServeIo
  stdin: PassThrough
  observed: Observed
  trace: {
    creates: string[]
    resumes: string[]
    cancels: { kind?: string }[]
    disposed: string[]
  }
  /** Send one wire request line. */
  send(message: Record<string, unknown>): void
  /** Wait until a line matching the predicate appears. */
  waitLine(predicate: (line: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>
}

interface Script {
  /** Called when the scripted agent receives a followup; appends the turn. */
  afterPrompt(session: Session, message: UserMessage, agent: Agent): Promise<void> | void
}

/** Mount the real registries around a scripted Agent factory and run serve. */
async function bench(script: Script): Promise<ServeBench> {
  const ctx = new Context()
  const trace: ServeBench['trace'] = { creates: [], resumes: [], cancels: [], disposed: [] }
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      trace.creates.push(options.sessionId)
      return makeHandle(ctx, options.sessionId, options, script, trace)
    },
    async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
      trace.resumes.push(options.resumeSessionId)
      return makeHandle(ctx, options.resumeSessionId, options, script, trace)
    },
  })

  const stdin = new PassThrough()
  const observed: Observed = { lines: [], err: '', exits: [] }
  const waiters: { predicate: (line: Record<string, unknown>) => boolean; resolve: (line: Record<string, unknown>) => void }[] = []
  const io: ServeIo = {
    stdin,
    stdout: {
      write(chunk: string) {
        for (const line of chunk.split('\n')) {
          if (line === '') continue
          const parsed = JSON.parse(line) as Record<string, unknown>
          observed.lines.push(parsed)
          for (let i = waiters.length - 1; i >= 0; i -= 1) {
            const waiter = waiters[i]!
            if (waiter.predicate(parsed)) {
              waiters.splice(i, 1)
              waiter.resolve(parsed)
            }
          }
        }
        return true
      },
    },
    stderr: { write: (chunk: string) => { observed.err += chunk; return true } },
    exit: code => { observed.exits.push(code) },
  }
  void runServe(ctx, io)
  return {
    ctx,
    io,
    stdin,
    observed,
    trace,
    send: message => { stdin.write(JSON.stringify(message) + '\n') },
    waitLine: predicate => new Promise((resolve) => {
      const existing = observed.lines.find(predicate)
      if (existing !== undefined) {
        resolve(existing)
        return
      }
      waiters.push({ predicate, resolve })
    }),
  }
}

/** The scripted handle: followup appends the scripted turn asynchronously. */
async function makeHandle(
  ctx: Context,
  sessionId: string,
  options: CreateAgentOptions | ResumeAgentOptions,
  script: Script,
  trace: ServeBench['trace'],
): Promise<AgentHandle> {
  const session = ctx.sessions.create(sessionId, {
    ...(options.meta === undefined || options.meta === null ? {} : { meta: options.meta }),
  })
  let idle = Promise.resolve()
  const agent = {} as Agent
  const agentCtx = (options.setup === undefined ? ctx : ctx.extend({ agent }))
  Object.assign(agent, {
    id: session.id,
    options: options.agentOptions ?? {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: agentCtx,
    cancel: (cause: { kind?: string }) => { trace.cancels.push(cause) },
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: (message: UserMessage) => {
      agent.inbox.append('next-turn', message)
      idle = Promise.resolve().then(() => script.afterPrompt(session, message, agent))
    },
    steer: () => {},
    inject: () => {},
    whenIdle: () => idle,
  } satisfies Partial<Agent>)
  await options.setup?.(agentCtx)
  ctx.agents.register(agent)
  return { agent, dispose: () => { trace.disposed.push(sessionId); return Promise.resolve() } }
}

/** Append one completed turn carrying the given answer text. */
function appendTurn(session: Session, turn: number, message: UserMessage, text: string): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text }],
      source: { provider: 'test-provider', model: 'test-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

const isResponseTo = (id: number) => (line: Record<string, unknown>) => line['id'] === id
const isNotification = (method: string) => (line: Record<string, unknown>) => line['method'] === method

describe('headless serve mode', () => {
  it('answers initialize with the server identity and protocol version', async () => {
    const test = await bench({ afterPrompt: () => {} })
    test.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const response = await test.waitLine(isResponseTo(1))
    expect(response['result']).toMatchObject({
      serverInfo: { name: '@khorsheed/dsh-local-agent-dsh-headless/serve' },
      protocolVersion: 1,
    })
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })

  it('drives a fresh turn: creates the caller-named session, pushes its events live, and closes with idle after flush', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'live answer') },
    })
    const flushOrder: string[] = []
    test.ctx.on('session/flush', () => { flushOrder.push('flush') })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-1', text: 'do it', resume: false } })
    const ack = await test.waitLine(isResponseTo(1))
    expect(ack['result']).toEqual({ accepted: true })
    const idle = await test.waitLine(isNotification('session/idle'))
    expect(test.trace.creates).toEqual(['member-1'])
    expect(test.trace.resumes).toEqual([])
    expect(idle['params']).toMatchObject({ sessionId: 'member-1', reason: { kind: 'completed' } })
    // Events streamed BEFORE the idle close, and the flush preceded idle.
    const idleIndex = test.observed.lines.indexOf(idle)
    const events = test.observed.lines.slice(0, idleIndex).filter(line => line['method'] === 'session/event')
    const types = events.map(line => ((line['params'] as { event: { type: string } }).event.type))
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/message')
    expect(flushOrder).toEqual(['flush'])
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })

  it('reuses the loaded agent for the next turn of the same session', async () => {
    let turn = 0
    const test = await bench({
      afterPrompt(session, message) { turn += 1; appendTurn(session, turn, message, `answer ${String(turn)}`) },
    })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-1', text: 'one', resume: false } })
    await test.waitLine(isNotification('session/idle'))
    test.send({ jsonrpc: '2.0', id: 2, method: 'turn/start', params: { sessionId: 'member-1', text: 'two', resume: true } })
    await test.waitLine(line =>
      isNotification('session/idle')(line)
      && test.observed.lines.filter(isNotification('session/idle')).length === 2)
    expect(test.trace.creates).toEqual(['member-1'])
    // The live agent absorbed the resume turn; no second load from disk.
    expect(test.trace.resumes).toEqual([])
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })

  it('resumes from disk when a resume turn names a session this runtime never loaded', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 7, message, 'resumed answer') },
    })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-9', text: 'continue', resume: true } })
    const idle = await test.waitLine(isNotification('session/idle'))
    expect(test.trace.resumes).toEqual(['member-9'])
    expect(test.trace.creates).toEqual([])
    expect(idle['params']).toMatchObject({ reason: { kind: 'completed' } })
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })

  it('fails the turn/start request when the resume target does not exist', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    ctx.agents.setFactory({
      createAgent: () => Promise.reject(new Error('not used')),
      resume: () => Promise.reject(new Error('no such session')),
    })
    const stdin = new PassThrough()
    const lines: Record<string, unknown>[] = []
    const io: ServeIo = {
      stdin,
      stdout: { write: (chunk: string) => { for (const l of chunk.split('\n')) { if (l !== '') lines.push(JSON.parse(l) as Record<string, unknown>) } return true } },
      stderr: { write: () => true },
      exit: () => {},
    }
    void runServe(ctx, io)
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'turn/start', params: { sessionId: 'gone', text: 'x', resume: true } }) + '\n')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setTimeout(resolve, 10))
    const response = lines.find(line => line['id'] === 5)
    expect(response?.['error']).toMatchObject({ message: 'no such session' })
    await ctx.fiber.dispose()
  })

  it('delivers turn/interrupt as the in-process Agent cancel with the parent cause', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'interrupted answer') },
    })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-1', text: 'work', resume: false } })
    await test.waitLine(isResponseTo(1))
    test.send({ jsonrpc: '2.0', id: 2, method: 'turn/interrupt', params: { sessionId: 'member-1' } })
    const ack = await test.waitLine(isResponseTo(2))
    expect(ack['result']).toEqual({ interrupted: true })
    expect(test.trace.cancels).toEqual([{ kind: 'parent' }])
    // An unknown session interrupts nothing but still answers.
    test.send({ jsonrpc: '2.0', id: 3, method: 'turn/interrupt', params: { sessionId: 'nobody' } })
    const miss = await test.waitLine(isResponseTo(3))
    expect(miss['result']).toEqual({ interrupted: false })
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })

  it('answers shutdown, disposes every managed agent, and exits 0', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'x') },
    })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-1', text: 'work', resume: false } })
    await test.waitLine(isNotification('session/idle'))
    test.send({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: {} })
    await test.waitLine(isResponseTo(2))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.trace.disposed).toEqual(['member-1'])
    expect(test.observed.exits).toEqual([0])
    // Shutdown detaches the stdin feed so the real process's event loop can
    // drain (the launcher's bounded exit completes via process.exitCode).
    expect(test.stdin.listenerCount('data')).toBe(0)
    await test.ctx.fiber.dispose()
  })

  it('stdin EOF shuts the runtime down (the reclaim path closes the pipe)', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'x') },
    })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-1', text: 'work', resume: false } })
    await test.waitLine(isNotification('session/idle'))
    test.stdin.end()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.trace.disposed).toEqual(['member-1'])
    expect(test.observed.exits).toEqual([0])
    await test.ctx.fiber.dispose()
  })

  it('reports unknown methods and survives malformed lines', async () => {
    const test = await bench({ afterPrompt: () => {} })
    test.send({ jsonrpc: '2.0', id: 9, method: 'turn/steer', params: {} })
    const response = await test.waitLine(isResponseTo(9))
    expect(response['error']).toMatchObject({ code: -32601 })
    test.stdin.write('this is not json\n')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.observed.err).toContain('malformed wire line')
    // Still healthy afterwards.
    test.send({ jsonrpc: '2.0', id: 10, method: 'initialize', params: {} })
    expect(await test.waitLine(isResponseTo(10))).toMatchObject({ result: { protocolVersion: 1 } })
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })

  it('closes the turn with an error reason when the turn body itself fails', async () => {
    const test = await bench({
      afterPrompt: async () => { throw new Error('driver exploded') },
    })
    test.send({ jsonrpc: '2.0', id: 1, method: 'turn/start', params: { sessionId: 'member-1', text: 'work', resume: false } })
    const idle = await test.waitLine(isNotification('session/idle'))
    expect(idle['params']).toMatchObject({ sessionId: 'member-1', reason: { kind: 'error' } })
    test.stdin.end()
    await test.ctx.fiber.dispose()
  })
})
