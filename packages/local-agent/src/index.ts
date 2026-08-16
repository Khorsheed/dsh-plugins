/**
 * @khorsheed/dsh-local-agent — the local code-agent harness family core.
 * Each locally-installed coding agent CLI (Kimi Code, Codex, Claude Code, …)
 * registers itself as one harness: a scoped home under the shared homes root,
 * the device-code login command, and a session-records adapter. The glue
 * registers the `/<harness> login|sessions` command family and provisions the
 * scoped home; every harness's state stays under its own directory and never
 * touches the user's native installation.
 *
 * Delegation deliberately stays OUT of this seam: each harness bundle mounts
 * its own subagent-provider row into the existing `subagent` capability
 * (subagent-acp for a harness that speaks ACP over stdio, subagent-codex's
 * provider for Codex's app-server wire, …), reading the scoped home through
 * {@link LocalAgentRegistry.homeDir}. This package owns only harness identity
 * and lifecycle.
 *
 * @module @khorsheed/dsh-local-agent
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { LocalAgentRosterRow, LocalAgentSessionRecord, LocalAgentStatus } from './types.ts'
import LocalAgentGateway from './gateway.ts'

/** Stable Cordis plugin name. */
export const name = 'local-agent'

/** Services required before the registry and commands can mount. */
export const inject = ['commands']

export type { LocalAgentRosterRow, LocalAgentSessionRecord, LocalAgentStatus } from './types.ts'

/** Per-harness session listing: reads the harness's own records format. */
export interface LocalAgentRecordsAdapter {
  /**
   * List sessions from the harness's scoped home.
   * @param homeDir - the harness's scoped home directory.
   * @returns the sessions in the harness's own order.
   */
  listSessions(homeDir: string): Promise<readonly LocalAgentSessionRecord[]>
}

/**
 * Compose a session-backed subagent's durable label from the harness's
 * display name and the delegation's own description, so the standard 子代理
 * surface shows which local agent produced the conversation. Providers
 * (kimi, future codex/claude-code) call this when appending the child's
 * `subagent/descriptor` event; the prefix is the durable, model-visible
 * source marker.
 * @param displayName - the harness's human display name (e.g. `Kimi Code`).
 * @param description - the delegation's short description, when the caller
 *   supplied one.
 * @returns the composed label, or just the display name without a description.
 */
export function subagentDelegationLabel(displayName: string, description: string | undefined): string {
  return description === undefined ? displayName : `${displayName}: ${description}`
}

/**
 * One registered local code-agent harness.
 */
export interface LocalAgentHarness {
  /** Command prefix and scoped-home directory name (lowercase, dashed). */
  name: string
  /** Human display name, used in command replies and UI labels. */
  displayName: string
  /** Environment variable naming the scoped home (e.g. `KIMI_CODE_HOME`). */
  homeEnvVar: string
  /**
   * Subagent provider name this harness delegates through, when it has one.
   * A harness without delegation is record-and-login only. The core invariant
   * cross-checks this against the mounted subagent providers, so a record
   * that names a provider the composition does not mount fails loud.
   */
  delegationProvider?: string
  /** Device-code login invocation; the prompt is captured from stderr. */
  login: {
    command: string
    args: readonly string[]
    /**
     * Which stream carries the device-code prompt. Defaults to `stderr`
     * (kimi's login prints there); harnesses whose CLI prints the prompt to
     * stdout (codex `login --device-auth`, claude `setup-token`) declare
     * `stdout` so the reply surfaces the URL instead of timing out.
     */
    capture?: 'stderr' | 'stdout'
  }
  /** Session records reader for this harness's format. */
  records: LocalAgentRecordsAdapter
  /**
   * Whether the scoped home currently holds usable credentials. Absent means
   * the harness reports "not authenticated" and the status command still
   * runs; the check is per-harness (a credentials directory, an auth file).
   */
  isAuthenticated?: (homeDir: string) => Promise<boolean>
  /**
   * Sign out of the scoped account, clearing the stored credentials so a
   * later login authorizes another account. Absent means the harness has no
   * logout path and `/logout` reports it instead of guessing.
   */
  logout?: (homeDir: string) => Promise<void>
  /**
   * Optional extra `/<name>` subcommands beyond the family's own. Returning
   * undefined means the input is not this harness's; the family's unknown-
   * subcommand error answers instead. A harness owns its extras (config
   * commands, preset management), keeping the core seam generic.
   * @param input - the trimmed subcommand input.
   * @param invocation - the full command invocation.
   * @returns the command result, or undefined when the subcommand is not this
   * harness's.
   */
  subcommand?: (
    input: string,
    invocation: CommandInvocation,
  ) => Promise<CommandResult> | CommandResult | undefined
}

/** Plugin config: the shared scoped-homes root and the login prompt wait. */
export interface Config {
  /** Root holding one directory per harness; subdirectories are `agent/<name>`. */
  homesRoot: string
  /** How long `/login` waits for the device-code prompt before failing. */
  loginPromptTimeoutMs?: number
}

/** Grace between SIGTERM and SIGKILL when replacing an abandoned login child. */
export const REPLACE_LOGIN_GRACE_MS = 5_000

export const Config: z<Config> = z.object({
  homesRoot: z.string().required(),
  loginPromptTimeoutMs: z.number().default(10_000),
})

/** Service name provided by this plugin and injected by patch rows. */
export const LOCAL_AGENT_SERVICE = 'localAgent'

/** One bounded login attempt: the polling child plus its settle signal. */
interface LoginController {
  child: ChildProcess
  done: Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    localAgent: LocalAgentRegistry
  }

  interface Events {
    /**
     * A harness became resolvable: its scoped home exists and its command
     * family is registered.
     * @param harness - the registered harness.
     * @mode emit
     */
    'localAgent/harness-added'(harness: LocalAgentHarness): void
    /**
     * A harness left the registry; its command family is unregistered.
     * @param name - the harness name that no longer resolves.
     * @mode emit
     */
    'localAgent/harness-removed'(name: string): void
  }
}

/** Render the session list for a command reply. */
function renderSessions(harness: LocalAgentHarness, records: readonly LocalAgentSessionRecord[]): string {
  if (records.length === 0) return `No ${harness.displayName} sessions in the scoped home yet.`
  const lines = records.map(record => `- ${record.id} (workDir: ${record.workDir})`)
  return `${harness.displayName} sessions (${records.length}):\n${lines.join('\n')}`
}

/** Render the status reply: one `key: value` line per fact. */
function renderStatus(status: LocalAgentStatus): string {
  return [
    `harness: ${status.name}`,
    `authenticated: ${status.authenticated ? 'yes' : 'no'}`,
    `homeDir: ${status.homeDir}`,
    ...status.delegationProvider !== undefined ? [`provider: ${status.delegationProvider}`] : [],
  ].join('\n')
}

/** Map a login failure to a command error, naming the swallowed signal. */
function loginFailure(harness: LocalAgentHarness, exitCode: number | null, signal: NodeJS.Signals | null): string {
  return `${harness.name} login exited with ${signal ?? `code ${exitCode ?? 'unknown'}`}; try /${harness.name} login again.`
}

/**
 * Registry of local code-agent harnesses and the per-harness command family.
 * @module @khorsheed/dsh-local-agent
 */
export class LocalAgentRegistry {
  private readonly harnesses = new Map<string, LocalAgentHarness>()
  private readonly commandDisposers = new Map<string, () => void>()
  private readonly logins = new Map<string, LoginController>()

  /**
   * @param ctx - context carrying the command registry.
   * @param homesRoot - shared scoped-homes root.
   * @param loginPromptTimeoutMs - device-code prompt wait.
   */
  constructor(
    private readonly ctx: Context,
    private readonly homesRoot: string,
    private readonly loginPromptTimeoutMs: number,
  ) {}

  /**
   * Absolute scoped home for one harness.
   * @param name - the harness name.
   * @returns `<homesRoot>/<name>`.
   */
  homeDir(name: string): string {
    return join(this.homesRoot, name)
  }

  /**
   * Register one harness: provision its scoped home, register the
   * `/<name> login|sessions` command family, and publish the added event.
   * @param harness - the harness definition.
   * @returns the disposer unregistering the command and the harness.
   */
  register(harness: LocalAgentHarness): () => void {
    if (this.harnesses.has(harness.name)) {
      throw new Error(`localAgent: harness ${harness.name} is already registered`)
    }
    const homeDir = this.homeDir(harness.name)
    // The scoped home holds credentials and sessions; 0700 keeps them
    // readable only by the owning user. mkdir's mode is umask-masked, so the
    // chmod enforces the exact bits.
    mkdirSync(homeDir, { recursive: true })
    chmodSync(homeDir, 0o700)
    this.harnesses.set(harness.name, harness)
    const commandDisposer = this.ctx.commands.register({
      name: harness.name,
      description: `manage the scoped ${harness.displayName} CLI: login, sessions, status, logout`,
      input: { hint: 'login|sessions|status|logout' },
      handler: invocation => this.handle(invocation, harness),
    })
    this.commandDisposers.set(harness.name, commandDisposer)
    this.ctx.emit('localAgent/harness-added', harness)
    return () => {
      commandDisposer()
      this.commandDisposers.delete(harness.name)
      this.harnesses.delete(harness.name)
      this.ctx.emit('localAgent/harness-removed', harness.name)
    }
  }

  /**
   * Resolve one harness by name.
   * @param name - the harness name.
   * @returns the harness, or undefined when it is not registered.
   */
  get(name: string): LocalAgentHarness | undefined {
    return this.harnesses.get(name)
  }

  /**
   * Every registered harness name, in registration order.
   * @returns the harness names.
   */
  list(): readonly string[] {
    return [...this.harnesses.keys()]
  }

  /**
   * Every registered harness as a roster row, in registration order.
   * @returns the roster rows.
   */
  roster(): readonly LocalAgentRosterRow[] {
    return [...this.harnesses.values()].map(harness => ({ name: harness.name, displayName: harness.displayName }))
  }

  /**
   * Query one harness's auth status.
   * @param name - the harness name.
   * @returns the status snapshot.
   */
  async statusOf(name: string): Promise<LocalAgentStatus> {
    const harness = this.requireHarness(name)
    const homeDir = this.homeDir(name)
    const authenticated = await (harness.isAuthenticated?.(homeDir) ?? Promise.resolve(false))
    return {
      name: harness.name,
      displayName: harness.displayName,
      authenticated,
      homeDir,
      ...harness.delegationProvider !== undefined ? { delegationProvider: harness.delegationProvider } : {},
    }
  }

  /**
   * Query one harness's scoped session records.
   * @param name - the harness name.
   * @returns the session records in the harness's own order.
   */
  sessionsOf(name: string): Promise<readonly LocalAgentSessionRecord[]> {
    return this.requireHarness(name).records.listSessions(this.homeDir(name))
  }

  /** Resolve one harness or fail loud. */
  private requireHarness(name: string): LocalAgentHarness {
    const harness = this.harnesses.get(name)
    if (harness === undefined) throw new Error(`localAgent: unknown harness ${name}`)
    return harness
  }

  /** Dispatch `/login`, `/status`, and `/sessions` for one harness. */
  private handle(invocation: CommandInvocation, harness: LocalAgentHarness): Promise<CommandResult> {
    const input = invocation.rawInput.trim()
    if (input === 'login') return this.login(harness)
    if (input === 'status') {
      return this.statusOf(harness.name).then(status => ({ kind: 'success', text: renderStatus(status) }))
    }
    if (input === 'sessions' || input === '') {
      return this.sessionsOf(harness.name)
        .then(records => ({ kind: 'success', text: renderSessions(harness, records) }))
    }
    if (input === 'logout') {
      if (harness.logout === undefined) {
        return Promise.resolve({
          kind: 'error',
          text: `${harness.name} has no logout path; delete ${this.homeDir(harness.name)} to sign out.`,
        })
      }
      return harness.logout(this.homeDir(harness.name))
        .then(() => ({ kind: 'success', text: `${harness.displayName} signed out of the scoped home; log in again to switch accounts.` }))
    }
    if (harness.subcommand !== undefined) {
      const extra = harness.subcommand(input, invocation)
      if (extra !== undefined) return Promise.resolve(extra)
    }
    return Promise.resolve({
      kind: 'error',
      text: `Unknown /${harness.name} subcommand; use /${harness.name} login, /${harness.name} status, /${harness.name} sessions, or /${harness.name} logout.`,
    })
  }

  /**
   * Start the device-code login in the harness's scoped home. The URL and code
   * arrive on stderr (verified against kimi-code 0.33.0; other harnesses print
   * the same prompt shape); the reply surfaces that prompt immediately while
   * the child keeps polling in the background. A second login while one is
   * pending terminates the previous login's child and replaces it — a stale or
   * abandoned login (browser never opened, user gave up) must not hold the
   * slot forever, and the user's retry should just get a fresh code. An
   * abandoned login with no retry self-heals when the CLI's own device code
   * expires and its polling child exits (kimi/codex/claude all do); no
   * idle timer is added because a too-short one would kill a user who is
   * genuinely authorizing.
   * @param harness - the harness whose login command runs.
   * @returns the device-code prompt as the command success text.
   */
  private login(harness: LocalAgentHarness): Promise<CommandResult> {
    const existing = this.logins.get(harness.name)
    if (existing !== undefined) {
      // A pending login is replaced, not refused: terminate its child so the
      // new login gets a clean slot. The old controller's done signal already
      // cleared the map entry or will (its settle path deletes only when the
      // map still holds THAT controller, which the new set() below makes false).
      const stale = existing.child
      stale.kill()
      // SIGTERM first, then SIGKILL after a grace period: a CLI that ignores
      // SIGTERM must not leave a zombie polling process behind (the slot is
      // already replaced, so this is process hygiene, not a functional lock).
      const hardKill = setTimeout(() => {
        if (stale.exitCode === null && stale.signalCode === null) stale.kill('SIGKILL')
      }, REPLACE_LOGIN_GRACE_MS)
      stale.once('exit', () => { clearTimeout(hardKill) })
    }
    const controller: LoginController = { child: undefined as unknown as ChildProcess, done: Promise.resolve() }
    this.logins.set(harness.name, controller)
    const resultPromise = this.runLogin(harness, controller)
    // The settle signal is the real one only after runLogin populated it;
    // chaining earlier would clear the guard on the placeholder promise.
    void controller.done.then(() => {
      if (this.logins.get(harness.name) === controller) this.logins.delete(harness.name)
    })
    return resultPromise
  }

  /** Spawn the harness login command and capture its device-code prompt. */
  private runLogin(harness: LocalAgentHarness, controller: LoginController): Promise<CommandResult> {
    const child = spawn(harness.login.command, [...harness.login.args], {
      env: { ...process.env, [harness.homeEnvVar]: this.homeDir(harness.name) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    controller.child = child
    controller.done = new Promise<void>((resolve) => {
      child.on('exit', () => { resolve() })
      child.on('error', () => { resolve() })
    })
    const capture = harness.login.capture ?? 'stderr'
    let prompt = ''
    return new Promise<CommandResult>((resolve) => {
      const probe = capture === 'stderr' ? child.stderr : child.stdout
      if (capture === 'stdout') {
        // Drain stderr so a stdout-captured CLI cannot stall on a full pipe.
        child.stderr.resume()
      }
      probe.on('data', (chunk: Buffer) => {
        if (prompt === '') {
          prompt = chunk.toString()
          resolve({
            kind: 'success',
            text: `Device login started in the scoped home.\n${prompt}\nComplete the flow in the browser; the CLI keeps polling in the background.`,
          })
        }
      })
      child.on('exit', () => {
        if (prompt === '') resolve({ kind: 'error', text: loginFailure(harness, child.exitCode, null) })
      })
      child.on('error', (error) => {
        if (prompt === '') resolve({ kind: 'error', text: `${harness.name} login failed to start: ${error.message}` })
      })
      // A CLI that prints nothing at all should not hold the reply hostage.
      setTimeout(() => {
        if (prompt === '') {
          child.kill('SIGTERM')
          resolve({
            kind: 'error',
            text: `${harness.name} login printed no device-code prompt; is the ${harness.displayName} CLI installed and configured?`,
          })
        }
      }, this.loginPromptTimeoutMs)
    })
  }
}

/** Render the harness roster for the family command. */
function renderRoster(registry: LocalAgentRegistry): string {
  const names = registry.list()
  if (names.length === 0) return 'No local-agent harnesses registered.'
  return names.map((name) => {
    const harness = registry.get(name)
    return `${name}: ${harness?.displayName ?? name}`
  }).join('\n')
}

/**
 * Mount the local-agent core: provide the harness registry and the family
 * command listing the registered harnesses (the client roster channel).
 * @param ctx - plugin context carrying the command registry.
 * @param config - shared scoped-homes root and login prompt wait.
 */
export function apply(ctx: Context, config: Config): void {
  const registry = new LocalAgentRegistry(ctx, config.homesRoot, config.loginPromptTimeoutMs ?? 10_000)
  ctx.provide(LOCAL_AGENT_SERVICE, registry)
  // The read-only Remote channel the web client polls through; it depends on
  // the registry, so it mounts after the provide above. Service registration
  // follows the owning fiber, so unload unregisters it automatically.
  new LocalAgentGateway(ctx)
  ctx.commands.register({
    name: 'local-agent',
    description: 'list the registered local code-agent harnesses',
    input: { hint: 'list' },
    handler: (invocation) => {
      const input = invocation.rawInput.trim()
      if (input === 'list' || input === '') {
        return Promise.resolve({ kind: 'success', text: renderRoster(registry) })
      }
      return Promise.resolve({
        kind: 'error',
        text: 'Unknown /local-agent subcommand; use /local-agent list.',
      })
    },
  })
}
