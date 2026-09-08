/**
 * Local-agent family type vocabulary, exported through the `./types` subpath
 * so Typert Remote boundary types resolve from a public non-root subpath
 * (the wire-schema generator's requirement for {@link LocalAgentGateway}
 * method signatures).
 * @module @khorsheed/dsh-local-agent/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** One session record a harness's records adapter lists. */
export interface LocalAgentSessionRecord {
  /** Harness session id. */
  id: string
  /** The workspace directory the session ran in. */
  workDir: string
  /** Optional session title when the harness records one. */
  title?: string
  /** Optional epoch-millis start time when the harness records one. */
  startedAt?: number
}

/** One harness's auth-status snapshot, shared by the command and Remote channels. */
export interface LocalAgentStatus {
  /** Harness command prefix. */
  name: string
  /** Human display name. */
  displayName: string
  /** Whether the scoped home holds usable credentials. */
  authenticated: boolean
  /** Absolute scoped home. */
  homeDir: string
  /** Subagent provider name, when the harness delegates. */
  delegationProvider?: string
  /**
   * Whether the harness declares a device-code login flow (`/<name> login`).
   * A harness without one authenticates through the host instance (e.g. by
   * resolving a credential), so surfaces must not offer a login action.
   */
  loginable?: boolean
  /**
   * A pty login is waiting for the user to paste the OAuth code
   * (`/<name> code <value>`). Surfaces render the paste box while set.
   */
  loginAwaitingCode?: boolean
  /**
   * Whether the harness declares a sign-out path (`/<name> logout`). A
   * harness without one has no account to switch, so surfaces must not offer
   * a logout action.
   */
  logoutable?: boolean
  /**
   * The harness's fairness-relevant effective settings, when the harness
   * declares a snapshot ({@link LocalAgentHarness.effectiveSettings}).
   * Additive: surfaces and clients written before the field simply ignore it.
   */
  effectiveSettings?: LocalAgentEffectiveSettings
}

/**
 * One harness's fairness-relevant effective settings — the read side of the
 * web-eval condition hash. Everything here is a knob the evaluation must hold
 * equal across harnesses (drive, approval boundary, reasoning effort,
 * endpoint route, CLI version) expressed as PURE JSON. Credentials never
 * enter: no keys, no tokens, no full URLs (an endpoint reports its hostname
 * only — a URL's path could carry tenant or project ids).
 *
 * A field the harness has no knob for stays ABSENT (`sandbox`,
 * `permissionMode`, `autoApprove`, `reasoningEffort`, `model`, `cliVersion`):
 * absence means "this harness has no such knob", which is itself the honest
 * condition-hash input (the web-eval frozen baseline calls the dsh harness
 * unrestricted because no knob exists). `drive` and `baseUrlSet` are always
 * present.
 */
export interface LocalAgentEffectiveSettings {
  /**
   * How delegation rounds run: a one-shot CLI process per round (`exec`) or a
   * resident runtime driven over its wire (`live`). The reported value is the
   * configured driver preference in force; a live round may still fall back
   * to exec when its channel cannot come up.
   */
  drive: 'exec' | 'live'
  /** Codex: the sandbox policy every round passes to `codex exec --sandbox`. */
  sandbox?: string
  /** Claude Code: the `claude -p` permission handling (`skip` or `normal`). */
  permissionMode?: string
  /**
   * Kimi: whether the scoped config's permission rules auto-approve tool use
   * (the `Bash(*)` allow rule the provisioning gate keys on).
   */
  autoApprove?: boolean
  /**
   * The reasoning effort in force, when the harness has one. Kimi reads its
   * scoped config (`[thinking] effort`, falling back to the model's
   * `default_effort`); codex reads its scoped config's
   * `model_reasoning_effort`. Absent when the harness exposes no effort knob.
   */
  reasoningEffort?: string
  /** Whether a non-default endpoint is in force (a provider-pinned or env-provided base URL). */
  baseUrlSet: boolean
  /**
   * The endpoint's HOSTNAME only, present exactly when `baseUrlSet`. Never
   * the full URL — its path can carry credential-adjacent segments.
   */
  baseUrlHost?: string
  /**
   * The CLI's own version. No family probe ships yet (probing would spawn
   * every CLI at status time), so this stays absent until a probe exists;
   * the field is reserved so a later probe is additive.
   */
  cliVersion?: string
  /**
   * The configured model identifier a delegation round would run with — read
   * from the harness's own configuration surface, never guessed: kimi reads
   * its scoped config's `default_model`, codex its scoped config's `model`,
   * claude-code its scoped `settings.json`'s `model` (the CLI's own default
   * stays unnamed), and dsh the host `agentDefaultModel` selection it
   * inherits, formatted `provider/model`. Absent when nothing is configured
   * or readable — absence is the honest answer, never a substituted default.
   */
  model?: string
  /**
   * Extra `NODE_OPTIONS` the harness injects when a round runs against a
   * container exec target ({@link DelegationExecTarget}). Only the dsh
   * harness declares one: its HTTP client is node's `fetch` (undici), which
   * does not read `HTTP(S)_PROXY` by default, so a round inside a unit whose
   * only egress is a whitelist proxy needs `--use-env-proxy` to open
   * undici's `EnvHttpProxyAgent` — without it the CLI dials the API directly
   * and the proxy never even sees a `CONNECT`. Reported unconditionally
   * because the injection is unconditional in code; absent means the harness
   * injects none. Never a credential — a node flag.
   */
  containerNodeOptions?: string
}

/**
 * The hostname of an endpoint URL, or undefined when the value does not parse
 * as a URL (scheme-less `host:port` forms included — still reported via
 * `baseUrlSet`, just without a hostname).
 */
export function endpointHost(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** Roster row: enough of a harness for a client list. */
export interface LocalAgentRosterRow {
  /** Harness command prefix. */
  name: string
  /** Human display name. */
  displayName: string
}

/**
 * One family delegation's CLI-session mapping, recorded by the harness
 * provider after its first round settles (the CLI session id is only known
 * from the round's output). The resume tool resolves a caller-supplied dsh
 * child session id against this registry, and ownership is proven by the
 * recorded parent session id: a forged handle naming another session is
 * rejected instead of resuming someone else's conversation context.
 */
export interface LocalAgentDelegationRecord {
  /** The dsh subagent child session id (the run id of the first round). */
  childSessionId: string
  /** The `ctx.subagents` provider name that owns the CLI session. */
  provider: string
  /** The delegating parent session id that created the child. */
  parentSessionId: string
  /**
   * The CLI's own session/thread id, used to build the resume command.
   */
  cliSessionId: string
  /**
   * The resolved working directory the FIRST round ran in — the anchor the
   * resume-consistency check compares a later round's effective cwd against.
   * Recorded by the provider at the delegation's first-round record point;
   * absent on records written before the field existed (they opt out of the
   * check rather than guess).
   */
  cwd?: string
  /**
   * The model identifier the provider observed in its own output stream for
   * the latest settled round (claude's stream-json init, codex's rollout
   * turn_context, kimi's wire usage/request records, the sub-dsh session's
   * assistant source). Read back verbatim, never guessed: absent when the
   * stream yielded none. This is the observed half of the evaluation's
   * "declared model == actually-run model" check (web-eval frozen decision
   * 5); it never enters any prompt or model-visible face.
   */
  observedModel?: string
  /**
   * Kimi transcript lines already mirrored into the child session. The kimi
   * provider advances this after every round so a resumed round mirrors only
   * its delta instead of duplicating earlier messages.
   */
  kimiMirroredLines?: number
}

/**
 * One delegation's record WITHOUT the CLI-session resume handle — the
 * read-only projection {@link LocalAgentRegistry.delegationOf} returns for
 * surfaces that need a delegation's facts (provider, parent, observed model,
 * first-round cwd) but must never see the resume handle, which stays a
 * first-class parameter plus the intent channel.
 */
export type LocalAgentDelegationInfo = Omit<LocalAgentDelegationRecord, 'cliSessionId'>

/**
 * The member-channel view of one delegation, projected by the gateway's
 * `memberOf` Remote for the composer: everything the browser needs to decide
 * "this child session is a family member" and to label it, without the
 * CLI-session resume handle (which never leaves the host).
 */
export interface LocalAgentDelegationView {
  /** The dsh subagent child session id. */
  childSessionId: string
  /** The `ctx.subagents` provider name that owns the CLI session. */
  provider: string
  /** The delegating parent session id that created the child. */
  parentSessionId: string
  /** The owning harness's human display name, when a harness claims the provider. */
  harnessDisplayName?: string
}

/**
 * Result of one user-initiated member prompt (`promptMember` Remote). Facade
 * failures (unknown delegation, parent not live, resume locked, …) arrive as
 * structured errors for the composer to render inline, never as raw exceptions
 * over the wire.
 */
export type LocalAgentPromptResult = { ok: true } | { ok: false; error: string }

/**
 * One member-to-member notification handed to the room gate — the frozen
 * contract (`proposals/active/2026-08-19-local-agent-member-channel.md` §3):
 * `{ from, to, content, parentSessionId, provenance }`. The bridge cannot
 * speak roster names for the SENDER (only room owns the roster), so `from`
 * is the sender's dsh child session id and the full delegation view rides
 * as `provenance`; room resolves both endpoints to roster names. The
 * CLI-session resume handle never crosses.
 */
export interface LocalAgentMemberMessage {
  /** The sending member's dsh child session id (resolved from its run token). */
  from: string
  /**
   * The raw `to` argument: a member's dsh child session id, or — only
   * meaningful to a claiming room — a member name from the room roster.
   */
  to: string
  /** The notification text. */
  content: string
  /** The parent session both members belong to. */
  parentSessionId: string
  /** The sender's delegation view, recorded as the delivery's provenance. */
  provenance: Record<string, string>
}

/**
 * The room gate's answer to a member notification, passed back to the sender
 * verbatim. Phase 1's gate is always human confirmation
 * ('pending-confirm'); 'sent'/'busy' belong to the phase-2 auto gate. A
 * DECLINE is not a value: the gate throws (the parent session is not a room
 * this instance manages) and the family direct-sends.
 */
export type RoomMemberMessageReceipt = 'sent' | 'pending-confirm' | 'busy'

/**
 * Duck-typed shape of the room service's member-message gate, probed via
 * `ctx.get('room')` — deliberately NO import of any room package, so the
 * optional local-agent → room edge needs no inter-plugin dependency and no
 * independence-checker sanction: room absent or declining is invisible to the
 * family path. Room implements this shape to own the dispatch gate.
 */
export interface RoomMemberMessageGate {
  receiveMemberMessage(message: LocalAgentMemberMessage): Promise<RoomMemberMessageReceipt>
}

/**
 * Outcome of one `member_message` delivery. Channel-level failures (unknown or
 * expired token, foreign pid, unknown member) are `ok: false` tool errors;
 * delivery verdicts — including a failed direct send — are receipts the sender
 * can quote in its conclusion: `sent` / `pending-confirm` / `busy` /
 * `error: <reason>` (or whatever a claiming room returns, passed verbatim).
 */
export type MemberMessageOutcome =
  | { readonly ok: true; readonly receipt: string }
  | { readonly ok: false; readonly error: string }

/** Environment variable carrying the member-bridge socket path (spawn env → bridge). */
export const MEMBER_BRIDGE_SOCKET_ENV = 'DSH_MEMBER_SOCKET'

/** Environment variable carrying the per-run member-bridge token. */
export const MEMBER_BRIDGE_TOKEN_ENV = 'DSH_MEMBER_TOKEN'

/**
 * One in-flight CLI run registered for the member channel: the per-run token's
 * resolution target. The token is minted at run start (fresh or resume),
 * cross-checked against the spawned CLI's pid, and invalidated when the run
 * settles — a member's identity is never self-reported.
 */
export interface LocalAgentMemberRun {
  /** The dsh child session id of the run (its member identity). */
  childSessionId: string
  /** The delegating parent session id. */
  parentSessionId: string
  /** The `ctx.subagents` provider name running the CLI. */
  provider: string
  /** The spawned CLI process pid, bound right after spawn. */
  cliPid?: number
}

/**
 * What one delegation tool call intends for the provider's next `start()`.
 * The tool stages exactly one intent per call before awaiting
 * `ctx.subagents.start()`, and the provider consumes exactly one per start,
 * so a per-(parent, provider) FIFO keeps fresh and resume rounds paired even
 * under parallel delegation.
 */
export type LocalAgentDelegationIntent =
  | {
    readonly kind: 'fresh'
    /**
     * The working directory the round's CLI process runs in, when the caller
     * supplied one (the `cwd` call option riding the staged intent). Absent
     * means the provider's default — the parent session's cwd.
     */
    readonly cwd?: string
    /**
     * Run the CLI inside this container instead of on the host (the `exec`
     * call option riding the same staged intent). Absent means the host.
     */
    readonly exec?: DelegationExecTarget
  }
  | {
    readonly kind: 'resume'
    /** The dsh child session id to continue (the resume handle). */
    readonly childSessionId: string
    /** The CLI session id the resume command continues. */
    readonly cliSessionId: string
    /**
     * The working directory the caller asks the resume round to run in, when
     * supplied. The provider compares it (or the parent-session default)
     * against the recorded first-round cwd and fails loud on a mismatch.
     */
    readonly cwd?: string
    /**
     * Run the resume round's CLI inside this container. The caller repeats
     * the first round's target; nothing recorded can verify that for it.
     */
    readonly exec?: DelegationExecTarget
  }

/**
 * One progress update for a delegation run. Providers report the data-bearing
 * kinds ({@link reportRunProgress} on the registry — the facade only forwards);
 * the facade itself emits the `heartbeat` kind while a facade-tracked run is
 * in flight, so a caller can render "in progress" without any provider
 * support.
 */
export type LocalAgentRunProgress =
  | {
    readonly kind: 'heartbeat'
    /** Milliseconds since the facade started tracking the run. */
    readonly elapsedMs: number
  }
  | {
    readonly kind: 'mirror'
    /** Total CLI transcript lines mirrored into the child session so far. */
    readonly mirroredLines: number
  }
  | {
    readonly kind: 'delta'
    /** A live transcript increment (M3; not yet emitted by any provider). */
    readonly text: string
  }
  | {
    readonly kind: 'settled'
    /**
     * The model identifier the provider observed in its own output stream for
     * this round, when the stream carried one — absent otherwise, never
     * guessed. The observed half of the evaluation's declared-vs-run model
     * check; never enters any prompt or model-visible face.
     */
    readonly observedModel?: string
    /** The settled round's token usage, when the harness reported one. */
    readonly usage?: TokenUsage
  }

/**
 * Where one delegation round's CLI process runs when the caller has already
 * acquired a container for it (a lab unit). Given a target, the provider
 * spawns `docker exec -w <workdir> [-e NAME…] <container> <the same argv>`
 * instead of the CLI directly; stdio stays piped and every downstream
 * layer — stream parse, settle, readback, delegation record — is the host
 * path's, unchanged.
 *
 * The scoped home stays a HOST directory, bind-mounted read-write into the
 * unit: readback (codex's rollout, kimi's wire log, the sub-dsh session log)
 * reads it straight off the host filesystem, and credential refreshes the CLI
 * writes land back on the host. `env` is where the caller names those
 * in-container paths (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `KIMI_CODE_HOME`,
 * `DSH_HOME`), which is why every provider REQUIRES its own scoped-home
 * variable here: the host path it would otherwise forward means nothing
 * inside the unit.
 *
 * Absent everywhere means the host path, byte-for-byte the behavior before
 * this option existed.
 */
export interface DelegationExecTarget {
  /**
   * The container the round runs in — a name or id the caller acquired (lab's
   * `UnitInfo.resource`). The family only ever runs `docker exec` against it:
   * creating, inspecting, mounting and destroying it belong to the caller.
   */
  readonly container: string
  /** Absolute in-container working directory (`docker exec -w`). */
  readonly workdir: string
  /**
   * Environment entries for the in-container process, overriding the
   * provider's own per key. Values travel in the docker CLIENT's environment
   * and reach the container through NAME-only `-e` flags, so nothing here
   * lands in the host process table.
   */
  readonly env?: Readonly<Record<string, string>>
}

/**
 * Call options for the public delegation facade (`LocalAgentRegistry.start` /
 * `resume`). The interface is deliberately additive: later milestones extend
 * it without changing the existing fields.
 */
export interface DelegationCallOptions {
  /**
   * Child display label persisted with a session-backed child; omitted, the
   * harness's own display name labels the delegation.
   */
  readonly label?: string
  /**
   * Caller-owned extra cancellation channel. It is fused with the facade's
   * internal `cancel()` controller: aborting either cancels the run.
   */
  readonly signal?: AbortSignal
  /**
   * Per-call progress callback: receives the same {@link LocalAgentRunProgress}
   * payloads the `localAgent/run-progress` cordis event carries, routed to the
   * tracked run this call started. For callers that cannot conveniently
   * subscribe to cordis events.
   */
  readonly onProgress?: (event: LocalAgentRunProgress) => void
  /**
   * `resume` only: when the child session is not live, reattach it from
   * persistence (the default, true). Pass `false` to fail loud instead — the
   * pre-facade behavior — leaving the absent session untouched.
   */
  readonly reattach?: boolean
  /**
   * The working directory the CLI round runs in. On a fresh delegation it
   * replaces the parent session's cwd (the `resolveChildCwd` override — an
   * orchestrator giving each cell its own directory); on a resume it must
   * match the first round's recorded cwd or the call fails loud, since the
   * CLI conversation continues in the directory its earlier rounds ran in.
   * Absent everywhere means the parent session's cwd — the behavior before
   * this option existed, unchanged.
   */
  readonly cwd?: string
  /**
   * Run the round's CLI inside an already-acquired container instead of on
   * the host ({@link DelegationExecTarget}). The transport is the only thing
   * it changes; a round with a target still parses, settles, reads back and
   * records exactly as a host round does. On a resume, repeat the SAME target
   * the first round used — the recorded first-round anchor is the host `cwd`,
   * so a swapped container is a caller error the record cannot catch.
   */
  readonly exec?: DelegationExecTarget
}
