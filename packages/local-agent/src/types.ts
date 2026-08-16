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
