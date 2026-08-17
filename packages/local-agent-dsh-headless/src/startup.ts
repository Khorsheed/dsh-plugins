/**
 * The sub-dsh one-shot app's command-line provider: it parses the task
 * positional, the caller-supplied `--session-id` (fresh delegation) and
 * `--resume` (continuation) flags, and `--help`, then publishes
 * {@link LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE}. The runner is an ordinary
 * consumer whose lazy config waits for that service. The session id is
 * caller-supplied — the parent provider generates one uuid and passes the same
 * value to `agents.create`/`agents.resume` on the sub-dsh side, so stdout
 * never carries a parseable session marker.
 * @module @khorsheed/dsh-local-agent-dsh-headless/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'local-agent-dsh-headless-startup'

/** Services required before the invocation can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the one-shot runner. */
export const LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE = 'localAgentDshHeadlessStartup'

/** What the runner row reads from {@link LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE}. */
export interface LocalAgentDshHeadlessStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** Fresh delegation: create a session with this exact id. */
  sessionId?: string
  /** Continuation: resume the existing session with this id. */
  resumeSessionId?: string
}

/**
 * This app's command: the session flags, the task positional, and help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function headlessCommand(): Command {
  return new Command()
    .name('dsh --profile headless-local-agent-dsh')
    .description('Answer one task in a caller-named session, print the final assistant message, and exit.')
    .helpOption('-h, --help', 'show this help')
    .option('--session-id <id>', 'create a fresh session with exactly this id')
    .option('--resume <id>', 'continue the existing session with this id')
    .argument('[task...]', 'the task text; multiple words are joined by spaces')
    .addHelpText('after', `
Examples:
  dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   create one session and answer
  dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       continue the same session
`)
}

/**
 * Parse and provide the one-shot invocation as an ordinary Cordis service.
 * The command's action publishes the invocation; a missing or whitespace-only
 * task, or both session flags together, is a usage error, so on rejection (and
 * on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = headlessCommand()
  program.action(() => {
    const task = program.args.join(' ')
    if (task.trim() === '') {
      program.error('error: a task is required, for example: dsh --profile headless-local-agent-dsh --session-id <id> "run the tests"')
    }
    // Commander camelizes `--session-id` to `sessionId` but keeps `--resume`
    // as `resume`; map both onto the service's explicit field names.
    const options = program.opts<{ sessionId?: string; resume?: string }>()
    if (options.sessionId !== undefined && options.resume !== undefined) {
      program.error('error: --session-id and --resume are mutually exclusive')
    }
    ctx.provide(LOCAL_AGENT_DSH_HEADLESS_STARTUP_SERVICE, {
      task,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      ...(options.resume !== undefined ? { resumeSessionId: options.resume } : {}),
    } satisfies LocalAgentDshHeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
