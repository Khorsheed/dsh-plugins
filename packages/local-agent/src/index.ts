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

import { COMPACT_COMMAND, isCompactCommand } from './types.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import * as sessionModule from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
// The durable reader validates plugin vocabulary before replay. Register in
// both resolution planes: source-based host toolchains and installed bundles
// can otherwise hold separate catalog instances (the Room journal uses the
// same host seam). Keep registration after uninstall until process exit so
// existing member histories remain readable.
const streamCatalogSpecifier = ['@deepseek-ai/dsh-session', 'src', 'known-event-types'].join('/')
const streamCatalogs = await Promise.all([
  import('@deepseek-ai/dsh-session'),
  import(streamCatalogSpecifier).catch(() => undefined),
])
for (const catalog of streamCatalogs) {
  (catalog?.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/stream')
  ;(catalog?.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/compaction')
  ;(catalog?.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/context')
  // Registered before any build writes it (batch 5 S0); never remove it.
  ;(catalog?.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/execution')
}

// The host's released-log check, the exact relationship rules every stored
// read enforces: the member write guard verifies each corrected event with it.
// Probed, never required — a host that does not expose it keeps the guard's
// own corrections and diversions (see child-log-guard.ts).
const releasedFormatSpecifier = ['@deepseek-ai', 'dsh-session-format-v3-to-v4'].join('/')
const releasedFormat = await import(releasedFormatSpecifier).catch(() => undefined) as {
  assertReleasedV4Relationships?: (artifact: unknown, knownEventTypes: ReadonlySet<string>) => void
} | undefined
const releasedLogCheck = releasedFormat?.assertReleasedV4Relationships === undefined ? undefined
  : (session: Session, events: readonly SessionEvent[]): string | undefined => {
      try {
        releasedFormat.assertReleasedV4Relationships!(
          { header: { ...session.header, version: 4, id: String(session.id) }, inheritedEventCount: session.inheritedEventCount, events },
          sessionModule.KNOWN_SESSION_EVENT_TYPES as ReadonlySet<string>,
        )
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }

import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SubagentActivation, SubagentActivationSpec, SubagentResult, SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {
  DelegationCallOptions,
  LocalAgentCredentialState,
  LocalAgentDelegationInfo,
  LocalAgentDelegationIntent,
  LocalAgentDelegationRecord,
  LocalAgentEffectiveSettings,
  LocalAgentEndpointAuthFields,
  LocalAgentEndpointAuthState,
  LocalAgentMemberRun,
  LocalAgentModelBroker,
  LocalAgentMemberBinding,
  LocalAgentMemberControlState,
  LocalAgentMemberInbox,
  LocalAgentMemberConfiguration,
  LocalAgentControlReceipt,
  LocalAgentAppliedConfiguration,
  LocalAgentRosterRow,
  LocalAgentRunProgress,
  LocalAgentSessionRecord,
  LocalAgentStatus,
  LocalAgentToolCalls,
  LocalAgentTimingAdapter,
  LocalAgentMemberModelTiming,
  LocalAgentCompactionEvent,
  LocalAgentContextEvent,
  LocalAgentMemberContext,
  LocalAgentMemberToolsReload,
  LocalAgentMemberToolsReloadOptions,
  LocalAgentMemberToolsStatus,
  LocalAgentExecutionIntent,
  LocalAgentUnrecordedDeclaration,
  LocalAgentExecutionAdmitted,
  LocalAgentExecutionCaller,
  LocalAgentExecutionCause,
  LocalAgentExecutionHandle,
  LocalAgentExecutionOperation,
  LocalAgentExecutionReading,
  LocalAgentExecutionRequest,
  LocalAgentExecutionSettlement,
  LocalAgentFoldedTaskResult,
  LocalAgentMemberCreate,
  LocalAgentMemberInput,
  LocalAgentTaskRef,
  LocalAgentBackgroundTasks,
  LocalAgentBackgroundTasksLost,
  LocalAgentBackgroundTasksRequest,
  LocalAgentSubagentCalls,
  LocalAgentSelfAdmission,
  LocalAgentSelfAdmissionRequest,
  LocalAgentSelfCause,
} from './types.ts'
import { ExecutionRecorder, executionOutcome, type OpenExecution } from './execution-records.ts'
import { executionOfToolCall, executionReadingsOf, executionTaskOf, selfExecutionOfTask, subagentReadingsFor } from './execution-read.ts'
import { CLI_SUBAGENT_SESSION_SEPARATOR } from './cli-subagent.ts'
import { grandchildIdsOf, subagentCallsOf } from './subagent-calls.ts'
import LocalAgentGateway from './gateway.ts'
import { guardChildLog, type QuarantineEntry } from './child-log-guard.ts'
import { MemberChannel } from './member-channel.ts'
import { PresetToolHost } from './preset-tool-host.ts'
import type { RoomMemberMessageGate as ModeApprovalGate } from './types.ts'
import { withMemberProcessIdentity, type MemberProcessIdentity } from './env.ts'
import { MemberInbox, SELF_ROUND_RESTARTED } from './member-inbox.ts'
import { recordHostProcess, type HostProcesses } from './host-process.ts'
import { PreparedMembers } from './prepared-members.ts'
import { MemberControls } from './member-controls.ts'
import { FileMemberControlStorage } from './member-control-storage.ts'
import type { MemberConfigurationController } from './member-control.ts'

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
  LocalAgentCompactionEvent,
  LocalAgentCompactionUnrecorded,
  LocalAgentContextEvent,
  LocalAgentMemberContext,
  LocalAgentExecutionCaller,
  LocalAgentExecutionCause,
  LocalAgentExecutionEndEvent,
  LocalAgentExecutionEvent,
  LocalAgentExecutionOperation,
  LocalAgentExecutionOutcome,
  LocalAgentExecutionReading,
  LocalAgentExecutionStartEvent,
  LocalAgentExecutionSubagentReading,
  LocalAgentBackgroundTask,
  LocalAgentBackgroundTaskState,
  LocalAgentBackgroundTasks,
  LocalAgentBackgroundTasksLost,
  LocalAgentBackgroundTasksRequest,
  LocalAgentSubagentCall,
  LocalAgentSubagentCalls,
  LocalAgentSubagentStep,
  LocalAgentTaskRef,
  LocalAgentUnrecorded,
  LocalAgentExecutionIntent,
  LocalAgentUnrecordedDeclaration,
  LocalAgentExecutionAdmitted,
  LocalAgentExecutionHandle,
  LocalAgentExecutionRequest,
  LocalAgentExecutionSettlement,
  LocalAgentFoldedTaskResult,
  LocalAgentMemberCreate,
  LocalAgentMemberInput,
  LocalAgentSelfAdmission,
  LocalAgentSelfAdmissionRequest,
  LocalAgentSelfCause,
} from './types.ts'
export { MemberInbox, MemberLedger, SELF_ROUND_RESTARTED } from './member-inbox.ts'
export { BEFORE_PROMPT_FAILURE, LocalAgentRetryableStartError, RETRYABLE_START_FAILURE, isRetryableStartFailure } from './types.ts'
export { beforeMirrorTurn, executionOutcome, ExecutionRecorder, OpenExecution } from './execution-records.ts'
export { addUsage, executionOfToolCall, executionReadingsOf, executionTaskOf, ownSelfRounds, selfExecutionOfTask, subagentReadingsFor } from './execution-read.ts'
export type { ExecutionAdmission, ExecutionObservation, ExecutionRecorderOptions, MirrorTransport } from './execution-records.ts'

export type {
  LocalAgentMemberMessage,
  LocalAgentMemberToolsReload,
  LocalAgentMemberToolsReloadOptions,
  LocalAgentMemberToolsStatus,
  MemberToolsNotice,
  MemberMessageOutcome,
  RoomMemberMessageGate,
  RoomMemberMessageReceipt,
} from './types.ts'

export { delegationEnv, LOCAL_AGENT_MEMBER_ENV, LOCAL_AGENT_ROOM_ENV, memberIdentityEnv, withMemberProcessIdentity, currentMemberProcessIdentity } from './env.ts'
export type { MemberProcessIdentity } from './env.ts'
export { ModelDirectoryCache, extendModelDirectory, modelDirectoryContextKey } from './model-directory.ts'
export { MODEL_LIST_FILE, firstModelOf, normalizeModelList, readModelList, readModelListSync, writeModelList } from './model-list.ts'
export { MemberConfigurationController } from './member-control.ts'
export type { MemberConfigurationAdapter, MemberControlStorage, MemberControlRecord } from './member-control.ts'
export { FileMemberControlStorage } from './member-control-storage.ts'
export { LiveFlush, LIVE_FLUSH_INTERVAL_MS } from './live-flush.ts'
export {
  MIRROR_INTERRUPTED_TOOL_RESULT,
  appendMirrorContent,
  appendMirrorStep,
  appendRequestHeaderIfChanged,
  closeMirrorTurn,
  openMirrorTurn,
  mirrorAssistantMessage,
  mirrorStreamRecords,
  recordContextOccupancy,
} from './mirror-step.ts'
export type { MirrorBlock, MirrorGeneration, MirrorRequestConfig, MirrorSource, MirrorUnit } from './mirror-step.ts'
export { CLI_SUBAGENT_SESSION_SEPARATOR, cliSubagentLabel, cliSubagentSessionId, openCliSubagent } from './cli-subagent.ts'
export { SUBAGENT_STEP_LIMIT, grandchildIdsOf, subagentCallsOf, toolArgumentSummary } from './subagent-calls.ts'
export type { CliSubagentCall, CliSubagentEndOptions, CliSubagentExecution, CliSubagentHandle, CliSubagentIdentity } from './cli-subagent.ts'
import { LocalAgentStreams } from './live-stream.ts'
export { LocalAgentStreams, LiveStreamPublisher, LIVE_CHECKPOINT_INTERVAL_MS } from './live-stream.ts'
export { containerExecSpawn, containerScopedHome } from './container.ts'
import { readCardSettings, writeCardSettings, type CardSettings, type CardSettingValue } from './card-settings.ts'
export { settingsFace, vol } from './settings-face.ts'
export { readCardSettings, writeCardSettings, CARD_SETTINGS_FILE } from './card-settings.ts'
export type { CardSettings, CardSettingValue } from './card-settings.ts'
export type { SettingsFace } from './settings-face.ts'

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
 * - **live session + the family core provided** (the production wiring):
 *   delegate to {@link LocalAgentRegistry.syncChildSession}, which syncs through
 *   its cached per-child write handle — the same handle the reattach recipe
 *   holds, so live write routing and the explicit suffix sync share one
 *   owner and never collide on SessionAlreadyOwnedError. The registry
 *   downgrades a sync failure to a warn, so this path never throws.
 * - **anything else** (standalone tests, ad-hoc mirrors, no core provided):
 *   a one-shot handle flow — claim the write handle
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
    const registry = ctx.get('localAgent') as LocalAgentRegistry | undefined
    if (registry !== undefined) {
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
 * Per-scope inputs one scope's provisioning may take.
 *
 * Provisioning has always been a function of the scoped home alone, which is
 * right for every knob a harness reads from its own plugin config — one
 * instance, one answer. `preset` is the first knob that is a property of the
 * SUBJECT rather than of the deployment: an evaluation whose two conditions
 * differ in exactly one preset needs two scopes rostering two presets, and a
 * plugin-level setting cannot say that. So the caller that knows (the
 * evaluation's `conditions provision`, which reads the condition document)
 * hands it in here, and the harness persists it into the scope directory so
 * the next provisioning of that scope reproduces it without being told.
 *
 * Only `dsh` reads it. The other three harnesses take the parameter and
 * ignore it, which is what keeps their provisioning byte-identical.
 */
export interface LocalAgentScopeProvisionOptions {
  /** The agent preset this scope's composition must compose. */
  preset?: string
}

/**
 * What one scope's provisioning reports back.
 *
 * Every field is optional and every one is a READ-BACK: what the scope now
 * holds, not what the caller asked for. A caller that wanted to know whether
 * its request took effect compares the two.
 */
export interface LocalAgentScopeProvisionResult {
  /** The preset the scope's composition now rosters, when it rosters one. */
  preset?: string
  /**
   * The scope's own copy of that preset directory, when the harness keeps
   * one. `matchesSource` is the whole content of the claim: the copy is
   * byte-for-byte the deployment's own preset directory, which is what lets
   * a fingerprint taken against the deployment's copy describe the scope's.
   */
  presetSnapshot?: { matchesSource: boolean }
}

/**
 * One registered local code-agent harness.
 */
export interface LocalAgentPreparation {
  binding: LocalAgentMemberBinding
  childSession: Session
  configuration: LocalAgentAppliedConfiguration
  signal: AbortSignal
}

/** The member channel's half of the 模式工具 read and reload (see {@link LocalAgentRegistry.setMemberToolsFace}). */
export interface MemberToolsFace {
  status(childSessionId: string): Promise<LocalAgentMemberToolsStatus | null>
  autoReloaded(childSessionId: string, oldToken: string | undefined): void
  reloadPending(childSessionId: string): boolean
  reloadAccepted(childSessionId: string, when: 'now' | 'after-round'): void
  reloadStarted(childSessionId: string): void
  /** `error`: why a `failed` start did not come up, in the provider's words (shown after 「上次启动没有成功：」). */
  reloadDone(childSessionId: string, outcome: 'respawned' | 'no-process' | 'failed', oldToken: string | undefined, error?: string): void
  /** Whether the member still sits in a room with a mode (a removed member is never started). */
  seated(childSessionId: string): Promise<boolean>
}

/**
 * Start a member's resident process now, without a round (see
 * {@link LocalAgentHarness.startMember}): everything a round's spawn needs,
 * derived from durable state — the member's binding (provider, cwd, scope,
 * recorded model), its live child session, the recorded CLI session to
 * resume, the next turn number, and the admitted configuration when the
 * harness has a configuration broker.
 */
export interface LocalAgentMemberStart {
  readonly binding: LocalAgentMemberBinding
  readonly childSession: Session
  readonly resume: { readonly cliSessionId: string; readonly turn: number }
  readonly configuration?: LocalAgentAppliedConfiguration
}

/**
 * One member-process reload a harness accepted (see
 * {@link LocalAgentHarness.reloadMember}): `now` when the member was idle,
 * `after-round` when a round is running (the reload waits for it to end).
 * `done` settles once the reload ran: the resident process was replaced and
 * its CLI session resumed (`respawned`), there was none to replace
 * (`no-process`), or the fresh process did not start (`failed`).
 */
export interface LocalAgentMemberReload {
  readonly when: 'now' | 'after-round'
  readonly done: Promise<'respawned' | 'no-process' | 'failed'>
}

export interface LocalAgentHarness {
  /**
   * What this harness's CLI never reports, declared statically per way of
   * running (exec, live, compact) and copied verbatim onto every execution's
   * `local-agent/execution` end record — never guessed from a run. Absent
   * declares nothing.
   */
  unrecorded?: LocalAgentUnrecordedDeclaration
  /** Native handshake/configuration only; no prompt, turn, or side-effecting task. */
  prepareMember?: (request: LocalAgentPreparation) => Promise<void>
  /**
   * Replace a member's resident CLI process with a fresh one that resumes the
   * same CLI session, WITHOUT a round (no prompt, no model call), so the new
   * process lists its tools again. Queued behind a running round, never
   * interrupting it. Undefined = this harness does not host the member on a
   * resident process right now (exec path, live driver off).
   * `onStart` fires when the replacement actually begins.
   */
  reloadMember?: (childSessionId: string, hooks: { readonly onStart: () => void }) => LocalAgentMemberReload | undefined
  /**
   * Whether {@link startMember} can start this member's resident process
   * right now: the live driver is on for it and holds no process, spawn or
   * round for it. Required alongside `startMember`.
   */
  canStartMember?: (childSessionId: string) => boolean
  /**
   * Start a member's resident CLI process WITHOUT a round (no prompt, no
   * model call), resuming its recorded CLI session, so the process lists its
   * tools now — the room's 立即载入 for a member with no process (after a
   * host restart, or an idle reclaim). Chained on the member's round queue;
   * `no-process` when nothing was started (a process or round appeared
   * meanwhile, the driver went away), `failed` when the spawn failed.
   */
  startMember?: (request: LocalAgentMemberStart) => Promise<'respawned' | 'no-process' | 'failed'>
  /**
   * The member's CLI background tasks, read-only from the CLI's own task
   * state (the room's 后台 tray and member line). Answers `supported: false`
   * when the member's current way of running keeps none (Kimi exec: the
   * process ends with the round). Absent = this harness has none at all.
   */
  backgroundTasks?: (request: LocalAgentBackgroundTasksRequest) => Promise<LocalAgentBackgroundTasks>
  /** Command prefix and scoped-home directory name (lowercase, dashed). */
  name: string
  /** Human display name, used in command replies and UI labels. */
  displayName: string
  /** Environment variable naming the scoped home (e.g. `KIMI_CODE_HOME`). */
  homeEnvVar: string
  /**
   * Subagent provider name this harness delegates through, when it has one.
   * A harness without delegation is record-and-login only.
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
  /** Optional read-only reconstruction of historical model and tool timing. */
  timing?: LocalAgentTimingAdapter
  /**
   * Bring one scoped home of this harness to the state its CLI needs before a
   * login or a round can use it (codex's `config.toml` storage pin, kimi's
   * provider/model config and permission rules, claude's `settings.json`,
   * dsh's sub-profile). Called by the registry when a NAMED scope's directory
   * is materialized — the default scope is provisioned by the harness bundle's
   * own `apply`, exactly as it always was, so nothing about it moves.
   * Best-effort: a failure is logged and the directory still exists (the
   * status surface then reports what is actually there).
   *
   * `options` carries the per-scope inputs a caller supplies when it
   * provisions one scope deliberately (see {@link LocalAgentRegistry.provisionScope});
   * the registry's own materialization passes none, so a harness that reads
   * nothing from it behaves exactly as it did before the parameter existed.
   * The return value is a READ-BACK of what the scope now holds, and `void`
   * is the honest answer for a harness with nothing to report.
   * @param homeDir - the scoped home to provision.
   * @param options - per-scope inputs, absent on the registry's own materialization.
   */
  provision?: (
    homeDir: string,
    options?: LocalAgentScopeProvisionOptions,
  ) => LocalAgentScopeProvisionResult | void | Promise<LocalAgentScopeProvisionResult | void>
  /**
   * Whether the scoped home currently holds usable credentials. Absent means
   * the harness reports "not authenticated" and the status command still
   * runs; the check is per-harness (a credentials directory, an auth file).
   */
  isAuthenticated?: (homeDir: string) => Promise<boolean>
  /**
   * Optional host-side endpoint verification (the settings card's verify
   * button): a cheap, token-free probe of the SAVED endpoint configuration,
   * answered as human-readable verdict text. It rides the session-less
   * gateway Remote (`checkEndpoint`) because a settings card may have no
   * main agent session to run a slash command through. Absent means the
   * harness has no such probe and the card must not offer the button.
   */
  checkEndpoint?: (homeDir: string) => Promise<string>
  /**
   * Optional endpoint-credential face for the settings card: a read of the
   * resolved per-field state (secrets as booleans, never echoed) and a write
   * that applies edits into the harness's OWN credential store. The card
   * talks to it through the session-less gateway Remotes
   * (`endpointAuth`/`configureEndpoint`) instead of the volatile row-config
   * channel — a credential never belongs in the profile patch document, and
   * that channel rejects writes a deployment cannot explain. Absent means
   * the card renders no endpoint form.
   */
  endpointAuth?: {
    read(homeDir: string): Promise<LocalAgentEndpointAuthState>
    write(homeDir: string, fields: LocalAgentEndpointAuthFields): Promise<void>
  }
  /**
   * Optional curated model-list face: an ORDERED list of model identifiers
   * the harness persists in its own store (its first entry is the harness's
   * default model). The settings card edits it through the session-less
   * `modelList`/`configureModelList` gateway Remotes. Absent means the card
   * renders no model-list editor.
   */
  modelList?: {
    read(homeDir: string): Promise<readonly string[]>
    write(homeDir: string, models: readonly string[]): Promise<readonly string[]>
  }  /**
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

/** Poll interval for a manual-handoff login watch. */
export const MANUAL_LOGIN_POLL_MS = 2_000

/** How long a manual-handoff login watches before reporting the timeout. */
export const MANUAL_LOGIN_LIMIT_MS = 5 * 60_000

/** Heartbeat interval for facade-tracked in-flight runs. */
export const RUN_PROGRESS_HEARTBEAT_MS = 5_000

/**
 * Re-announce interval for a tool-registered (non-facade) delegation run's
 * `running: true` on the host session-status channel. Facade runs re-announce
 * on their own {@link RUN_PROGRESS_HEARTBEAT_MS} heartbeat instead.
 *
 * STOPGAP(session-activity-contribution): replace with host activity lease when upstream lands.
 * The host's list summary only knows host agents and its status event is
 * emit-only, so a browser that reloads or reconnects re-baselines a running
 * CLI child to idle; a periodic `true` puts the spinner back within one beat.
 * 4 s matches the client's own pendingCards poll.
 */
export const SESSION_STATUS_HEARTBEAT_MS = 4_000

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

/** The host-process record (host-process.ts), under the shared homes root. */
export const HOST_PROCESS_FILENAME = '.host-process.json'

export type { HostProcess, HostProcesses } from './host-process.ts'

/** One delegation-intent queue per (parent session, provider). */
function delegationIntentKey(parentSessionId: string, provider: string): string {
  return `${parentSessionId}\u0000${provider}`
}

/**
 * Fuse the facade-owned cancel controller with an optional caller signal, so
 * `cancel()` and the caller's own abort channel both reach the run.
 * `AbortSignal.any` is the harness's own fusion primitive (agent-loop's resume
 * uses it); either source aborts the run.
 *
 * Host 0.2.1 note: the fused signal reaches `startActivation`'s `spec.signal`,
 * which owns cancellation only up to publication — after the activation is
 * published the manager unlinks it and `dispose()` is the sole cancel channel.
 * {@link activationRun} therefore re-wires the caller signal to disposal.
 */
function fusedSignal(controller: AbortController, caller: AbortSignal | undefined): AbortSignal {
  if (caller === undefined) return controller.signal
  return AbortSignal.any([controller.signal, caller])
}

/** rc.2 reads the flat fields; older managers read the nested request. */
function callerActivationSpec(
  provider: string,
  label: string,
  prompt: ContentBlock[],
  parent: Agent,
  signal: AbortSignal,
): SubagentActivationSpec {
  return {
    provider,
    label,
    prompt,
    parent,
    signal,
    delivery: 'caller',
    request: { prompt, parent },
  } as SubagentActivationSpec
}

/**
 * Adapt a 0.2.1 managed activation to the family's published `SubagentRun`
 * shape. The adapter's `id` is the dsh child session id — the family's
 * tracking key, resume handle, and client-facing identity — NOT the
 * activation's `childId`, which for an external (CLI) provider is the
 * provider's per-execution id and never names the mirrored live Session.
 * `dispose()` is the activation's exact-epoch cancellation: it settles the
 * result with an `aborted`-class stop reason and runs teardown, so a caller
 * signal aborted mid-run is re-wired to it (the start signal the facade fused
 * is unlinked by the manager at publication). The listener detaches when the
 * result settles, so a long-lived caller signal never accumulates them.
 */
function activationRun(
  activation: SubagentActivation,
  childSessionId: string,
  caller: AbortSignal | undefined,
  warn: (message: string) => void,
): SubagentRun {
  const dispose = (): Promise<void> => activation.dispose()
  if (caller !== undefined) {
    const onAbort = (): void => {
      void dispose().catch((error: unknown) => {
        warn(`localAgent: caller-signal disposal of ${childSessionId} failed: ${String(error)}`)
      })
    }
    caller.addEventListener('abort', onAbort, { once: true })
    const detach = (): void => { caller.removeEventListener('abort', onAbort) }
    void activation.result.then(detach, detach)
  }
  return { id: SessionId(childSessionId), result: activation.result, dispose }
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
    ...typeof record['effort'] === 'string' && record['effort'] !== '' ? { effort: record['effort'] } : {},
    ...typeof record['configurationLock'] === 'string' && record['configurationLock'] !== '' ? { configurationLock: record['configurationLock'] } : {},
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

// Bare `z` annotation: `z<Config>`/`z<any, Config>` both fail schemastery
// 3.18.4's variance under exactOptionalPropertyTypes (TS2375), and dropping
// the annotation trips TS2742 on the inferred type's private names. The
// interface stays the apply signature's contract.
export const Config: z = z.object({
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
    /**
     * A member's CLI background tasks lost contact because a harness took
     * its resident process away (`LocalAgentRegistry.noteBackgroundTasksLost`).
     * @param lost - the member, its parent session, the task ids and why.
     * @mode emit
     */
    'localAgent/background-tasks-lost'(lost: LocalAgentBackgroundTasksLost): void
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

/**
 * A member log's context occupancy: the latest `local-agent/context`, unless
 * a completed compaction came after it (its after-count is then current).
 * @param events - the member's session events.
 * @returns the reading, or undefined when the CLI never reported one.
 */
export function memberContextOf(events: readonly SessionEvent[]): Omit<LocalAgentMemberContext, 'state'> | undefined {
  let reading: Omit<LocalAgentMemberContext, 'state'> | undefined
  for (const event of events) {
    if (event.type === 'local-agent/context') {
      const data = event.data as LocalAgentContextEvent
      reading = { provider: data.provider, usedTokens: data.usedTokens, ...data.contextWindow === undefined ? reading?.contextWindow === undefined ? {} : { contextWindow: reading.contextWindow } : { contextWindow: data.contextWindow } }
    } else if (event.type === 'local-agent/compaction') {
      const data = event.data as LocalAgentCompactionEvent
      if (data.outcome !== 'completed') continue
      // A compaction without an after-count (codex states none) leaves the
      // occupancy unknown until the next round reports it.
      const contextWindow = data.contextWindow ?? reading?.contextWindow
      reading = { provider: data.provider, ...data.afterTokens === undefined ? {} : { usedTokens: data.afterTokens }, ...contextWindow === undefined ? {} : { contextWindow } }
    }
  }
  return reading
}

// The `/compact` recognizer lives in the types module (dependency-free, the single source).
export { COMPACT_COMMAND, isCompactCommand } from './types.ts'

/**
 * How long an execution's settlement waits, after its run ended, for the
 * provider's settle report (its observed model, effort and CLI version). A
 * report that comes later is not on the settlement: absent = not recorded.
 */
export const SETTLEMENT_REPORT_WAIT_MS = 2_000

/** One queued execution as the core runs it: `run`'s request, or a start/resume/compact wrapper call. */
interface ExecutionPlan {
  readonly parentSessionId: string
  readonly provider: string
  readonly childSessionId: string
  /** `auto`: the core decides first round vs continuation; `start`/`resume`: a wrapper's explicit choice. */
  readonly mode: 'auto' | 'start' | 'resume'
  readonly create?: LocalAgentMemberCreate | undefined
  /** A wrapper's options, passed through to the round verbatim (its cwd, scope, exec, onAdmitted, …). */
  readonly options?: DelegationCallOptions | undefined
  readonly input: LocalAgentExecutionRequest['input']
  readonly operation: LocalAgentExecutionOperation
  readonly caller: LocalAgentExecutionCaller
  readonly cause?: LocalAgentExecutionCause | undefined
  readonly task?: LocalAgentTaskRef | undefined
  readonly key?: string | undefined
  readonly callerRef?: string | undefined
  readonly label?: string | undefined
  readonly signal?: AbortSignal | undefined
  /** Composer rows only: the text the ledger keeps for replay. */
  readonly text?: string | undefined
  /** Display only: the ledger row's preview (see LocalAgentMemberInput.preview). */
  readonly preview?: string | undefined
  readonly on?: LocalAgentExecutionRequest['on']
}

/** A start/resume/compact wrapper call as an execution plan: the options' facts, verbatim. */
function legacyPlan(mode: 'start' | 'resume', parentSessionId: string, provider: string, childSessionId: string, prompt: ContentBlock[], options: DelegationCallOptions | undefined): ExecutionPlan {
  return {
    parentSessionId, provider, childSessionId, mode, options, input: prompt,
    operation: options?.operation ?? 'prompt',
    caller: options?.caller ?? 'api',
    cause: options?.cause, task: options?.task, callerRef: options?.callerRef,
    label: options?.label, signal: options?.signal,
  }
}

/**
 * The member whose round requested the last host restart, as the restart
 * guard (ankh-guard's optional `selfRestartGuard` service) records it.
 * Probed duck-typed; no guard, a guard without the read, or a failing read
 * answer undefined (the restart then counts as nobody's).
 */
function restartInitiatorMember(ctx: Context): string | undefined {
  try {
    const guard = (ctx.get as (name: string) => unknown)('selfRestartGuard') as { lastRestart?: () => { readonly initiatorMember?: unknown } | null | undefined } | undefined
    const member = guard?.lastRestart?.()?.initiatorMember
    return typeof member === 'string' && member !== '' ? member : undefined
  } catch {
    return undefined
  }
}

/** A ledger row's terminal status as an execution outcome. */
function rowOutcome(status: LocalAgentMemberInput['status']): LocalAgentExecutionSettlement['outcome'] {
  return status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : 'failed'
}

/** A delegation record without its requested model. */
function withoutModel(record: LocalAgentDelegationRecord): LocalAgentDelegationRecord {
  const { model: _model, ...rest } = record
  return rest
}

/** Map a login failure to a command error, naming the swallowed signal. */
function loginFailure(harness: LocalAgentHarness, exitCode: number | null, signal: NodeJS.Signals | null): string {
  return `${harness.name} login exited with ${signal ?? `code ${exitCode ?? 'unknown'}`}; try /${harness.name} login again.`
}


/**
 * Registry of local code-agent harnesses and the per-harness command family.
 * @module @khorsheed/dsh-local-agent
 */
/** One member log's execution readings and the CLI-subagent grandchildren its catalog names. */
interface MemberExecutionRead {
  readonly readings: Map<string, LocalAgentExecutionReading>
  readonly subagentSessions: readonly string[]
}

function memberExecutionRead(childSessionId: string, events: readonly SessionEvent[]): MemberExecutionRead {
  const prefix = `${childSessionId}${CLI_SUBAGENT_SESSION_SEPARATOR}`
  const subagentSessions = [...new Set(events.flatMap((event) => {
    if (event.type !== 'subagent/catalog') return []
    const childId = (event.data as { childId?: unknown }).childId
    return typeof childId === 'string' && childId.startsWith(prefix) ? [childId] : []
  }))]
  return { readings: executionReadingsOf(events), subagentSessions }
}

export class LocalAgentRegistry {
  private readonly preparedMembers: PreparedMembers
  private readonly preparations = new Map<string, { signature: string; promise: Promise<string> }>()
  readonly memberInbox: MemberInbox
  /** This host process and the one before it (see {@link hostProcesses}). */
  private readonly processes: HostProcesses
  private readonly memberControls: MemberControls
  /**
   * All provider starts, including direct tool starts, acquire the same
   * whole-turn lease — and every admitted round is one recorded execution: its
   * `local-agent/execution` start is written at the admission point (the
   * wrapped `start` runs exactly there, after `onAdmitted`), its end when the
   * run settles. `execution` is the staged intent's execution facts.
   */
  withMemberConfigurationRound(binding: LocalAgentMemberBinding, start: (configuration: LocalAgentAppliedConfiguration) => Promise<SubagentRun>, signal?: AbortSignal, onAdmitted?: () => void | Promise<void>, execution?: LocalAgentExecutionIntent): Promise<SubagentRun> {
    this.memberInbox.assertAdmission(binding.childSessionId)
    return this.memberControls.run(binding, configuration => this.recordedExecution(binding, execution, signal, () => this.asMemberProcess(binding, () => start(configuration))),
      signal, () => { this.memberInbox.assertAdmission(binding.childSessionId); return onAdmitted?.() })
  }

  private readonly roomParents = new Map<string, boolean>()

  /**
   * Run `body` as work for one member, so every CLI process a provider spawns
   * inside it carries `DSH_LOCAL_AGENT_MEMBER` (and `DSH_LOCAL_AGENT_ROOM`
   * when the parent is a room) through `delegationEnv`. The room probe is
   * optional and cached per parent (the room marker never changes); without
   * the room service, or on any probe failure, only the member is named.
   * @param binding - the member's identity.
   * @param body - the provider work (a round start, a preparation, a process start or reload).
   * @returns what `body` resolves to.
   */
  async asMemberProcess<T>(binding: Pick<LocalAgentMemberBinding, 'childSessionId' | 'parentSessionId'>, body: () => T | Promise<T>): Promise<T> {
    return await withMemberProcessIdentity(await this.memberProcessIdentity(binding), body)
  }

  /** The identity {@link asMemberProcess} runs under, for a caller that must enter it synchronously. */
  async memberProcessIdentity(binding: Pick<LocalAgentMemberBinding, 'childSessionId' | 'parentSessionId'>): Promise<MemberProcessIdentity> {
    const room = await this.isRoomParent(binding.parentSessionId)
    return { member: binding.childSessionId, ...room ? { room: binding.parentSessionId } : {} }
  }

  private async isRoomParent(parentSessionId: string): Promise<boolean> {
    const known = this.roomParents.get(parentSessionId)
    if (known !== undefined) return known
    const room = (this.ctx.get as (key: string) => unknown).call(this.ctx, 'room') as { isRoom?: (request: { sessionId: SessionId }) => Promise<boolean> } | undefined
    if (typeof room?.isRoom !== 'function') return false
    try {
      const answer = (await room.isRoom({ sessionId: SessionId(parentSessionId) })) === true
      this.roomParents.set(parentSessionId, answer)
      return answer
    } catch {
      return false
    }
  }

  /** Open one execution around an admitted provider start (see {@link withMemberConfigurationRound}). */
  private async recordedExecution(binding: LocalAgentMemberBinding, execution: LocalAgentExecutionIntent | undefined, signal: AbortSignal | undefined, start: () => Promise<SubagentRun>): Promise<SubagentRun> {
    const open = this.executions.admit({
      childSessionId: binding.childSessionId,
      parentSessionId: binding.parentSessionId,
      operation: execution?.operation ?? 'prompt',
      provider: binding.provider,
      execution,
      unrecorded: this.harnessForProvider(binding.provider)?.unrecorded,
    })
    // A ledger execution reads its turn range and observations back at settlement.
    const ledgered = execution?.executionId !== undefined ? this.ledgerExecutions.get(execution.executionId) : undefined
    if (ledgered !== undefined) ledgered.open = open
    let run: SubagentRun
    try {
      run = await start()
    } catch (error) {
      open.settle(signal?.aborted === true ? 'cancelled' : 'failed')
      throw error
    }
    open.started()
    void run.result.then(result => open.settle(executionOutcome(result)), () => open.settle('failed'))
    return run
  }

  /** Every admitted execution's start/end records (execution-records.ts). */
  private readonly executions: ExecutionRecorder = new ExecutionRecorder({
    session: childSessionId => this.ctx.get('sessions')?.get(SessionId(childSessionId)),
    persist: (session) => {
      if (this.ctx.get('sessionPersistence') === undefined) return
      void this.syncChildSession(session)
    },
    settleWaitMs: RUN_PROGRESS_SETTLE_GRACE_MS,
    onError: error => { this.ctx.logger.warn(`localAgent: execution record write failed: ${String(error)}`) },
    reconciled: (childSessionId, executionId) => {
      let row: LocalAgentMemberInput | undefined
      try { row = this.memberInbox.find(childSessionId, executionId) } catch { return undefined }
      // A round the CLI opened itself, or any round a restart cut off
      // (closed as interrupted): its end reads `uncertain` — unknown, and
      // nobody's to reconcile (Context Lens reads it as 停了).
      if ((row?.caller === 'cli' && row.status === 'failed' && row.error === SELF_ROUND_RESTARTED) || row?.interrupted === 'restart') {
        return { outcome: 'uncertain', at: row.settledAt ?? row.updatedAt, reconciled: false }
      }
      return row?.reconciledAt === undefined || (row.status !== 'done' && row.status !== 'failed' && row.status !== 'cancelled')
        ? undefined : { outcome: row.status, at: row.reconciledAt }
    },
  })

  private requireInboxMember(childSessionId: string): LocalAgentDelegationRecord {
    const record = this.getDelegation(childSessionId)
    if (record === undefined) throw new Error('localAgent: no delegation recorded for this member')
    if (!this.supportsMemberConfiguration(record.provider)) throw new Error('The member provider does not support queued input admission')
    if (record.configurationLock !== undefined) throw new Error('Frozen evaluation members do not accept extra human input')
    return record
  }

  enqueueMemberInput(childSessionId: string, text: string, requestId: string): string {
    const record = this.requireInboxMember(childSessionId)
    this.requireLiveParent(record.parentSessionId)
    // The members-page composer goes through the same entry as every other
    // caller; its request id is the execution's key.
    this.memberInbox.enqueue(childSessionId, text, requestId, row => { this.submitExecution(this.composerPlan(childSessionId, row.text, row.key)) })
    return requestId
  }
  resumeMemberInbox(childSessionId: string): void {
    const record = this.requireInboxMember(childSessionId)
    this.requireLiveParent(record.parentSessionId)
    this.memberInbox.resume(childSessionId)
  }
  readMemberInbox(childSessionId: string): LocalAgentMemberInbox {
    // Preparation establishes the same stable child identity before a delegation
    // transcript exists. Its empty inbox must be readable by the composer.
    if (this.isPreparedMember(childSessionId)) return this.memberInbox.read(childSessionId)
    this.requireInboxMember(childSessionId)
    return this.memberInbox.read(childSessionId)
  }

  /**
   * The parent sessions of members whose execution this restart cut off
   * (M10): the room loads those of them that are rooms once
   * after the host starts, so its auto-continue pass runs without anyone
   * opening the room. Reads the ledger files only (no model call, nothing
   * converted); a member whose identity is unknown (its provider is not
   * registered) is left out.
   * @returns distinct parent session ids.
   */
  interruptedMemberParents(): string[] {
    const parents = new Set<string>()
    for (const childSessionId of this.memberInbox.interruptedMembers()) {
      const parent = this.memberBinding(childSessionId)?.parentSessionId
      if (parent !== undefined && parent !== '') parents.add(parent)
    }
    return [...parents]
  }

  /**
   * This host process and the one before it (host-process.ts), as recorded
   * when the core started: the boot evidence a restart's consumers judge
   * "cut off by THIS restart" with — a round that started before the
   * previous process did belongs to an earlier restart, whenever its
   * interruption happens to be written down. `previous` is absent on the
   * first boot with the record.
   */
  hostProcesses(): HostProcesses {
    return this.processes
  }

  /**
   * The parent sessions of members whose CLI background tasks a host restart
   * cut off (member-self-started-rounds M6): the room loads those that are
   * rooms once after the host starts, so it records the loss and tells the
   * dispatcher without anyone opening the room. A read-only scan of the
   * harness's own task state (`backgroundTasks`, its lookups over the member
   * log skipped): no CLI process is started and no model is called.
   * @param since - only tasks started at or after this epoch ms count (an
   *   older loss was another restart's, long past).
   * @returns distinct parent session ids.
   */
  async lostBackgroundTaskParents(since: number): Promise<string[]> {
    const parents = new Set<string>()
    for (const record of [...this.delegations.values()]) {
      const parent = record.parentSessionId
      if (parent === undefined || parent === '' || parents.has(parent)) continue
      if (this.harnessForProvider(record.provider)?.backgroundTasks === undefined) continue
      const read = await this.memberBackgroundTasks(record.childSessionId, { lookups: false })
      if (read?.tasks.some(task => task.state === 'lost' && task.lostBecause === 'host-restart' && task.startedAt >= since) === true) parents.add(parent)
    }
    return [...parents]
  }

  /** Rounds of the member waiting for admission: queued ledger rows, or provider starts waiting outside the ledger. */
  queuedMemberRounds(childSessionId: string): number {
    let ledger = 0
    try { ledger = this.memberInbox.read(childSessionId).messages.filter(row => row.status === 'queued').length } catch { /* an unreadable ledger blocks admission on its own */ }
    return Math.max(ledger, this.memberControls.queuedCount(childSessionId))
  }

  /** The admitted snapshot belongs to this exact run object, including after settle. */
  runConfiguration(run: object): LocalAgentAppliedConfiguration | undefined { return this.memberControls.configurationOf(run) }
  supportsMemberConfiguration(provider: string): boolean { return this.harnessForProvider(provider)?.modelBroker?.configurationAdapter !== undefined }

  private memberControl(childSessionId: string): MemberConfigurationController {
    let binding = this.memberControls.binding(childSessionId)
    if (binding === undefined) {
      const record = this.getDelegation(childSessionId)
      if (record === undefined || record.cwd === undefined) binding = this.preparedMembers.read(childSessionId)?.binding
      else binding = { ...record, cwd: record.cwd }
      if (binding === undefined) throw new Error('localAgent: member execution identity is unavailable')
    }
    return this.memberControls.get(binding)
  }

  /** Execution identity is available before the first native transcript exists. */
  memberBinding(childSessionId: string): LocalAgentMemberBinding | undefined {
    const known = this.memberControls.binding(childSessionId)
    if (known !== undefined) return known
    const record = this.getDelegation(childSessionId)
    if (record?.cwd !== undefined) return { ...record, cwd: record.cwd }
    return this.preparedMembers.read(childSessionId)?.binding
  }

  memberConfiguration(childSessionId: string): LocalAgentMemberControlState {
    return this.memberControl(childSessionId).read()
  }

  selectMemberConfiguration(childSessionId: string, requestId: string, expectedRevision: number, selection: LocalAgentMemberConfiguration): Promise<LocalAgentControlReceipt> {
    return this.memberControl(childSessionId).select(requestId, expectedRevision, selection)
  }

  cancelMemberConfiguration(childSessionId: string, requestId: string, expectedRevision: number): LocalAgentControlReceipt {
    return this.memberControl(childSessionId).cancel(requestId, expectedRevision)
  }

  retryMemberConfiguration(childSessionId: string, expectedRevision: number): Promise<void> {
    return this.memberControl(childSessionId).retry(expectedRevision)
  }

  followMemberConfiguration(childSessionId: string, signal: AbortSignal): AsyncIterable<LocalAgentMemberControlState> {
    return this.memberControl(childSessionId).follow(signal)
  }

  /** Compatibility write routes through the durable slot, including while busy. */
  async setMemberModel(childSessionId: string, model: string | undefined): Promise<void> {
    const state = this.memberConfiguration(childSessionId)
    const selection = state.pending?.selection ?? state.current.selection
    const receipt = await this.selectMemberConfiguration(childSessionId, randomUUID(), state.revision, {
      ...selection, model: model?.trim() ? { mode: 'value', value: model } : { mode: 'inherit' },
    })
    if (!['pending', 'applying', 'applied'].includes(receipt.status)) throw new Error(receipt.error ?? receipt.status)
  }
  /** Independent live output transport for mirrored sessions without native Agents. */
  readonly liveStreams: LocalAgentStreams = new LocalAgentStreams()
  private readonly harnesses = new Map<string, LocalAgentHarness>()
  /**
   * Named scopes materialized in this host process, keyed exactly like their
   * directory (`<name>@<scope>`) — the guard that keeps the mkdir, the
   * harness provisioning and the per-directory delegation load to once each.
   */
  private readonly scopedHomes = new Set<string>()

  /**
   * The provisioning currently running for each materialized scope.
   *
   * Materialization fires the harness's hook and does not wait for it — the
   * directory is what the caller asked for, and the hook is best-effort. A
   * caller that then provisions the SAME scope deliberately would otherwise
   * race it, and both writers regenerate the same files. Recording the
   * promise lets {@link LocalAgentRegistry.provisionScope} let the first one
   * finish before it starts.
   */
  private readonly scopeProvisioning = new Map<string, Promise<void>>()
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
   * `ctx.subagents.startActivation()`, and the owning provider consumes
   * exactly one per start, so fresh and resume rounds stay paired even under
   * parallel delegations from one parent.
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
   *   `ctx.subagents.startActivation`; cancel aborts the pre-publication
   *   signal and disposes the published activation.
   * - **tool-registered** ({@link trackDelegationRun}): runs the family tool
   *   starts directly through `ctx.subagents.startActivation`, carrying an
   *   explicit cancel lever (its fused controller plus the activation's
   *   dispose); cancel calls it.
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
    /**
     * STOPGAP(session-activity-contribution): replace with host activity lease when upstream lands.
     * Tool-registered runs' periodic `running: true` re-announce timer.
     */
    statusBeat?: ReturnType<typeof setInterval>
    /** Its settle report already arrived (a provider may report before the result resolves): nothing is owed. */
    settled?: boolean
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
  /** Releases that a new acquisition must await before opening the same child session. */
  private readonly childWriteHandleReleases = new Map<string, Promise<void>>()
  /** Child syncs that must finish before their write handles close on dispose. */
  private readonly childSyncs = new Set<Promise<void>>()

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
    this.preparedMembers = new PreparedMembers(join(homesRoot, '.prepared-members'))
    // Which host process this is and which one ran before (before any ledger is read).
    this.processes = recordHostProcess(join(homesRoot, HOST_PROCESS_FILENAME), undefined, error => this.ctx.logger.warn(`localAgent: recording the host process failed: ${String(error)}`))
    // The member execution ledger. A composer row replayed after a restart
    // (its in-memory dispatcher is gone) runs from its stored text here.
    this.memberInbox = new MemberInbox(join(homesRoot, '.member-inbox'), async (childSessionId, row, signal, admitted) => {
      return await this.dispatchExecution(this.composerPlan(childSessionId, row.text ?? '', row.key), row.id, signal, admitted)
    }, error => this.ctx.logger.warn(`localAgent: member inbox failed: ${String(error)}`), this.processes, {
      // A members-page round a restart cut off continues on its own, except
      // the member whose own round requested the restart (the guard's record).
      continueComposer: childSessionId => restartInitiatorMember(this.ctx) !== childSessionId,
      canReplay: (childSessionId) => {
        try { this.requireInboxMember(childSessionId); return true } catch { return false }
      },
    })
    this.memberControls = new MemberControls(new FileMemberControlStorage(join(homesRoot, '.member-controls')), binding => {
      const adapter = this.harnessForProvider(binding.provider)?.modelBroker?.configurationAdapter?.(binding)
      if (adapter === undefined) throw new Error(`localAgent: ${binding.provider} exposes no configuration admission adapter`)
      // Applying a configuration may restart the member's process: it runs as that member.
      const prepare = adapter.prepare
      return {
        ...prepare === undefined ? {} : { prepare: (selection: LocalAgentMemberConfiguration) => this.asMemberProcess(binding, () => prepare.call(adapter, selection)) },
        validate: selection => this.asMemberProcess(binding, () => adapter.validate(selection)),
        apply: (selection, previous, operationId) => this.asMemberProcess(binding, () => adapter.apply(selection, previous, operationId)),
        reconcile: state => this.asMemberProcess(binding, () => adapter.reconcile(state)),
      }
    }, error => { this.ctx.logger.warn(`localAgent: member control persistence failed: ${String(error)}`) })
    // Reattached child sessions leave the live store, in-flight run
    // heartbeats stop, and every cached child-session write handle closes,
    // when the plugin unloads.
    ctx.effect(() => async () => {
      // Ends still waiting for a settle report are written now, before the
      // write handles close.
      this.executions.flush()
      this.memberInbox.dispose()
      this.liveStreams.dispose()
      for (const entry of this.runs.values()) {
        if (entry.heartbeat !== undefined) clearInterval(entry.heartbeat)
        if (entry.statusBeat !== undefined) clearInterval(entry.statusBeat)
      }
      for (const entry of this.settledRuns.values()) clearTimeout(entry.timer)
      this.settledRuns.clear()
      while (this.childSyncs.size > 0) await Promise.allSettled([...this.childSyncs])
      for (const detach of this.reattachDisposers.values()) detach()
      this.reattachDisposers.clear()
      await Promise.all([...this.childWriteHandles.keys()].map(childSessionId => this.releaseChildWriteHandle(childSessionId)))
      await Promise.all([...this.childWriteHandleReleases.values()])
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
  /** Listeners of one harness's card-settings writes (see card-settings.ts). */
  private readonly cardSettingsListeners = new Map<string, Set<(next: CardSettings) => void>>()

  /**
   * One harness's settings-card overrides, stored in its default scoped home
   * (never the profile patch — see card-settings.ts).
   * @param name - the harness name.
   * @returns the stored values.
   */
  cardSettings(name: string): CardSettings {
    return readCardSettings(this.homeDir(name))
  }

  /**
   * Write one harness's settings-card overrides (`null` removes a field) and
   * tell the harness's settings face, so the change reaches the next round
   * without a reload.
   * @param name - the harness name.
   * @param patch - field → value, or null to fall back to the row config.
   * @returns the stored values after the write.
   */
  setCardSettings(name: string, patch: Readonly<Record<string, CardSettingValue | null>>): CardSettings {
    const next = writeCardSettings(this.homeDir(name), patch)
    for (const listener of [...this.cardSettingsListeners.get(name) ?? []]) {
      try { listener(next) } catch (error: unknown) { this.ctx.logger.warn(`localAgent: ${name} card-settings listener failed: ${String(error)}`) }
    }
    return next
  }

  /**
   * Observe one harness's card-settings writes.
   * @param name - the harness name.
   * @param listener - receives the stored values after each write.
   * @returns the disposer.
   */
  onCardSettings(name: string, listener: (next: CardSettings) => void): () => void {
    let set = this.cardSettingsListeners.get(name)
    if (set === undefined) this.cardSettingsListeners.set(name, set = new Set())
    set.add(listener)
    return () => { set.delete(listener) }
  }

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
    const pending = (async () => { await harness.provision?.(dir) })().catch((error: unknown) => {
      this.ctx.logger.warn(
        `localAgent: ${name} provisioning of scope ${scope} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    this.scopeProvisioning.set(key, pending)
    void pending
  }

  /**
   * Provision ONE scope deliberately, with per-scope inputs, and report what
   * the scope now holds.
   *
   * The difference from the materialization above is the whole reason this
   * exists. Materialization runs once per (harness, scope) per host process,
   * passes no options, and swallows failures — right for "somebody named a
   * scope". A caller that provisions a scope on purpose is asking a question
   * (`compose this preset`), needs the answer (`this is what it composes
   * now`), and needs the failure (a preset that could not be composed must
   * not read as one that was). So this one awaits, propagates, and returns
   * the harness's read-back.
   *
   * A harness with no `provision` hook is not an error: there is simply
   * nothing to do, and the caller's own read-back — the file it was going to
   * check anyway — reports what is actually there.
   * @param name - the harness name.
   * @param scope - the named scope, or undefined for the default scoped home.
   * @param options - per-scope inputs for the harness's provisioning.
   * @returns the scoped home plus whatever the harness read back.
   * @throws whatever the harness's provisioning throws.
   */
  async provisionScope(
    name: string,
    scope?: string,
    options?: LocalAgentScopeProvisionOptions,
  ): Promise<LocalAgentScopeProvisionResult & { homeDir: string }> {
    const dir = this.homeDir(name, scope)
    if (scope !== undefined) {
      // The materialization this call may just have started writes the same
      // files. Let it finish rather than interleave with it.
      await this.scopeProvisioning.get(scopedHomeName(name, scope))
    }
    const harness = this.harnesses.get(name)
    if (harness?.provision === undefined) return { homeDir: dir }
    const run = (async () => harness.provision?.(dir, options))()
    if (scope !== undefined) this.scopeProvisioning.set(scopedHomeName(name, scope), run.then(() => {}, () => {}))
    const result = await run
    return { homeDir: dir, ...(result ?? {}) }
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

  /** Reconstruct one member's historical model and tool timing without changing either log. */
  async memberModelTiming(childSessionId: string): Promise<LocalAgentMemberModelTiming | undefined> {
    const record = this.getDelegation(childSessionId)
    if (record === undefined) return undefined
    const harness = this.harnessForProvider(record.provider)
    if (harness?.timing === undefined) return undefined
    const home = this.homeDir(harness.name, record.scope)
    const events = await this.readMemberEvents(childSessionId)
    return events === undefined ? harness.timing.read(home, record.cliSessionId) : harness.timing.read(home, record.cliSessionId, events)
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
    const binding = this.memberControls.binding(record.childSessionId)
    if (binding !== undefined) record = {
      // The model a resume re-requests is the bound one, verbatim: a provider
      // recording its resolved model ('opus' → 'claude-opus-5-5', or the
      // default a model-less start resolved to) would make the next round's
      // binding differ and the member refuse it ("identity changed: model").
      ...withoutModel(record),
      ...binding.model === undefined ? {} : { model: binding.model },
      ...binding.effort === undefined ? {} : { effort: binding.effort },
      ...binding.configurationLock === undefined ? {} : { configurationLock: binding.configurationLock },
    }
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
   * `ctx.subagents.startActivation()`; the provider consumes exactly one per
   * start via {@link takeDelegationIntent}, so the per-(parent, provider)
   * FIFO pairs fresh and resume rounds even under parallel delegations from
   * one parent.
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
   * still queued. The delegation facade calls this when `ctx.subagents.startActivation()`
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
      readonly observedEffort?: string
      readonly observedModel?: string
      readonly cliVersion?: string
      readonly usage?: TokenUsage
      /**
       * The CLI's OWN whole-round total, only when the CLI reports one
       * (claude's `result.usage`, codex's turn total) — never a sum the
       * provider computed from the per-call usage it mirrored. It lands on the
       * execution's end record as `providerReportedUsage`.
       */
      readonly providerReportedUsage?: TokenUsage
      readonly toolCalls?: LocalAgentToolCalls
      /**
       * Background-task results the CLI folded into this round while it ran
       * (a Kimi task that ended mid-round). They land on the execution's end
       * record as `taskResults`; the room marks the reply with them.
       */
      readonly taskResults?: readonly LocalAgentFoldedTaskResult[]
    },
  ): void {
    this.executions.noteReport(childSessionId, round.providerReportedUsage, {
      ...round.observedModel === undefined ? {} : { observedModel: round.observedModel },
      ...round.observedEffort === undefined ? {} : { observedEffort: round.observedEffort },
      ...round.cliVersion === undefined ? {} : { cliVersion: round.cliVersion },
      ...round.taskResults === undefined || round.taskResults.length === 0 ? {} : { taskResults: round.taskResults },
    })
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
      ...round.observedEffort === undefined ? {} : { observedEffort: round.observedEffort },
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

  private memberBridgeAvailable = false

  /** Listener lifecycle owns this flag; it is never persisted across host restarts. */
  setMemberBridgeAvailable(available: boolean): void { this.memberBridgeAvailable = available }

  /** Transport/readiness capability only; authenticated generation needs separate acceptance. */
  canCoordinateRoom(childSessionId: string): boolean {
    const binding = this.memberBinding(childSessionId)
    return this.memberBridgeAvailable && binding !== undefined && this.harnessForProvider(binding.provider)?.prepareMember !== undefined
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

  private memberToolsCheck: ((token: string) => Promise<string | undefined>) | undefined

  /** The member channel installs (and on dispose removes) the check behind {@link memberToolsStale}. */
  setMemberToolsCheck(check: ((token: string) => Promise<string | undefined>) | undefined): void {
    this.memberToolsCheck = check
  }

  /**
   * Round-start self-heal, provider-generic: whether the resident member
   * process behind a bridge token must be replaced before the round because
   * its CLI lacks its mode tools (it was served the bridge's placeholder, or
   * an empty list while its mode has tools, or its token is gone). A live
   * driver calls this between rounds — never mid-round — and on a reason
   * retires the runtime, so the round respawns a fresh process that lists
   * again (resuming the same CLI session). Undefined without a member channel.
   * @param token - the member process's bridge token.
   * @returns why to respawn, or undefined to keep the process.
   */
  async memberToolsStale(token: string): Promise<string | undefined> {
    try {
      return await this.memberToolsCheck?.(token)
    } catch (error) {
      this.ctx.logger.warn(`localAgent: the member tool check failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  private memberToolsFace: MemberToolsFace | undefined

  /** The member channel installs (and on dispose removes) the bookkeeping behind the 模式工具 read and reload. */
  setMemberToolsFace(face: MemberToolsFace | undefined): void {
    this.memberToolsFace = face
  }

  /**
   * The member-channel token of the member's current process: the most
   * recently registered one still valid (a resident live process, or an
   * exec run in flight). Undefined = no process.
   * @param childSessionId - the member's child session.
   * @returns the token, or undefined.
   */
  currentMemberToken(childSessionId: string): string | undefined {
    let current: string | undefined
    for (const [token, run] of this.memberRuns) {
      if (run.childSessionId === childSessionId) current = token
    }
    return current
  }

  /**
   * What the member's current process holds of its mode tools (the room's
   * edit dialog). Null without a member channel, for an unknown member, or
   * for a member without a mode.
   * @param childSessionId - the member's child session.
   * @returns the status, or null.
   */
  async memberToolsStatus(childSessionId: string): Promise<LocalAgentMemberToolsStatus | null> {
    try {
      return await this.memberToolsFace?.status(childSessionId) ?? null
    } catch (error) {
      this.ctx.logger.warn(`localAgent: the member tool status read failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * Replace the member's resident process so it lists its mode tools again,
   * resuming the same CLI session without a round. An idle member reloads
   * now; a running one right after its round ends (never interrupted).
   * A member whose resident process runs CLI background tasks is refused
   * (`background-tasks`, nothing done) unless the caller confirmed.
   * @param childSessionId - the member's child session.
   * @param options - `confirmBackgroundTasks`: the user accepted that those tasks lose their process.
   * @returns when it happens, or why it cannot.
   */
  async reloadMemberTools(childSessionId: string, options: LocalAgentMemberToolsReloadOptions = {}): Promise<LocalAgentMemberToolsReload> {
    const face = this.memberToolsFace
    const binding = this.memberBinding(childSessionId)
    if (face === undefined || binding === undefined) return { ok: false, reason: 'unknown-member' }
    const harness = this.harnessForProvider(binding.provider)
    // Resolved before the pending check, so the reload below is entered
    // synchronously after it, as it always was.
    const identity = await this.memberProcessIdentity(binding)
    if (face.reloadPending(childSessionId)) return { ok: false, reason: 'busy' }
    // An explicit load recovers a failed native start first (11-04: a Kimi
    // member whose start failed after a host restart kept failing in 0 ms,
    // and 对账并重试 lived only in its own session). A selection that did
    // not apply still waits for the user's own retry or cancel.
    const recovery = await this.recoverFailedStart(binding)
    if (recovery !== undefined) return recovery
    const oldToken = this.currentMemberToken(childSessionId)
    // No process at all (a host restart, an idle reclaim): start one now
    // where the harness can (立即载入), instead of waiting for a message.
    if (oldToken === undefined && harness?.startMember !== undefined) return await this.startMemberProcess(childSessionId, binding, harness, face)
    if (harness?.reloadMember === undefined) return { ok: false, reason: 'unsupported' }
    if (options.confirmBackgroundTasks !== true && harness.backgroundTasks !== undefined) {
      const running = await this.runningBackgroundTasks(childSessionId)
      if (running > 0) return { ok: false, reason: 'background-tasks', running }
    }
    let accepted = false
    let startedEarly = false
    const reloadMember = harness.reloadMember
    const handle = withMemberProcessIdentity(identity, () => reloadMember(childSessionId, {
      onStart: () => {
        if (accepted) face.reloadStarted(childSessionId)
        else startedEarly = true
      },
    }))
    if (handle === undefined) return { ok: false, reason: 'no-process' }
    accepted = true
    face.reloadAccepted(childSessionId, handle.when)
    if (startedEarly) face.reloadStarted(childSessionId)
    void handle.done.then(
      (outcome) => { face.reloadDone(childSessionId, outcome, oldToken) },
      (error: unknown) => { face.reloadDone(childSessionId, 'failed', oldToken, error instanceof Error ? error.message : String(error)) },
    )
    return { ok: true, when: handle.when }
  }

  /**
   * 立即载入 / 重新载入's first step: a member whose configuration failed on
   * a native start (no selection waiting) is reconciled and retried before
   * the load. Nothing reaches a model here.
   * @param binding - the member's execution identity.
   * @returns undefined to go on, or the refusal carrying the new reason.
   */
  private async recoverFailedStart(binding: LocalAgentMemberBinding): Promise<LocalAgentMemberToolsReload | undefined> {
    if (!this.supportsMemberConfiguration(binding.provider)) return undefined
    let control: MemberConfigurationController
    try { control = this.memberControls.get(binding) } catch { return undefined }
    if (!control.startFailed()) return undefined
    try {
      await control.retry(control.read().revision)
      return undefined
    } catch (error) {
      const state = control.read()
      return { ok: false, reason: 'start-failed', error: state.error ?? (error instanceof Error ? error.message : String(error)) }
    }
  }

  /**
   * Whether 立即载入 can start the member's process now: it has none, its
   * delegation recorded a CLI session to resume, no round is starting or
   * running (no resume lock, nothing queued), and its harness can start one.
   * @param childSessionId - the member's child session.
   * @returns whether a start would be accepted.
   */
  canStartMemberProcess(childSessionId: string): boolean {
    const binding = this.memberBinding(childSessionId)
    if (binding === undefined || this.currentMemberToken(childSessionId) !== undefined) return false
    const record = this.getDelegation(childSessionId)
    if (record === undefined || record.cliSessionId === '' || record.provider !== binding.provider) return false
    if (this.isResumeLocked(childSessionId) || this.queuedMemberRounds(childSessionId) > 0) return false
    const harness = this.harnessForProvider(binding.provider)
    if (harness?.startMember === undefined || harness.canStartMember === undefined) return false
    try { return harness.canStartMember(childSessionId) } catch { return false }
  }

  /**
   * 立即载入: start the member's resident process without a round, resuming
   * its recorded CLI session, so its tools list now. Admitted through the
   * member's configuration queue like a round (a round asked for meanwhile
   * waits for it), but nothing reaches a model.
   */
  private async startMemberProcess(childSessionId: string, binding: LocalAgentMemberBinding, harness: LocalAgentHarness, face: MemberToolsFace): Promise<LocalAgentMemberToolsReload> {
    if (!this.canStartMemberProcess(childSessionId)) {
      return { ok: false, reason: this.isResumeLocked(childSessionId) || this.queuedMemberRounds(childSessionId) > 0 ? 'busy' : 'no-process' }
    }
    if (!await face.seated(childSessionId).catch(() => false)) return { ok: false, reason: 'unknown-member' }
    // Re-check after the await: a round may have started meanwhile.
    if (!this.canStartMemberProcess(childSessionId) || face.reloadPending(childSessionId)) return { ok: false, reason: 'busy' }
    const record = this.getDelegation(childSessionId)!
    const start = harness.startMember!
    face.reloadAccepted(childSessionId, 'now')
    face.reloadStarted(childSessionId)
    const run = async (configuration?: LocalAgentAppliedConfiguration): Promise<'respawned' | 'no-process' | 'failed'> => {
      await this.reattachChildSession(childSessionId)
      const childSession = this.ctx.get('sessions')?.get(SessionId(childSessionId))
      if (childSession === undefined) return 'no-process'
      const turn = childSession.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      return await this.asMemberProcess(binding, () => start({ binding, childSession, resume: { cliSessionId: record.cliSessionId, turn }, ...configuration === undefined ? {} : { configuration } }))
    }
    const done = this.supportsMemberConfiguration(binding.provider)
      ? this.memberControls.withAdmission(binding, configuration => run(configuration))
      : run()
    void done.then(
      (outcome) => { face.reloadDone(childSessionId, outcome, undefined) },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.ctx.logger.warn(`localAgent: starting member ${childSessionId}'s process failed: ${message}`)
        face.reloadDone(childSessionId, 'failed', undefined, message)
      },
    )
    return { ok: true, when: 'now' }
  }

  /**
   * A live driver replaced a member's process at round start because it
   * lacked its mode tools (after {@link memberToolsStale} gave a reason):
   * the edit dialog shows it until the next normal load, and the room gets
   * one line before the round.
   * @param childSessionId - the member's child session.
   * @param oldToken - the replaced process's token.
   */
  noteMemberToolsRespawn(childSessionId: string, oldToken: string | undefined): void {
    try {
      this.memberToolsFace?.autoReloaded(childSessionId, oldToken)
    } catch (error) {
      this.ctx.logger.warn(`localAgent: recording a member respawn failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * A harness took a member's resident process away while some of its CLI
   * background tasks ran in it (member-self-started-rounds C①: the
   * keep-alive cap, a reload, a model switch): those tasks lost contact.
   * Re-emitted as `localAgent/background-tasks-lost` with the member's parent
   * session, so the room records the loss and tells the dispatcher when it
   * happens (a host restart's losses are found by the startup scan instead).
   * Plugin unload does not report (the next host start reads those tasks as
   * `host-restart`). Never throws: a missing parent drops the report.
   * @param childSessionId - the member's child session.
   * @param taskIds - the CLI's ids of the tasks that ran in the process.
   * @param because - why the process went away (only `process-reclaimed` today).
   */
  noteBackgroundTasksLost(childSessionId: string, taskIds: readonly string[], because: LocalAgentBackgroundTasksLost['because'] = 'process-reclaimed'): void {
    try {
      const parentSessionId = this.delegations.get(childSessionId)?.parentSessionId ?? this.memberBinding(childSessionId)?.parentSessionId
      if (parentSessionId === undefined || parentSessionId === '' || taskIds.length === 0) return
      this.ctx.emit('localAgent/background-tasks-lost', { childSessionId, parentSessionId, taskIds: [...taskIds], because })
    } catch (error) {
      this.ctx.logger.warn(`localAgent: reporting lost background tasks failed: ${error instanceof Error ? error.message : String(error)}`)
    }
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

  /** Prepare a roster-owned identity without a paid prompt; repeated calls coalesce. */
  prepareMember(parentSessionId: string, provider: string, childSessionId: string, options: DelegationCallOptions = {}): Promise<string> {
    const signature = JSON.stringify([parentSessionId, provider, options.cwd, options.scope, options.model, options.effort, options.configurationLock, options.exec, options.preparedMemberId])
    const existing = this.preparations.get(childSessionId)
    if (existing !== undefined) return existing.signature === signature ? existing.promise : Promise.reject(new Error('Prepared member identity cannot change'))
    const preparation = this.prepareMemberNow(parentSessionId, provider, childSessionId, options)
      .finally(() => this.preparations.delete(childSessionId))
    this.preparations.set(childSessionId, { signature, promise: preparation })
    return preparation
  }

  private async prepareMemberNow(parentSessionId: string, provider: string, childSessionId: string, options: DelegationCallOptions): Promise<string> {
    options.signal?.throwIfAborted()
    if (options.exec !== undefined || options.preparedMemberId !== undefined) throw new Error('Member preparation requires a live local harness')
    const parent = this.requireLiveParent(parentSessionId)
    this.requireProvider(this.requireSubagents(), provider)
    const harness = this.harnessForProvider(provider)
    if (harness?.prepareMember === undefined) throw new Error('Harness has no native member preparation capability')
    const cwd = resolveChildCwd(parent.session.header.cwd, options.cwd)
    if (cwd === undefined || !statSync(cwd).isDirectory()) throw new Error('Member working directory is unavailable')
    const binding: LocalAgentMemberBinding = { childSessionId, parentSessionId, provider, cwd,
      ...options.scope === undefined ? {} : { scope: options.scope },
      ...options.model === undefined ? {} : { model: options.model },
      ...options.effort === undefined ? {} : { effort: options.effort },
      ...options.configurationLock === undefined ? {} : { configurationLock: options.configurationLock },
    }
    const previous = this.preparedMembers.read(childSessionId)
    if (previous !== undefined && JSON.stringify(previous.binding) !== JSON.stringify(binding)) throw new Error('Prepared member identity cannot change')
    if (previous?.phase === 'starting' || previous?.phase === 'used' || this.getDelegation(childSessionId) !== undefined) throw new Error('Member has already entered execution; use its existing controls')
    const status = await this.statusOf(harness.name, options.scope)
    if (!status.authenticated) throw new Error('Member harness is not authenticated in its bound scope')
    this.preparedMembers.write({ version: 1, binding, phase: 'preparing' })
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('Session store is unavailable')
    let childSession = sessions.get(SessionId(childSessionId))
    if (childSession === undefined) {
      const stored = await this.ctx.get('sessionPersistence')?.stat(SessionId(childSessionId))
      if (stored !== undefined && stored !== null) {
        await this.reattachChildSession(childSessionId)
        childSession = sessions.get(SessionId(childSessionId))
      }
      childSession ??= sessions.create(SessionId(childSessionId), { meta: { cwd, parentSession: parent.session.id, origin: 'subagent', delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1 } })
    }
    if (childSession.header.parentSession !== parent.session.id || childSession.header.cwd !== cwd) throw new Error('Prepared transcript identity does not match its parent')
    this.guardChildSession(childSession)
    const control = this.memberControls.get(binding)
    // An explicit repeated preparation retries only pre-execution failure.
    // The durable starting/used barrier above never admits uncertain paid work.
    if (control.read().status === 'failed') await control.retry(control.read().revision)
    const lease = await control.admit(`prepare:${randomUUID()}`)
    try {
      const prepare = harness.prepareMember
      await this.asMemberProcess(binding, () => prepare({ binding, childSession, configuration: lease.configuration, signal: options.signal ?? AbortSignal.timeout(30_000) }))
      await this.syncChildSession(childSession, true)
      this.preparedMembers.write({ version: 1, binding, phase: 'ready' })
    } catch (error) { control.rejectAdmission(error); throw error }
    finally { lease.release() }
    return childSessionId
  }

  isPreparedMember(childSessionId: string): boolean { return this.preparedMembers.read(childSessionId)?.phase === 'ready' && this.getDelegation(childSessionId) === undefined }

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
   * session id, minted here and carried to the provider through the staged
   * intent — host 0.2.1's `startActivation` never surfaces it on the
   * activation) until `run.result` settles; {@link cancel} aborts it by that
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
    // A thin wrapper over the execution entry (batch 5 S4): the same checks
    // fail before anything is queued, then the round goes through the
    // member's ledger like every other execution.
    const prepared = options?.preparedMemberId === undefined ? undefined : this.preparedMembers.read(options.preparedMemberId)
    if (options?.preparedMemberId !== undefined) {
      if (prepared?.phase !== 'ready' || prepared.binding.parentSessionId !== parentSessionId || prepared.binding.provider !== provider) throw new Error('Prepared member is unavailable or belongs to another parent/provider')
      if (options.model !== undefined || options.effort !== undefined || options.cwd !== undefined || options.scope !== undefined || options.exec !== undefined || options.configurationLock !== undefined) throw new Error('Prepared member start inherits its fixed creation identity')
      if (this.preparations.has(prepared.binding.childSessionId)) throw new Error('Member preparation is still in progress')
    }
    this.requireProvider(this.requireSubagents(), provider)
    this.requireLiveParent(parentSessionId)
    const minted = prepared?.binding.childSessionId ?? randomUUID()
    return await this.submitExecution(legacyPlan('start', parentSessionId, provider, minted, prompt, options)).started
  }

  /** The first-round body behind {@link start} and {@link run}: stage the fresh intent and start the provider. */
  private async startRound(
    parentSessionId: string,
    provider: string,
    prompt: ContentBlock[],
    options: DelegationCallOptions | undefined,
    minted: string,
    execution: LocalAgentExecutionIntent,
  ): Promise<SubagentRun> {
    const prepared = options?.preparedMemberId === undefined ? undefined : this.preparedMembers.read(options.preparedMemberId)
    if (options?.preparedMemberId !== undefined) {
      if (prepared?.phase !== 'ready' || prepared.binding.parentSessionId !== parentSessionId || prepared.binding.provider !== provider) throw new Error('Prepared member is unavailable or belongs to another parent/provider')
      if (options.model !== undefined || options.effort !== undefined || options.cwd !== undefined || options.scope !== undefined || options.exec !== undefined || options.configurationLock !== undefined) throw new Error('Prepared member start inherits its fixed creation identity')
      this.requireProvider(this.requireSubagents(), provider)
      this.requireLiveParent(parentSessionId)
      if (this.preparations.has(prepared.binding.childSessionId)) throw new Error('Member preparation is still in progress')
      this.preparedMembers.write({ ...prepared, phase: 'starting' })
      options = { ...options, ...prepared.binding, preparedMemberId: prepared.binding.childSessionId }
      await this.reattachChildSession(prepared.binding.childSessionId)
    }
    const subagents = this.requireSubagents()
    this.requireProvider(subagents, provider)
    const parent = this.requireLiveParent(parentSessionId)
    // The durable child identity is caller-minted here: host 0.2.1 activations
    // forbid a provider run id that names a live Session (the manager rejects
    // it as DUPLICATE_CHILD), so the provider's returned run carries a
    // per-execution id and the child session id rides the staged intent — the
    // same channel the prepared-member path already used for it.
    const childSessionId = prepared?.binding.childSessionId ?? minted
    // The cwd override rides the staged intent, not the host seam (the
    // SubagentStartRequest contract's cwd is the manager-resolved directory,
    // not the family's resolveChildCwd override): the provider consumes it as
    // the resolveChildCwd override.
    const intent: LocalAgentDelegationIntent = {
      kind: 'fresh',
      ...options?.onAdmitted === undefined ? {} : { onAdmitted: options.onAdmitted },
      execution,
      ...options?.preparedMemberId === undefined ? {} : { preparedMemberId: options.preparedMemberId },
      ...prepared === undefined ? { childSessionId } : {},
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
      ...options?.effort === undefined ? {} : { effort: options.effort },
      ...options?.configurationLock === undefined ? {} : { configurationLock: options.configurationLock },
    }
    this.stageDelegationIntent(parentSessionId, provider, intent)
    const controller = new AbortController()
    let run: SubagentRun
    try {
      // Caller delivery: the family collects the result itself and pushes it
      // through its own Remote; the parent agent gets no completion notice.
      // The activation spec's label is required, so the absent-description
      // case rides through as the empty string, which the provider's label
      // composition reads as "no description" (the harness display name wins).
      const activation = await subagents.startActivation(
        callerActivationSpec(provider, options?.label ?? '', prompt, parent, fusedSignal(controller, options?.signal)),
      )
      run = activationRun(activation, childSessionId, options?.signal, message => this.ctx.logger.warn(message))
    } catch (error: unknown) {
      this.unstageDelegationIntent(parentSessionId, provider, intent)
      throw error
    }
    this.trackRun(childSessionId, controller, run, options?.onProgress)
    if (prepared !== undefined) {
      try { this.preparedMembers.write({ ...prepared, phase: 'used' }) }
      catch (error) {
        // The durable starting barrier still prevents replay. Keep the actual
        // published run reachable for cancellation and result delivery.
        this.ctx.logger.warn(`localAgent: finalizing prepared member ${run.id} failed: ${String(error)}`)
      }
    }
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
   *    constraint, since `ctx.subagents.startActivation` requires a live parent;
   * 5. child-session REATTACH when `ctx.sessions.get(childSessionId)` is
   *    undefined (recipe below; `opts.reattach === false` disables this step
   *    and fails loud on a non-live child instead);
   * 6. stage `{ kind: 'resume', childSessionId, cliSessionId }` and, in the
   *    same synchronous flow, `await ctx.subagents.startActivation({…})`;
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
   *   // Close a turn a restart interrupted, or the next round's turn/start
   *   // makes the stored log unreadable.
   *   const closers = interruptedTurnClosers(cold.events)
   *   if (closers.length > 0) await handle.append(closers)
   *   const session = ctx.sessions.prepare(SessionId(childSessionId), {
   *     seed: [...cold.events, ...closers],
   *     meta: structuredClone(handle.header),
   *     inheritedEventCount: handle.inheritedEventCount,
   *     eventState: cold.eventState,
   *   })
   *   // The seeded constructor's session/end-seed marker lands before enter()
   *   // installs publication hooks — push the unstored suffix through the
   *   // handle directly, or the writer's contiguous cursor diverges.
   *   const unstored = session.snapshotEvents().slice(cold.events.length + closers.length)
   *   if (unstored.length > 0) await handle.append(unstored)
   *   const detach = ctx.sessions.enter(session)
   *   try { ctx.sessions.announce(session) }
   *   catch (error) { detach(); throw error }
   *   // Hold BOTH for the reattached lifetime: the backend routes live
   *   // session/event appends into the per-id writer only while the write
   *   // handle is open; closing it ends persistence for the session.
   * } catch (error) {
   *   await handle.close().catch(() => {})
   *   throw error
   * }
   * ```
   *
   * Hold `detach` and `handle` for the plugin lifetime. Announce the restored
   * live session after entering it, rolling back detach if announcement fails.
   * History followers need this lifecycle edge to replay the constructor's
   * end-seed suffix before the provider publishes subsequent events.
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
    // A thin wrapper over the execution entry (batch 5 S4): the documented
    // checks fail before anything is queued; the round itself runs from the
    // member's ledger.
    this.checkResume(parentSessionId, provider, childSessionId, options, true)
    this.requireLiveParent(parentSessionId)
    return await this.submitExecution(legacyPlan('resume', parentSessionId, provider, childSessionId, prompt, options)).started
  }

  /** The continuation body behind {@link resume} and {@link run}: reattach, stage the resume intent, start the provider. */
  private async resumeRound(
    parentSessionId: string,
    provider: string,
    childSessionId: string,
    prompt: ContentBlock[],
    options: DelegationCallOptions | undefined,
    execution: LocalAgentExecutionIntent,
  ): Promise<SubagentRun> {
    // The ledger dispatches a member's rounds one at a time, so the resume
    // lock probe is the wrapper's alone.
    const { cliSessionId } = this.checkResume(parentSessionId, provider, childSessionId, options, false)
    const subagents = this.requireSubagents()
    const parent = this.requireLiveParent(parentSessionId)
    return this.resumeStaged(subagents, parent, parentSessionId, provider, childSessionId, cliSessionId, prompt, options, execution)
  }

  /** {@link resume}'s checks that need no I/O (steps 1–3). */
  private checkResume(parentSessionId: string, provider: string, childSessionId: string, options: DelegationCallOptions | undefined, probeLock: boolean): { cliSessionId: string } {
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
    if (options?.effort !== undefined || options?.configurationLock !== undefined) {
      throw new Error('localAgent: resume reuses the member configuration; use member controls to change effort')
    }
    if (options?.model !== undefined) {
      throw new Error(
        `localAgent: resume does not take a model — child session ${childSessionId} re-requests the model its first `
        + 'round recorded; start a new delegation to run another model',
      )
    }
    if (probeLock && this.isResumeLocked(childSessionId) && !this.supportsMemberConfiguration(provider)) {
      throw new Error(`localAgent: child session ${childSessionId} already has an in-flight resume`)
    }
    return { cliSessionId }
  }

  /** {@link resume} steps 5–8: reattach, stage, start, track. */
  private async resumeStaged(
    subagents: SubagentRuntime,
    parent: Agent,
    parentSessionId: string,
    provider: string,
    childSessionId: string,
    cliSessionId: string,
    prompt: ContentBlock[],
    options: DelegationCallOptions | undefined,
    execution: LocalAgentExecutionIntent,
  ): Promise<SubagentRun> {
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
      ...options?.onAdmitted === undefined ? {} : { onAdmitted: options.onAdmitted },
      execution,
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
      ...options?.operation === undefined ? {} : { operation: options.operation },
    }
    this.stageDelegationIntent(parentSessionId, provider, intent)
    const controller = new AbortController()
    let run: SubagentRun
    try {
      // Caller delivery (see start): the family self-collects the result and
      // pushes it through its own Remote; the resumed child session id stays
      // the tracking key while the activation carries the provider's
      // per-execution id.
      const activation = await subagents.startActivation(
        callerActivationSpec(provider, options?.label ?? '', prompt, parent, fusedSignal(controller, options?.signal)),
      )
      run = activationRun(activation, childSessionId, options?.signal, message => this.ctx.logger.warn(message))
    } catch (error: unknown) {
      this.unstageDelegationIntent(parentSessionId, provider, intent)
      throw error
    }
    this.trackRun(childSessionId, controller, run, options?.onProgress)
    if (options?.operation === 'compact') {
      this.compactingRuns.set(childSessionId, run)
      const clear = (): void => { if (this.compactingRuns.get(childSessionId) === run) this.compactingRuns.delete(childSessionId) }
      void run.result.then(clear, clear)
    }
    return run
  }

  /** The member's in-flight compaction round, by child session id. */
  private readonly compactingRuns = new Map<string, SubagentRun>()
  /** A cold member session's occupancy, read once from the stored log (it cannot move until a round revives the session). */
  private readonly coldContexts = new Map<string, Promise<Omit<LocalAgentMemberContext, 'state'> | undefined>>()

  /**
   * A member's context occupancy: the latest `local-agent/context`, or a
   * later completed compaction's after-count, from the child log. undefined
   * when the session is not a family member.
   * @param childSessionId - the member's dsh child session.
   * @returns occupancy and run state.
   */
  async memberContext(childSessionId: string): Promise<LocalAgentMemberContext | undefined> {
    const record = this.delegations.get(childSessionId)
    if (record === undefined) return undefined
    const state = this.compactingRuns.has(childSessionId) ? 'compacting' : this.runs.has(childSessionId) ? 'running' : 'idle'
    const live = this.ctx.get('sessions')?.get(SessionId(childSessionId))
    let reading: Omit<LocalAgentMemberContext, 'state'> | undefined
    if (live !== undefined) {
      this.coldContexts.delete(childSessionId)
      reading = memberContextOf(live.snapshotEvents())
    } else {
      let cold = this.coldContexts.get(childSessionId)
      if (cold === undefined) {
        cold = this.readStoredContext(childSessionId)
        this.coldContexts.set(childSessionId, cold)
      }
      reading = await cold
    }
    const harness = this.harnessForProvider(record.provider)
    return {
      provider: reading?.provider ?? record.provider, ...reading, state,
      ...harness === undefined ? {} : { harness: harness.name, harnessDisplayName: harness.displayName },
    }
  }

  /** {@link memberContext}'s cold read; undefined when the log is unreadable. */
  private async readStoredContext(childSessionId: string): Promise<Omit<LocalAgentMemberContext, 'state'> | undefined> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return undefined
    try {
      const reader = await persistence.open(SessionId(childSessionId), 'read')
      try {
        return memberContextOf((await reader.read(0)).events)
      } finally {
        await reader.close()
      }
    } catch {
      this.coldContexts.delete(childSessionId)
      return undefined
    }
  }

  /** Each member's execution readings, keyed by the log's last seq they were read at (live). */
  private readonly executionReadings = new Map<string, { readonly seq: number; readonly read: MemberExecutionRead }>()
  /** A cold member log's execution readings, read once from storage (it cannot move until a round revives it). */
  private readonly coldExecutionReadings = new Map<string, Promise<MemberExecutionRead | undefined>>()
  /** A cold grandchild log (a CLI subagent's), read once from storage while it is not live. */
  private readonly coldSubagentEvents = new Map<string, Promise<readonly SessionEvent[] | undefined>>()

  /**
   * Read one execution back from the member's log (batch 5 S6): the sum of
   * the per-call `assistant/message.usage` in its turns, the CLI's own round
   * total from its end record, its "not recorded" declarations, and the
   * compaction facts in its range. Computed, never stored: a live log is
   * re-read when it moved, a cold one is read once from storage.
   *
   * The member CLI's own subagents that ran for the execution
   * (member-cli-subagents M6) come with it: each grandchild the member's
   * catalog names (`<member>.sub.<id>`) is read the same way — live, or once
   * from storage — and every grandchild execution whose `cli-subagent` cause
   * names this execution is listed in `subagents`, their per-call sum in
   * `subagentUsage`, apart from the member's own `callUsage`.
   * @param childSessionId - the member's dsh child session.
   * @param executionId - the execution (room's run-state `executionId`).
   * @returns the reading, or undefined when the log holds no record of it or cannot be read.
   */
  async readExecution(childSessionId: string, executionId: string): Promise<LocalAgentExecutionReading | undefined> {
    const live = this.ctx.get('sessions')?.get(SessionId(childSessionId))
    let read: MemberExecutionRead | undefined
    if (live !== undefined) {
      this.coldExecutionReadings.delete(childSessionId)
      const events = live.snapshotEvents()
      const last = events.at(-1)
      const seq = last === undefined ? -1 : Number(last.seq)
      let cached = this.executionReadings.get(childSessionId)
      if (cached?.seq !== seq) {
        cached = { seq, read: memberExecutionRead(childSessionId, events) }
        this.executionReadings.set(childSessionId, cached)
      }
      read = cached.read
    } else {
      this.executionReadings.delete(childSessionId)
      let cold = this.coldExecutionReadings.get(childSessionId)
      if (cold === undefined) {
        cold = this.readStoredExecutions(childSessionId)
        this.coldExecutionReadings.set(childSessionId, cold)
      }
      read = await cold
    }
    const reading = read?.readings.get(executionId)
    if (reading === undefined) return undefined
    const out = structuredClone(reading)
    if (read!.subagentSessions.length === 0) return out
    const grandchildren: Array<{ sessionId: string; events: readonly SessionEvent[] }> = []
    for (const sessionId of read!.subagentSessions) {
      const events = await this.subagentEvents(sessionId)
      if (events !== undefined) grandchildren.push({ sessionId, events })
    }
    const { subagents, subagentUsage } = subagentReadingsFor(executionId, grandchildren)
    return {
      ...out,
      ...subagents.length === 0 ? {} : { subagents },
      ...subagentUsage === undefined ? {} : { subagentUsage },
    }
  }

  /** {@link readExecution}'s cold read; undefined (and not kept) when the log is unreadable. */
  private async readStoredExecutions(childSessionId: string): Promise<MemberExecutionRead | undefined> {
    const events = await this.readStoredEvents(childSessionId)
    if (events === undefined) {
      this.coldExecutionReadings.delete(childSessionId)
      return undefined
    }
    return memberExecutionRead(childSessionId, events)
  }

  /** A grandchild's events: the live snapshot, else one storage read kept while it stays cold. */
  private async subagentEvents(sessionId: string): Promise<readonly SessionEvent[] | undefined> {
    const live = this.ctx.get('sessions')?.get(SessionId(sessionId))
    if (live !== undefined) {
      this.coldSubagentEvents.delete(sessionId)
      return live.snapshotEvents()
    }
    let cold = this.coldSubagentEvents.get(sessionId)
    if (cold === undefined) {
      cold = this.readStoredEvents(sessionId).then((events) => {
        if (events === undefined) this.coldSubagentEvents.delete(sessionId)
        return events
      })
      this.coldSubagentEvents.set(sessionId, cold)
    }
    return cold
  }

  /** One stored session log's events; undefined when there is no persistence or it cannot be read. */
  private async readStoredEvents(sessionId: string): Promise<readonly SessionEvent[] | undefined> {
    const persistence = this.ctx.get('sessionPersistence')
    try {
      if (persistence === undefined) throw new Error('no session persistence')
      const reader = await persistence.open(SessionId(sessionId), 'read')
      try {
        return (await reader.read(0)).events
      } finally {
        await reader.close()
      }
    } catch {
      return undefined
    }
  }

  /**
   * A member's CLI background tasks (the `memberBackgroundTasks` Remote):
   * the harness reads the CLI's own task state; the core hands it lookups
   * over the member's child log (read only when the harness asks). Null for
   * a session that is not a family member; `supported: false` for a harness
   * without background tasks.
   * @param childSessionId - the member's dsh child session.
   * @returns the tasks, or null.
   */
  /**
   * How many of the member's CLI background tasks run in its live resident
   * process (a reload would cut them off); 0 when unreadable.
   */
  private async runningBackgroundTasks(childSessionId: string): Promise<number> {
    const read = await this.memberBackgroundTasks(childSessionId)
    if (read === null || !read.supported || !read.processAlive) return 0
    return read.tasks.filter(task => task.state === 'running').length
  }

  async memberBackgroundTasks(childSessionId: string, options: { readonly lookups?: boolean } = {}): Promise<LocalAgentBackgroundTasks | null> {
    const record = this.delegations.get(childSessionId)
    const binding = record === undefined ? this.memberBinding(childSessionId) : undefined
    const provider = record?.provider ?? binding?.provider
    if (provider === undefined) return null
    const harness = this.harnessForProvider(provider)
    if (harness?.backgroundTasks === undefined) return { supported: false, tasks: [], processAlive: false }
    let events: Promise<{ events: readonly SessionEvent[]; readings: Map<string, LocalAgentExecutionReading> } | undefined> | undefined
    const memberLog = () => events ??= this.readMemberEvents(childSessionId)
      .then(read => read === undefined ? undefined : { events: read, readings: executionReadingsOf(read) })
    const cliSessionId = record?.cliSessionId
    try {
      return await harness.backgroundTasks({
        childSessionId,
        homeDir: this.homeDir(harness.name, record?.scope ?? binding?.scope),
        ...cliSessionId === undefined || cliSessionId === '' ? {} : { cliSessionId },
        executionOfCall: async callId => {
          if (options.lookups === false) return undefined
          const log = await memberLog()
          return log === undefined ? undefined : executionOfToolCall(log.events, callId, log.readings)
        },
        selfExecutionOf: async taskId => {
          if (options.lookups === false) return undefined
          const log = await memberLog()
          return log === undefined ? undefined : selfExecutionOfTask(log.events, taskId)
        },
      })
    } catch (error) {
      this.ctx.logger.warn(`localAgent: the background task read failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * A member's CLI subagent calls (the `memberSubagentCalls` Remote; the
   * member session's subagent cards): the member's catalog rows name its
   * grandchild sessions, each grandchild execution with a `cli-subagent`
   * cause is one call's subagent. Null for a session that is not a family
   * member; an empty list for a member whose CLI ran none (or a log this
   * host cannot read).
   * @param childSessionId - the member's dsh child session.
   * @returns the calls, or null.
   */
  async memberSubagentCalls(childSessionId: string): Promise<LocalAgentSubagentCalls | null> {
    const provider = this.delegations.get(childSessionId)?.provider ?? this.memberBinding(childSessionId)?.provider
    if (provider === undefined) return null
    const events = await this.readMemberEvents(childSessionId)
    if (events === undefined) return { calls: [] }
    const grandchildren: Array<{ sessionId: string; events: readonly SessionEvent[] }> = []
    for (const sessionId of grandchildIdsOf(childSessionId, events)) {
      const read = await this.readMemberEvents(sessionId)
      if (read !== undefined) grandchildren.push({ sessionId, events: read })
    }
    return { calls: subagentCallsOf(grandchildren) }
  }

  /** A member's child-log events: the live session's snapshot, else one read from storage; undefined when unreadable. */
  private async readMemberEvents(childSessionId: string): Promise<readonly SessionEvent[] | undefined> {
    const live = this.ctx.get('sessions')?.get(SessionId(childSessionId))
    if (live !== undefined) return live.snapshotEvents()
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return undefined
    try {
      const reader = await persistence.open(SessionId(childSessionId), 'read')
      try {
        return (await reader.read(0)).events
      } finally {
        await reader.close()
      }
    } catch {
      return undefined
    }
  }

  /**
   * Compact a member's context: a resume round whose operation is
   * `compact`. It queues behind the member's running round like any round,
   * and input sent meanwhile waits for it (Kimi silently drops a prompt sent
   * while it compacts; Codex refuses one). The provider records one
   * `local-agent/compaction` event and writes no turn.
   * @param parentSessionId - the delegating parent session.
   * @param provider - the member's delegation provider.
   * @param childSessionId - the member's dsh child session.
   * @param options - the resume options (no prompt, no operation).
   * @returns the compaction run.
   */
  async compact(parentSessionId: string, provider: string, childSessionId: string, options?: Omit<DelegationCallOptions, 'operation'>): Promise<SubagentRun> {
    return this.resume(parentSessionId, provider, childSessionId, [{ type: 'text', text: COMPACT_COMMAND }], { ...options, operation: 'compact' })
  }

  /** In-flight ledger executions, by execution id: the round's open record once admitted. */
  private readonly ledgerExecutions = new Map<string, {
    open?: OpenExecution
    readonly settled: Promise<LocalAgentExecutionSettlement>
    readonly started: Promise<SubagentRun>
  }>()

  /**
   * The single execution entry (batch 5 S4). Every member execution — the
   * host `subagent` tool, the member composer, room, a plugin — is queued in
   * the member's ledger (durably, before this resolves), runs when it
   * reaches the head of that queue, is admitted at the one admission point
   * (`MemberControls`), and is recorded as one `local-agent/execution`.
   *
   * The core decides first round vs continuation: a member with a
   * delegation record continues (scope and cwd come from the record), a
   * prepared member starts its prepared identity, anything else starts fresh
   * under `member.childSessionId` with `member.create`.
   *
   * A `key` the member's ledger already holds never runs twice (see
   * {@link LocalAgentExecutionRequest.key}).
   * @param request - the execution request.
   * @returns the execution id and its settlement (and the published run).
   * @throws when the provider is not registered, the member's queue is
   *   paused with composer input waiting, or the key names an execution
   *   still queued or running elsewhere.
   */
  async run(request: LocalAgentExecutionRequest): Promise<LocalAgentExecutionHandle> {
    this.requireProvider(this.requireSubagents(), request.provider)
    return this.submitExecution({
      parentSessionId: request.parentSessionId,
      provider: request.provider,
      childSessionId: request.member.childSessionId,
      mode: 'auto',
      create: request.member.create,
      input: request.input,
      operation: request.operation ?? 'prompt',
      caller: request.caller ?? 'api',
      cause: request.cause,
      task: request.task,
      key: request.key,
      callerRef: request.callerRef,
      label: request.label ?? request.member.create?.label,
      ...request.preview === undefined || request.preview.trim() === '' ? {} : { preview: request.preview.trim().slice(0, 120) },
      signal: request.signal,
      on: request.on,
    })
  }

  /** Queue one plan in its member's ledger; see {@link run}. */
  private submitExecution(plan: ExecutionPlan): LocalAgentExecutionHandle {
    const ledger = this.memberInbox
    const memberId = plan.childSessionId
    if (plan.key !== undefined) {
      const existing = ledger.read(memberId).messages.find(row => row.key === plan.key)
      if (existing !== undefined) return this.existingExecution(existing)
    }
    plan.signal?.throwIfAborted()
    // Composer input may wait behind a paused queue (the members page shows
    // it); every other caller is refused at once.
    if (plan.caller !== 'composer') ledger.assertAdmission(memberId)
    const executionId = randomUUID()
    let resolveSettled!: (settlement: LocalAgentExecutionSettlement) => void
    let resolveStarted!: (run: SubagentRun) => void
    let rejectStarted!: (error: unknown) => void
    const settled = new Promise<LocalAgentExecutionSettlement>((resolve) => { resolveSettled = resolve })
    const started = new Promise<SubagentRun>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject })
    void started.catch(() => {})
    const entry: { open?: OpenExecution; settled: Promise<LocalAgentExecutionSettlement>; started: Promise<SubagentRun> } = { settled, started }
    this.ledgerExecutions.set(executionId, entry)
    const onAbort = (): void => {
      // A queued execution leaves the queue; a running one is stopped by the
      // same signal, fused into its round.
      try { if (ledger.find(memberId, executionId)?.status === 'queued') ledger.cancel(memberId, executionId) } catch (error) { this.ctx.logger.warn(`localAgent: cancelling queued execution ${executionId} failed: ${String(error)}`) }
    }
    const final = (row: LocalAgentMemberInput, run: SubagentRun | undefined, error: unknown): void => {
      plan.signal?.removeEventListener('abort', onAbort)
      if (run === undefined) rejectStarted(error ?? new Error(`localAgent: execution ${executionId} ended ${row.status} before it started`))
      void this.settlementOf(executionId, row, run, error, entry).then((settlement) => {
        this.ledgerExecutions.delete(executionId)
        try { plan.on?.settled?.(settlement) } catch (failure) { this.ctx.logger.warn(`localAgent: execution settled callback failed: ${String(failure)}`) }
        resolveSettled(settlement)
      })
    }
    try {
      ledger.submit(memberId, {
        id: executionId, caller: plan.caller,
        ...plan.key === undefined ? {} : { key: plan.key },
        ...plan.text === undefined ? {} : { text: plan.text },
        ...plan.preview === undefined ? {} : { preview: plan.preview },
        ...plan.operation === 'compact' ? { operation: 'compact' as const } : {},
      }, {
        dispatch: (signal, admitted) => this.dispatchExecution(plan, executionId, signal, admitted).then((run) => { resolveStarted(run); return run }),
        final,
      })
    } catch (error) {
      this.ledgerExecutions.delete(executionId)
      throw error
    }
    plan.signal?.addEventListener('abort', onAbort, { once: true })
    return { executionId, settled, started }
  }

  /**
   * Admit a round the member's CLI opened on its own — a background task it
   * started ended while the member was idle (member-self-started-rounds A②).
   * The CLI already runs it, so it is never queued: it takes the member's
   * slot at once (a `cli` ledger row, `running`), and every execution asked
   * for meanwhile waits for it in the ledger. It is recorded as one
   * `local-agent/execution` (caller `cli`, cause `self`) like any other:
   * the start lands in the member's child session before the harness's
   * `follow` opens the round's turn, the end when `follow` settles.
   *
   * `startedBy` follows recorded facts only: the task's tool call
   * (`taskCallId`) → the mirrored call's turn → the execution whose turns
   * hold it. Its start record's `task` is copied verbatim, so the round's
   * spend sums onto the task that started the background work. A missing
   * link leaves both out.
   *
   * Refused (undefined) when the session is not this provider's member, or
   * the member's slot is taken (a round is dispatched — the harness's own
   * collision handling owns that case), a row is uncertain, or its ledger
   * cannot be written.
   * @param request - the round, its cause, and how to follow it.
   * @returns the admitted execution, or undefined when refused.
   */
  async admitSelf(request: LocalAgentSelfAdmissionRequest): Promise<LocalAgentSelfAdmission | undefined> {
    const childSessionId = request.childSessionId
    const record = this.getDelegation(childSessionId)
    if (record === undefined || record.provider !== request.provider) return undefined
    const executionId = randomUUID()
    const entry: { open?: OpenExecution } = {}
    let resolveSettled!: (settlement: LocalAgentExecutionSettlement) => void
    const settled = new Promise<LocalAgentExecutionSettlement>((resolve) => { resolveSettled = resolve })
    let resolveAdmitted!: (admitted: { startedBy?: string; task?: LocalAgentTaskRef } | undefined) => void
    const admitted = new Promise<{ startedBy?: string; task?: LocalAgentTaskRef } | undefined>((resolve) => { resolveAdmitted = resolve })
    const dispatch = async (signal: AbortSignal): Promise<SubagentRun> => {
      await this.reattachChildSession(childSessionId)
      const session = this.ctx.get('sessions')?.get(SessionId(childSessionId))
      if (session === undefined) throw new Error(`localAgent: member ${childSessionId}'s child session is not live`)
      const events = session.snapshotEvents()
      const startedBy = request.taskCallId === undefined ? undefined : executionOfToolCall(events, request.taskCallId)
      const task = startedBy === undefined ? undefined : executionTaskOf(events, startedBy)
      const cause: LocalAgentSelfCause = { ...structuredClone(request.cause), ...startedBy === undefined ? {} : { startedBy } }
      const open = this.executions.admit({
        childSessionId,
        parentSessionId: record.parentSessionId,
        operation: 'prompt',
        provider: record.provider,
        execution: { executionId, caller: 'cli', cause, ...task === undefined ? {} : { task } },
        unrecorded: this.harnessForProvider(record.provider)?.unrecorded,
      })
      entry.open = open
      open.started()
      resolveAdmitted({ ...startedBy === undefined ? {} : { startedBy }, ...task === undefined ? {} : { task } })
      const result = Promise.resolve()
        .then(() => request.follow({ executionId, session, signal }))
        .catch((error: unknown): SubagentResult => ({ stopReason: signal.aborted ? 'aborted' : 'error', output: [], diagnostic: error instanceof Error ? error.message : String(error) }))
      void result.then(settledResult => open.settle(executionOutcome(settledResult)))
      return { id: SessionId(executionId), result, dispose: async () => {} } as SubagentRun
    }
    let row: LocalAgentMemberInput | undefined
    try {
      row = this.memberInbox.runNow(childSessionId, { id: executionId, caller: 'cli' }, {
        dispatch: signal => dispatch(signal),
        final: (ended, run, error) => {
          resolveAdmitted(undefined)
          void this.settlementOf(executionId, ended, run, error, entry).then(resolveSettled)
        },
      })
    } catch (error) {
      this.ctx.logger.warn(`localAgent: admitting member ${childSessionId}'s self-opened round failed: ${String(error)}`)
      return undefined
    }
    if (row === undefined) return undefined
    this.memberControls.hold(childSessionId, settled)
    const facts = await admitted
    // The follow never started (the child could not be made live): the row
    // already ended failed, and the CLI's round folds into the next one.
    if (facts === undefined) return undefined
    return { executionId, ...facts, settled }
  }

  /** A key the ledger already holds: the same execution, its settlement, or an error. */
  private existingExecution(row: LocalAgentMemberInput): LocalAgentExecutionHandle {
    const live = this.ledgerExecutions.get(row.id)
    if (live !== undefined) return { executionId: row.id, settled: live.settled, started: live.started }
    if (row.status === 'uncertain') throw new Error(`localAgent: execution ${row.id} (key ${row.key ?? ''}) has an uncertain outcome; reconcile it before continuing`)
    if (row.status === 'queued' || row.status === 'running') throw new Error(`localAgent: execution ${row.id} (key ${row.key ?? ''}) is already ${row.status}`)
    const settlement: LocalAgentExecutionSettlement = {
      executionId: row.id, outcome: rowOutcome(row.status), turns: [],
      ...row.error === undefined ? {} : { error: row.error },
    }
    const started = Promise.reject(new Error(`localAgent: execution ${row.id} already ended ${row.status}`))
    void started.catch(() => {})
    return { executionId: row.id, settled: Promise.resolve(settlement), started }
  }

  /** The settlement of an ended ledger row, with the observations a prompt-round report brings within {@link SETTLEMENT_REPORT_WAIT_MS}. */
  private async settlementOf(executionId: string, row: LocalAgentMemberInput, run: SubagentRun | undefined, error: unknown, entry: { open?: OpenExecution }): Promise<LocalAgentExecutionSettlement> {
    const open = entry.open
    if (open !== undefined && run !== undefined) await open.reportOrTimeout(SETTLEMENT_REPORT_WAIT_MS)
    const reason = row.error ?? (error === undefined ? undefined : error instanceof Error ? error.message : String(error))
    return {
      executionId,
      outcome: rowOutcome(row.status),
      ...run === undefined ? {} : { run },
      turns: open?.turnRange() ?? [],
      ...open?.observed?.observedModel === undefined ? {} : { observedModel: open.observed.observedModel },
      ...open?.observed?.observedEffort === undefined ? {} : { observedEffort: open.observed.observedEffort },
      ...open?.observed?.cliVersion === undefined ? {} : { cliVersion: open.observed.cliVersion },
      ...open?.observed?.taskResults === undefined || open.observed.taskResults.length === 0 ? {} : { taskResults: open.observed.taskResults },
      ...reason === undefined || row.status === 'done' ? {} : { error: reason },
    }
  }

  /**
   * Run one plan at the head of its member's queue: evaluate the input,
   * choose first round vs continuation, and start the round with the
   * execution's facts. `admitted` marks the ledger row running at the
   * admission point.
   */
  private async dispatchExecution(plan: ExecutionPlan, executionId: string, ledgerSignal: AbortSignal, admitted: () => void): Promise<SubagentRun> {
    const signal = plan.signal === undefined ? ledgerSignal : AbortSignal.any([ledgerSignal, plan.signal])
    signal.throwIfAborted()
    const prompt = (typeof plan.input === 'function' ? [...await plan.input()] : plan.input) as ContentBlock[]
    signal.throwIfAborted()
    const childSessionId = plan.childSessionId
    const execution: LocalAgentExecutionIntent = {
      executionId,
      caller: plan.caller,
      ...plan.operation === 'compact' ? { operation: 'compact' as const } : {},
      ...plan.callerRef === undefined ? {} : { callerRef: plan.callerRef },
      ...plan.cause === undefined ? {} : { cause: plan.cause },
      ...plan.task === undefined ? {} : { task: plan.task },
    }
    const onAdmitted = async (): Promise<void> => {
      admitted()
      await plan.options?.onAdmitted?.()
      if (plan.on?.admitted === undefined) return
      const last = this.ctx.get('sessions')?.get(SessionId(childSessionId))?.snapshotEvents().at(-1)
      const admission: LocalAgentExecutionAdmitted = { executionId, admittedAt: Date.now(), childFromSeq: last === undefined ? 0 : Number(last.seq) + 1 }
      await plan.on.admitted(admission)
    }
    const progressTargets = [plan.options?.onProgress, plan.on?.progress].filter(target => target !== undefined)
    const { onProgress: _onProgress, onAdmitted: _onAdmitted, signal: _signal, ...passed } = plan.options ?? {}
    const round: DelegationCallOptions = {
      ...passed,
      signal,
      onAdmitted,
      ...progressTargets.length === 0 ? {} : { onProgress: (event: LocalAgentRunProgress) => { for (const target of progressTargets) target(event) } },
      ...plan.label === undefined ? {} : { label: plan.label },
      ...plan.operation === 'compact' ? { operation: 'compact' as const } : {},
    }
    let mode = plan.mode
    let options = round
    if (mode === 'auto') {
      const record = this.getDelegation(childSessionId)
      if (record !== undefined) {
        // A continuation runs where and as its first round did: scope and
        // cwd come from the record, never from the caller.
        mode = 'resume'
        options = { ...round, ...record.scope === undefined ? {} : { scope: record.scope }, ...record.cwd === undefined ? {} : { cwd: record.cwd } }
      } else {
        if (plan.operation === 'compact') throw new Error(`localAgent: member ${childSessionId} has no conversation to compact yet`)
        mode = 'start'
        const prepared = this.preparedMembers.read(childSessionId)
        const create = plan.create
        options = prepared?.phase === 'ready'
          ? { ...round, preparedMemberId: childSessionId }
          : {
            ...round,
            ...create?.model === undefined ? {} : { model: create.model },
            ...create?.effort === undefined ? {} : { effort: create.effort },
            ...create?.cwd === undefined ? {} : { cwd: create.cwd },
            ...create?.scope === undefined ? {} : { scope: create.scope },
            ...create?.exec === undefined ? {} : { exec: create.exec },
            ...create?.configurationLock === undefined ? {} : { configurationLock: create.configurationLock },
          }
      }
    }
    return mode === 'start'
      ? this.startRound(plan.parentSessionId, plan.provider, prompt, options, childSessionId, execution)
      : this.resumeRound(plan.parentSessionId, plan.provider, childSessionId, prompt, options, execution)
  }

  /** A composer row as an execution plan (a fresh submission, or a row replayed after a restart). */
  private composerPlan(childSessionId: string, text: string, key: string | undefined): ExecutionPlan {
    const record = this.requireInboxMember(childSessionId)
    return {
      parentSessionId: record.parentSessionId,
      provider: record.provider,
      childSessionId,
      mode: 'auto',
      input: [{ type: 'text', text }],
      // `/compact` typed to a member compacts it: the entry keeps its place
      // in the queue, then runs as the compaction round instead of a prompt.
      operation: isCompactCommand(text) ? 'compact' : 'prompt',
      caller: 'composer',
      cause: { kind: 'human', sessionId: record.parentSessionId, via: 'member-composer' },
      text,
      ...key === undefined ? {} : { key, callerRef: key },
    }
  }

  /**
   * Cancel one execution of a member: a queued one leaves the queue, a
   * running one is stopped like {@link cancel}.
   * @returns whether something was cancelled.
   */
  cancelExecution(childSessionId: string, executionId: string): boolean {
    const row = this.memberInbox.find(childSessionId, executionId)
    if (row?.status === 'queued') {
      this.memberInbox.cancel(childSessionId, row.id)
      return true
    }
    return row?.status === 'running' ? this.cancel(childSessionId) : false
  }

  /**
   * COMPAT(restart-recovery consolidation, remove one release after): the
   * retired reconciliation action. A restart no longer leaves an execution
   * `uncertain` (the ledger closes it as interrupted and the member
   * continues on its own), so this only answers a client that has not
   * reloaded — with the old refusal, since no row is uncertain.
   * @param outcome - what the evidence shows.
   * @param evidence - non-empty operator evidence.
   * @deprecated nothing reconciles any more.
   */
  reconcileExecution(childSessionId: string, executionId: string, outcome: 'done' | 'failed' | 'cancelled', evidence: string): void {
    this.memberInbox.reconcile(childSessionId, executionId, outcome, evidence)
    const session = this.executions.lookup(childSessionId)
    if (session !== undefined) this.executions.closeReconciled(session)
  }

  /**
   * Cancel an in-flight facade-started run by its dsh child session id:
   * aborts the internal controller (the pre-publication channel fused into
   * the activation's start signal) and disposes the activation — host 0.2.1's
   * canonical POST-publication cancellation, which settles the run with an
   * `aborted`-class stop reason. A caller holding the `SubagentRun` may also
   * `run.dispose()`.
   * @param childSessionId - the dsh child session id of the run to cancel.
   * @returns whether an in-flight run was found and signalled (false on a
   *   miss — never a silent success, never a throw).
   */
  cancel(childSessionId: string): boolean {
    const entry = this.runs.get(childSessionId)
    if (entry === undefined) return this.memberInbox.cancelStarting(childSessionId)
    if (entry.controller !== undefined) {
      entry.controller.abort()
      // The start signal is unlinked at publication, so disposal is the lever
      // that actually reaches a running round. Idempotent and memoized by the
      // manager; a teardown failure is reported, never thrown from here.
      void entry.run.dispose().catch((error: unknown) => {
        this.ctx.logger.warn(`localAgent: cancel disposal of ${childSessionId} failed: ${String(error)}`)
      })
    } else {
      // Tool-registered run: the caller-supplied cancel lever (its fused
      // controller plus the activation's dispose), the same channels the
      // facade entry drives.
      entry.cancel?.()
    }
    return true
  }

  /**
   * Register a NON-facade in-flight delegation run with the active-delegation
   * registry, keyed by the dsh child session id, so the `/local-agent stop`
   * command and {@link cancel} can reach it. This is the family TOOL's entry
   * point: the tool starts its runs through `ctx.subagents.startActivation`
   * directly (not the facade), so without this registration its in-flight
   * runs would be invisible to the stop command. The caller owns the cancel
   * lever — aborting the fused controller (pre-publication) and disposing the
   * activation (post-publication), the same channels the facade drives. The
   * entry clears itself when the run's result settles (any stop reason); an
   * existing facade entry for the same child session wins (it already owns
   * cancellation and progress).
   * @param childSessionId - the dsh child session id.
   * @param run - the published subagent run (the tool's activation adapter).
   * @param cancel - the lever that cancels the run.
   */
  trackDelegationRun(childSessionId: string, run: SubagentRun, cancel: () => void): void {
    if (this.runs.has(childSessionId)) return
    // STOPGAP(session-activity-contribution): replace with host activity lease when upstream lands.
    // Re-announce `running: true` while the run is in flight, so a browser that
    // reloaded or reconnected (and re-baselined from the host's summary, which
    // knows nothing of CLI children) gets the spinner back within one beat.
    // An entry whose run's result never settles would spin forever: the
    // member's ledger (the source of truth since batch 5 S7) retires it.
    const startedAt = Date.now()
    const statusBeat = setInterval(() => {
      if (this.runs.get(childSessionId)?.run !== run) return
      const stale = this.ledgerOutlived(childSessionId, startedAt)
      if (stale === undefined) {
        this.announceRunning(childSessionId, true)
        return
      }
      clearInterval(statusBeat)
      this.runs.delete(childSessionId)
      this.ctx.logger.warn(`localAgent: dropped a stale active run ${childSessionId} (${stale})`)
      this.announceRunning(childSessionId, false)
    }, SESSION_STATUS_HEARTBEAT_MS)
    statusBeat.unref()
    this.runs.set(childSessionId, {
      cancel,
      run,
      onProgress: undefined,
      startedAt,
      statusBeat,
    })
    this.announceRunning(childSessionId, true)
    const clear = (): void => {
      clearInterval(statusBeat)
      const entry = this.runs.get(childSessionId)
      if (entry?.run !== run) return
      this.runs.delete(childSessionId)
      this.announceRunning(childSessionId, false)
    }
    void run.result.then(clear, clear)
  }

  /**
   * STOPGAP(session-activity-contribution): replace with host activity lease when upstream lands.
   * Whether the member's ledger says a tool-registered run is over although
   * its result never settled. A tool-registered entry carries no execution
   * id, so this is conservative: the ledger must be readable and hold rows,
   * none of them queued or running, and its latest row must have settled (or
   * turned uncertain) after the entry started — an older settled history next
   * to a run that bypassed the ledger never counts. Anything else (no ledger,
   * an unreadable one, an empty one) keeps the run.
   * @param childSessionId - the member's dsh child session.
   * @param startedAt - when the entry was registered.
   * @returns why the run is stale, or undefined to keep it.
   */
  private ledgerOutlived(childSessionId: string, startedAt: number): string | undefined {
    let rows: readonly LocalAgentMemberInput[]
    try {
      const inbox = this.memberInbox.read(childSessionId)
      if (inbox.error !== undefined) return undefined
      rows = inbox.messages
    } catch {
      return undefined
    }
    if (rows.length === 0 || rows.some(row => row.status === 'queued' || row.status === 'running')) return undefined
    const latest = rows.reduce((last, row) => (row.settledAt ?? row.updatedAt) > (last.settledAt ?? last.updatedAt) ? row : last)
    if ((latest.settledAt ?? latest.updatedAt) < startedAt) return undefined
    return `ledger execution ${latest.id}: ${latest.status}`
  }

  /**
   * Tell the browser a delegated child session started or stopped working,
   * on the host's own session-status channel: the host raises it only for
   * its own agents, and a CLI child has none — without this the session list
   * never shows a delegation running (nor its parent's 「N 个子 agent 运行中」,
   * which counts children by this status). Degrades silently on a host
   * without the channel's listeners.
   * @param childSessionId - the dsh child session id.
   * @param running - whether a round is now in flight.
   */
  private announceRunning(childSessionId: string, running: boolean): void {
    try {
      (this.ctx.emit as unknown as (name: string, ...args: unknown[]) => void)('api-session/status', SessionId(childSessionId), running)
    } catch {
      // A host without the status channel: the list simply stays as it was.
    }
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
   * family subagent tool starts runs directly through `ctx.subagents.startActivation`;
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
   * the reattach recipe documented on {@link resume}. Announce the restored
   * lifecycle so open history followers receive the constructor suffix before
   * subsequent appends. Hold detach in {@link reattachDisposers} until plugin
   * dispose; the write handle comes from the shared
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
      // A host restart mid-round leaves the child's last turn open on disk;
      // the next round's turn/start would then follow an unclosed turn and
      // the strict reader rejects the whole log. Close it the way the agent
      // loop's own resume does: synthetic closers (missing tool errors,
      // step/end, an `interrupted` turn/end) appended through the handle.
      const closers = sessionModule.interruptedTurnClosers(cold.events)
      if (closers.length > 0) await handle.append(closers)
      const session = sessions.prepare(SessionId(childSessionId), {
        seed: [...cold.events, ...closers],
        meta: structuredClone(handle.header),
        inheritedEventCount: handle.inheritedEventCount,
        eventState: cold.eventState,
      })
      // The seeded constructor appends its `session/end-seed` marker BEFORE
      // enter() installs the publication hooks, so live routing never sees it
      // — push the unstored suffix through the handle directly (the agent
      // loop's resume does the same via appendUnstoredSuffix), or the writer's
      // contiguous cursor and the session log diverge.
      const unstored = session.snapshotEvents().slice(cold.events.length + closers.length)
      if (unstored.length > 0) await handle.append(unstored)
      this.guardChildSession(session)
      const detach = sessions.enter(session)
      try {
        sessions.announce(session)
      } catch (error) {
        detach()
        throw error
      }
      this.reattachDisposers.set(childSessionId, detach)
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
  /**
   * Install the member write guard on a child session (idempotent): every
   * provider's appends pass it, so no provider's bookkeeping slip can make
   * the stored log unreadable. Diverted events land in the quarantine file
   * (`<homes>/quarantine/<childSessionId>.jsonl`) with a warning — nothing is
   * dropped silently.
   * @param session - the member's dsh child session.
   */
  guardChildSession(session: Session): void {
    guardChildLog(session, { quarantine: entry => this.quarantineChildEvent(entry), validate: releasedLogCheck })
  }

  /** Reasons already warned about, per child session (one warning each). */
  private readonly quarantineWarned = new Set<string>()

  private quarantineChildEvent(entry: QuarantineEntry): void {
    try {
      const dir = join(this.homesRoot, 'quarantine')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      appendFileSync(join(dir, `${entry.sessionId}.jsonl`), JSON.stringify(entry) + '\n', { mode: 0o600 })
    } catch (error) {
      this.ctx.logger.warn(`localAgent: quarantine write failed for ${entry.sessionId}: ${String(error)}`)
    }
    const key = `${entry.sessionId}\0${entry.reason}`
    if (this.quarantineWarned.has(key)) return
    this.quarantineWarned.add(key)
    this.ctx.logger.warn(`localAgent: member log write diverted (${entry.sessionId}, ${entry.type}): ${entry.reason}`)
  }

  async syncChildSession(session: Session, strict: boolean = false): Promise<void> {
    const pending = this.syncChildSessionWithRecovery(session, strict)
    this.childSyncs.add(pending)
    try { await pending } finally { this.childSyncs.delete(pending) }
  }

  private async syncChildSessionWithRecovery(session: Session, strict: boolean): Promise<void> {
    this.guardChildSession(session)
    const id = String(session.id)
    try {
      try {
        await this.syncChildSessionOnce(session)
      } catch (error: unknown) {
        if (!/append seq mismatch/.test(error instanceof Error ? error.message : String(error))) throw error
        // A routed live buffer the explicit suffix raced (see
        // syncChildSessionOnce) stays poisoned for the handle's lifetime:
        // drop the handle with it and catch up from disk on a fresh one.
        await this.releaseChildWriteHandle(id)
        await this.syncChildSessionOnce(session)
      }
    } catch (error: unknown) {
      if (strict) throw error
      this.ctx.logger.warn(`localAgent: syncing child session ${id} to persistence failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * One sync pass. While the write handle is open the host routes every live
   * append into the writer's buffer, so the routed events are drained first
   * (`sessions.flush`: drain + flush) and only what is STILL missing — events
   * from before the handle opened, or a host that routes nothing — goes in
   * explicitly, bounded to the events that existed before the drain. Appending
   * routed-but-undrained events explicitly as well would land them twice: the
   * explicit write wins, the buffered copy then fails contiguity forever, and
   * every later flush — the host's tool-execution checkpoint included —
   * throws "append seq mismatch".
   */
  private async syncChildSessionOnce(session: Session): Promise<void> {
    const handle = await this.acquireChildWriteHandle(String(session.id), session.header)
    const known = session.snapshotEvents().length
    await this.ctx.get('sessions')?.flush(session)
    const stored = await handle.read(0)
    const missing = session.snapshotEvents().slice(stored.events.length, known)
    if (missing.length > 0) await handle.append(missing)
    await handle.flush()
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
    const pendingRelease = this.childWriteHandleReleases.get(childSessionId)
    const acquired = (async (): Promise<SessionHandle> => {
      if (pendingRelease !== undefined) await pendingRelease
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
   * with the cache on plugin dispose. A later acquisition waits for this close
   * to settle before it can compete for the same session lease.
   */
  private async releaseChildWriteHandle(childSessionId: string): Promise<void> {
    const cached = this.childWriteHandles.get(childSessionId)
    if (cached === undefined) {
      await this.childWriteHandleReleases.get(childSessionId)
      return
    }
    this.childWriteHandles.delete(childSessionId)
    const released = (async (): Promise<void> => {
      const handle = await cached.catch(() => undefined)
      await handle?.close().catch((error: unknown) => {
        this.ctx.logger.warn(`localAgent: closing the child session ${childSessionId} write handle failed: ${String(error)}`)
      })
    })()
    this.childWriteHandleReleases.set(childSessionId, released)
    try {
      await released
    } finally {
      if (this.childWriteHandleReleases.get(childSessionId) === released) this.childWriteHandleReleases.delete(childSessionId)
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
      // STOPGAP(session-activity-contribution): replace with host activity lease when upstream lands.
      // The same beat re-announces `running: true` — see SESSION_STATUS_HEARTBEAT_MS.
      if (this.runs.get(childSessionId)?.run === run) this.announceRunning(childSessionId, true)
    }, RUN_PROGRESS_HEARTBEAT_MS)
    heartbeat.unref()
    // A resume round reuses the child session id. A previous round's parked
    // route stays open (bounded by its grace timer): a room member's queued
    // round starts the moment the last one's result resolves, BEFORE that
    // round's settle report lands, and the report belongs to the round it
    // observed — see reportRunProgress.
    this.runs.set(childSessionId, { controller, run, onProgress, startedAt, heartbeat })
    this.announceRunning(childSessionId, true)
    const clear = (): void => {
      const entry = this.runs.get(childSessionId)
      if (entry?.run !== run) return
      clearInterval(entry.heartbeat)
      this.runs.delete(childSessionId)
      this.announceRunning(childSessionId, false)
      // The provider computes this round's settle observation AFTER the result
      // resolves (the CLI's stream is only complete once the process is
      // reaped), so the route stays open for it — bounded, and closed by the
      // report itself. See RUN_PROGRESS_SETTLE_GRACE_MS.
      // A round whose settle report already arrived owes nothing: parking it
      // would hand the NEXT round's report to this finished call.
      if (onProgress === undefined || entry.settled === true) return
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
    // A settle report closes the OLDEST open round: a parked one (its result
    // resolved, its observation still owed) settles before the round that
    // started after it.
    const owed = progress.kind === 'settled' ? this.settledRuns.get(childSessionId) : undefined
    if (owed !== undefined) {
      owed.onProgress(progress)
      this.dropSettledRun(childSessionId)
      return
    }
    const tracked = this.runs.get(childSessionId)
    if (tracked !== undefined) {
      if (progress.kind === 'settled') tracked.settled = true
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
export async function apply(ctx: Context, config: Config): Promise<void> {
  // A linked development plugin can have its own installed host peers. Resolve
  // through the mounted loader too, so the running backend sees the same set.
  const loader = ctx.get('loader') as { import?: (name: string) => Promise<{ KNOWN_SESSION_EVENT_TYPES?: ReadonlySet<string> }> } | undefined
  if (loader?.import !== undefined) {
    for (const specifier of ['@deepseek-ai/dsh-session', streamCatalogSpecifier]) {
      try {
        const catalog = await loader.import(specifier)
        ;(catalog.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/stream')
        ;(catalog.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/compaction')
        ;(catalog.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/context')
        ;(catalog.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add('local-agent/execution')
      } catch { /* Optional source export or loader capability; root registration remains. */ }
    }
  }
  const registry = new LocalAgentRegistry(ctx, config.homesRoot, config.loginPromptTimeoutMs ?? 10_000)
  ctx.provide(LOCAL_AGENT_SERVICE, registry)
  // The read-only Remote channel the web client polls through; it depends on
  // the registry, so it mounts after the provide above. Service registration
  // follows the owning fiber, so unload unregisters it automatically.
  new LocalAgentGateway(ctx)
  // The member channel's loopback listener (bridge MCP servers call back here).
  // Degrade, don't explode: a failed bind leaves member_message failing with a
  // tool error while everything else works.
  // Mode tools: a member with a mode reaches that preset's plugin tools
  // through the same bridge (see preset-tool-host.ts).
  const modeTools = new PresetToolHost(ctx, join(config.homesRoot, 'mode-tools.jsonl'))
  const memberChannel = new MemberChannel(ctx, registry, registry.memberBridgeSocketPath(), modeTools)
  void memberChannel.start()
  // A mode tool that needs the human's approval asks in the member's room —
  // the person is there, not in the member's own session. Ahead of every
  // other answerer; anything that is not a member's mode call passes through.
  ;(ctx.on as (name: string, listener: (request: { agent?: unknown; toolName: string; reason?: string; displayReason?: string; signal?: AbortSignal }, next: () => Promise<string>) => Promise<string>, options?: { prepend?: boolean }) => () => void)(
    'approval/request',
    async (request, next) => {
      const child = modeTools.memberOf(request.agent)
      const delegation = child === undefined ? undefined : registry.getDelegation(child)
      const room = (ctx.get as (key: string) => unknown).call(ctx, 'room') as ModeApprovalGate | undefined
      if (child === undefined || delegation === undefined || room?.askMemberApproval === undefined) return next()
      const reason = request.displayReason ?? request.reason
      const outcome = await room.askMemberApproval(
        { childSessionId: child, parentSessionId: delegation.parentSessionId, provider: delegation.provider },
        { toolName: request.toolName, ...reason === undefined ? {} : { reason }, ...request.signal === undefined ? {} : { signal: request.signal } },
      )
      return outcome === 'unavailable' ? next() : outcome
    },
    { prepend: true },
  )
  ctx.effect(() => () => { void memberChannel.dispose(); void modeTools.dispose() })
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
