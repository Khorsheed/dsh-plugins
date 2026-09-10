import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as localAgent from '@khorsheed/dsh-local-agent'
import { LOCAL_AGENT_SERVICE, RUN_PROGRESS_HEARTBEAT_MS } from '@khorsheed/dsh-local-agent'
import type { LocalAgentDelegationIntent, LocalAgentRunProgress } from '@khorsheed/dsh-local-agent'

const PROVIDER = 'fake-cli'
const PARENT = 'parent-1'
const PROMPT: ContentBlock[] = [{ type: 'text', text: 'do the thing' }]

/** A controllable fake run: settle() resolves run.result. */
function makeRun(id: string, signal?: AbortSignal): { run: SubagentRun; settle(result: SubagentResult): void } {
  let settle!: (result: SubagentResult) => void
  const result = new Promise<SubagentResult>((resolve) => {
    settle = resolve
    // The canonical cancellation channel for a one-shot run is the start signal.
    signal?.addEventListener('abort', () => { resolve({ stopReason: 'aborted', output: [] }) })
  })
  return {
    settle,
    run: {
      id: SessionId(id),
      localAgent: undefined,
      result,
      dispose: () => Promise.resolve(),
    },
  }
}

interface FacadeHarness {
  ctx: Context
  registry: localAgent.LocalAgentRegistry
  /** Fiber handle of the local-agent plugin, for dispose-path tests. */
  fiber: { await(): Promise<unknown>; dispose(): Promise<unknown> }
  /** Intents the fake provider consumed, one entry per start() call. */
  consumed: (LocalAgentDelegationIntent | undefined)[]
  /** Child session ids the fake persistence was asked to open (reattach). */
  prepared: string[]
  /** Child session ids whose write handle the reattach closed at dispose. */
  closed: string[]
  /** Requests the fake provider received. */
  requests: SubagentStartRequest[]
  setStartHandler(handler: (request: SubagentStartRequest) => SubagentRun | Promise<SubagentRun>): void
  /** Enter a minimal live parent agent into the real AgentRegistry. */
  enterParent(id: string): void
  /** Consume one staged intent exactly like a real provider's start() does. */
  consumeIntent(request: SubagentStartRequest): void
}

/**
 * Mount the registry stack (real SessionStore/CommandRuntime/AgentRegistry, as
 * in delegation.spec.ts) plus a fake `subagents` service whose provider
 * records takeDelegationIntent consumption and returns controllable runs, and
 * a fake `sessionPersistence` whose open() hands back an empty-log write
 * handle (the host 0.1.5 handle API).
 */
async function mountFacade(): Promise<FacadeHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const harness: FacadeHarness = {
    ctx,
    registry: undefined as unknown as localAgent.LocalAgentRegistry,
    fiber: undefined as unknown as FacadeHarness['fiber'],
    consumed: [],
    prepared: [],
    closed: [],
    requests: [],
    setStartHandler(handler) {
      startHandler = handler
    },
    enterParent(id) {
      const sessionId = SessionId(id)
      const agent = { id: sessionId, session: { id: sessionId, header: { id: sessionId } } } as unknown as Agent
      ctx.agents.enter(agent, undefined)
    },
    consumeIntent(request) {
      harness.consumed.push(harness.registry.takeDelegationIntent(request.parent.session.id, PROVIDER))
    },
  }
  // The default handler consumes exactly one intent per start, like the real
  // family providers, and returns a controllable in-flight run. Custom
  // handlers decide whether consumption happens before a throw (orphan
  // rollback tests).
  let startHandler: (request: SubagentStartRequest) => SubagentRun | Promise<SubagentRun> = (request) => {
    harness.consumeIntent(request)
    return makeRun(`child-${harness.requests.length}`, request.signal).run
  }
  ctx.provide('subagents', {
    getProvider: (name: string) => name === PROVIDER ? { name } : undefined,
    start: async (_name: string, request: SubagentStartRequest) => {
      harness.requests.push(request)
      return startHandler(request)
    },
  })
  ctx.provide('sessionPersistence', {
    // Host 0.1.5 handle-based persistence: the reattach opens a write handle,
    // reads the stored log (empty here), and holds the handle until dispose.
    open: (id: SessionId, _access: string) => {
      harness.prepared.push(id)
      return Promise.resolve({
        id,
        header: { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false },
        inheritedEventCount: 0,
        read: () => Promise.resolve({ events: [], eventState: 'detached' }),
        append: () => Promise.resolve(),
        flush: () => Promise.resolve(),
        close: () => {
          harness.closed.push(id)
          return Promise.resolve()
        },
      })
    },
  })
  const fiber = ctx.plugin(localAgent, { homesRoot: mkdtempSync(join(tmpdir(), 'facade-homes-')) })
  await fiber.await()
  harness.fiber = fiber as unknown as FacadeHarness['fiber']
  harness.registry = ctx.get(LOCAL_AGENT_SERVICE) as localAgent.LocalAgentRegistry
  return harness
}

/** Assert that no intent is left staged for the (parent, provider) pair. */
function expectNothingStaged(registry: localAgent.LocalAgentRegistry): void {
  expect(registry.takeDelegationIntent(PARENT, PROVIDER)).toBeUndefined()
}

describe('LocalAgentRegistry delegation facade', () => {
  it('starts a fresh delegation: pairs exactly one intent and tracks the run until settle', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    const controllable = makeRun('child-fresh')
    h.setStartHandler((request) => {
      h.consumeIntent(request)
      return controllable.run
    })

    const run = await h.registry.start(PARENT, PROVIDER, PROMPT, { label: 'scout' })

    expect(run).toBe(controllable.run)
    // The staged fresh intent was consumed by exactly this start, FIFO-paired.
    expect(h.consumed).toEqual([{ kind: 'fresh' }])
    expectNothingStaged(h.registry)
    // The request carried the label, prompt, live parent, and a usable signal.
    expect(h.requests[0]?.label).toBe('scout')
    expect(h.requests[0]?.prompt).toBe(PROMPT)
    expect(h.requests[0]?.parent.session.id).toBe(PARENT)
    expect(h.requests[0]?.signal.aborted).toBe(false)
    // The run is tracked while in flight…
    expect(h.registry.cancel('child-fresh')).toBe(true)
    controllable.settle({ stopReason: 'aborted', output: [] })
    expect((await run.result).stopReason).toBe('aborted')
    // …and the registration clears once the run settles.
    await Promise.resolve()
    expect(h.registry.cancel('child-fresh')).toBe(false)
  })

  it('resumes a recorded delegation and reattaches an absent child session', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    h.registry.recordDelegation({
      childSessionId: 'child-1',
      provider: PROVIDER,
      parentSessionId: PARENT,
      cliSessionId: 'cli-42',
    })
    expect(h.ctx.sessions.get(SessionId('child-1'))).toBeUndefined()

    const run = await h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT)

    // The reattach recipe ran: the child session is live in the store now.
    expect(h.prepared).toEqual(['child-1'])
    expect(h.ctx.sessions.get(SessionId('child-1'))).toBeDefined()
    // The provider consumed the resume intent carrying the CLI session id.
    expect(h.consumed).toEqual([{ kind: 'resume', childSessionId: 'child-1', cliSessionId: 'cli-42' }])
    expect(run.id).toBeDefined()
  })

  it('holds the reattached child\'s write handle until plugin dispose (0.1.5 handle-based persistence)', async () => {
    // The 0.1.2 coordinator/reservation pair is gone: the backend routes a
    // live session's events into the per-id writer only while a WRITE handle
    // is open, so the reattach claims the handle at enter and releases it
    // (with the store detach) at dispose. A reattached child whose handle was
    // dropped would silently never persist again — the same regression the
    // old reservation-flush test pinned.
    const h = await mountFacade()
    h.enterParent(PARENT)
    h.registry.recordDelegation({
      childSessionId: 'child-1',
      provider: PROVIDER,
      parentSessionId: PARENT,
      cliSessionId: 'cli-42',
    })

    await h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT)

    const child = h.ctx.sessions.get(SessionId('child-1'))!
    // A post-reattach append + flush cycle works (the writer is bound).
    child.append('subagent/descriptor', { version: 2, mode: 'one-shot', provider: PROVIDER, label: 'fake' })
    await expect(h.ctx.sessions.flush(child)).resolves.toBeDefined()
    // Disposing the plugin detaches the child and closes the write handle.
    expect(h.closed).toEqual([])
    await h.fiber.dispose()
    expect(h.ctx.sessions.get(SessionId('child-1'))).toBeUndefined()
    expect(h.closed).toEqual(['child-1'])
  })

  it('does not reattach when the child session is already live', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    h.registry.recordDelegation({
      childSessionId: 'child-1',
      provider: PROVIDER,
      parentSessionId: PARENT,
      cliSessionId: 'cli-42',
    })
    h.ctx.sessions.create(SessionId('child-1'))

    await h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT)

    expect(h.prepared).toEqual([])
    expect(h.consumed).toEqual([{ kind: 'resume', childSessionId: 'child-1', cliSessionId: 'cli-42' }])
  })

  it('releases the reattached child session when the plugin disposes', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    h.registry.recordDelegation({
      childSessionId: 'child-1',
      provider: PROVIDER,
      parentSessionId: PARENT,
      cliSessionId: 'cli-42',
    })
    await h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT)
    const sessions = h.ctx.sessions
    expect(sessions.get(SessionId('child-1'))).toBeDefined()

    await h.fiber.dispose()

    expect(sessions.get(SessionId('child-1'))).toBeUndefined()
  })

  describe('fail-fast paths stage nothing', () => {
    it('rejects an unknown provider', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      await expect(h.registry.start(PARENT, 'no-such-provider', PROMPT))
        .rejects.toThrow(/not registered/)
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-42',
      })
      await expect(h.registry.resume(PARENT, 'no-such-provider', 'child-1', PROMPT))
        .rejects.toThrow(/not registered/)
      expectNothingStaged(h.registry)
      expect(h.requests).toHaveLength(0)
    })

    it('rejects an unknown resume handle', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      await expect(h.registry.resume(PARENT, PROVIDER, 'child-missing', PROMPT))
        .rejects.toThrow(/no delegation recorded/)
      expectNothingStaged(h.registry)
    })

    it('rejects a handle owned by another parent session', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: PROVIDER, parentSessionId: 'parent-2', cliSessionId: 'cli-42',
      })
      await expect(h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT))
        .rejects.toThrow(/belongs to another parent/)
      expectNothingStaged(h.registry)
    })

    it('rejects a handle claimed through the wrong provider', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      // Mount a second provider so the pre-check passes and the ownership
      // check is what rejects.
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: 'other-cli', parentSessionId: PARENT, cliSessionId: 'cli-42',
      })
      await expect(h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT))
        .rejects.toThrow(/was delegated through other-cli/)
      expectNothingStaged(h.registry)
    })

    it('rejects a child with an in-flight resume', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-42',
      })
      expect(h.registry.acquireResumeLock('child-1')).toBe(true)

      await expect(h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT))
        .rejects.toThrow(/in-flight resume/)

      expectNothingStaged(h.registry)
      h.registry.releaseResumeLock('child-1')
    })

    it('rejects a parent session without a live agent', async () => {
      const h = await mountFacade()
      await expect(h.registry.start(PARENT, PROVIDER, PROMPT))
        .rejects.toThrow(/no live agent/)
      expectNothingStaged(h.registry)
      expect(h.requests).toHaveLength(0)
    })
  })

  describe('orphan intent rollback', () => {
    it('removes the staged intent when start throws before the provider consumes it', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      // Use resume so the staged intent is distinguishable from a later fresh one.
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-42',
      })
      h.ctx.sessions.create(SessionId('child-1'))
      h.setStartHandler(() => {
        // Models a rejection before provider.start (e.g. capability check):
        // the intent was staged but never consumed.
        throw new Error('provider capability check failed')
      })

      await expect(h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT))
        .rejects.toThrow(/capability check failed/)

      // The orphan was rolled back: the next start consumes only its own
      // intent, not the leftover resume intent.
      expectNothingStaged(h.registry)
      h.setStartHandler((request) => {
        h.consumeIntent(request)
        return makeRun('child-2', request.signal).run
      })
      await h.registry.start(PARENT, PROVIDER, PROMPT)
      expect(h.consumed).toEqual([{ kind: 'fresh' }])
    })

    it('is a no-op when start throws after the provider consumed the intent', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      h.setStartHandler((request) => {
        h.consumeIntent(request)
        throw new Error('spawn failed after pairing')
      })

      await expect(h.registry.start(PARENT, PROVIDER, PROMPT))
        .rejects.toThrow(/spawn failed after pairing/)

      // The provider consumed the intent, so the rollback found nothing to
      // remove — and the queue holds no orphan either way.
      expect(h.consumed).toEqual([{ kind: 'fresh' }])
      expectNothingStaged(h.registry)
    })
  })

  describe('cancel', () => {
    it('aborts an in-flight run, settling it with an aborted stop reason', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)

      const run = await h.registry.start(PARENT, PROVIDER, PROMPT)
      expect(h.registry.cancel(String(run.id))).toBe(true)
      expect((await run.result).stopReason).toBe('aborted')
    })

    it('propagates a caller-supplied abort signal into the run', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      const caller = new AbortController()

      const run = await h.registry.start(PARENT, PROVIDER, PROMPT, { signal: caller.signal })
      caller.abort()
      expect((await run.result).stopReason).toBe('aborted')
    })

    it('returns false for an unknown child session id', async () => {
      const h = await mountFacade()
      expect(h.registry.cancel('child-missing')).toBe(false)
    })
  })

  describe('run progress', () => {
    it('emits a heartbeat while a run is in flight and stops at settle', async () => {
      vi.useFakeTimers()
      try {
        const h = await mountFacade()
        h.enterParent(PARENT)
        const events: [string, LocalAgentRunProgress][] = []
        h.ctx.on('localAgent/run-progress', (id, progress) => { events.push([id, progress]) })
        const controllable = makeRun('child-hb')
        h.setStartHandler((request) => {
          h.consumeIntent(request)
          return controllable.run
        })

        await h.registry.start(PARENT, PROVIDER, PROMPT)
        expect(events).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(RUN_PROGRESS_HEARTBEAT_MS)
        expect(events).toHaveLength(1)
        expect(events[0]?.[0]).toBe('child-hb')
        expect(events[0]?.[1].kind).toBe('heartbeat')
        await vi.advanceTimersByTimeAsync(RUN_PROGRESS_HEARTBEAT_MS)
        expect(events).toHaveLength(2)

        // Settle stops the heartbeat.
        controllable.settle({ stopReason: 'completed', output: [] })
        await vi.advanceTimersByTimeAsync(RUN_PROGRESS_HEARTBEAT_MS * 3)
        expect(events).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('routes provider reports to the tracked run onProgress and the cordis event', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      const seenA: LocalAgentRunProgress[] = []
      const seenB: LocalAgentRunProgress[] = []
      const cordisEvents: [string, LocalAgentRunProgress][] = []
      h.ctx.on('localAgent/run-progress', (id, progress) => { cordisEvents.push([id, progress]) })
      const runs = [makeRun('child-a').run, makeRun('child-b').run]
      h.setStartHandler((request) => {
        h.consumeIntent(request)
        const run = runs.shift()
        if (run === undefined) throw new Error('unexpected extra start')
        return run
      })
      await h.registry.start(PARENT, PROVIDER, PROMPT, { onProgress: progress => { seenA.push(progress) } })
      await h.registry.start(PARENT, PROVIDER, PROMPT, { onProgress: progress => { seenB.push(progress) } })

      h.registry.reportRunProgress('child-a', { kind: 'mirror', mirroredLines: 12 })

      expect(seenA).toEqual([{ kind: 'mirror', mirroredLines: 12 }])
      expect(seenB).toEqual([])
      expect(cordisEvents).toEqual([['child-a', { kind: 'mirror', mirroredLines: 12 }]])
    })

    it('still routes the provider’s settle observation after the result resolved', async () => {
      // Every exec-drive provider computes a round's observed model, CLI
      // version and usage only once the CLI process is reaped and its whole
      // stream is parsed — strictly after `run.result` settles. Dropping the
      // route at result-settle is what left a real evaluation run with a null
      // usage against a delegation that had recorded one.
      const h = await mountFacade()
      h.enterParent(PARENT)
      const seen: LocalAgentRunProgress[] = []
      const controllable = makeRun('child-late')
      h.setStartHandler((request) => { h.consumeIntent(request); return controllable.run })
      await h.registry.start(PARENT, PROVIDER, PROMPT, { onProgress: progress => { seen.push(progress) } })

      controllable.settle({ stopReason: 'completed', output: [] })
      await controllable.run.result
      // Let the facade's own settle handler run before the provider reports.
      await Promise.resolve()

      h.registry.recordRoundSettled('child-late', {
        observedModel: 'gpt-5.6-sol',
        cliVersion: '0.144.0',
        usage: { inputTokens: 10, outputTokens: 4 },
      })
      expect(seen).toEqual([{
        kind: 'settled',
        observedModel: 'gpt-5.6-sol',
        cliVersion: '0.144.0',
        usage: { inputTokens: 10, outputTokens: 4 },
      }])

      // The route closes on delivery: a second report reaches the cordis event
      // only, never the finished call's callback.
      h.registry.reportRunProgress('child-late', { kind: 'mirror', mirroredLines: 1 })
      expect(seen).toHaveLength(1)
    })

    it('emits the cordis event for reports on untracked child sessions', async () => {
      const h = await mountFacade()
      const cordisEvents: [string, LocalAgentRunProgress][] = []
      h.ctx.on('localAgent/run-progress', (id, progress) => { cordisEvents.push([id, progress]) })

      // A resumed run tracked only by the provider must stay observable.
      expect(() => h.registry.reportRunProgress('child-untracked', { kind: 'mirror', mirroredLines: 3 })).not.toThrow()
      expect(cordisEvents).toEqual([['child-untracked', { kind: 'mirror', mirroredLines: 3 }]])
    })

    it('stops heartbeats when the plugin disposes', async () => {
      vi.useFakeTimers()
      try {
        const h = await mountFacade()
        h.enterParent(PARENT)
        const events: [string, LocalAgentRunProgress][] = []
        h.ctx.on('localAgent/run-progress', (id, progress) => { events.push([id, progress]) })
        await h.registry.start(PARENT, PROVIDER, PROMPT)
        await vi.advanceTimersByTimeAsync(RUN_PROGRESS_HEARTBEAT_MS)
        expect(events).toHaveLength(1)

        await h.fiber.dispose()
        await vi.advanceTimersByTimeAsync(RUN_PROGRESS_HEARTBEAT_MS * 3)
        expect(events).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('reattach opt-out', () => {
    it('reattach:false fails loud on a non-live child and stages nothing', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-42',
      })
      expect(h.ctx.sessions.get(SessionId('child-1'))).toBeUndefined()

      await expect(h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT, { reattach: false }))
        .rejects.toThrow(/is not live and reattach is disabled/)

      expectNothingStaged(h.registry)
      expect(h.prepared).toEqual([])
    })

    it('reattach:false resumes normally when the child is already live', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      h.registry.recordDelegation({
        childSessionId: 'child-1', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-42',
      })
      h.ctx.sessions.create(SessionId('child-1'))

      await h.registry.resume(PARENT, PROVIDER, 'child-1', PROMPT, { reattach: false })

      expect(h.prepared).toEqual([])
      expect(h.consumed).toEqual([{ kind: 'resume', childSessionId: 'child-1', cliSessionId: 'cli-42' }])
    })
  })

  describe('active-delegation registry (tool registration + stop)', () => {
    it('tracks a tool-registered run and cancel() fires its cancel lever', async () => {
      const h = await mountFacade()
      const controllable = makeRun('child-tool')
      let cancelled = 0
      h.registry.trackDelegationRun('child-tool', controllable.run, () => { cancelled += 1 })

      expect(h.registry.isDelegationActive('child-tool')).toBe(true)
      expect(h.registry.cancel('child-tool')).toBe(true)
      expect(cancelled).toBe(1)

      // The entry clears itself once the run settles (any stop reason).
      controllable.settle({ stopReason: 'aborted', output: [] })
      await controllable.run.result
      await Promise.resolve()
      expect(h.registry.isDelegationActive('child-tool')).toBe(false)
      expect(h.registry.cancel('child-tool')).toBe(false)
    })

    it('keeps the facade entry when a tool registration lands for the same child session', async () => {
      const h = await mountFacade()
      h.enterParent(PARENT)
      const controllable = makeRun('child-fresh')
      h.setStartHandler((request) => {
        h.consumeIntent(request)
        return controllable.run
      })
      await h.registry.start(PARENT, PROVIDER, PROMPT)
      // The facade already tracks the child; a tool registration must not
      // replace the facade controller (which owns cancellation + progress).
      let strayCancelled = 0
      h.registry.trackDelegationRun('child-fresh', controllable.run, () => { strayCancelled += 1 })

      expect(h.registry.isDelegationActive('child-fresh')).toBe(true)
      expect(h.registry.cancel('child-fresh')).toBe(true)
      // The facade controller aborted the run; the tool lever never fired.
      expect(strayCancelled).toBe(0)
      controllable.settle({ stopReason: 'aborted', output: [] })
      await controllable.run.result
    })

    it('reports a miss for an unknown child without throwing', async () => {
      const h = await mountFacade()
      expect(h.registry.isDelegationActive('nope')).toBe(false)
      expect(h.registry.cancel('nope')).toBe(false)
    })
  })
})

describe('delegation cwd option and observation read side', () => {
  it('rides the cwd override into the staged fresh and resume intents', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    await h.registry.start(PARENT, PROVIDER, PROMPT, { cwd: '/cell-a' })
    expect(h.consumed[0]).toEqual({ kind: 'fresh', cwd: '/cell-a' })

    h.registry.recordDelegation({
      childSessionId: 'child-cwd', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-1', cwd: '/cell-a',
    })
    await h.registry.resume(PARENT, PROVIDER, 'child-cwd', PROMPT, { cwd: '/cell-a' })
    expect(h.consumed[1]).toEqual({
      kind: 'resume', childSessionId: 'child-cwd', cliSessionId: 'cli-1', cwd: '/cell-a',
    })
  })

  it('rides the scope into the staged fresh and resume intents, and refuses a resume that changes it', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    await h.registry.start(PARENT, PROVIDER, PROMPT, { cwd: '/cell-a', scope: 'eval-b' })
    expect(h.consumed[0]).toEqual({ kind: 'fresh', cwd: '/cell-a', scope: 'eval-b' })

    h.registry.recordDelegation({
      childSessionId: 'child-scope', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-3', cwd: '/cell-a', scope: 'eval-b',
    })
    await h.registry.resume(PARENT, PROVIDER, 'child-scope', PROMPT, { cwd: '/cell-a', scope: 'eval-b' })
    expect(h.consumed[1]).toEqual({
      kind: 'resume', childSessionId: 'child-scope', cliSessionId: 'cli-3', cwd: '/cell-a', scope: 'eval-b',
    })

    // Another scope — or none — would continue the CLI session under another
    // account's credentials, so the facade refuses BEFORE staging anything.
    await expect(h.registry.resume(PARENT, PROVIDER, 'child-scope', PROMPT, { cwd: '/cell-a' }))
      .rejects.toThrow(/resume scope \(default\) differs/)
    await expect(h.registry.resume(PARENT, PROVIDER, 'child-scope', PROMPT, { cwd: '/cell-a', scope: 'other' }))
      .rejects.toThrow(/resume scope other differs/)
    expect(h.consumed).toHaveLength(2)
    expectNothingStaged(h.registry)
  })

  it('rides the delegation model into the staged fresh intent, and refuses one on resume', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    await h.registry.start(PARENT, PROVIDER, PROMPT, { cwd: '/cell-a', model: 'model-a' })
    expect(h.consumed[0]).toEqual({ kind: 'fresh', cwd: '/cell-a', model: 'model-a' })

    // A resume re-requests what the record holds; naming one here would
    // switch a live conversation's model mid-way, so it is refused BEFORE
    // anything is staged.
    h.registry.recordDelegation({
      childSessionId: 'child-model', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-4', cwd: '/cell-a', model: 'model-a',
    })
    await expect(h.registry.resume(PARENT, PROVIDER, 'child-model', PROMPT, { cwd: '/cell-a', model: 'model-a' }))
      .rejects.toThrow(/resume does not take a model/)
    await expect(h.registry.resume(PARENT, PROVIDER, 'child-model', PROMPT, { cwd: '/cell-a', model: 'other' }))
      .rejects.toThrow(/resume does not take a model/)
    expect(h.consumed).toHaveLength(1)
    expectNothingStaged(h.registry)

    // Without one, the resume stages the ordinary intent and the provider
    // reads the model back off the record.
    await h.registry.resume(PARENT, PROVIDER, 'child-model', PROMPT, { cwd: '/cell-a' })
    expect(h.consumed[1]).toEqual({ kind: 'resume', childSessionId: 'child-model', cliSessionId: 'cli-4', cwd: '/cell-a' })
    expect(h.registry.getDelegation('child-model')).toMatchObject({ model: 'model-a' })
  })

  it('stages no model when the option is absent — the default intent is unchanged', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    await h.registry.start(PARENT, PROVIDER, PROMPT, {})
    expect(h.consumed[0]).toEqual({ kind: 'fresh' })
  })

  it('stages no cwd when the option is absent — the default intent is unchanged', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    await h.registry.start(PARENT, PROVIDER, PROMPT)
    expect(h.consumed[0]).toEqual({ kind: 'fresh' })
    expectNothingStaged(h.registry)
  })

  it('rides the container exec target into the staged fresh and resume intents', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    const exec = { container: 'dsh-lab-abc', workdir: '/workspace', env: { CODEX_HOME: '/creds/codex' } }
    await h.registry.start(PARENT, PROVIDER, PROMPT, { cwd: '/cell-a', exec })
    expect(h.consumed[0]).toEqual({ kind: 'fresh', cwd: '/cell-a', exec })

    h.registry.recordDelegation({
      childSessionId: 'child-exec', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-2', cwd: '/cell-a',
    })
    // The caller repeats the target on resume, exactly as it repeats the cwd.
    await h.registry.resume(PARENT, PROVIDER, 'child-exec', PROMPT, { cwd: '/cell-a', exec })
    expect(h.consumed[1]).toEqual({
      kind: 'resume', childSessionId: 'child-exec', cliSessionId: 'cli-2', cwd: '/cell-a', exec,
    })
  })

  it('stages no exec target when the option is absent — the round runs on the host', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    await h.registry.start(PARENT, PROVIDER, PROMPT, { cwd: '/cell-a' })
    expect(h.consumed[0]).toEqual({ kind: 'fresh', cwd: '/cell-a' })
    expectNothingStaged(h.registry)
  })

  it('delegationOf projects the record without the CLI-session resume handle', async () => {
    const h = await mountFacade()
    h.registry.recordDelegation({
      childSessionId: 'child-obs', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-2',
      cwd: '/cell-b', observedModel: 'gpt-5.6-sol',
    })
    expect(h.registry.delegationOf('child-obs')).toEqual({
      childSessionId: 'child-obs',
      provider: PROVIDER,
      parentSessionId: PARENT,
      cwd: '/cell-b',
      observedModel: 'gpt-5.6-sol',
    })
    // Absent observations stay absent, and unknown children return undefined.
    h.registry.recordDelegation({
      childSessionId: 'child-bare', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-3',
    })
    expect(h.registry.delegationOf('child-bare')).toEqual({
      childSessionId: 'child-bare', provider: PROVIDER, parentSessionId: PARENT,
    })
    expect(h.registry.delegationOf('nope')).toBeUndefined()
  })

  it('recordRoundSettled merges observedModel into the record and reports the settled event', async () => {
    const h = await mountFacade()
    h.enterParent(PARENT)
    h.registry.recordDelegation({
      childSessionId: 'child-obs', provider: PROVIDER, parentSessionId: PARENT, cliSessionId: 'cli-9',
    })
    const cordisEvents: [string, LocalAgentRunProgress][] = []
    h.ctx.on('localAgent/run-progress', (id, progress) => { cordisEvents.push([id, progress]) })

    h.registry.recordRoundSettled('child-obs', {
      observedModel: 'gpt-5.6-sol', cliVersion: '0.144.0', usage: { inputTokens: 10, outputTokens: 4 },
    })
    expect(h.registry.delegationOf('child-obs')).toMatchObject({
      observedModel: 'gpt-5.6-sol',
      cliVersion: '0.144.0',
    })
    expect(cordisEvents.at(-1)).toEqual([
      'child-obs',
      {
        kind: 'settled',
        observedModel: 'gpt-5.6-sol',
        cliVersion: '0.144.0',
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ])

    // Absent fields stay absent — no keys, never guesses. A later round with
    // no model leaves the earlier observation standing.
    h.registry.recordRoundSettled('child-obs', {})
    expect(cordisEvents.at(-1)).toEqual(['child-obs', { kind: 'settled' }])
    expect(h.registry.delegationOf('child-obs')).toMatchObject({
      observedModel: 'gpt-5.6-sol',
      cliVersion: '0.144.0',
    })

    // An unknown child has nothing to merge, but the event still reports.
    expect(() => h.registry.recordRoundSettled('child-unknown', { observedModel: 'm' })).not.toThrow()
    expect(h.registry.delegationOf('child-unknown')).toBeUndefined()
    expect(cordisEvents.at(-1)).toEqual(['child-unknown', { kind: 'settled', observedModel: 'm' }])
  })
})
