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

/**
 * How much is known about a harness's credential, from the two channels a
 * status read has: the scoped home's own shape, and what delegation rounds
 * observed.
 *
 * - `absent` — no credential in the scoped home (or the harness declares no
 *   probe at all). Nothing to try.
 * - `present-unverified` — a credential record exists and nothing has
 *   exercised it in this host process. The record could be expired and
 *   unrefreshable and still look exactly like this; saying so is the point.
 * - `verified` — a delegation round reached the CLI's endpoint and completed
 *   since the last login/logout, so the credential is known live.
 * - `rejected` — a round's endpoint rejected the credential (a 401/403 a
 *   presence probe cannot see) and no fresh login has rewritten the
 *   credential marker since.
 *
 * The grade is per host process: after a restart a present credential reports
 * `present-unverified` until a round exercises it, because that is what is
 * actually known. An eager liveness probe at status time is deliberately NOT
 * this field's job.
 */
export type LocalAgentCredentialState = 'absent' | 'present-unverified' | 'verified' | 'rejected'

/** One harness's auth-status snapshot, shared by the command and Remote channels. */
export interface LocalAgentStatus {
  /** Harness command prefix. */
  name: string
  /** Human display name. */
  displayName: string
  /**
   * Whether the scoped home holds usable credentials — the SHAPE answer,
   * kept for every surface written before {@link LocalAgentCredentialState}
   * existed. Exactly `credentialState === 'verified' || 'present-unverified'`:
   * a record that is present but never exercised still reads true, which is
   * why the finer field exists.
   */
  authenticated: boolean
  /**
   * How much is actually known about the credential — the liveness grade
   * behind {@link LocalAgentStatus.authenticated}. Always present.
   */
  credentialState: LocalAgentCredentialState
  /**
   * Absolute scoped home — of the SCOPE this status was asked about (see
   * {@link LocalAgentStatus.scope}), which for the default scope is the
   * directory it always was.
   */
  homeDir: string
  /**
   * The named scope this status describes, when it describes one. Absent
   * means the default scope — the only one that existed before named scopes,
   * so every surface written before the field keeps reading exactly what it
   * read. A named scope holds its own account: its credential grade, its
   * session records and its delegation mappings are its own.
   */
  scope?: string
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
 * A field the harness has no knob for — or one whose knob this deployment
 * leaves unset — stays ABSENT (`sandbox`, `permissionMode`, `autoApprove`,
 * `reasoningEffort`, `model`, `cliVersion`): absence is itself the honest
 * condition-hash input, never a substituted default. `drive` and
 * `baseUrlSet` are always present.
 */
export interface LocalAgentEffectiveSettings {
  /**
   * How delegation rounds run: a one-shot CLI process per round (`exec`) or a
   * resident runtime driven over its wire (`live`). The reported value is the
   * configured driver preference in force; a live round may still fall back
   * to exec when its channel cannot come up.
   */
  drive: 'exec' | 'live'
  /**
   * The file-effect boundary in force, in the harness's own vocabulary.
   * Codex: the sandbox policy every round passes to `codex exec --sandbox`.
   * dsh: the permission preset provisioning pins into the sub-profile
   * (`read-only` / `workspace-write` / `danger-full-access`), which also
   * decides the sub-dsh's approval policy through dsh-base's own preset
   * table. Absent when the deployment pins none.
   */
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
   * The CLI's own version, as the CLI itself reports it — the version a
   * delegation round would run with right now. Resolved by the family's
   * `<cli> --version` probe, which spawns at most once per executable
   * identity (resolved path + mtime + size) and is therefore cheap enough for
   * a status read while still re-probing across an upgrade. Absent when the
   * CLI cannot be asked (not installed, non-zero exit, timeout, no
   * version-shaped token in its banner) — absence is the honest condition
   * input, never a substituted guess.
   */
  cliVersion?: string
  /**
   * The configured model identifier a delegation round would run with — read
   * in one fixed order, never guessed: the harness's OWN `model` plugin-config
   * key first (codex, claude-code, and kimi each accept one, and a set key
   * rides every round's CLI launch), then the harness's scoped configuration
   * surface (kimi's `default_model`, codex's `model`, claude-code's
   * `settings.json` `model`, dsh's host `agentDefaultModel` selection
   * formatted `provider/model` — the CLI's own default stays unnamed), then
   * absent. Absence is the honest answer, never a substituted default.
   *
   * This deliberately does NOT report a delegation-level model
   * ({@link DelegationCallOptions.model}): that one belongs to one
   * delegation, while this field answers "what would a round with no model of
   * its own run" — the harness-wide setting, which is what the evaluation's
   * condition snapshot is asking about.
   *
   * This is a LIVE read of what the NEXT such round would run with. A run's
   * condition hash freezes it at run setup, so changing the key mid-run does
   * not rewrite the recorded condition — the next round's model read-back
   * fails the run as misattributed instead (web-eval frozen decision 5).
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
   * The named scope whose scoped home this delegation ran against — the
   * anchor a resume round must repeat. Absent means the DEFAULT scope, which
   * is what every record written before the field existed is; a resume that
   * names a scope against such a record (or names none against a scoped one)
   * is refused rather than continuing the CLI session under another account's
   * credentials.
   */
  scope?: string
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
   * The model this delegation REQUESTED — the `model` call option its first
   * round carried, recorded so every resume round re-requests the same value.
   * The requested half of the pair whose observed half is
   * {@link LocalAgentDelegationRecord.observedModel}: a delegation that asked
   * for one model and read back another is exactly what the evaluation's
   * declared-vs-run check exists to catch.
   *
   * Absent means the delegation named none — its rounds fall back to the
   * plugin config, the scoped file, then the CLI's default, and a resume of
   * it does the same. Records written before this field existed are that
   * case, unchanged.
   */
  model?: string
  /**
   * The CLI version the latest settled round actually ran, read back the same
   * way {@link LocalAgentDelegationRecord.observedModel} is: from the CLI's
   * own stream or records when it names one (codex's rollout `session_meta`
   * carries `cli_version`, claude's stream-json init carries
   * `claude_code_version`), otherwise from the family's `--version` probe of
   * the executable the round spawned. Absent when neither channel answered.
   */
  cliVersion?: string
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
 * Where a member's effective model comes from, in the family's fixed
 * resolution order (first match wins): the session-level override set through
 * the composer's model picker, then the delegation's own recorded model, then
 * the harness's plugin-config `model` (settings card / YAML), then the scoped
 * config file's own default, and last the CLI's built-in default — which by
 * itself names nothing, exactly as it did before any of these layers existed.
 * A harness MAY still name that compiled default through a side channel:
 * codex's app-server `model/list` marks the account's built-in default with
 * `isDefault`, so a broker that probed the catalog reports `cli-builtin` WITH
 * `effective` set (the one case this source names a model). And even when
 * nothing names it, the delegation records show what last actually ran —
 * {@link LocalAgentModelInfo.lastObserved}.
 */
export type LocalAgentModelSource = 'override' | 'delegation' | 'settings' | 'cli-config' | 'cli-builtin'

/**
 * The model surface for one member — or, without a member, for a harness's
 * next round (the settings card's "what would run" line). Every layer reports
 * its own value so a UI can explain WHY the effective model is what it is;
 * `choices` is the pickable vocabulary (settings + scoped-config default +
 * config-discovered + recently used, deduped), never a hardcoded catalog.
 */
export interface LocalAgentModelInfo {
  /** The model the next round would actually run with, when any layer names one. */
  effective?: string
  /** Which layer {@link LocalAgentModelInfo.effective} came from. */
  source: LocalAgentModelSource
  /** The session-level override, when one is active for the member. */
  override?: string
  /** The delegation's recorded model, when the delegation named one. */
  delegation?: string
  /** The harness's plugin-config `model`, when the settings layer sets one. */
  settings?: string
  /** The scoped config file's own default model, when the file names one. */
  cliDefault?: string
  /**
   * The most recent model the provider was OBSERVED running (the delegation
   * records' {@link LocalAgentDelegationRecord.observedModel}), filled by the
   * core gateway when the broker itself names none. Display context for the
   * cli-builtin layer: the CLI's compiled default names nothing, but "what
   * ran last time" is exactly what a member still on that default would run
   * again — so surfaces show it as the last-observed hint, never as
   * {@link LocalAgentModelInfo.effective} (an observation is not a layer).
   */
  lastObserved?: string
  /**
   * The pickable model identifiers (deduped; empty when nothing names a
   * model). The core gateway appends {@link LocalAgentModelInfo.lastObserved}
   * as the final entry when no broker choice already lists it, so a member
   * that only ever ran its CLI default still has a one-item menu.
   */
  choices: readonly string[]
  /** Whether the harness's live driver is on for the member's rounds. */
  live: boolean
  /**
   * False while a round is in flight for the member: a model switch retires
   * the member's resident runtime so the NEXT round respawns with the new
   * model, and retiring a runtime mid-round would kill the run.
   */
  switchable: boolean
  /** Why a switch is currently refused, when {@link LocalAgentModelInfo.switchable} is false. */
  reason?: string
}

/**
 * A harness's model knob, registered with the harness and routed by the
 * gateway: the settings card reads the memberless info, the member composer
 * reads and switches per member. A harness without a broker keeps its old
 * faces exactly (the card's free-text model input still writes plugin config).
 */
export interface LocalAgentModelBroker {
  /**
   * Read the model surface. With a member, `delegationModel` carries the
   * delegation record's requested model (the record lives in the core; the
   * broker ranks it between override and settings).
   * @param childSessionId - the member to read, absent for the harness default.
   * @param delegationModel - the delegation's recorded model, when it named one.
   * @returns the layer-by-layer surface.
   */
  modelInfo(childSessionId?: string, delegationModel?: string): LocalAgentModelInfo | Promise<LocalAgentModelInfo>
  /**
   * Set (or clear, with undefined) a member's session-level model override.
   * The override outranks the delegation's recorded model and the settings
   * layer; it is in-memory and deliberately does not survive a host restart.
   * When the member has a live runtime, setting a DIFFERENT model retires the
   * runtime so the next round respawns with the new model; the same model is
   * a no-op. Throws when a round is in flight for the member.
   * @param childSessionId - the member to switch.
   * @param model - the model identifier, or undefined to clear the override.
   */
  setMemberModel(childSessionId: string, model: string | undefined): Promise<void>
}

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
 * expired token, unknown member) are `ok: false` tool errors;
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
 * resolution target. The token is minted at run start (fresh or resume) and
 * invalidated when the run settles — a member's identity is never
 * self-reported. The token is the sole credential (host 0.1.5 removed the
 * child pid the parentage cross-check used; the auth-hardening proposal
 * tracks a stronger second factor).
 */
export interface LocalAgentMemberRun {
  /** The dsh child session id of the run (its member identity). */
  childSessionId: string
  /** The delegating parent session id. */
  parentSessionId: string
  /** The `ctx.subagents` provider name running the CLI. */
  provider: string
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
    /**
     * The named scope whose scoped home the round runs against (the `scope`
     * call option riding the same staged intent). Absent means the default
     * scope — the provider then resolves the same directory it always did.
     */
    readonly scope?: string
    /**
     * The model this delegation requested (the `model` call option riding the
     * same staged intent). The provider passes it to the CLI and RECORDS it,
     * so every resume round of this delegation re-requests the same value.
     * Absent means the provider falls back to its plugin config, then the
     * scoped file, then the CLI default.
     */
    readonly model?: string
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
    /**
     * The named scope the resume round runs against. Unlike the container
     * target this one IS anchored: the record carries the first round's
     * scope, and a round naming another (or none) is refused.
     */
    readonly scope?: string
  }

/**
 * One settled round's tool-call accounting, counted from the events the
 * provider ALREADY parses for its transcript mirror — no second parse, no new
 * readback channel. Per round, never cumulative.
 *
 * `byName` keys are whatever the harness's own CLI calls the tool, verbatim
 * and un-normalized: codex reports its stream item types (`command_execution`,
 * `web_search_call`), claude the `tool_use` name (`Bash`, `Read`, `TodoWrite`,
 * an MCP tool's full name), kimi and dsh the tool name their own events carry.
 * Cross-harness comparison is therefore `count` ONLY — the names are for a
 * reader, and normalizing them would invent an equivalence the CLIs never
 * agreed to. `byName` is absent when the events carried no usable name, and
 * its values always sum to `count`.
 */
export interface LocalAgentToolCalls {
  /** Tool calls the round made. Zero is a real observation — the round used none. */
  readonly count: number
  /** Per-tool counts under the CLI's own names; absent when no name was available. */
  readonly byName?: Readonly<Record<string, number>>
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
    /**
     * The CLI version the round ran, when the provider could read one back
     * (its own stream or records first, the `--version` probe second).
     */
    readonly cliVersion?: string
    /** The settled round's token usage, when the harness reported one. */
    readonly usage?: TokenUsage
    /**
     * The round's tool-call accounting, counted from the transcript events the
     * provider already parsed. Absent when the harness reported none for this
     * round — absence is "not observed", which is not the same fact as a
     * `count: 0` round that ran no tools, so it is never filled in with zero.
     */
    readonly toolCalls?: LocalAgentToolCalls
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
  /**
   * Run the round against a NAMED scoped home of the harness
   * (`<homesRoot>/<harness>@<scope>`) instead of the default one. A scope is
   * a name matching `[a-z0-9-]`, never a path; the directory is materialized
   * (0700, then the harness's own provisioning) the first time anything names
   * it, and it holds its own credentials — nothing is copied from the default
   * scope, so a fresh scope needs its own `/<harness> login --scope <name>`.
   *
   * On a resume the scope must be the one the first round recorded, absence
   * included: continuing a CLI session against another account's credentials
   * is refused rather than attempted.
   *
   * Absent everywhere means the default scope — byte for byte the behavior
   * before scopes existed. A scoped round is exec-only (the live drivers bind
   * the default scoped home) and, on kimi, carries no member channel (the
   * bridge declaration is written into the default scope's `mcp.json`).
   */
  readonly scope?: string
  /**
   * The model this DELEGATION runs — `start` only. It outranks the harness's
   * `model` plugin-config key, which in turn outranks the scoped
   * configuration file and, last, the CLI's own default. Absent leaves that
   * pre-existing order exactly as it was, so a caller that names no model
   * gets byte-identical behavior.
   *
   * **Not accepted on `resume`.** A model belongs to the delegation, not to
   * one of its rounds: the first round records what it requested and every
   * later round of the same CLI session re-requests that same value (none,
   * when the first round named none). Passing it to `resume` is a caller
   * error and fails loud rather than switching a conversation's model
   * mid-way — which the CLI would honour and the transcript would not show.
   *
   * A round with a model is exec-only, for the reason a scoped round is: the
   * live drivers bind their model when the resident runtime spawns, and one
   * runtime serves many rounds.
   *
   * dsh spells it `provider/model` (the shape `effectiveSettings.model`
   * reports); the three CLI harnesses take whatever identifier their own CLI
   * takes.
   */
  readonly model?: string
}
