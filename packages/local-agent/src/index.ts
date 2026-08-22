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
import { randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {
  DelegationCallOptions,
  LocalAgentDelegationIntent,
  LocalAgentDelegationRecord,
  LocalAgentMemberRun,
  LocalAgentRosterRow,
  LocalAgentRunProgress,
  LocalAgentSessionRecord,
  LocalAgentStatus,
} from './types.ts'
import LocalAgentGateway from './gateway.ts'
import { MemberChannel } from './member-channel.ts'

/** Stable Cordis plugin name. */
export const name = 'local-agent'

/** Services required before the registry and commands can mount. */
export const inject = ['commands']

export type {
  DelegationCallOptions,
  LocalAgentDelegationIntent,
  LocalAgentDelegationRecord,
  LocalAgentDelegationView,
  LocalAgentMemberRun,
  LocalAgentPromptResult,
  LocalAgentRosterRow,
  LocalAgentRunProgress,
  LocalAgentSessionRecord,
  LocalAgentStatus,
} from './types.ts'

export type {
  LocalAgentMemberMessage,
  MemberMessageOutcome,
  RoomMemberMessageGate,
  RoomMemberMessageReceipt,
} from './types.ts'

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
  /**
   * Device-code login invocation; the prompt is captured from stderr. Absent
   * means the harness has no login flow — it authenticates through the host
   * instance (e.g. by resolving a credential from the parent's store), so
   * `/login` reports that instead of guessing a command.
   */
  login?: {
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

/** Heartbeat interval for facade-tracked in-flight runs. */
export const RUN_PROGRESS_HEARTBEAT_MS = 5_000

/** Socket filename of the member-bridge listener, under the shared homes root. */
export const MEMBER_BRIDGE_SOCKET_FILENAME = 'member-bridge.sock'

/** One delegation-intent queue per (parent session, provider). */
function delegationIntentKey(parentSessionId: string, provider: string): string {
  return `${parentSessionId}\u0000${provider}`
}

/**
 * Fuse the facade-owned cancel controller with an optional caller signal, so
 * `cancel()` and the caller's own abort channel both reach the run.
 * `AbortSignal.any` is the harness's own fusion primitive (agent-loop's resume
 * uses it); either source aborts the run.
 */
function fusedSignal(controller: AbortController, caller: AbortSignal | undefined): AbortSignal {
  if (caller === undefined) return controller.signal
  return AbortSignal.any([controller.signal, caller])
}

/**
 * The per-harness append-only delegation-mapping log inside the harness's
 * scoped home (`<homeDir>/<harness>/delegations.jsonl`): one JSON record per
 * line, the last line per childSessionId wins — the same replace semantics as
 * {@link LocalAgentRegistry.recordDelegation}. The file grows without
 * rotation (accepted; same growth class as session_index/rollout files).
 */
export const DELEGATIONS_FILENAME = 'delegations.jsonl'

/**
 * Parse one `delegations.jsonl` line into a delegation record, or `undefined`
 * when the line is malformed or names a different provider than the harness
 * being loaded (a foreign or stale line must never fail registration).
 * @param line - one raw line of the file.
 * @param provider - the loading harness's delegation provider.
 * @returns the record, or undefined to skip the line.
 */
function parseDelegationLine(
  line: string,
  provider: string | undefined,
): LocalAgentDelegationRecord | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (provider === undefined || record['provider'] !== provider) return undefined
  const childSessionId = record['childSessionId']
  const parentSessionId = record['parentSessionId']
  const cliSessionId = record['cliSessionId']
  if (typeof childSessionId !== 'string' || childSessionId === '') return undefined
  if (typeof parentSessionId !== 'string' || parentSessionId === '') return undefined
  if (typeof cliSessionId !== 'string' || cliSessionId === '') return undefined
  const kimiMirroredLines = record['kimiMirroredLines']
  return {
    childSessionId,
    provider,
    parentSessionId,
    cliSessionId,
    ...typeof kimiMirroredLines === 'number' && Number.isFinite(kimiMirroredLines)
      ? { kimiMirroredLines }
      : {},
  }
}

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
    /**
     * Progress for one delegation run. The facade emits `heartbeat` payloads
     * while a facade-tracked run is in flight; providers report the
     * data-bearing kinds through `LocalAgentRegistry.reportRunProgress` and
     * the registry re-emits them here (reports for sessions with no
     * facade-tracked run still emit, so a provider-only run stays
     * observable).
     * @param childSessionId - the dsh child session id of the run.
     * @param progress - the progress payload.
     * @mode emit
     */
    'localAgent/run-progress'(childSessionId: string, progress: LocalAgentRunProgress): void
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
   * One delegation per dsh child session id: the CLI session id a resumed
   * round continues, plus the ownership proof (parent session) and the
   * provider that owns the CLI session.
   */
  private readonly delegations = new Map<string, LocalAgentDelegationRecord>()
  /**
   * Per-(parent session, provider) FIFO of delegation intents. The family
   * resume tool stages exactly one intent per call before awaiting
   * `ctx.subagents.start()`, and the owning provider consumes exactly one per
   * start, so fresh and resume rounds stay paired even under parallel
   * delegations from one parent.
   */
  private readonly delegationIntents = new Map<string, LocalAgentDelegationIntent[]>()
  /**
   * Per-child-session resume locks: a dsh child session may have only one
   * in-flight resume at a time. The provider takes the lock before spawning
   * the resume CLI and releases it when the run settles, so a second resume
   * of the same child fails loud instead of racing the first process.
   */
  private readonly resumeLocks = new Set<string>()
  /**
   * Kimi transcript-line mirror offset per child session, tracked
   * INDEPENDENTLY of the delegation record: the offset must survive even when
   * the CLI session hint is not parsed from stderr (the record — and therefore
   * a resume — needs the hint, but the mirror bookkeeping does not). Without
   * this separation a resume round would fall back to offset 0 and duplicate
   * the first round's messages.
   */
  private readonly kimiMirrorOffsets = new Map<string, number>()
  /**
   * In-flight runs registered with the member channel, by per-run token. The
   * bridge MCP server presents its token (and parent pid) on every callback;
   * entries are invalidated on the run's settle path.
   */
  private readonly memberRuns = new Map<string, LocalAgentMemberRun>()
  /**
   * Facade-tracked in-flight runs by dsh child session id, so
   * {@link LocalAgentRegistry.cancel} can abort a run started through
   * {@link LocalAgentRegistry.start} / {@link LocalAgentRegistry.resume} and
   * the caller's `onProgress` receives the run's reports. Each entry clears
   * itself (and its heartbeat timer) when the run's result settles (any stop
   * reason).
   */
  private readonly runs = new Map<string, {
    controller: AbortController
    run: SubagentRun
    onProgress: ((event: LocalAgentRunProgress) => void) | undefined
    startedAt: number
    heartbeat: ReturnType<typeof setInterval>
  }>()
  /**
   * Detach disposers for child sessions the facade reattached into the live
   * store (see {@link LocalAgentRegistry.resume} step 5). Held for the plugin
   * lifetime — the same lifecycle a provider-created child session has — and
   * released together on plugin dispose.
   */
  private readonly reattachDisposers = new Map<string, () => void>()

  /**
   * @param ctx - context carrying the command registry.
   * @param homesRoot - shared scoped-homes root.
   * @param loginPromptTimeoutMs - device-code prompt wait.
   */
  constructor(
    private readonly ctx: Context,
    private readonly homesRoot: string,
    private readonly loginPromptTimeoutMs: number,
  ) {
    // Reattached child sessions leave the live store, and in-flight run
    // heartbeats stop, when the plugin unloads.
    ctx.effect(() => () => {
      for (const entry of this.runs.values()) clearInterval(entry.heartbeat)
      for (const detach of this.reattachDisposers.values()) detach()
      this.reattachDisposers.clear()
    })
  }

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
    // Restore this harness's persisted delegation mappings before the harness
    // becomes visible: a resume after a host restart resolves them.
    this.loadDelegations(harness)
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
      // Explicit capability flags so surfaces never offer a login/logout
      // action the harness would answer with an error (the dsh harness has
      // neither).
      loginable: harness.login !== undefined,
      logoutable: harness.logout !== undefined,
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

  /**
   * Record one delegation's CLI-session mapping after its first round
   * settles, so a later resume round can continue the same CLI session. The
   * provider learns the CLI session id only from the settled round's output,
   * so recording happens post-settle. A duplicate child session id replaces
   * the earlier record: a resumed child keeps one mapping. The record is also
   * appended to the owning harness's `delegations.jsonl` (last line per child
   * session wins), so a host restart keeps the mapping resolvable.
   * @param record - the delegation's dsh child session id, provider, owning
   *   parent session id, and CLI session id.
   */
  recordDelegation(record: LocalAgentDelegationRecord): void {
    this.delegations.set(record.childSessionId, record)
    this.persistDelegation(record)
  }

  /**
   * Resolve the CLI-session mapping a resume tool call needs to continue a
   * previous delegation. Ownership is proven by the recorded parent session
   * id: a caller naming a child session it did not delegate is rejected
   * instead of resuming someone else's conversation context.
   * @param childSessionId - the dsh child session id from the first round.
   * @param claims - the caller's provider and parent session id.
   * @returns the recorded CLI session id to continue.
   * @throws when the child session is unknown, owned by another parent, or
   *   served by a different provider than claimed.
   */
  resolveDelegation(
    childSessionId: string,
    claims: { readonly provider: string; readonly parentSessionId: string },
  ): { readonly cliSessionId: string } {
    const record = this.delegations.get(childSessionId)
    if (record === undefined) {
      throw new Error(`localAgent: no delegation recorded for child session ${childSessionId}`)
    }
    if (record.parentSessionId !== claims.parentSessionId) {
      throw new Error(
        `localAgent: child session ${childSessionId} belongs to another parent session and cannot be resumed`,
      )
    }
    if (record.provider !== claims.provider) {
      throw new Error(
        `localAgent: child session ${childSessionId} was delegated through ${record.provider}, not ${claims.provider}`,
      )
    }
    return { cliSessionId: record.cliSessionId }
  }

  /**
   * Stage one delegation intent for a provider's next `start()`. The family
   * resume tool stages exactly one intent per call before awaiting
   * `ctx.subagents.start()`; the provider consumes exactly one per start via
   * {@link takeDelegationIntent}, so the per-(parent, provider) FIFO pairs
   * fresh and resume rounds even under parallel delegations from one parent.
   * @param parentSessionId - the delegating parent session id.
   * @param provider - the `ctx.subagents` provider name.
   * @param intent - the fresh or resume intent for the next start.
   */
  stageDelegationIntent(
    parentSessionId: string,
    provider: string,
    intent: LocalAgentDelegationIntent,
  ): void {
    const key = delegationIntentKey(parentSessionId, provider)
    const queue = this.delegationIntents.get(key)
    if (queue === undefined) {
      this.delegationIntents.set(key, [intent])
      return
    }
    queue.push(intent)
  }

  /**
   * Consume the oldest staged intent for one provider start, or `undefined`
   * when the queue is empty (a provider invoked directly without the family
   * tool stages nothing and starts a fresh round).
   * @param parentSessionId - the delegating parent session id.
   * @param provider - the `ctx.subagents` provider name.
   * @returns the oldest staged intent, or undefined when none is staged.
   */
  takeDelegationIntent(
    parentSessionId: string,
    provider: string,
  ): LocalAgentDelegationIntent | undefined {
    const key = delegationIntentKey(parentSessionId, provider)
    const queue = this.delegationIntents.get(key)
    if (queue === undefined || queue.length === 0) return undefined
    const intent = queue.shift()
    if (queue.length === 0) this.delegationIntents.delete(key)
    return intent
  }

  /**
   * Remove one previously staged intent by reference, returning whether it was
   * still queued. The delegation facade calls this when `ctx.subagents.start()`
   * throws: an intent the provider never consumed must not linger in the FIFO,
   * where the NEXT same-(parent, provider) start would misconsume it as its own
   * (orphan-intent crosstalk). When the provider already consumed the intent
   * before throwing, the removal is a no-op and the pairing stays intact.
   * @param parentSessionId - the delegating parent session id.
   * @param provider - the `ctx.subagents` provider name.
   * @param intent - the exact intent object passed to
   *   {@link stageDelegationIntent}.
   * @returns whether the intent was removed (false when already consumed or
   *   never staged).
   */
  unstageDelegationIntent(
    parentSessionId: string,
    provider: string,
    intent: LocalAgentDelegationIntent,
  ): boolean {
    const key = delegationIntentKey(parentSessionId, provider)
    const queue = this.delegationIntents.get(key)
    if (queue === undefined) return false
    const index = queue.indexOf(intent)
    if (index === -1) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.delegationIntents.delete(key)
    return true
  }

  /**
   * Every recorded delegation, in recording order. The invariant companion
   * cross-checks each record's provider against the mounted subagent
   * providers so a provider rename cannot leave a stale resume mapping.
   * @returns the recorded delegations.
   */
  listDelegations(): readonly LocalAgentDelegationRecord[] {
    return [...this.delegations.values()]
  }

  /**
   * Read-only lookup of one delegation by its dsh child session id — the
   * member channel's membership check. Unlike {@link resolveDelegation} this
   * never throws and performs no ownership assertion: the gateway composes it
   * with {@link resume} (whose ownership checks are unchanged) for the
   * human-opened child session, where the record itself is the authorization
   * source.
   * @param childSessionId - the dsh child session id.
   * @returns the record, or undefined when this child was never delegated
   *   through the family.
   */
  getDelegation(childSessionId: string): LocalAgentDelegationRecord | undefined {
    return this.delegations.get(childSessionId)
  }

  /**
   * Acquire the resume lock for one child session. A dsh child session may
   * have only one in-flight resume: the provider takes the lock before
   * spawning the resume CLI and releases it when the run settles, so a second
   * resume of the same child fails loud instead of racing the first process.
   * Fresh delegations never take the lock (they mint a new child session).
   * @param childSessionId - the dsh child session id to resume.
   * @returns whether the lock was acquired (false when already held).
   */
  acquireResumeLock(childSessionId: string): boolean {
    if (this.resumeLocks.has(childSessionId)) return false
    this.resumeLocks.add(childSessionId)
    return true
  }

  /**
   * Release the resume lock for one child session. The provider releases it
   * on every settle path (completed, failed, cancelled) so a deadlock never
   * strands a later resume. Releasing an unheld lock is a no-op.
   * @param childSessionId - the dsh child session id.
   */
  releaseResumeLock(childSessionId: string): void {
    this.resumeLocks.delete(childSessionId)
  }

  /**
   * Read-only probe of the per-child resume lock. The delegation facade uses
   * it to fail fast BEFORE staging an intent; the authoritative mutual
   * exclusion stays with the provider's `acquireResumeLock` inside `start()`.
   * @param childSessionId - the dsh child session id.
   * @returns whether a resume of this child session is currently in flight.
   */
  isResumeLocked(childSessionId: string): boolean {
    return this.resumeLocks.has(childSessionId)
  }

  /**
   * Register one CLI run with the member channel and mint its per-run token.
   * The provider calls this before spawning the CLI (fresh and resume rounds
   * alike) and injects the token into the bridge MCP server's environment; the
   * token is how the host resolves which run — and therefore which member — a
   * bridge callback belongs to, so a member's identity is never self-reported.
   * @param run - the run's member identity (child session, parent, provider).
   * @returns the minted token, invalidated by {@link unregisterMemberRun}.
   */
  registerMemberRun(run: Omit<LocalAgentMemberRun, 'cliPid'>): string {
    const token = randomUUID()
    this.memberRuns.set(token, { ...run })
    return token
  }

  /**
   * Bind the spawned CLI's pid to a registered run. The bridge (the CLI's MCP
   * child) reports its parent pid with every callback; the host cross-checks it
   * against this binding, so a sibling run's bridge entry — visible in a shared
   * scoped home's MCP config — cannot be used to impersonate another member.
   * @param token - the run's member-channel token.
   * @param cliPid - the spawned CLI process pid.
   */
  bindMemberRunPid(token: string, cliPid: number): void {
    const run = this.memberRuns.get(token)
    if (run !== undefined) this.memberRuns.set(token, { ...run, cliPid })
  }

  /**
   * Resolve a member-channel token to its run, or undefined when the token is
   * unknown or already invalidated (the run settled).
   * @param token - the token the bridge presented.
   * @returns the registered run, or undefined.
   */
  resolveMemberRun(token: string): LocalAgentMemberRun | undefined {
    return this.memberRuns.get(token)
  }

  /**
   * Invalidate a run's member-channel token on its settle path (any stop
   * reason). A bridge callback arriving after settle is an unknown token.
   * @param token - the token to invalidate.
   */
  unregisterMemberRun(token: string): void {
    this.memberRuns.delete(token)
  }

  /**
   * The loopback socket path the member-bridge listener owns. Providers inject
   * it into the bridge's environment so the stdio MCP server knows where to
   * call back.
   * @returns the unix socket path under the shared homes root.
   */
  memberBridgeSocketPath(): string {
    return join(this.homesRoot, MEMBER_BRIDGE_SOCKET_FILENAME)
  }

  /**
   * The stdio MCP server entry for the member bridge, for providers to write
   * into their CLI's scoped MCP config. The bridge script ships inside this
   * package and runs under the same Node that runs the host.
   * @returns the command + args declaring the bridge server.
   */
  memberBridgeCommand(): { command: string; args: string[] } {
    return { command: process.execPath, args: [fileURLToPath(new URL('./member-bridge.js', import.meta.url))] }
  }

  /**
   * Start a FRESH delegation on one subagent provider — the programmatic
   * equivalent of the family tool's fresh call, for plugins acting on the
   * user's behalf (room, orchestrators). One call performs the provider
   * pre-check, resolves the live parent agent, stages exactly one
   * `{ kind: 'fresh' }` intent, and starts the provider in the same
   * synchronous flow, so the per-(parent, provider) FIFO pairing holds. When
   * the start throws, the staged intent is rolled back via
   * {@link unstageDelegationIntent} (a no-op once the provider consumed it).
   *
   * The returned run is tracked under its `run.id` (== the new dsh child
   * session id) until `run.result` settles; {@link cancel} aborts it by that
   * id. Note on trust: cordis plugins share one process, so the ownership
   * checks here and in {@link resume} guard against caller MISTAKES, not
   * against a malicious plugin — their real protection target is untrusted
   * model text, which never carries the resume handle (first-class parameter
   * + intent channel only).
   * @param parentSessionId - the delegating parent session id; must have a
   *   live agent (`ctx.agents.get`, a harness hard constraint).
   * @param provider - the `ctx.subagents` provider name.
   * @param prompt - the child user message content blocks.
   * @param options - optional label and caller-owned abort signal.
   * @returns the published subagent run.
   * @throws when the subagents/agents service is not mounted, the provider is
   *   not registered, or the parent session has no live agent — in every case
   *   BEFORE anything is staged.
   */
  async start(
    parentSessionId: string,
    provider: string,
    prompt: ContentBlock[],
    options?: DelegationCallOptions,
  ): Promise<SubagentRun> {
    const subagents = this.requireSubagents()
    this.requireProvider(subagents, provider)
    const parent = this.requireLiveParent(parentSessionId)
    const intent: LocalAgentDelegationIntent = { kind: 'fresh' }
    this.stageDelegationIntent(parentSessionId, provider, intent)
    const controller = new AbortController()
    let run: SubagentRun
    try {
      run = await subagents.start(provider, {
        prompt,
        parent,
        signal: fusedSignal(controller, options?.signal),
        ...options?.label === undefined ? {} : { label: options.label },
      })
    } catch (error: unknown) {
      this.unstageDelegationIntent(parentSessionId, provider, intent)
      throw error
    }
    this.trackRun(run.id, controller, run, options?.onProgress)
    return run
  }

  /**
   * Resume a recorded delegation: continue the SAME CLI session inside the
   * SAME dsh child session. One call performs, in order:
   *
   * 1. provider pre-check (`ctx.subagents.getProvider`) — fails loud WITHOUT
   *    staging, so an unknown provider never leaves an orphan intent;
   * 2. `resolveDelegation` ownership check (unchanged semantics): the handle
   *    must name a delegation THIS parent session recorded through THIS
   *    provider;
   * 3. read-only resume-lock probe ({@link isResumeLocked}) — fails fast
   *    without staging; the provider still takes the authoritative lock inside
   *    its `start()`;
   * 4. live parent agent resolution (`ctx.agents.get`) — a harness hard
   *    constraint, since `ctx.subagents.start` requires a live parent;
   * 5. child-session REATTACH when `ctx.sessions.get(childSessionId)` is
   *    undefined (recipe below; `opts.reattach === false` disables this step
   *    and fails loud on a non-live child instead);
   * 6. stage `{ kind: 'resume', childSessionId, cliSessionId }` and, in the
   *    same synchronous flow, `await ctx.subagents.start(provider, …)`;
   * 7. on start failure, roll the intent back via
   *    {@link unstageDelegationIntent} (no-op once consumed);
   * 8. on success, track the run under `childSessionId` for {@link cancel}
   *    until `run.result` settles.
   *
   * **Reattach recipe** (callers replicating this flow — e.g. room — copy
   * exactly this sequence):
   *
   * ```ts
   * const prep = await ctx.sessionPersistence.prepare(SessionId(childSessionId))
   * try {
   *   const detach = ctx.sessions.enter(prep.session)
   *   await ctx.sessions.flush(prep.session)  // binds the coordinator (consumes the reservation)
   * } finally {
   *   prep[Symbol.dispose]()
   * }
   * ```
   *
   * Hold `detach` for the plugin lifetime. The publication is ENTER-ONLY,
   * deliberately WITHOUT `ctx.sessions.announce()`: `enter` installs the
   * append-publication hooks and the store entry — everything the provider's
   * liveness probe (`sessions.get`) and the transcript mirror's `session/event`
   * broadcast need — while `announce` only emits `session/created`, whose
   * semantics are NEW-session creation. A persisted child already fired
   * `session/created` in its original lifetime (fresh delegations publish
   * through `sessions.create()`), and re-firing would re-trigger creation
   * listeners (apiproxy projections, per-session setup invariants) for a
   * session being RESTORED, not created. The official agent resume
   * (`agentLoop.resume` → publish) announces because it publishes a brand-new
   * live agent+session pair for this process lifetime; a CLI provider's child
   * is a pure transcript container with no agent on it, so only `enter`
   * applies.
   * @param parentSessionId - the delegating parent session id; must match the
   *   recorded one and have a live agent.
   * @param provider - the `ctx.subagents` provider that owns the CLI session.
   * @param childSessionId - the dsh child session id from the first round (the
   *   resume handle).
   * @param prompt - the follow-up user message content blocks.
   * @param options - optional label and caller-owned abort signal.
   * @returns the published subagent run.
   * @throws on unknown provider, unknown/foreign-parent/wrong-provider handle,
   *   an in-flight resume of the same child, or a missing live parent agent —
   *   all BEFORE anything is staged.
   */
  async resume(
    parentSessionId: string,
    provider: string,
    childSessionId: string,
    prompt: ContentBlock[],
    options?: DelegationCallOptions,
  ): Promise<SubagentRun> {
    const subagents = this.requireSubagents()
    this.requireProvider(subagents, provider)
    const { cliSessionId } = this.resolveDelegation(childSessionId, { provider, parentSessionId })
    if (this.isResumeLocked(childSessionId)) {
      throw new Error(`localAgent: child session ${childSessionId} already has an in-flight resume`)
    }
    const parent = this.requireLiveParent(parentSessionId)
    if (options?.reattach === false) {
      // Explicit opt-out: the pre-facade behavior — fail loud on a child that
      // is not live instead of restoring it from persistence.
      if (this.ctx.get('sessions')?.get(SessionId(childSessionId)) === undefined) {
        throw new Error(`localAgent: child session ${childSessionId} is not live and reattach is disabled`)
      }
    } else {
      await this.reattachChildSession(childSessionId)
    }
    const intent: LocalAgentDelegationIntent = { kind: 'resume', childSessionId, cliSessionId }
    this.stageDelegationIntent(parentSessionId, provider, intent)
    const controller = new AbortController()
    let run: SubagentRun
    try {
      run = await subagents.start(provider, {
        prompt,
        parent,
        signal: fusedSignal(controller, options?.signal),
        ...options?.label === undefined ? {} : { label: options.label },
      })
    } catch (error: unknown) {
      this.unstageDelegationIntent(parentSessionId, provider, intent)
      throw error
    }
    this.trackRun(childSessionId, controller, run, options?.onProgress)
    return run
  }

  /**
   * Cancel an in-flight facade-started run by its dsh child session id: aborts
   * the internal controller whose (fused) signal was passed to
   * `ctx.subagents.start`, which is the canonical cancellation channel for a
   * one-shot run. The provider settles the run with an `aborted`-class stop
   * reason. A caller holding the `SubagentRun` may also `run.dispose()`.
   * @param childSessionId - the dsh child session id of the run to cancel.
   * @returns whether an in-flight run was found and signalled (false on a
   *   miss — never a silent success, never a throw).
   */
  cancel(childSessionId: string): boolean {
    const entry = this.runs.get(childSessionId)
    if (entry === undefined) return false
    entry.controller.abort()
    return true
  }

  /**
   * Read the kimi transcript lines already mirrored into one child session,
   * so a resumed round mirrors only its delta instead of duplicating earlier
   * messages. Absent means the first round has not mirrored yet. Reads the
   * dedicated offset map (never gated on a delegation record).
   * @param childSessionId - the dsh child session id.
   * @returns the mirrored transcript-line count, or undefined.
   */
  kimiMirroredLines(childSessionId: string): number | undefined {
    return this.kimiMirrorOffsets.get(childSessionId)
  }

  /**
   * Advance the kimi transcript-line mirror offset for one child session.
   * The kimi provider calls this after every mirror (fresh or resumed) with
   * the new total transcript-line count. Writes the dedicated offset map so
   * the offset survives even without a delegation record; the record's own
   * field is mirrored for completeness.
   * @param childSessionId - the dsh child session id.
   * @param lines - the total transcript lines mirrored so far.
   */
  setKimiMirroredLines(childSessionId: string, lines: number): void {
    this.kimiMirrorOffsets.set(childSessionId, lines)
    const record = this.delegations.get(childSessionId)
    if (record !== undefined) {
      const updated = { ...record, kimiMirroredLines: lines }
      this.delegations.set(childSessionId, updated)
      // Keep the persisted record's offset current so a post-restart resume
      // mirrors only its delta instead of re-mirroring earlier rounds.
      this.persistDelegation(updated)
    }
  }

  /** Resolve the subagents service or fail loud naming the missing service. */
  private requireSubagents(): SubagentRuntime {
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined) {
      throw new Error('localAgent: delegation requires the subagents service, which is not mounted (install a subagent provider plugin)')
    }
    return subagents
  }

  /** Fail loud on an unknown provider BEFORE any intent is staged. */
  private requireProvider(subagents: SubagentRuntime, provider: string): void {
    if (subagents.getProvider(provider) === undefined) {
      throw new Error(`localAgent: subagent provider ${JSON.stringify(provider)} is not registered`)
    }
  }

  /** Resolve the live parent Agent or fail loud (harness hard constraint). */
  private requireLiveParent(parentSessionId: string): Agent {
    const agents = this.ctx.get('agents')
    if (agents === undefined) {
      throw new Error('localAgent: delegation requires the agents service, which is not mounted')
    }
    const parent = agents.get(SessionId(parentSessionId))
    if (parent === undefined) {
      throw new Error(`localAgent: parent session ${parentSessionId} has no live agent; delegation requires a live parent agent`)
    }
    return parent
  }

  /**
   * Restore a persisted child session into the live store when it is absent —
   * the reattach recipe documented on {@link resume}. Enter-only on purpose;
   * the detach disposer is held in {@link reattachDisposers} until plugin
   * dispose.
   */
  private async reattachChildSession(childSessionId: string): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) {
      throw new Error('localAgent: delegation requires the sessions service, which is not mounted')
    }
    if (sessions.get(SessionId(childSessionId)) !== undefined) return
    if (this.reattachDisposers.has(childSessionId)) return
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new Error(`localAgent: child session ${childSessionId} is not live and the sessionPersistence service is not mounted to reattach it`)
    }
    const preparation = await persistence.prepare(SessionId(childSessionId))
    try {
      this.reattachDisposers.set(childSessionId, sessions.enter(preparation.session))
      // The publication is ENTER-ONLY (no announce — see resume's doc
      // comment), so the persistence coordinator never hears session/created
      // for the restored child; and preparation disposal would release its
      // reservation as a REUSABLE ready entry, making every later coordinator
      // contact (session/event buffering, flush) throw "persisted state
      // already owns this identity" — the reattached child silently never
      // persisted again. Flush immediately instead: the coordinator's initFor
      // consumes the reservation (attachPrepared), after which the release
      // below is a no-op.
      await sessions.flush(preparation.session)
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  /**
   * Track one facade-started run under its child session id for
   * {@link cancel} and progress routing; the entry (and its heartbeat timer)
   * clears itself when the run's result settles (any stop reason, resolved or
   * rejected). While tracked, the facade emits a `heartbeat` progress every
   * {@link RUN_PROGRESS_HEARTBEAT_MS}; the timer is unref'd so it never keeps
   * the process alive.
   */
  private trackRun(
    childSessionId: string,
    controller: AbortController,
    run: SubagentRun,
    onProgress: ((event: LocalAgentRunProgress) => void) | undefined,
  ): void {
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      this.reportRunProgress(childSessionId, { kind: 'heartbeat', elapsedMs: Date.now() - startedAt })
    }, RUN_PROGRESS_HEARTBEAT_MS)
    heartbeat.unref()
    this.runs.set(childSessionId, { controller, run, onProgress, startedAt, heartbeat })
    const clear = (): void => {
      const entry = this.runs.get(childSessionId)
      if (entry?.run !== run) return
      clearInterval(entry.heartbeat)
      this.runs.delete(childSessionId)
    }
    void run.result.then(clear, clear)
  }

  /**
   * The provider-facing progress reporting channel: a provider reports a
   * run's data-bearing progress (mirror counts now, live deltas with M3), and
   * the registry forwards it — as the `localAgent/run-progress` cordis event,
   * and to the `onProgress` callback when the child session has a
   * facade-tracked run. Reports for untracked child sessions still emit the
   * event (a provider-only run must stay observable) and invoke no callback.
   * The facade's own heartbeat rides the same path.
   * @param childSessionId - the dsh child session id of the running delegation.
   * @param progress - the progress payload.
   */
  reportRunProgress(childSessionId: string, progress: LocalAgentRunProgress): void {
    this.ctx.emit('localAgent/run-progress', childSessionId, progress)
    this.runs.get(childSessionId)?.onProgress?.(progress)
  }

  /**
   * Resolve one harness or fail loud. */
  private requireHarness(name: string): LocalAgentHarness {
    const harness = this.harnesses.get(name)
    if (harness === undefined) throw new Error(`localAgent: unknown harness ${name}`)
    return harness
  }

  /**
   * Append one delegation record to the owning harness's `delegations.jsonl`.
   * Durability is synchronous (recording happens once per fresh-round settle)
   * and best-effort: a provider with no claiming harness or a filesystem
   * failure keeps the in-memory record and warns — recording must never break
   * a settling run.
   */
  private persistDelegation(record: LocalAgentDelegationRecord): void {
    const harness = [...this.harnesses.values()]
      .find(candidate => candidate.delegationProvider === record.provider)
    if (harness === undefined) {
      this.ctx.logger.warn(
        `localAgent: no registered harness claims provider ${JSON.stringify(record.provider)}; the delegation for child session ${record.childSessionId} stays in memory only`,
      )
      return
    }
    try {
      appendFileSync(join(this.homeDir(harness.name), DELEGATIONS_FILENAME), `${JSON.stringify(record)}\n`)
    } catch (error: unknown) {
      this.ctx.logger.warn(`localAgent: failed to persist the delegation for child session ${record.childSessionId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Load one harness's persisted delegation mappings into the in-memory maps.
   * Runs synchronously inside {@link register} before `localAgent/harness-added`
   * fires. Malformed or foreign-provider lines skip with a warn; the last line
   * per child session wins (matching {@link recordDelegation}'s replace
   * semantics), and a record's `kimiMirroredLines` restores the mirror offset.
   */
  private loadDelegations(harness: LocalAgentHarness): void {
    let text: string
    try {
      text = readFileSync(join(this.homeDir(harness.name), DELEGATIONS_FILENAME), 'utf8')
    } catch {
      // No mappings persisted yet.
      return
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const record = parseDelegationLine(line, harness.delegationProvider)
      if (record === undefined) {
        this.ctx.logger.warn(`localAgent: skipping a malformed or foreign line in ${harness.name}/${DELEGATIONS_FILENAME}`)
        continue
      }
      this.delegations.set(record.childSessionId, record)
      if (record.kimiMirroredLines !== undefined) {
        this.kimiMirrorOffsets.set(record.childSessionId, record.kimiMirroredLines)
      }
    }
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
   * genuinely authorizing. A harness without a login flow answers with an
   * error instead of spawning anything.
   * @param harness - the harness whose login command runs.
   * @returns the device-code prompt as the command success text.
   */
  private login(harness: LocalAgentHarness): Promise<CommandResult> {
    const login = harness.login
    if (login === undefined) {
      return Promise.resolve({
        kind: 'error',
        text: `${harness.name} has no device-code login; it authenticates through the host instance's credentials.`,
      })
    }
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
    const resultPromise = this.runLogin(harness, login, controller)
    // The settle signal is the real one only after runLogin populated it;
    // chaining earlier would clear the guard on the placeholder promise.
    void controller.done.then(() => {
      if (this.logins.get(harness.name) === controller) this.logins.delete(harness.name)
    })
    return resultPromise
  }

  /** Spawn the harness login command and capture its device-code prompt. */
  private runLogin(
    harness: LocalAgentHarness,
    login: NonNullable<LocalAgentHarness['login']>,
    controller: LoginController,
  ): Promise<CommandResult> {
    const child = spawn(login.command, [...login.args], {
      env: { ...process.env, [harness.homeEnvVar]: this.homeDir(harness.name) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    controller.child = child
    controller.done = new Promise<void>((resolve) => {
      child.on('exit', () => { resolve() })
      child.on('error', () => { resolve() })
    })
    const capture = login.capture ?? 'stderr'
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
      // 'close', not 'exit': exit can fire before the captured stream's
      // final data events are delivered, and a fast print-and-exit CLI would
      // then be misreported as prompt-less. close guarantees stdio drained.
      child.on('close', () => {
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
  // The member channel's loopback listener (bridge MCP servers call back here).
  // Degrade, don't explode: a failed bind leaves member_message failing with a
  // tool error while everything else works.
  const memberChannel = new MemberChannel(ctx, registry, registry.memberBridgeSocketPath())
  void memberChannel.start()
  ctx.effect(() => () => { void memberChannel.dispose() })
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
