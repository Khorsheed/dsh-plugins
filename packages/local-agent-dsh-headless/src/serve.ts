/**
 * Serve mode: the resident sub-dsh loop behind the family-internal live-driver
 * wire (see `./wire.ts`). Where the one-shot runner drives a single task and
 * exits, serve mode keeps the tree alive on stdin: each `turn/start` request
 * feeds one followup into the caller-named session's Agent, every session
 * event streams back as a `session/event` notification while it happens, and
 * `session/idle` closes the turn after the log flush. `turn/interrupt`
 * delivers the runtime-level graceful cancel (`Agent.cancel`) that the
 * process boundary cannot express — the process survives and the session
 * stays continuable, which is the live driver's reason to exist.
 * @module @khorsheed/dsh-local-agent-dsh-headless/serve
 */

import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { loadSubDshAgent, summarizeTurn } from './agent-loader.ts'
import {
  LIVE_SERVER_NAME,
  LIVE_WIRE_ERROR_INTERNAL,
  LIVE_WIRE_ERROR_METHOD_NOT_FOUND,
  LIVE_WIRE_PROTOCOL_VERSION,
} from './wire.ts'
import type { LiveSessionIdleParams, LiveTurnReason } from './wire.ts'

/**
 * The process streams serve mode reads and writes; tests substitute captures.
 * `stdin` is the minimal readable surface (`data`/`end`), `exit` is the
 * launcher-provided bounded exit request.
 */
export interface ServeIo {
  readonly stdin: {
    on(event: 'data', listener: (chunk: unknown) => void): unknown
    on(event: 'end', listener: () => void): unknown
  }
  readonly stdout: { write(chunk: string): unknown }
  readonly stderr: { write(chunk: string): unknown }
  readonly exit: (code: number) => void
}

/** Flatten an unknown thrown value for a wire error or stderr line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run the resident loop until stdin closes or a `shutdown` request arrives.
 * @param ctx - plugin context carrying the loader settle, core services, and
 *   the session/event feed.
 * @param io - process-facing effects.
 */
export async function runServe(ctx: Context, io: ServeIo, model?: string, effort?: string): Promise<void> {
  // Loader siblings mount concurrently; await the complete application before
  // driving Agents so scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  if (agents === undefined || sessions === undefined || ctx.get('agentDefaultModel') === undefined) {
    io.stderr.write('dsh: serve mode requires the agents, sessions, and agentDefaultModel services\n')
    io.exit(1)
    return
  }

  /** Loaded agents by caller session id; one member per process in practice. */
  const managed = new Map<string, AgentHandle>()
  /** Per-session turn serialization: one in-flight turn per session, FIFO. */
  const queues = new Map<string, Promise<void>>()
  /**
   * The in-flight round's parent-supplied turn number per session, set while
   * a turn body runs and echoed on its notifications — the parent drops a
   * cancelled round's late unwind instead of mis-settling the next round.
   */
  const activeTurns = new Map<string, number>()
  let shuttingDown = false
  let buffer = ''
  const decoder = new StringDecoder('utf8')

  const send = (message: Record<string, unknown>): void => {
    io.stdout.write(JSON.stringify(message) + '\n')
  }
  const respond = (id: number, result: unknown): void => {
    send({ jsonrpc: '2.0', id, result })
  }
  const respondError = (id: number, message: string, code: number = LIVE_WIRE_ERROR_INTERNAL): void => {
    send({ jsonrpc: '2.0', id, error: { code, message } })
  }
  const notify = (method: string, params: Record<string, unknown>): void => {
    send({ jsonrpc: '2.0', method, params })
  }

  // Push every session event of a managed session the moment it lands; the
  // parent mirrors event-by-event instead of polling the log file. Events
  // outside a round (agent maintenance, load-time scaffolding) carry a null
  // turn tag and the parent ignores them.
  ctx.on('session/event', (session, event) => {
    if (shuttingDown || !managed.has(String(session.id))) return
    const id = String(session.id)
    notify('session/event', {
      sessionId: id,
      turn: activeTurns.get(id) ?? null,
      event: event as unknown as Record<string, unknown>,
    })
  })

  // This process owns real Agents, so the public scoped stream bus is valid
  // here. The parent presents these frames through the plugin's own channel.
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const sessionId = String(agent.session.id)
    const turn = activeTurns.get(sessionId)
    if (shuttingDown || !managed.has(sessionId) || turn === undefined) return
    notify('session/assistant-stream', { sessionId, turn, frame })
  }, { global: true })

  const debug = process.env['DSH_SERVE_DEBUG'] === '1'
    ? (message: string): void => { io.stderr.write(`dsh-serve: ${message}\n`) }
    : (): void => {}

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    debug('shutdown requested')
    for (const handle of managed.values()) {
      await handle.dispose().catch(() => {})
    }
    debug('managed agents disposed; requesting exit')
    io.exit(0)
    // The launcher's bounded shutdown completes with `process.exitCode`, which
    // only takes effect once the event loop drains — our flowing stdin pipe
    // would hold it open forever (a one-shot never listens on stdin, so only
    // serve mode hits this). Detach our stdin handle and arm a bounded
    // self-exit fallback for anything else still holding the loop.
    const stdin = io.stdin as { removeAllListeners?: (event?: string) => void; unref?: () => void }
    stdin.removeAllListeners?.('data')
    stdin.removeAllListeners?.('end')
    stdin.unref?.()
    setTimeout(() => {
      debug('exit fallback fired')
      process.exit(0)
    }, 2_000).unref()
  }

  /** Accept one turn: followup now, outcome later as `session/idle`. */
  const startTurn = (sessionId: string, text: string, turn: number, agent: AgentHandle['agent']): void => {
    const previous = queues.get(sessionId) ?? Promise.resolve()
    const run = previous.then(async () => {
      activeTurns.set(sessionId, turn)
      let reason: LiveTurnReason | null
      try {
        const firstSeq = agent.session.seq
        agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }))
        await agent.whenIdle()
        // Flush BEFORE the idle notification so the parent's file-based
        // reconciliation pass sees the complete round on disk.
        await sessions.flush(agent.session)
        reason = summarizeTurn(agent.session.snapshotEvents(), firstSeq).reason ?? null
      } catch (error) {
        // A turn-level failure must still close the parent's wait.
        reason = { kind: 'error', error: { message: messageOf(error), code: 'UNKNOWN' } }
      }
      const params: LiveSessionIdleParams = { sessionId, turn, reason }
      try {
        notify('session/idle', params as unknown as Record<string, unknown>)
      } finally {
        activeTurns.delete(sessionId)
      }
    })
    queues.set(sessionId, run)
  }

  const handleRequest = async (id: number, method: string, params: Record<string, unknown>): Promise<void> => {
    switch (method) {
      case 'initialize':
        respond(id, { serverInfo: { name: LIVE_SERVER_NAME }, protocolVersion: LIVE_WIRE_PROTOCOL_VERSION })
        return
      case 'turn/start': {
        const sessionId = params['sessionId']
        const text = params['text']
        const turn = params['turn']
        const resume = params['resume'] === true
        if (typeof sessionId !== 'string' || sessionId === '' || typeof text !== 'string'
          || typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1) {
          respondError(id, 'turn/start requires a sessionId, a text, and a positive integer turn')
          return
        }
        let handle = managed.get(sessionId)
        if (handle === undefined) {
          try {
            // The launch's `--model` binds every session this resident
            // process hosts: a runtime's model is a process fact, which is
            // exactly why the parent refuses a per-delegation model on the
            // live path.
            handle = await loadSubDshAgent(ctx, {
              ...resume ? { resumeSessionId: sessionId } : { sessionId },
              ...model === undefined ? {} : { model },
              ...effort === undefined ? {} : { effort },
            })
          } catch (error) {
            respondError(id, messageOf(error))
            return
          }
          managed.set(sessionId, handle)
        }
        startTurn(sessionId, text, turn, handle.agent)
        respond(id, { accepted: true })
        return
      }
      case 'turn/interrupt': {
        const sessionId = params['sessionId']
        if (typeof sessionId !== 'string') {
          respondError(id, 'turn/interrupt requires a sessionId')
          return
        }
        const handle = managed.get(sessionId)
        // The official Agent cancel: the active turn aborts, un-started inbox
        // work survives, and the process/session stay continuable.
        handle?.agent.cancel({ kind: 'parent' })
        respond(id, { interrupted: handle !== undefined })
        return
      }
      case 'shutdown':
        respond(id, {})
        void shutdown()
        return
      default:
        respondError(id, `unknown method: ${method}`, LIVE_WIRE_ERROR_METHOD_NOT_FOUND)
    }
  }

  io.stdin.on('data', (chunk: unknown) => {
    if (shuttingDown) return
    // A multi-byte UTF-8 sequence can straddle two chunks; the StringDecoder
    // holds the partial tail instead of corrupting it into U+FFFD.
    const text = typeof chunk === 'string'
      ? chunk
      : decoder.write(chunk as Buffer)
    buffer += text
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (line.trim() === '') continue
      let message: { id?: unknown; method?: unknown; params?: unknown }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        io.stderr.write('dsh: serve ignored a malformed wire line\n')
        continue
      }
      // Only requests carry an id; the parent sends no notifications.
      if ((typeof message.id === 'number' || typeof message.id === 'string') && typeof message.method === 'string') {
        const id = Number(message.id)
        void handleRequest(id, message.method,
          (message.params ?? {}) as Record<string, unknown>).catch((error: unknown) => {
          respondError(id, messageOf(error))
        })
      }
    }
  })
  // The parent closing the pipe IS the shutdown request (reclaim path).
  io.stdin.on('end', () => { void shutdown() })
}
