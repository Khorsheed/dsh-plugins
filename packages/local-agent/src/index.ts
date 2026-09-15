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
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {
  DelegationCallOptions,
  LocalAgentCredentialState,
  LocalAgentDelegationInfo,
  LocalAgentDelegationIntent,
  LocalAgentDelegationRecord,
  LocalAgentEffectiveSettings,
  LocalAgentMemberRun,
  LocalAgentModelBroker,
  LocalAgentRosterRow,
  LocalAgentRunProgress,
  LocalAgentSessionRecord,
  LocalAgentStatus,
  LocalAgentToolCalls,
} from './types.ts'
import LocalAgentGateway from './gateway.ts'
import { MemberChannel } from './member-channel.ts'

/** Stable Cordis plugin name. */
export const name = 'local-agent'

/** Services required before the registry and commands can mount. */
export const inject = ['commands']

export type {
  ContainerExecLaunch,
} from './container.ts'

export type {
  DelegationCallOptions,
  LocalAgentCredentialState,
  DelegationExecTarget,
  LocalAgentDelegationInfo,
  LocalAgentDelegationIntent,
  LocalAgentDelegationRecord,
  LocalAgentDelegationView,
  LocalAgentEffectiveSettings,
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

export { delegationEnv } from './env.ts'
export { containerExecSpawn, containerScopedHome } from './container.ts'

export {
  CLI_VERSION_FAILURE_TTL_MS,
  CLI_VERSION_PROBE_TIMEOUT_MS,
  clearCliVersionCache,
  parseCliVersion,
  probeCliVersion,
} from './cli-version.ts'
export type { CliVersionProbe } from './cli-version.ts'

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
 * Append the parent-side `subagent/catalog` discovery row for a freshly
 * established session-backed child. The official SubagentRuntime writes this
 * row only for IN-PROCESS children (`run.localAgent.session`, harness
 * `SubagentRuntime.start`); a family provider's run is remote, so the
 * provider appends the row itself, right where the child's
 * `subagent/descriptor` lands — exactly once per child session, since resume
 * rounds never create a session.
 *
 * The payload mirrors the upstream `establishCatalogChild` helper
 * (harness packages/subagent catalog.ts) byte-for-byte. It is inlined
 * because that helper is unreachable through the package's exports map on
 * the npm release line: only `./src/*` would resolve it, and published
 * artifacts ship no `src/`. The `subagent/catalog` event type itself rides
 * the official package's SessionEventMap augmentation, so this append stays
 * type-checked against the host's own schema. A throw is the caller's to
 * degrade (warn and continue) — a missing catalog row never blocks the
 * delegation itself.
 * @param parent - the durable direct parent session receiving the row.
 * @param child - the established child's immutable session header.
 * @param label - the same composed label the child's descriptor carries.
 */
export function establishSubagentCatalogChild(
  parent: Session,
  child: SessionHeader,
  label: string | undefined,
): void {
  parent.append('subagent/catalog', {
    version: 0,
    childId: child.id,
    childCreatedAt: child.createdAt,
    mode: 'one-shot',
    ...label === undefined ? {} : { label },
  })
}

/**
 * Persist a delegated child session's events, the family providers' one entry
 * point after every mirror pass. Two paths:
 *
 * - **live session + a core with {@link LocalAgentRegistry.syncChildSession}**
 *   (the production wiring): delegate to the registry, which syncs through
 *   its cached per-child write handle — the same handle the reattach recipe
 *   holds, so live write routing and the explicit suffix sync share one
 *   owner and never collide on SessionAlreadyOwnedError. The registry
 *   downgrades a sync failure to a warn, so this path never throws.
 * - **anything else** (standalone tests, ad-hoc mirrors, a core predating
 *   syncChildSession): a one-shot handle flow — claim the write handle
 *   (creating the stored session on first persist), append only the unstored
 *   suffix (re-appending the full snapshot violates the contiguous-seq
 *   contract), flush, close. There is deliberately NO live-session skip:
 *   reading the stored prefix first makes the suffix append idempotent, so
 *   on a host line whose write-behind does store live appends the suffix is
 *   simply empty — while on host 0.1.5, where a mirror session without an
 *   agent loop never checkpoints, this flow is what lands the events at all.
 *
 * @param ctx - host context carrying the sessions/localAgent/sessionPersistence services.
 * @param childSession - the dsh child session the provider mirrored into.
 */
export async function persistChildSession(ctx: Context, childSession: Session): Promise<void> {
  const sessions = ctx.get('sessions')
  if (sessions !== undefined && sessions.get(childSession.id) !== undefined) {
    const registry = ctx.get('localAgent') as unknown as { syncChildSession?: (session: Session) => Promise<void> } | undefined
    if (registry?.syncChildSession !== undefined) {
      await registry.syncChildSession(childSession)
      return
    }
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return
  const existing = await persistence.stat(childSession.id)
  const handle = existing === undefined
    ? await persistence.create(childSession.header)
    : await persistence.open(childSession.id, 'write')
  try {
    const stored = await handle.read(0)
    const suffix = childSession.snapshotEvents().slice(stored.events.length)
    if (suffix.length > 0) await handle.append(suffix)
    await handle.flush()
  } finally {
    await handle.close()
  }
}

/**
 * A harness's login flow. Two variants:
 *
 * - **device-code**: spawn the CLI's login command and capture its printed
 *   prompt (the URL/code) for the reply while the CLI polls in the background.
 * - **manual handoff**: the CLI's auth is TTY-only, so nothing is spawnable —
 *   `/login` replies with instructions naming the command for the user's own
 *   terminal, and the registry watches the scoped home for the credential.
 */
export type LocalAgentLogin =
  | {
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
  | {
    manual: {
      /** The exact command line the user runs in their own terminal. */
      commandDisplay: string
    }
    /**
     * Credential probe polled while the handoff is in flight; defaults to the
     * harness's own `isAuthenticated`.
     */
    watch?: (homeDir: string) => Promise<boolean>
  }
  | {
    /**
     * The CLI's auth needs a TTY but drives the browser itself (claude ≥2.1):
     * the command is spawned under a pseudo-terminal wrapper so it opens the
     * user's browser, and its output is watched for an OAuth URL to show as a
     * fallback. When the CLI prompts for a code, the user pastes it via
     * `/<name> code <value>`, which the registry writes to the child's stdin.
     */
    pty: {
      command: string
      /**
       * The argv, or a factory that receives the scoped home being logged
       * in. The factory form exists because one harness pins its scoped home
       * ON the argv (claude's `env CLAUDE_CONFIG_DIR=… claude auth login`, an
       * assignment that outranks the spawn env): with a fixed array a
       * `--scope` login would authorize the DEFAULT directory while claiming
       * to authorize the scope. The plain array stays the form every other
       * harness uses.
       */
      args: readonly string[] | ((homeDir: string) => readonly string[])
    }
    /**
     * Credential probe polled while the login is in flight; defaults to the
     * harness's own `isAuthenticated`.
     */
    watch?: (homeDir: string) => Promise<boolean>
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
   * Login flow declaration. The device-code variant spawns the CLI and
   * captures its printed prompt. The manual variant spawns NOTHING: the CLI's
   * auth is TTY-only (claude ≥2.1 prints no OAuth URL off a TTY and
   * `setup-token` needs Ink raw mode — scraping broke twice), so `/login`
   * replies with instructions naming `manual.commandDisplay` for the user's
   * own terminal, then watches for the credential to land. Absent means the
   * harness has no login flow — it authenticates through the host instance
   * (e.g. by resolving a credential from the parent's store), so `/login`
   * reports that instead of guessing a command.
   */
  login?: LocalAgentLogin
  /** Session records reader for this harness's format. */
  records: LocalAgentRecordsAdapter
  /**
   * Bring one scoped home of this harness to the state its CLI needs before a
   * login or a round can use it (codex's `config.toml` storage pin, kimi's
   * provider/model config and permission rules, claude's `settings.json`,
   * dsh's sub-profile). Called by the registry when a NAMED scope's directory
   * is materialized — the default scope is provisioned by the harness bundle's
   * own `apply`, exactly as it always was, so nothing about it moves.
   * Best-effort: a failure is logged and the directory still exists (the
   * status surface then reports what is actually there).
   * @param homeDir - the scoped home to provision.
   */
  provision?: (homeDir: string) => Promise<void> | void
  /**
   * Whether the scoped home currently holds usable credentials. Absent means
   * the harness reports "not authenticated" and the status command still
   * runs; the check is per-harness (a credentials directory, an auth file).
   */
  isAuthenticated?: (homeDir: string) => Promise<boolean>
  /**
   * The credential marker's modification stamp (epoch ms), undefined when no
   * credential exists. Two consumers: the manual-login watch requires a stamp
   * NEWER than the watch start (a stale marker must not read as a fresh
   * login), and `statusOf` downgrades a presence-true probe when a delegation
   * reported an auth failure newer than the stamp (presence cannot see a
   * server-side revocation; the next real login rewrites the marker and
   * recovers the status).
   */
  credentialStamp?: (homeDir: string) => Promise<number | undefined>
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
  /**
   * The harness's fairness-relevant effective settings — the read side of an
   * evaluation condition hash (the web-eval frozen baseline: every factor
   * must be hashable). The registry's {@link LocalAgentRegistry.effectiveSettings}
   * resolves it, and both status surfaces (the `/<name> status` reply and the
   * `LocalAgentStatus` Remote) attach it. The snapshot is a LIVE read — it
   * reflects what the harness would use right now, including scoped-config
   * values a person edited. Pure JSON, never credentials; see
   * {@link LocalAgentEffectiveSettings} for the field vocabulary and the
   * absence-is-a-knob-absent rule.
   *
   * The snapshot is taken of ONE scoped home, named by the parameter: a
   * harness reads its config out of the directory it is handed, so a named
   * scope reports the settings that scope's rounds would run with rather than
   * the default scope's.
   * @param homeDir - the scoped home to read; the registry passes the
   *   directory of the scope being asked about.
   */
  effectiveSettings?: (homeDir: string) => LocalAgentEffectiveSettings | Promise<LocalAgentEffectiveSettings>
  /**
   * The harness's model knob: the settings card reads the memberless surface
   * ("what would a round run with"), the member composer reads and switches a
   * member's session-level override. Absent means the harness exposes no
   * model surface beyond its free-text settings field — the gateway answers
   * null and both UIs keep their pre-broker behavior.
   */
  modelBroker?: LocalAgentModelBroker
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

/**
 * Strip ANSI escape sequences (colors, OSC-8 hyperlinks) from captured CLI
 * output. Login prompts are scraped from terminal-targeted output, and a
 * trailing `ESC[0m` glued onto an OAuth URL corrupts the link the user opens
 * (a real 3080 incident: codex's device URL ended in `%1B[0m` and the page
 * reported the session ended).
 */
const ANSI_ESCAPE = /\[[0-9;?]*[A-Za-z]|\]8;;[^\ ]*\\/g

/** Remove terminal escape sequences from scraped CLI text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

/**
 * The characters a named scope may use. A scope is a NAME, never a path: the
 * scoped home it selects always lands directly under the shared homes root,
 * so `..`, a slash, or a leading dash can never walk out of it.
 */
export const SCOPE_NAME_RE = /^[a-z0-9-]+$/

/**
 * The directory NAME of one harness's scoped home under the homes root: the
 * harness name for the default scope, `<name>@<scope>` for a named one. The
 * named directory is a SIBLING of the default one, never a child: nesting it
 * inside would put a second CLI state tree under a directory each harness's
 * own CLI owns and prunes.
 * @param name - the harness name.
 * @param scope - the named scope, or undefined for the default one.
 * @returns the directory name under the homes root.
 * @throws when the scope is present but not a `[a-z0-9-]` name.
 */
export function scopedHomeName(name: string, scope?: string): string {
  if (scope === undefined) return name
  if (!SCOPE_NAME_RE.test(scope)) {
    throw new Error(
      `localAgent: ${JSON.stringify(scope)} is not a usable scope name — a scope is a name matching [a-z0-9-], never a path`,
    )
  }
  return `${name}@${scope}`
}

/**
 * Enforce the resume-scope consistency rule, the scoped-home twin of
 * {@link assertResumeCwdUnchanged}: a CLI session continues in the scoped home
 * its earlier rounds ran in, so a round naming a different scope — including
 * naming none when the first round named one, and the reverse — is rejected
 * instead of resuming the conversation against another account's credentials
 * and another directory's session records. Records written before the `scope`
 * field existed carry no scope and are default-scope records; a resume of one
 * with a scope is exactly the mismatch this refuses.
 * @param record - the delegation's persisted record, when one exists.
 * @param scope - the round's scope, or undefined for the default one.
 * @param provider - the provider name, for the error message.
 * @throws when the record's scope differs from the round's.
 */
export function assertResumeScopeUnchanged(
  record: LocalAgentDelegationRecord | undefined,
  scope: string | undefined,
  provider: string,
): void {
  if (record === undefined) return
  if (record.scope === scope) return
  throw new Error(
    `${provider}: resume scope ${scope === undefined ? '(default)' : scope} differs from the first round's `
    + `${record.scope === undefined ? '(default)' : record.scope}; a CLI session continues in the scoped home its `
    + 'earlier rounds ran in — repeat the first round\'s scope',
  )
}

/**
 * Refuse a round that names its own model and would be served by a live
 * driver — the model twin of {@link assertScopeExecOnly}, and refused for the
 * same reason. A resident runtime (codex's `app-server`, claude's and kimi's
 * ACP servers, the sub-dsh `serve`) binds its model when the PROCESS starts
 * and then serves many rounds of one member, so a per-delegation model would
 * either be ignored or would silently change what every other round of that
 * runtime runs. Refused rather than quietly downgraded to exec: the caller
 * named a model, and a fallback would answer a different question than the
 * one asked. The evaluation pins `drive: exec` anyway (web-eval frozen
 * decision 2).
 * @param model - the round's requested model, or undefined for none.
 * @param provider - the provider name, for the error message.
 * @throws when a named model meets an active live driver.
 */
export function assertModelExecOnly(model: string | undefined, provider: string): void {
  if (model === undefined) return
  throw new Error(
    `${provider}: a delegation that names model ${model} is exec-only — a resident runtime binds its model at spawn `
    + 'and serves many rounds; turn the live driver off for this delegation, or drop the model',
  )
}

/**
 * The model one round starts its CLI with, resolved in the family's fixed
 * order: the DELEGATION's own model (the `model` call option on the fresh
 * round, re-requested by every resume round from the record) first, then the
 * harness's `model` plugin-config key, then nothing — which leaves the scoped
 * configuration file and, last, the CLI's own default to decide exactly as
 * they did before either key existed.
 *
 * Blank is not a model: a whitespace-only value at either layer reads as
 * unset, so an empty settings field cannot produce an empty flag value.
 * @param requested - the delegation's own model, when it named one.
 * @param configured - the plugin config's per-round resolver, when the plugin
 *   passed one.
 * @returns `{ model }` when either layer names one, `{}` otherwise — the
 *   fragment a provider spreads into its run spec, so an absent model leaves
 *   the spawn argv byte-identical to the shape that shipped before.
 */
export function resolveRoundModel(
  requested: string | undefined,
  configured?: () => string | undefined,
): { model?: string } {
  const own = requested?.trim()
  if (own !== undefined && own !== '') return { model: own }
  const fallback = configured?.()?.trim()
  return fallback === undefined || fallback === '' ? {} : { model: fallback }
}

/**
 * Refuse a scoped round that would be served by a live driver. The resident
 * runtimes (codex's `app-server`, claude's and kimi's ACP servers, the
 * sub-dsh `serve`) are started per member against the DEFAULT scoped home and
 * outlive a single round, so a scoped round taken by one would run under the
 * wrong credentials and write its records into the wrong directory. Refused
 * rather than silently downgraded to exec: the caller named a scope, and a
 * quiet fallback would answer a different question than the one asked. The
 * evaluation pins `drive: exec` anyway (web-eval frozen decision 2).
 * @param scope - the round's scope, or undefined for the default one.
 * @param provider - the provider name, for the error message.
 * @throws when a named scope meets an active live driver.
 */
export function assertScopeExecOnly(scope: string | undefined, provider: string): void {
  if (scope === undefined) return
  throw new Error(
    `${provider}: a delegation in scope ${scope} is exec-only — the live driver binds the harness's default scoped home; `
    + 'turn the live driver off for this round, or drop the scope',
  )
}

/** Poll interval for a manual-handoff login watch. */
export const MANUAL_LOGIN_POLL_MS = 2_000

/** How long a manual-handoff login watches before reporting the timeout. */
export const MANUAL_LOGIN_LIMIT_MS = 5 * 60_000

/** Heartbeat interval for facade-tracked in-flight runs. */
export const RUN_PROGRESS_HEARTBEAT_MS = 5_000

/**
 * How long after a run's result settles the facade still routes progress to
 * that call's `onProgress`.
 *
 * A round's settle OBSERVATION (its observed model, CLI version, and token
 * usage) is only knowable once the CLI process has exited and its whole
 * output stream has been parsed — which, on every exec-drive provider, is
 * strictly after `run.result` resolves (a cancelled run settles at the cancel
 * moment, before the process is even reaped). Clearing the tracked run at
 * result-settle therefore dropped exactly the one report the caller asked for:
 * the `settled` payload reached the cordis event and nothing else. The entry's
 * cancel lever and heartbeat still stop at result-settle — only the progress
 * route is held open, and it closes the moment the `settled` report arrives.
 */
export const RUN_PROGRESS_SETTLE_GRACE_MS = 60_000

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
  const observedModel = record['observedModel']
  const cliVersion = record['cliVersion']
  const cwd = record['cwd']
  const scope = record['scope']
  const model = record['model']
  return {
    childSessionId,
    provider,
    parentSessionId,
    cliSessionId,
    ...typeof kimiMirroredLines === 'number' && Number.isFinite(kimiMirroredLines)
      ? { kimiMirroredLines }
      : {},
    // Optional observations: records written before the fields existed (and
    // lines that never observed them) load unchanged — absence stays absence.
    ...typeof observedModel === 'string' && observedModel !== '' ? { observedModel } : {},
    ...typeof cliVersion === 'string' && cliVersion !== '' ? { cliVersion } : {},
    ...typeof cwd === 'string' && cwd !== '' ? { cwd } : {},
    // The scoped home the delegation belongs to. A line without one is a
    // DEFAULT-scope record — which is what every line written before the
    // field existed is, and what the fallback below preserves when a named
    // scope's own file carries an older line.
    ...typeof scope === 'string' && scope !== '' ? { scope } : {},
    // The model the delegation requested. A line without one is a delegation
    // that named none — which every line written before the field existed is.
    ...typeof model === 'string' && model !== '' ? { model } : {},
  }
}

/**
 * Resolve the working directory one CLI delegation round runs in: the caller's
 * override when supplied (the {@link DelegationCallOptions.cwd} position —
 * an orchestrator giving each evaluation cell its own directory), otherwise
 * the parent session's cwd. Returns `undefined` when neither is present — the
 * caller fails loud on that, exactly as it did before overrides existed.
 * Named after the seam the official ACP provider uses for the same override;
 * the future container-workdir layer (web-eval I3) lands here too.
 * @param parentCwd - the parent session's cwd, when the session has one.
 * @param override - the caller-supplied cwd, when one was passed.
 * @returns the effective cwd, or undefined when neither source has one.
 */
export function resolveChildCwd(
  parentCwd: string | undefined,
  override: string | undefined,
): string | undefined {
  if (override !== undefined && override !== '') return override
  return parentCwd
}

/**
 * Enforce the resume-cwd consistency rule: a CLI session continues in the
 * directory its earlier rounds ran in, so a round whose effective cwd differs
 * from the recorded first-round cwd is rejected instead of resuming the
 * conversation somewhere else. Records written before the `cwd` field existed
 * carry no anchor and opt out — absence is the honest state, never a guess.
 * @param record - the delegation's persisted record, when one exists.
 * @param effectiveCwd - the round's resolved working directory.
 * @param provider - the provider name, for the error message.
 * @throws when the record anchors a different first-round cwd.
 */
export function assertResumeCwdUnchanged(
  record: LocalAgentDelegationRecord | undefined,
  effectiveCwd: string,
  provider: string,
): void {
  if (record?.cwd === undefined) return
  if (record.cwd !== effectiveCwd) {
    throw new Error(
      `${provider}: resume cwd ${effectiveCwd} differs from the first round's ${record.cwd}; `
      + `a CLI session continues in the directory its earlier rounds ran in — repeat the first round's cwd`,
    )
  }
}

export const Config: z<Config> = z.object({
  homesRoot: z.string().required(),
  loginPromptTimeoutMs: z.number().default(10_000),
})

/** Service name provided by this plugin and injected by patch rows. */
export const LOCAL_AGENT_SERVICE = 'localAgent'

/** One bounded login attempt: the polling child plus its settle signal. */
/** One bounded login attempt: the polling child or manual watch, plus its settle signal. */
interface LoginController {
  /** The device-code variant's CLI child; absent for a manual-handoff watch. */
  child?: ChildProcess
  /** The pty variant's terminal; written to when the CLI prompts for a code. */
  terminal?: SubprocessTerminalHandle
  done: Promise<void>
  /** Cancel a manual-handoff watch (the device variant cancels by killing its child). */
  stop?: () => void
  /**
   * The pty variant: the CLI runs on a real pseudo-terminal (it auto-opens
   * the browser itself) and may prompt for an OAuth code on stdin.
   * `writeCode` delivers the user's pasted code; `awaitingCode` tells the
   * settings surface to render the paste box.
   */
  awaitingCode?: boolean
  writeCode?: (code: string) => void
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

/** Render one effective-settings snapshot as `key: value` status lines. */
function renderEffectiveSettings(settings: LocalAgentEffectiveSettings): string[] {
  return [
    `drive: ${settings.drive}`,
    ...settings.sandbox !== undefined ? [`sandbox: ${settings.sandbox}`] : [],
    ...settings.permissionMode !== undefined ? [`permissionMode: ${settings.permissionMode}`] : [],
    ...settings.autoApprove !== undefined ? [`autoApprove: ${settings.autoApprove ? 'yes' : 'no'}`] : [],
    ...settings.reasoningEffort !== undefined ? [`reasoningEffort: ${settings.reasoningEffort}`] : [],
    settings.baseUrlSet
      ? `baseUrl: set${settings.baseUrlHost !== undefined ? ` (${settings.baseUrlHost})` : ''}`
      : 'baseUrl: default',
    ...settings.cliVersion !== undefined ? [`cliVersion: ${settings.cliVersion}`] : [],
  ]
}

/** Render the status reply: one `key: value` line per fact. */
function renderStatus(status: LocalAgentStatus): string {
  return [
    `harness: ${status.name}`,
    `authenticated: ${status.authenticated ? 'yes' : 'no'}`,
    `credentialState: ${status.credentialState}`,
    ...status.scope !== undefined ? [`scope: ${status.scope}`] : [],
    `homeDir: ${status.homeDir}`,
    ...status.delegationProvider !== undefined ? [`provider: ${status.delegationProvider}`] : [],
    ...status.effectiveSettings !== undefined ? renderEffectiveSettings(status.effectiveSettings) : [],
  ].join('\n')
}

/**
 * Split one `/<harness>` input into its optional `--scope <name>` flag and the
 * remaining subcommand. Both spellings a person reaches for are accepted
 * (`--scope eval-b` and `--scope=eval-b`); everything else is left in place,
 * so an input without the flag comes back exactly as it went in.
 * @param input - the trimmed subcommand input.
 * @returns the remaining input and the scope, or the error naming the rule.
 */
export function parseScopeFlag(input: string): { input: string; scope?: string; error?: string } {
  if (!input.includes('--scope')) return { input }
  const tokens = input.split(/\s+/)
  const rest: string[] = []
  let scope: string | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (token === '--scope') {
      const value = tokens[index + 1]
      if (value === undefined || value.startsWith('--')) {
        return { input, error: 'usage: --scope <name>, where the name matches [a-z0-9-] (a scope is a name, never a path)' }
      }
      scope = value
      index += 1
      continue
    }
    if (token.startsWith('--scope=')) {
      scope = token.slice('--scope='.length)
      continue
    }
    rest.push(token)
  }
  if (scope !== undefined && !SCOPE_NAME_RE.test(scope)) {
    return { input, error: `${JSON.stringify(scope)} is not a usable scope name — a scope is a name matching [a-z0-9-], never a path` }
  }
  return { input: rest.join(' ').trim(), ...scope === undefined ? {} : { scope } }
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
  /**
   * Named scopes materialized in this host process, keyed exactly like their
   * directory (`<name>@<scope>`) — the guard that keeps the mkdir, the
   * harness provisioning and the per-directory delegation load to once each.
   */
  private readonly scopedHomes = new Set<string>()
  private readonly commandDisposers = new Map<string, () => void>()
  private readonly logins = new Map<string, LoginController>()
  /**
   * One delegation per dsh child session id: the CLI session id a resumed
   * round continues, plus the ownership proof (parent session) and the
   * provider that owns the CLI session.
   */
  private readonly delegations = new Map<string, LocalAgentDelegationRecord>()
  /**
   * Observation recency for {@link latestObservedModel}: a monotonically
   * increasing stamp per child session, bumped every time a record carrying an
   * `observedModel` lands in {@link delegations} (recordDelegation,
   * recordRoundSettled's merge, and the boot-time `delegations.jsonl` load —
   * file order stamps the load, so the log's own last-line-wins semantics carry
   * over). In-memory only: the records themselves deliberately carry no
   * timestamp, and the Map's insertion order cannot serve (a `set` on an
   * existing key keeps its first position, so an old record re-observed by a
   * fresh round would sort as old).
   */
  private readonly observedModelStamps = new Map<string, number>()
  /** The stamp counter for {@link observedModelStamps}. */
  private observedModelClock = 0
  /**
   * A settled round's observation that arrived BEFORE the delegation record
   * existed ({@link recordRoundSettled} has nothing to merge into yet), held
   * until {@link recordDelegation} lands and consumed there. A settle and the
   * first-round record are ordered on every provider path today, but the
   * record point is the provider's (a live round records at session/new, an
   * exec round at the settle-time output parse), so the channel tolerates the
   * inversion instead of dropping the observation. In-memory only and never
   * persisted on its own: an observation whose record never arrives stays
   * unrecorded, exactly as before.
   */
  private readonly pendingRoundObservations = new Map<string, { observedModel?: string; cliVersion?: string }>()
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
   * Delegation-reported auth failures per harness (epoch ms of the report).
   * Presence probes cannot see a server-side revocation, so a provider
   * observing a 401/403 reports it here and `statusOf` downgrades the harness
   * until its credential marker is rewritten by a real re-login (stamp newer
   * than the mark).
   */
  private readonly authFailures = new Map<string, number>()
  /**
   * Delegation-reported auth SUCCESSES per harness (epoch ms of the report):
   * a round that reached the CLI's endpoint and completed, which is the only
   * evidence a host has that a present credential is actually live. Cleared
   * when a login starts or a logout lands, because both change which account
   * the scoped home holds — a verification of the previous credential says
   * nothing about the next one. Per host process on purpose: after a restart
   * a present credential is `present-unverified` until a round exercises it,
   * which is exactly what is known.
   */
  private readonly authSuccesses = new Map<string, number>()
  /**
   * In-flight runs registered with the member channel, by per-run token. The
   * bridge MCP server presents its token (and parent pid) on every callback;
   * entries are invalidated on the run's settle path.
   */
  private readonly memberRuns = new Map<string, LocalAgentMemberRun>()
  /**
   * The ACTIVE DELEGATION REGISTRY — in-flight local-agent runs by dsh child
   * session id, the key the `/local-agent stop <childSessionId>` command and
   * {@link LocalAgentRegistry.cancel} look up. Two registration kinds share
   * the map:
   *
   * - **facade-tracked** ({@link trackRun}): runs started through
   *   {@link LocalAgentRegistry.start} / {@link LocalAgentRegistry.resume},
   *   carrying the fused AbortController whose signal reached
   *   `ctx.subagents.start`; cancel aborts it.
   * - **tool-registered** ({@link trackDelegationRun}): runs the family tool
   *   starts directly through `ctx.subagents.start`, carrying an explicit
   *   cancel lever (its fused controller); cancel calls it.
   *
   * Every entry clears itself when the run's result settles (any stop
   * reason), and facade entries also stop their heartbeat timer then.
   */
  private readonly runs = new Map<string, {
    /** Facade-owned controller (start/resume); aborting it cancels the run. */
    controller?: AbortController
    /** Caller-supplied cancel lever for tool-registered (non-facade) runs. */
    cancel?: () => void
    run: SubagentRun
    onProgress: ((event: LocalAgentRunProgress) => void) | undefined
    startedAt: number
    heartbeat?: ReturnType<typeof setInterval>
  }>()
  /**
   * Progress routes held open past their run's result-settle, by child session
   * id — see {@link RUN_PROGRESS_SETTLE_GRACE_MS}. An entry carries only the
   * call's `onProgress` (never a cancel lever: a settled run is not
   * cancellable) and self-destructs on the `settled` report or the grace
   * timer, whichever comes first.
   */
  private readonly settledRuns = new Map<string, {
    onProgress: (event: LocalAgentRunProgress) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  /**
   * Detach disposers for child sessions the facade reattached into the live
   * store (see {@link LocalAgentRegistry.resume} step 5). Held for the plugin
   * lifetime — the same lifecycle a provider-created child session has — and
   * released together on plugin dispose. The reattach's WRITE handle is NOT
   * here: it lives in {@link childWriteHandles}, shared with
   * {@link syncChildSession}, and closes with the cache on dispose.
   */
  private readonly reattachDisposers = new Map<string, () => void>()
  /**
   * The registry-owned WRITE handle per child session id (a resolved-value
   * cache: the PROMISE is stored so concurrent acquirers share one open).
   * Host 0.1.5 routes a live session's `session/event` appends into the
   * per-id writer only while a write handle is open, so exactly one handle
   * must exist per child — a second open fails SessionAlreadyOwnedError.
   * Both owners of a child session's durability share this cache: the
   * reattach recipe ({@link reattachChildSession}) and the explicit suffix
   * sync ({@link syncChildSession}). Every handle closes on plugin dispose.
   */
  private readonly childWriteHandles = new Map<string, Promise<SessionHandle>>()

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
    // Reattached child sessions leave the live store, in-flight run
    // heartbeats stop, and every cached child-session write handle closes,
    // when the plugin unloads.
    ctx.effect(() => () => {
      for (const entry of this.runs.values()) {
        if (entry.heartbeat !== undefined) clearInterval(entry.heartbeat)
      }
      for (const entry of this.settledRuns.values()) clearTimeout(entry.timer)
      this.settledRuns.clear()
      for (const detach of this.reattachDisposers.values()) detach()
      this.reattachDisposers.clear()
      for (const [childSessionId, cached] of this.childWriteHandles) {
        this.childWriteHandles.delete(childSessionId)
        void cached.then(handle => handle.close()).catch((error: unknown) => {
          this.ctx.logger.warn(`localAgent: closing the child session ${childSessionId} write handle failed: ${String(error)}`)
        })
      }
    })
  }

  /**
   * Absolute scoped home for one harness, in the default scope or in a NAMED
   * one.
   *
   * The default scope (`scope` absent) is `<homesRoot>/<name>` and is a pure
   * path computation, exactly as it always was. A named scope is the sibling
   * directory `<homesRoot>/<name>@<scope>` — a name, never a path, so the
   * directory can only ever be under the homes root — and is MATERIALIZED the
   * first time it is named here: `mkdir` 0700 plus this harness's own
   * provisioning, plus the load of that directory's own `delegations.jsonl`,
   * once per (harness, scope) in this host process. Materializing on the read
   * is what makes "a scope exists once something names it" true for every
   * caller at once: `/<name> login --scope`, the status surfaces, a scoped
   * delegation, and the evaluation's mount source.
   *
   * Credentials are never copied between scopes: a new named scope starts
   * empty, reports `credentialState: absent`, and needs its own login.
   * @param name - the harness name.
   * @param scope - the named scope, or undefined for the default one.
   * @returns `<homesRoot>/<name>`, or `<homesRoot>/<name>@<scope>`.
   * @throws when the scope is present but not a `[a-z0-9-]` name.
   */
  homeDir(name: string, scope?: string): string {
    const dir = join(this.homesRoot, scopedHomeName(name, scope))
    if (scope !== undefined) this.materializeScopedHome(name, scope, dir)
    return dir
  }

  /**
   * Create one named scope's directory the first time it is named, with the
   * same 0700 the default scope's gets, then run the harness's own
   * provisioning and load that directory's persisted delegation mappings.
   * Runs at most once per (harness, scope) per host process; the mkdir itself
   * is idempotent, so a directory a person created by hand is adopted rather
   * than refused. An unregistered harness gets the directory and nothing
   * else — there is no harness to ask for provisioning yet.
   */
  private materializeScopedHome(name: string, scope: string, dir: string): void {
    const key = scopedHomeName(name, scope)
    if (this.scopedHomes.has(key)) return
    this.scopedHomes.add(key)
    try {
      mkdirSync(dir, { recursive: true })
      chmodSync(dir, 0o700)
    } catch (error: unknown) {
      this.scopedHomes.delete(key)
      throw error
    }
    const harness = this.harnesses.get(name)
    if (harness === undefined) return
    this.loadDelegations(harness, scope)
    // Provisioning is async and best-effort, exactly as it is in every
    // harness bundle's own apply: the directory exists either way, and a
    // failure is a log line rather than a broken command reply.
    void (async () => harness.provision?.(dir))().catch((error: unknown) => {
      this.ctx.logger.warn(
        `localAgent: ${name} provisioning of scope ${scope} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
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
   * Resolve the harness that claims one delegation provider — the inverse of
   * {@link LocalAgentHarness.delegationProvider}, for surfaces handed a
   * provider name (a delegation record's) that need the owning harness's
   * knobs (its model broker).
   * @param provider - the `ctx.subagents` provider name.
   * @returns the claiming harness, or undefined when none claims it.
   */
  harnessForProvider(provider: string): LocalAgentHarness | undefined {
    return [...this.harnesses.values()]
      .find(candidate => candidate.delegationProvider === provider)
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
   * Record a delegation-observed authentication failure (a 401/403 from the
   * CLI's endpoint). Presence probes cannot see a server-side revocation, so
   * this mark downgrades the harness's reported status until a real re-login
   * rewrites the credential marker (see {@link LocalAgentHarness.credentialStamp}).
   * @param name - the harness whose credential failed.
   * @param detail - the endpoint's answer, for the log.
   * @param scope - the scope whose credential failed; absent means the
   *   default scope. Each scope holds its own account, so the mark is per
   *   scope: one scope's revocation says nothing about another's.
   */
  reportAuthFailure(name: string, detail: string, scope?: string): void {
    this.authFailures.set(scopedHomeName(name, scope), Date.now())
    this.ctx.logger.warn(
      `localAgent: ${name} credential rejected by its endpoint (${detail}); the harness reports unauthenticated until a fresh login rewrites the credential marker`,
    )
  }

  /**
   * Record a delegation-observed authentication SUCCESS: a round reached the
   * harness CLI's endpoint and completed, so the scoped credential is known
   * live and the status grades it `verified` instead of `present-unverified`.
   * The counterpart of {@link reportAuthFailure}; providers wire both from the
   * same settle path. A success newer than a failure mark also clears the
   * `rejected` grade — a completed round outranks a stale rejection.
   * @param name - the harness whose credential just worked.
   * @param scope - the scope whose credential just worked; absent means the
   *   default scope.
   */
  reportAuthSuccess(name: string, scope?: string): void {
    this.authSuccesses.set(scopedHomeName(name, scope), Date.now())
  }

  /**
   * Forget what delegation rounds observed about one harness's credential.
   * Called where the account itself can change — a login starting, a logout
   * landing — because a verdict about the previous credential describes
   * nothing about the next one.
   */
  private forgetCredentialObservations(name: string, scope?: string): void {
    const key = scopedHomeName(name, scope)
    this.authSuccesses.delete(key)
    this.authFailures.delete(key)
  }

  /**
   * Query one harness's auth status, in the default scope or in a named one.
   * @param name - the harness name.
   * @param scope - the named scope to report on; absent means the default
   *   scope and the reply is exactly what it always was. A named scope is
   *   materialized by the read (see {@link homeDir}), so a scope nobody has
   *   logged into reports `credentialState: absent` against a real, empty
   *   directory.
   * @returns the status snapshot.
   */
  async statusOf(name: string, scope?: string): Promise<LocalAgentStatus> {
    const harness = this.requireHarness(name)
    const homeDir = this.homeDir(name, scope)
    const credentialState = await this.credentialStateOf(harness, homeDir, scope)
    // The boolean is exactly the two grades that mean "there is a credential
    // worth trying", so every surface written before the grade existed keeps
    // reading what it always read.
    const authenticated = credentialState === 'verified' || credentialState === 'present-unverified'
    // Degrade, don't explode: the snapshot reads scoped-config files, and a
    // read failure must not break the status surface — the field drops out
    // and the failure is logged instead.
    let effectiveSettings: LocalAgentEffectiveSettings | undefined
    try {
      effectiveSettings = await harness.effectiveSettings?.(homeDir)
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `localAgent: ${name} effective-settings snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return {
      name: harness.name,
      displayName: harness.displayName,
      authenticated,
      credentialState,
      homeDir,
      ...scope === undefined ? {} : { scope },
      // Explicit capability flags so surfaces never offer a login/logout
      // action the harness would answer with an error (the dsh harness has
      // neither).
      loginable: harness.login !== undefined,
      logoutable: harness.logout !== undefined,
      ...this.logins.get(scopedHomeName(name, scope))?.awaitingCode === true ? { loginAwaitingCode: true } : {},
      ...harness.delegationProvider !== undefined ? { delegationProvider: harness.delegationProvider } : {},
      ...effectiveSettings !== undefined ? { effectiveSettings } : {},
    }
  }

  /**
   * Grade one harness's credential from the two channels a status read has:
   * the scoped home's own shape ({@link LocalAgentHarness.isAuthenticated})
   * and what delegation rounds reported. Presence alone can only ever say
   * `present-unverified` — an expired, unrefreshable record has exactly the
   * shape of a working one, and saying so is this grade's whole point.
   * @param harness - the harness to grade.
   * @param homeDir - its scoped home.
   * @param scope - the scope that directory belongs to; the delegation-
   *   reported observations are per scope, because each scope holds its own
   *   account.
   * @returns the credential grade.
   */
  private async credentialStateOf(
    harness: LocalAgentHarness,
    homeDir: string,
    scope?: string,
  ): Promise<LocalAgentCredentialState> {
    const present = await (harness.isAuthenticated?.(homeDir) ?? Promise.resolve(false))
    if (!present) return 'absent'
    const key = scopedHomeName(harness.name, scope)
    const failedAt = this.authFailures.get(key)
    const verifiedAt = this.authSuccesses.get(key)
    // A completed round outranks a stale rejection: the endpoint answered.
    if (verifiedAt !== undefined && (failedAt === undefined || verifiedAt > failedAt)) return 'verified'
    if (failedAt !== undefined && harness.credentialStamp !== undefined) {
      // A delegation reported an auth failure (e.g. a server-side revocation
      // the presence probe cannot see). Stay rejected until the credential
      // marker is rewritten by a real re-login. A harness without a stamp has
      // no recovery signal at all, so its mark cannot pin the grade down.
      const stamp = await harness.credentialStamp(homeDir).catch(() => undefined)
      return stamp !== undefined && stamp > failedAt ? 'present-unverified' : 'rejected'
    }
    return 'present-unverified'
  }

  /**
   * One harness's fairness-relevant effective settings — the evaluation
   * condition hash's read side (web-eval frozen decisions 2 to 4: drive,
   * approval boundary, reasoning effort, endpoint route). Read-only: the
   * snapshot reflects the settings in force right now, whatever layer set
   * them (plugin config, scoped-home config a person edited, process env).
   * Pure JSON and credential-free by contract; see
   * {@link LocalAgentEffectiveSettings}.
   * @param name - the harness name.
   * @param scope - the scope to snapshot; absent means the default one.
   * @returns the snapshot, or undefined when the harness declares none.
   */
  async effectiveSettings(name: string, scope?: string): Promise<LocalAgentEffectiveSettings | undefined> {
    const harness = this.requireHarness(name)
    return harness.effectiveSettings?.(this.homeDir(name, scope))
  }

  /**
   * Query one harness's scoped session records.
   * @param name - the harness name.
   * @param scope - the scope to list; absent means the default one. Session
   *   records belong to the directory the rounds ran in, so a named scope
   *   lists its own and nothing of the default scope's.
   * @returns the session records in the harness's own order.
   */
  sessionsOf(name: string, scope?: string): Promise<readonly LocalAgentSessionRecord[]> {
    return this.requireHarness(name).records.listSessions(this.homeDir(name, scope))
  }

  /**
   * Record one delegation's CLI-session mapping after its first round
   * settles, so a later resume round can continue the same CLI session. The
   * provider learns the CLI session id only from the settled round's output,
   * so recording happens post-settle. A duplicate child session id replaces
   * the earlier record: a resumed child keeps one mapping. The record is also
   * appended to the owning harness's `delegations.jsonl` (last line per child
   * session wins), so a host restart keeps the mapping resolvable. A settled
   * round's observation that arrived before this record (the provider's
   * record point is its own) is merged in from the pending stash — see
   * {@link recordRoundSettled}.
   * @param record - the delegation's dsh child session id, provider, owning
   *   parent session id, and CLI session id.
   */
  recordDelegation(record: LocalAgentDelegationRecord): void {
    // A settle that beat the record (see pendingRoundObservations) fills only
    // the fields the record itself does not carry — the record's own values
    // win.
    const pending = this.pendingRoundObservations.get(record.childSessionId)
    this.pendingRoundObservations.delete(record.childSessionId)
    const merged = pending === undefined ? record : {
      ...record,
      ...record.observedModel === undefined && pending.observedModel !== undefined
        ? { observedModel: pending.observedModel }
        : {},
      ...record.cliVersion === undefined && pending.cliVersion !== undefined
        ? { cliVersion: pending.cliVersion }
        : {},
    }
    this.delegations.set(record.childSessionId, merged)
    this.noteObservedModel(merged)
    this.persistDelegation(merged)
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
   * Read-only lookup of one delegation's facts by its dsh child session id,
   * WITHOUT the CLI-session resume handle — the orchestrator-facing read side
   * (the evaluation reads a cell's recorded `observedModel` and first-round
   * `cwd` through it). Same never-throws contract as
   * {@link getDelegation}; the record's optional fields stay absent when the
   * stream never yielded them.
   * @param childSessionId - the dsh child session id.
   * @returns the record without `cliSessionId`, or undefined when this child
   *   was never delegated through the family.
   */
  delegationOf(childSessionId: string): LocalAgentDelegationInfo | undefined {
    const record = this.delegations.get(childSessionId)
    if (record === undefined) return undefined
    const { cliSessionId: _resumeHandle, ...info } = record
    return info
  }

  /**
   * Stamp a record's `observedModel` with the next recency tick, when the
   * record carries a usable one. Called everywhere a record with an observed
   * model lands in {@link delegations}; a blank value is no observation.
   */
  private noteObservedModel(record: LocalAgentDelegationRecord): void {
    if (record.observedModel === undefined || record.observedModel.trim() === '') return
    this.observedModelClock += 1
    this.observedModelStamps.set(record.childSessionId, this.observedModelClock)
  }

  /**
   * The most recent model one provider was OBSERVED running across all its
   * recorded delegations — the display hint behind the cli-builtin layer
   * (nothing names the CLI's compiled default, but "what ran last" is what a
   * round with no model layer would run again). Recency is the observation
   * stamp ({@link observedModelStamps}), not record insertion order: a round
   * that re-observes an old delegation counts as the freshest. Records whose
   * stream never yielded a model (absent or blank) are not candidates.
   * @param provider - the `ctx.subagents` provider name to scan.
   * @returns the newest observed model identifier, or undefined when this
   *   provider was never observed running one.
   */
  latestObservedModel(provider: string): string | undefined {
    let newest: { stamp: number; model: string } | undefined
    for (const record of this.delegations.values()) {
      if (record.provider !== provider) continue
      const model = record.observedModel?.trim()
      if (model === undefined || model === '') continue
      const stamp = this.observedModelStamps.get(record.childSessionId) ?? 0
      if (newest === undefined || stamp >= newest.stamp) newest = { stamp, model }
    }
    return newest?.model
  }

  /**
   * Record one delegation round's settled observation: merge `observedModel`
   * into the delegation record when present (in memory and `delegations.jsonl`,
   * same replace semantics as {@link recordDelegation}) and report the
   * `settled` run-progress event with the round's observed model and usage.
   * Providers call it once per settled round, at the point their output
   * stream has been fully parsed; fields the stream did not yield stay absent
   * — absence is recorded, never guessed. A record that does not exist yet
   * (the round's settle beat the provider's record point — e.g. a round whose
   * CLI session id only parses post-settle) does not lose the observation: it
   * is stashed and merged by the later {@link recordDelegation}; the event
   * still reports either way.
   * @param childSessionId - the dsh child session id of the settled round.
   * @param round - the round's observed model, version, usage and tool-call
   *   accounting, each optional.
   */
  recordRoundSettled(
    childSessionId: string,
    round: {
      readonly observedModel?: string
      readonly cliVersion?: string
      readonly usage?: TokenUsage
      readonly toolCalls?: LocalAgentToolCalls
    },
  ): void {
    if (round.observedModel !== undefined || round.cliVersion !== undefined) {
      const record = this.delegations.get(childSessionId)
      if (record !== undefined) {
        const updated = {
          ...record,
          ...round.observedModel === undefined ? {} : { observedModel: round.observedModel },
          ...round.cliVersion === undefined ? {} : { cliVersion: round.cliVersion },
        }
        this.delegations.set(childSessionId, updated)
        this.noteObservedModel(updated)
        this.persistDelegation(updated)
      } else {
        const pending = this.pendingRoundObservations.get(childSessionId) ?? {}
        this.pendingRoundObservations.set(childSessionId, {
          ...(round.observedModel ?? pending.observedModel) === undefined
            ? {}
            : { observedModel: (round.observedModel ?? pending.observedModel) as string },
          ...(round.cliVersion ?? pending.cliVersion) === undefined
            ? {}
            : { cliVersion: (round.cliVersion ?? pending.cliVersion) as string },
        })
      }
    }
    // `toolCalls` rides the EVENT only, never the record: the record carries a
    // delegation's latest state (its model, its build), while a tool-call
    // count belongs to one round and merging it would silently overwrite the
    // previous round's count with the newest one.
    this.reportRunProgress(childSessionId, {
      kind: 'settled',
      ...round.observedModel === undefined ? {} : { observedModel: round.observedModel },
      ...round.cliVersion === undefined ? {} : { cliVersion: round.cliVersion },
      ...round.usage === undefined ? {} : { usage: round.usage },
      ...round.toolCalls === undefined ? {} : { toolCalls: round.toolCalls },
    })
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
  registerMemberRun(run: LocalAgentMemberRun): string {
    const token = randomUUID()
    this.memberRuns.set(token, { ...run })
    return token
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
    // The cwd override rides the staged intent, not the host seam (the
    // SubagentStartRequest contract has no cwd field and must not grow one):
    // the provider consumes it as the resolveChildCwd override.
    const intent: LocalAgentDelegationIntent = {
      kind: 'fresh',
      ...options?.cwd === undefined ? {} : { cwd: options.cwd },
      // The container exec target rides the same channel for the same
      // reason: it is a family-private start fact, and the host
      // SubagentStartRequest contract has no place for it.
      ...options?.exec === undefined ? {} : { exec: options.exec },
      // The scoped home this round runs against, for the same reason again.
      // The provider resolves `homeDir(<harness>, scope)` from it and records
      // the scope, so the resume of this delegation must repeat it.
      ...options?.scope === undefined ? {} : { scope: options.scope },
      // The model this DELEGATION runs. The provider passes it to the CLI and
      // records it, so a resume round re-requests the same value without the
      // caller restating it (and without being able to change it).
      ...options?.model === undefined ? {} : { model: options.model },
    }
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
   * const handle = await ctx.sessionPersistence.open(SessionId(childSessionId), 'write')
   * try {
   *   const cold = await handle.read(0)
   *   const session = ctx.sessions.prepare(SessionId(childSessionId), {
   *     seed: [...cold.events],
   *     meta: structuredClone(handle.header),
   *     inheritedEventCount: handle.inheritedEventCount,
   *     eventState: cold.eventState,
   *   })
   *   // The seeded constructor's session/end-seed marker lands before enter()
   *   // installs publication hooks — push the unstored suffix through the
   *   // handle directly, or the writer's contiguous cursor diverges.
   *   const unstored = session.snapshotEvents().slice(cold.events.length)
   *   if (unstored.length > 0) await handle.append(unstored)
   *   const detach = ctx.sessions.enter(session)
   *   // Hold BOTH for the reattached lifetime: the backend routes live
   *   // session/event appends into the per-id writer only while the write
   *   // handle is open; closing it ends persistence for the session.
   * } catch (error) {
   *   await handle.close().catch(() => {})
   *   throw error
   * }
   * ```
   *
   * Hold `detach` and `handle` for the plugin lifetime. The publication is
   * ENTER-ONLY, deliberately WITHOUT `ctx.sessions.announce()`: `enter`
   * installs the append-publication hooks and the store entry — everything the
   * provider's liveness probe (`sessions.get`) and the transcript mirror's
   * `session/event` broadcast need — while `announce` only emits
   * `session/created`, whose semantics are NEW-session creation. A persisted
   * child already fired `session/created` in its original lifetime (fresh
   * delegations publish through `sessions.create()`), and re-firing would
   * re-trigger creation listeners (apiproxy projections, per-session setup
   * invariants) for a session being RESTORED, not created. The official agent
   * resume (`agentLoop.resume` → publish) announces because it publishes a
   * brand-new live agent+session pair for this process lifetime; a CLI
   * provider's child is a pure transcript container with no agent on it, so
   * only `enter` applies.
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
    // The scoped home is anchored by the record: a resume naming another
    // scope (or none, when the first round named one) would continue the CLI
    // session against a different account's credentials. Checked here so the
    // facade fails before staging; the provider repeats the check at the same
    // point it checks the cwd anchor.
    assertResumeScopeUnchanged(this.delegations.get(childSessionId), options?.scope, 'localAgent')
    // A model belongs to the delegation, not to one of its rounds: the first
    // round recorded what it requested and this round re-requests exactly
    // that. Naming one here would switch a live conversation's model mid-way
    // — which the CLI would honour and the transcript would not show — so it
    // is a caller error, not a silently ignored field.
    if (options?.model !== undefined) {
      throw new Error(
        `localAgent: resume does not take a model — child session ${childSessionId} re-requests the model its first `
        + 'round recorded; start a new delegation to run another model',
      )
    }
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
    // The cwd override rides the staged intent (see start): the provider
    // compares the round's effective cwd against the recorded first-round one
    // and fails loud on a mismatch.
    const intent: LocalAgentDelegationIntent = {
      kind: 'resume',
      childSessionId,
      cliSessionId,
      ...options?.cwd === undefined ? {} : { cwd: options.cwd },
      // Repeat of the first round's target: the caller owns the pairing (the
      // recorded anchor is the host cwd, which a container swap leaves equal).
      ...options?.exec === undefined ? {} : { exec: options.exec },
      // Repeat of the first round's scope — and unlike the container target,
      // this one IS anchored: the record carries the scope and the provider
      // refuses a round that names another one (or none).
      ...options?.scope === undefined ? {} : { scope: options.scope },
    }
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
    if (entry.controller !== undefined) {
      entry.controller.abort()
    } else {
      // Tool-registered run: the caller-supplied cancel lever (its fused
      // controller), the same abort channel the facade entry aborts.
      entry.cancel?.()
    }
    return true
  }

  /**
   * Register a NON-facade in-flight delegation run with the active-delegation
   * registry, keyed by the dsh child session id, so the `/local-agent stop`
   * command and {@link cancel} can reach it. This is the family TOOL's entry
   * point: the tool starts its runs through `ctx.subagents.start` directly
   * (not the facade), so without this registration its in-flight runs would
   * be invisible to the stop command. The caller owns the cancel lever — a
   * controller fused with the run's request signal, aborted exactly like the
   * facade's tracked controller. The entry clears itself when the run's
   * result settles (any stop reason); an existing facade entry for the same
   * child session wins (it already owns cancellation and progress).
   * @param childSessionId - the dsh child session id (the run id).
   * @param run - the published subagent run.
   * @param cancel - the lever that aborts the run's request signal.
   */
  trackDelegationRun(childSessionId: string, run: SubagentRun, cancel: () => void): void {
    if (this.runs.has(childSessionId)) return
    this.runs.set(childSessionId, {
      cancel,
      run,
      onProgress: undefined,
      startedAt: Date.now(),
    })
    const clear = (): void => {
      const entry = this.runs.get(childSessionId)
      if (entry?.run !== run) return
      this.runs.delete(childSessionId)
    }
    void run.result.then(clear, clear)
  }

  /**
   * Whether the active-delegation registry holds an in-flight run for the
   * child session — the registry's read side for the `/local-agent stop`
   * command's miss report (the command cancels through {@link cancel}).
   * @param childSessionId - the dsh child session id.
   * @returns whether a run is currently in flight under that id.
   */
  isDelegationActive(childSessionId: string): boolean {
    return this.runs.has(childSessionId)
  }

  /**
   * The child session ids with an in-flight delegation run — the gateway's
   * `activeDelegations` Remote exposes this to the browser so surfaces can
   * mark one-shot rows as running.
   * @returns the in-flight child session ids.
   */
  activeDelegations(): readonly string[] {
    return [...this.runs.keys()]
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
   * Ensure a delegated child session is live in this process, reattaching it
   * from persistence when it is not — a host restart evicts every child from
   * the live store. This is the public entry of the facade resume's reattach
   * recipe for callers that start resume rounds WITHOUT the facade (the
   * family subagent tool starts runs directly through `ctx.subagents.start`;
   * without this call the provider refuses the resume as "not live").
   * Idempotent; a child that was never persisted fails through the
   * persistence layer's own not-found error.
   * @param childSessionId - the dsh child session id (the resume handle).
   */
  async ensureChildLive(childSessionId: string): Promise<void> {
    await this.reattachChildSession(childSessionId)
  }

  /**
   * Restore a persisted child session into the live store when it is absent —
   * the reattach recipe documented on {@link resume}. Enter-only on purpose;
   * the detach disposer is held in {@link reattachDisposers} until plugin
   * dispose, and the write handle comes from the shared
   * {@link childWriteHandles} cache so a later {@link syncChildSession}
   * reuses it instead of failing SessionAlreadyOwnedError on a second open.
   */
  private async reattachChildSession(childSessionId: string): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) {
      throw new Error('localAgent: delegation requires the sessions service, which is not mounted')
    }
    if (sessions.get(SessionId(childSessionId)) !== undefined) return
    if (this.reattachDisposers.has(childSessionId)) return
    if (this.ctx.get('sessionPersistence') === undefined) {
      throw new Error(`localAgent: child session ${childSessionId} is not live and the sessionPersistence service is not mounted to reattach it`)
    }
    // Host 0.1.5 handle-based persistence: the backend routes live
    // session/event appends into the per-id writer only while a WRITE handle
    // is open, so the reattach claims the write handle first and the cache
    // holds it for the child's lifetime (closed on dispose).
    const handle = await this.acquireChildWriteHandle(childSessionId)
    try {
      const cold = await handle.read(0)
      const session = sessions.prepare(SessionId(childSessionId), {
        seed: [...cold.events],
        meta: structuredClone(handle.header),
        inheritedEventCount: handle.inheritedEventCount,
        eventState: cold.eventState,
      })
      // The seeded constructor appends its `session/end-seed` marker BEFORE
      // enter() installs the publication hooks, so live routing never sees it
      // — push the unstored suffix through the handle directly (the agent
      // loop's resume does the same via appendUnstoredSuffix), or the writer's
      // contiguous cursor and the session log diverge.
      const unstored = session.snapshotEvents().slice(cold.events.length)
      if (unstored.length > 0) await handle.append(unstored)
      const detach = sessions.enter(session)
      this.reattachDisposers.set(childSessionId, () => {
        detach()
      })
    } catch (error) {
      // A failed reattach keeps no ownership: the cached handle would hold
      // write ownership of a session that never went live.
      await this.releaseChildWriteHandle(childSessionId)
      throw error
    }
  }

  /**
   * Sync a live delegated child session's events into durable storage through
   * the registry-cached write handle, creating the stored session on first
   * sync. The host's live write-behind routes `session/event` appends into
   * the per-id writer only while a write handle is open AND a checkpoint
   * drains it — a delegated mirror session has no agent loop, so nothing ever
   * checkpoints it and production child logs stayed header-only. This explicit
   * suffix sync is the mirror's durability path: read the stored prefix,
   * append only what is missing (idempotent under repetition and under a
   * working write-behind), then flush. A failure downgrades to a warn and the
   * handle stays cached for the next sync — a persistence hiccup must never
   * fail the delegation round.
   * @param session - the live child session to sync.
   */
  async syncChildSession(session: Session): Promise<void> {
    try {
      const handle = await this.acquireChildWriteHandle(String(session.id), session.header)
      const stored = await handle.read(0)
      const suffix = session.snapshotEvents().slice(stored.events.length)
      if (suffix.length > 0) await handle.append(suffix)
      await handle.flush()
    } catch (error: unknown) {
      this.ctx.logger.warn(`localAgent: syncing child session ${String(session.id)} to persistence failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get or open the child session's registry-owned WRITE handle (the
   * {@link childWriteHandles} cache). When the caller carries the session
   * header (a sync), a missing stored session is created from it; a create
   * that loses a stat/create race adopts the winner's stored session. A
   * failed acquisition is evicted so the next call retries from scratch.
   */
  private acquireChildWriteHandle(childSessionId: string, header?: SessionHeader): Promise<SessionHandle> {
    const cached = this.childWriteHandles.get(childSessionId)
    if (cached !== undefined) return cached
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new Error('localAgent: the sessionPersistence service is not mounted')
    }
    const id = SessionId(childSessionId)
    const acquired = (async (): Promise<SessionHandle> => {
      if (header !== undefined && (await persistence.stat(id)) === undefined) {
        try {
          return await persistence.create(header)
        } catch (error: unknown) {
          // Another writer stored the session between the stat and the
          // create: adopt it instead of failing the sync.
          if ((error as { name?: string }).name !== 'SessionAlreadyExistsError') throw error
          return persistence.open(id, 'write')
        }
      }
      return persistence.open(id, 'write')
    })()
    this.childWriteHandles.set(childSessionId, acquired)
    acquired.catch(() => {
      if (this.childWriteHandles.get(childSessionId) === acquired) {
        this.childWriteHandles.delete(childSessionId)
      }
    })
    return acquired
  }

  /**
   * Evict one child session's cached write handle and close it. Used when an
   * owner gives the session up (a failed reattach); normal lifetimes close
   * with the cache on plugin dispose.
   */
  private async releaseChildWriteHandle(childSessionId: string): Promise<void> {
    const cached = this.childWriteHandles.get(childSessionId)
    if (cached === undefined) return
    this.childWriteHandles.delete(childSessionId)
    const handle = await cached.catch(() => undefined)
    await handle?.close().catch((error: unknown) => {
      this.ctx.logger.warn(`localAgent: closing the child session ${childSessionId} write handle failed: ${String(error)}`)
    })
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
    // A resume round reuses the child session id, so a previous round's parked
    // route (whose settle report never arrived) must not outlive it.
    this.dropSettledRun(childSessionId)
    this.runs.set(childSessionId, { controller, run, onProgress, startedAt, heartbeat })
    const clear = (): void => {
      const entry = this.runs.get(childSessionId)
      if (entry?.run !== run) return
      clearInterval(entry.heartbeat)
      this.runs.delete(childSessionId)
      // The provider computes this round's settle observation AFTER the result
      // resolves (the CLI's stream is only complete once the process is
      // reaped), so the route stays open for it — bounded, and closed by the
      // report itself. See RUN_PROGRESS_SETTLE_GRACE_MS.
      if (onProgress === undefined) return
      const timer = setTimeout(() => { this.dropSettledRun(childSessionId) }, RUN_PROGRESS_SETTLE_GRACE_MS)
      timer.unref()
      this.settledRuns.set(childSessionId, { onProgress, timer })
    }
    void run.result.then(clear, clear)
  }

  /** Close one parked progress route, if any. */
  private dropSettledRun(childSessionId: string): void {
    const parked = this.settledRuns.get(childSessionId)
    if (parked === undefined) return
    clearTimeout(parked.timer)
    this.settledRuns.delete(childSessionId)
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
    const tracked = this.runs.get(childSessionId)
    if (tracked !== undefined) {
      tracked.onProgress?.(progress)
      return
    }
    // The run's result already settled; its call's route is parked for the
    // provider's late settle observation and closes on delivery.
    const parked = this.settledRuns.get(childSessionId)
    if (parked === undefined) return
    parked.onProgress(progress)
    if (progress.kind === 'settled') this.dropSettledRun(childSessionId)
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
      // The log belongs to the DIRECTORY the delegation ran in: a scoped
      // round's mapping lands in that scope's own `delegations.jsonl`, so a
      // scope carries its whole state (credentials, session records, resume
      // mappings) and stays readable on its own after a host restart.
      appendFileSync(join(this.homeDir(harness.name, record.scope), DELEGATIONS_FILENAME), `${JSON.stringify(record)}\n`)
    } catch (error: unknown) {
      this.ctx.logger.warn(`localAgent: failed to persist the delegation for child session ${record.childSessionId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Load one scoped home's persisted delegation mappings into the in-memory
   * maps. The default scope runs synchronously inside {@link register} before
   * `localAgent/harness-added` fires — unchanged; a named scope's file is read
   * when that scope's directory is materialized ({@link homeDir}). Malformed
   * or foreign-provider lines skip with a warn; the last line per child
   * session wins (matching {@link recordDelegation}'s replace semantics), and
   * a record's `kimiMirroredLines` restores the mirror offset.
   * @param harness - the harness whose log is read.
   * @param scope - the scope whose directory holds the log; absent means the
   *   default scope.
   */
  private loadDelegations(harness: LocalAgentHarness, scope?: string): void {
    const dirName = scopedHomeName(harness.name, scope)
    let text: string
    try {
      text = readFileSync(join(this.homesRoot, dirName, DELEGATIONS_FILENAME), 'utf8')
    } catch {
      // No mappings persisted yet.
      return
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const parsed = parseDelegationLine(line, harness.delegationProvider)
      if (parsed === undefined) {
        this.ctx.logger.warn(`localAgent: skipping a malformed or foreign line in ${dirName}/${DELEGATIONS_FILENAME}`)
        continue
      }
      // A file inside a named scope's directory describes that scope, so a
      // line that predates the field is restored as belonging to the
      // directory it was found in rather than as a default-scope record.
      const record = parsed.scope === undefined && scope !== undefined ? { ...parsed, scope } : parsed
      this.delegations.set(record.childSessionId, record)
      this.noteObservedModel(record)
      if (record.kimiMirroredLines !== undefined) {
        this.kimiMirrorOffsets.set(record.childSessionId, record.kimiMirroredLines)
      }
    }
  }

  /**
   * Dispatch `/login`, `/status`, `/sessions` and `/logout` for one harness,
   * in the default scope or — with `--scope <name>` — in a named one. The
   * flag is parsed off the input before the verb is matched, so every family
   * verb takes it and an input without it is dispatched exactly as before.
   * A harness's own extra subcommands receive the RAW input, flag included:
   * the family does not rewrite a subcommand it does not own.
   */
  private handle(invocation: CommandInvocation, harness: LocalAgentHarness): Promise<CommandResult> {
    const raw = invocation.rawInput.trim()
    const parsed = parseScopeFlag(raw)
    if (parsed.error !== undefined) return Promise.resolve({ kind: 'error', text: `/${harness.name}: ${parsed.error}` })
    const input = parsed.input
    const scope = parsed.scope
    if (input === 'login') {
      // A login changes which account the scoped home holds, so whatever
      // rounds observed about the previous credential stops describing it.
      this.forgetCredentialObservations(harness.name, scope)
      return this.login(harness, scope)
    }
    if (input.startsWith('code ')) return Promise.resolve(this.submitLoginCode(harness, input.slice('code '.length).trim(), scope))
    if (input === 'status') {
      return this.statusOf(harness.name, scope).then(status => ({ kind: 'success', text: renderStatus(status) }))
    }
    if (input === 'sessions' || input === '') {
      return this.sessionsOf(harness.name, scope)
        .then(records => ({ kind: 'success', text: renderSessions(harness, records) }))
    }
    if (input === 'logout') {
      if (harness.logout === undefined) {
        return Promise.resolve({
          kind: 'error',
          text: `${harness.name} has no logout path; delete ${this.homeDir(harness.name, scope)} to sign out.`,
        })
      }
      return harness.logout(this.homeDir(harness.name, scope))
        .then(() => {
          this.forgetCredentialObservations(harness.name, scope)
          return { kind: 'success', text: `${harness.displayName} signed out of the scoped home; log in again to switch accounts.` }
        })
    }
    if (harness.subcommand !== undefined) {
      const extra = harness.subcommand(raw, invocation)
      if (extra !== undefined) return Promise.resolve(extra)
    }
    return Promise.resolve({
      kind: 'error',
      text: `Unknown /${harness.name} subcommand; use /${harness.name} login, /${harness.name} status, /${harness.name} sessions, or /${harness.name} logout.`,
    })
  }

  /**
   * Run one login flow. The device-code variant spawns the CLI in the scoped
   * home and captures its prompt from stderr/stdout; the reply surfaces that
   * prompt immediately while the child keeps polling in the background. The
   * manual variant spawns nothing — the reply carries the terminal
   * instructions and a watch polls the credential probe. A second login while
   * one is pending replaces it — a stale or abandoned attempt (browser never
   * opened, user gave up) must not hold the slot forever, and the user's
   * retry should just get a fresh start. An abandoned device-code login with
   * no retry self-heals when the CLI's own device code expires and its
   * polling child exits (kimi/codex do); no idle timer is added because a
   * too-short one would kill a user who is genuinely authorizing (the manual
   * watch is bounded instead). A harness without a login flow answers with an
   * error instead of spawning anything.
   * Each scope logs in on its own: credentials are never copied between
   * scopes, so `--scope <name>` authorizes THAT directory's account and the
   * pending-login slot is per (harness, scope) too — a login in one scope
   * neither replaces nor observes another's.
   * @param harness - the harness whose login flow runs.
   * @param scope - the scope to log in; absent means the default one.
   * @returns the command result: the device-code prompt, or the manual
   *   handoff's terminal instructions.
   */
  private login(harness: LocalAgentHarness, scope?: string): Promise<CommandResult> {
    const login = harness.login
    if (login === undefined) {
      return Promise.resolve({
        kind: 'error',
        text: `${harness.name} has no device-code login; it authenticates through the host instance's credentials.`,
      })
    }
    const loginKey = scopedHomeName(harness.name, scope)
    const existing = this.logins.get(loginKey)
    if (existing !== undefined) {
      // A pending login is replaced, not refused: stop its watch / terminate
      // its child so the new login gets a clean slot. The old controller's
      // done signal already cleared the map entry or will (its settle path
      // deletes only when the map still holds THAT controller, which the new
      // set() below makes false).
      existing.stop?.()
      if (existing.terminal !== undefined) void existing.terminal.terminate()
      const stale = existing.child
      if (stale !== undefined) {
        stale.kill()
        // SIGTERM first, then SIGKILL after a grace period: a CLI that ignores
        // SIGTERM must not leave a zombie polling process behind (the slot is
        // already replaced, so this is process hygiene, not a functional lock).
        const hardKill = setTimeout(() => {
          if (stale.exitCode === null && stale.signalCode === null) stale.kill('SIGKILL')
        }, REPLACE_LOGIN_GRACE_MS)
        stale.once('exit', () => { clearTimeout(hardKill) })
      }
    }
    // The manual handoff spawns nothing: reply with the terminal instructions
    // and watch for the credential.
    if ('manual' in login) return this.manualLogin(harness, login, scope)
    if ('pty' in login) return this.ptyLogin(harness, login, scope)
    const controller: LoginController = { done: Promise.resolve() }
    this.logins.set(loginKey, controller)
    const resultPromise = this.runLogin(harness, login, controller, scope)
    // The settle signal is the real one only after runLogin populated it;
    // chaining earlier would clear the guard on the placeholder promise.
    void controller.done.then(() => {
      if (this.logins.get(loginKey) === controller) this.logins.delete(loginKey)
    })
    return resultPromise
  }

  /**
   * The shared credential watch behind the manual and pty login variants:
   * polls the probe until the credential lands (presence AND, when the
   * harness exposes a credential stamp, a stamp rewritten after the watch
   * started — a leftover marker must not conclude a login), the window
   * expires, or a new login replaces the watch. Outcomes are logged; the
   * surfaces' own status polling picks the landed credential up.
   * @param harness - the harness being logged in.
   * @param probe - the credential probe.
   * @param controller - the pending login's controller (done resolves here).
   * @param scope - the scope being logged in; absent means the default one.
   */
  private watchCredential(
    harness: LocalAgentHarness,
    probe: (homeDir: string) => Promise<boolean>,
    controller: LoginController,
    scope?: string,
  ): void {
    const homeDir = this.homeDir(harness.name, scope)
    const deadline = Date.now() + MANUAL_LOGIN_LIMIT_MS
    const watchStart = Date.now()
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined
    controller.done = new Promise<void>((resolve) => {
      const finish = (message: string, level: 'info' | 'warn'): void => {
        if (stopped) return
        stopped = true
        if (timer !== undefined) clearInterval(timer)
        this.ctx.logger[level](message)
        resolve()
      }
      controller.stop = () => { finish(`${harness.name} login watch replaced`, 'info') }
      const tick = async (): Promise<void> => {
        if (stopped) return
        try {
          if (await probe(homeDir)) {
            // Presence alone must not conclude a login: a stale marker (e.g.
            // a revoked token's leftover record) would report success without
            // any new login. When the harness exposes a credential stamp,
            // require it to be rewritten after this watch started.
            if (harness.credentialStamp !== undefined) {
              const stamp = await harness.credentialStamp(homeDir).catch(() => undefined)
              if (stamp === undefined || stamp <= watchStart) return
            }
            finish(`${harness.name} login detected in the scoped home`, 'info')
            return
          }
        } catch {
          // A probe failure is a transient read; keep watching.
        }
        if (Date.now() >= deadline) {
          finish(
            `${harness.name} login watch expired after ${Math.round(MANUAL_LOGIN_LIMIT_MS / 1000)}s with no credential; run /${harness.name} login again to retry`,
            'warn',
          )
        }
      }
      timer = setInterval(() => { void tick() }, MANUAL_LOGIN_POLL_MS)
      timer.unref()
    })
  }

  /**
   * The manual-handoff login: the reply carries the exact command the user
   * runs in their own terminal, and a bounded watch polls the credential probe
   * (default: the harness's `isAuthenticated`) until the credential lands, the
   * window expires, or a new login replaces the watch. The reply cannot carry
   * the outcome — the command channel has already returned — so success and
   * timeout are logged, and the surfaces' own status polling (the settings
   * section re-probes every few seconds) picks the landed credential up.
   * @param harness - the harness declaring the manual flow.
   * @param login - the manual variant declaration.
   * @param scope - the scope being logged in; absent means the default one.
   * @returns the instructions as the command success text.
   */
  private manualLogin(
    harness: LocalAgentHarness,
    login: Extract<LocalAgentLogin, { manual: unknown }>,
    scope?: string,
  ): Promise<CommandResult> {
    const loginKey = scopedHomeName(harness.name, scope)
    const controller: LoginController = { done: Promise.resolve() }
    this.logins.set(loginKey, controller)
    const probe = login.watch ?? harness.isAuthenticated
    if (probe !== undefined) this.watchCredential(harness, probe, controller, scope)
    void controller.done.then(() => {
      if (this.logins.get(loginKey) === controller) this.logins.delete(loginKey)
    })
    return Promise.resolve({
      kind: 'success',
      text: `${harness.displayName} CLI login needs an interactive terminal. Run this in your own terminal:\n\n  ${login.manual.commandDisplay}\n\nWatching the scoped home for the credential for up to ${Math.round(MANUAL_LOGIN_LIMIT_MS / 60_000)} minutes; this surface picks the login up automatically.`,
    })
  }

  /**
   * The pty login: spawn the CLI under a pseudo-terminal wrapper so its
   * TTY-only auth flow runs — current claude auto-opens the user's browser
   * itself. The OAuth URL is captured from the merged output as a fallback,
   * and when the CLI prompts for a code the user pastes it through
   * `/<name> code <value>` (written to the child's stdin). Completion is the
   * shared credential watch. Windows has no script(1) wrapper; there the
   * reply falls back to the manual instruction.
   * @param harness - the harness declaring the pty flow.
   * @param login - the pty variant declaration.
   * @param scope - the scope being logged in; absent means the default one.
   *   The CLI runs with its scoped-home variable pointed at THAT directory,
   *   so the grant it writes lands in the scope that asked for it.
   * @returns the browser/paste instructions as the command success text.
   */
  private async ptyLogin(
    harness: LocalAgentHarness,
    login: Extract<LocalAgentLogin, { pty: unknown }>,
    scope?: string,
  ): Promise<CommandResult> {
    const homeDir = this.homeDir(harness.name, scope)
    const loginKey = scopedHomeName(harness.name, scope)
    // The argv may depend on the directory being logged in (see the pty
    // variant's `args`), so it is resolved against THIS scope's home.
    const args = typeof login.pty.args === 'function' ? login.pty.args(homeDir) : login.pty.args
    const displayCommand = [login.pty.command, ...args].join(' ')
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) {
      // The seam is absent in this composition: degrade to the manual handoff.
      const controller: LoginController = { done: Promise.resolve() }
      this.logins.set(loginKey, controller)
      const probe = login.watch ?? harness.isAuthenticated
      if (probe !== undefined) this.watchCredential(harness, probe, controller, scope)
      void controller.done.then(() => {
        if (this.logins.get(loginKey) === controller) this.logins.delete(loginKey)
      })
      return Promise.resolve({
        kind: 'success',
        text: `${harness.displayName} CLI login needs an interactive terminal. Run this in your own terminal:\n\n  ${displayCommand}\n\nWatching the scoped home for the credential; this surface picks the login up automatically.`,
      })
    }
    const controller: LoginController = { done: Promise.resolve(), awaitingCode: true }
    const terminal = await subprocess.spawnTerminal({
      argv: [login.pty.command, ...args],
      cwd: homeDir,
      env: { [harness.homeEnvVar]: homeDir },
      terminalType: 'xterm-256color',
      rows: 24,
      cols: 80,
      graceMs: REPLACE_LOGIN_GRACE_MS,
    })
    controller.terminal = terminal
    this.logins.set(loginKey, controller)
    controller.writeCode = (code) => {
      void terminal.write(`${code}\r`)
      controller.awaitingCode = false
    }
    let url: string | undefined
    const urlCaptured = new Promise<void>((resolve) => {
      const promptTimeout = setTimeout(() => { resolve() }, this.loginPromptTimeoutMs)
      terminal.output.on('data', (chunk: Buffer) => {
        if (url === undefined) {
          const match = /https?:\/\/[^\s\]]+/.exec(stripAnsi(chunk.toString()))
          if (match !== null) {
            url = match[0]
            clearTimeout(promptTimeout)
            resolve()
          }
        }
      })
      void terminal.done.then(() => { clearTimeout(promptTimeout); resolve() }, () => { clearTimeout(promptTimeout); resolve() })
    })
    controller.done = new Promise<void>((resolve) => {
      void terminal.done.then(() => { resolve() }, () => { resolve() })
    })
    const probe = login.watch ?? harness.isAuthenticated
    if (probe !== undefined) this.watchCredential(harness, probe, controller, scope)
    void controller.done.then(() => {
      if (this.logins.get(loginKey) === controller) this.logins.delete(loginKey)
    })
    // Give the CLI a bounded moment to print its OAuth URL so the reply can
    // carry the fallback link; the browser opens on its own either way.
    return urlCaptured.then(() => ({
      kind: 'success',
      text: `${harness.displayName} 授权页应已在浏览器中打开。`
        + (url !== undefined ? `\n\n若浏览器未打开，请访问：\n  ${url}` : '')
        + `\n\n授权完成后若页面给出一个 code，请粘贴回来：\n  /${harness.name} code <你的code>`,
    }))
  }

  /**
   * Deliver the user's pasted OAuth code to a pending pty login's stdin.
   * @param harness - the harness whose login is pending.
   * @param code - the pasted code.
   * @param scope - the scope whose login is pending; absent means the default
   *   one. The pending-login slot is per scope, so the code reaches the login
   *   that asked for it.
   * @returns the command result.
   */
  private submitLoginCode(harness: LocalAgentHarness, code: string, scope?: string): CommandResult {
    const controller = this.logins.get(scopedHomeName(harness.name, scope))
    if (controller?.writeCode === undefined || code === '') {
      return {
        kind: 'error',
        text: `${harness.name} 没有等待授权 code 的登录；先运行 /${harness.name} login。`,
      }
    }
    controller.writeCode(code)
    return { kind: 'success', text: 'code 已提交，等待授权完成…' }
  }


  /**
   * Spawn the harness login command and capture its device-code prompt. The
   * scoped-home variable points the CLI at the scope being logged in, so the
   * grant lands in that directory and nowhere else.
   */
  private runLogin(
    harness: LocalAgentHarness,
    login: Extract<LocalAgentLogin, { command: string }>,
    controller: LoginController,
    scope?: string,
  ): Promise<CommandResult> {
    const child = spawn(login.command, [...login.args], {
      env: { ...process.env, [harness.homeEnvVar]: this.homeDir(harness.name, scope) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    controller.child = child
    controller.done = new Promise<void>((resolve) => {
      child.on('exit', () => { resolve() })
      child.on('error', () => { resolve() })
    })
    const capture = login.capture ?? 'stderr'
    let prompt = ''
    let answered = false
    return new Promise<CommandResult>((resolve) => {
      const probe = capture === 'stderr' ? child.stderr : child.stdout
      if (capture === 'stdout') {
        // Drain stderr so a stdout-captured CLI cannot stall on a full pipe.
        child.stderr.resume()
      }
      probe.on('data', (chunk: Buffer) => {
        // ANSI escapes ride CLI output even when piped (codex colorizes the
        // auth URL); strip before the URL check and the reply.
        prompt += stripAnsi(chunk.toString())
        // Reply fast only once a URL is in hand — a fast print-and-exit CLI
        // (kimi's already-logged-in 'Logged in to …') never prints one and
        // must fall through to the close handler instead of showing a bogus
        // 'complete the flow in the browser' wrapper.
        if (!answered && /https?:\/\//.test(prompt)) {
          answered = true
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
        if (answered) return
        answered = true
        if (child.exitCode === 0) {
          // The CLI finished without asking for anything — it considers the
          // harness already authenticated (kimi's 'Logged in to …').
          resolve({
            kind: 'success',
            text: prompt.trim() === '' ? `${harness.displayName} 已是登录状态。` : prompt.trim(),
          })
          return
        }
        resolve({ kind: 'error', text: loginFailure(harness, child.exitCode, null) })
      })
      child.on('error', (error) => {
        if (answered) return
        answered = true
        resolve({ kind: 'error', text: `${harness.name} login failed to start: ${error.message}` })
      })
      // A CLI that prints nothing at all should not hold the reply hostage.
      setTimeout(() => {
        if (answered) return
        answered = true
        child.kill('SIGTERM')
        resolve({
          kind: 'error',
          text: `${harness.name} login printed no device-code prompt; is the ${harness.displayName} CLI installed and configured?`,
        })
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
 * The `/local-agent stop <childSessionId>` result: fire-and-return like the
 * official `subagents.interrupt(targetSessionId)` — the cancel signal is
 * issued before the reply, and an absent target (unknown child or no
 * in-flight run) is an accepted no-op, named explicitly rather than a silent
 * success. The authority is implicit: the dispatching agent's UI initiated
 * the command, exactly as every other slash command.
 * @param registry - the active-delegation registry.
 * @param childSessionId - the dsh child session id of the delegation to stop.
 * @returns the command result.
 */
function stopDelegation(registry: LocalAgentRegistry, childSessionId: string): CommandResult {
  if (registry.cancel(childSessionId)) {
    return { kind: 'success', text: `stop requested for child session ${childSessionId}` }
  }
  return {
    kind: 'success',
    text: `child session ${childSessionId} has no in-flight local-agent run to stop`,
  }
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
    description: 'list the registered local code-agent harnesses, or stop an in-flight delegation',
    input: { hint: 'list | stop <childSessionId>' },
    handler: (invocation) => {
      const input = invocation.rawInput.trim()
      if (input === 'list' || input === '') {
        return Promise.resolve({ kind: 'success', text: renderRoster(registry) })
      }
      if (input.startsWith('stop')) {
        // /local-agent stop <childSessionId>: cancel the active delegation
        // keyed by the child session id (semantics aligned with the official
        // subagents.interrupt — fire-and-return, absent target accepted).
        const childSessionId = input.slice('stop'.length).trim()
        if (childSessionId === '') {
          return Promise.resolve({
            kind: 'error',
            text: 'usage: /local-agent stop <childSessionId>',
          })
        }
        return Promise.resolve(stopDelegation(registry, childSessionId))
      }
      return Promise.resolve({
        kind: 'error',
        text: 'Unknown /local-agent subcommand; use /local-agent list or /local-agent stop <childSessionId>.',
      })
    },
  })
}
