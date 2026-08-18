/**
 * Local-agent family type vocabulary, exported through the `./types` subpath
 * so Typert Remote boundary types resolve from a public non-root subpath
 * (the wire-schema generator's requirement for {@link LocalAgentGateway}
 * method signatures).
 * @module @khorsheed/dsh-local-agent/types
 */

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
   * Whether the harness declares a sign-out path (`/<name> logout`). A
   * harness without one has no account to switch, so surfaces must not offer
   * a logout action.
   */
  logoutable?: boolean
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
  /** The CLI's own session/thread id, used to build the resume command. */
  cliSessionId: string
  /**
   * Kimi transcript lines already mirrored into the child session. The kimi
   * provider advances this after every round so a resumed round mirrors only
   * its delta instead of duplicating earlier messages.
   */
  kimiMirroredLines?: number
}

/**
 * What one delegation tool call intends for the provider's next `start()`.
 * The tool stages exactly one intent per call before awaiting
 * `ctx.subagents.start()`, and the provider consumes exactly one per start,
 * so a per-(parent, provider) FIFO keeps fresh and resume rounds paired even
 * under parallel delegation.
 */
export type LocalAgentDelegationIntent =
  | { readonly kind: 'fresh' }
  | {
    readonly kind: 'resume'
    /** The dsh child session id to continue (the resume handle). */
    readonly childSessionId: string
    /** The CLI session id the resume command continues. */
    readonly cliSessionId: string
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
}
