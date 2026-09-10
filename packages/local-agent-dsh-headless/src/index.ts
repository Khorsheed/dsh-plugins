/**
 * @khorsheed/dsh-local-agent-dsh-headless — sub-dsh direct Agent driver with
 * two modes. One-shot (default): create one Agent through the core registry
 * on a caller-supplied session id (or resume one), drive the task to
 * quiescence, flush its Session, print the final assistant text, and exit.
 * Serve (`--serve`): stay resident and drive turns over the family-internal
 * live-driver wire (see `./serve.ts` / `./wire.ts`). The session id comes
 * from the invocation (`--session-id` / `--resume`) or the wire, never from
 * stdout — the parent provider generates one uuid and both sides use it, so
 * stdout carries no parseable session marker.
 *
 * @module @khorsheed/dsh-local-agent-dsh-headless
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { loadSubDshAgent, summarizeTurn } from './agent-loader.ts'
import { runServe } from './serve.ts'

/** Stable Cordis plugin name. */
export const name = 'local-agent-dsh-headless-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the one-shot task and caller session identity, or serve mode. */
export interface Config {
  /** The prompt text for the single run; unused in serve mode. */
  task?: string
  /** Fresh delegation: create a session with exactly this id. */
  sessionId?: string
  /** Continuation: resume the existing session with this id. */
  resumeSessionId?: string
  /** Resident mode: drive turns over the stdio wire instead of one task. */
  serve?: boolean
  /**
   * The model this launch runs (`--model`), spelled `provider/model`; a bare
   * id names the model and keeps the instance's provider. Absent means the
   * instance's default selection, unchanged. Under `serve` it binds every
   * session the resident process hosts.
   */
  model?: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
  sessionId: z.string(),
  resumeSessionId: z.string(),
  serve: z.boolean().default(false),
  model: z.string(),
})

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface HeadlessIo {
  stdin: { on(event: 'data', listener: (chunk: unknown) => void): unknown; on(event: 'end', listener: () => void): unknown }
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdin: HeadlessIo['stdin']; stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: HeadlessIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Run one task through a fresh or resumed Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param config - validated one-shot config (task plus the caller session id).
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: HeadlessIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (ctx.get('agents') === undefined || ctx.get('agentDefaultModel') === undefined || sessions === undefined) return

  const handle = await loadSubDshAgent(ctx, {
    ...config.sessionId === undefined ? {} : { sessionId: config.sessionId },
    ...config.resumeSessionId === undefined ? {} : { resumeSessionId: config.resumeSessionId },
    ...config.model === undefined ? {} : { model: config.model },
  })
  const agent = handle.agent
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: config.task ?? '' }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await sessions.flush(agent.session)
  const outcome = summarizeTurn(agent.session.snapshotEvents(), firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the direct driver: one-shot by default, the resident serve loop when
 * the invocation passed `--serve`.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task/serve config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('local-agent-dsh-headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdin: internals.stdin, stdout: internals.stdout, stderr: internals.stderr, exit }
  if (config.serve === true) {
    void runServe(ctx, io, config.model).catch((error: unknown) => { fail(io, error) })
    return
  }
  if (config.task === undefined || config.task.trim() === '') {
    throw new Error('local-agent-dsh-headless-runner: a task is required unless serve mode is on')
  }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
