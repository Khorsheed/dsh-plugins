import { AsyncLocalStorage } from 'node:async_hooks'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/**
 * Names the CLI process of a member: its dsh child session id. Anything the
 * member's CLI runs (its shell tool, a script) inherits it, so a script can
 * tell it was started from inside a member — `scripts/deploy-3080.mts`
 * refuses to restart the instance the member itself runs in.
 */
export const LOCAL_AGENT_MEMBER_ENV = 'DSH_LOCAL_AGENT_MEMBER'

/** Names the room session a member sits in, set alongside {@link LOCAL_AGENT_MEMBER_ENV} only when the member's parent is a room. */
export const LOCAL_AGENT_ROOM_ENV = 'DSH_LOCAL_AGENT_ROOM'

/** Which member a CLI process belongs to (see {@link withMemberProcessIdentity}). */
export interface MemberProcessIdentity {
  /** The member's dsh child session id. */
  readonly member: string
  /** The room session id, when the member's parent is a room. */
  readonly room?: string
}

// One store per process, shared by every copy of this module: source-based
// toolchains and installed bundles can load the core twice, and the providers
// must read the store the core wrote.
const IDENTITY_STORE_KEY = Symbol.for('@khorsheed/dsh-local-agent/member-process-identity')
const identityStore: AsyncLocalStorage<MemberProcessIdentity> = (() => {
  const slot = globalThis as unknown as Record<symbol, AsyncLocalStorage<MemberProcessIdentity> | undefined>
  return slot[IDENTITY_STORE_KEY] ??= new AsyncLocalStorage<MemberProcessIdentity>()
})()

/**
 * Run `body` as work done for one member: every {@link delegationEnv} built
 * inside it (directly, or in anything it awaits or schedules) adds the
 * member's identity variables. The core wraps each provider round, member
 * preparation, process start and reload in this, so the providers' spawns
 * carry the identity without naming it themselves.
 * @param identity - the member (and its room, if any) the work belongs to.
 * @param body - the work.
 * @returns what `body` returns.
 */
export function withMemberProcessIdentity<T>(identity: MemberProcessIdentity, body: () => T): T {
  return identityStore.run(identity, body)
}

/** The member identity of the current async context, if any. */
export function currentMemberProcessIdentity(): MemberProcessIdentity | undefined {
  return identityStore.getStore()
}

/**
 * The environment entries that name a member to its CLI process.
 * @param identity - the member and its room.
 * @returns the entries, `DSH_LOCAL_AGENT_ROOM` only when a room is known.
 */
export function memberIdentityEnv(identity: MemberProcessIdentity): Record<string, string> {
  return {
    [LOCAL_AGENT_MEMBER_ENV]: identity.member,
    ...identity.room === undefined ? {} : { [LOCAL_AGENT_ROOM_ENV]: identity.room },
  }
}

/**
 * Ambient keys a delegated CLI child may inherit on POSIX. Everything else the
 * harness process carries is tombstoned: the CLIs read far more of the
 * environment than they document (claude 2.1.236's credential resolution
 * breaks when `USER` is present — bisected on a live host), so inheriting by
 * default turns every host-specific variable into a per-harness incident.
 * `USER`/`LOGNAME` are deliberately absent; git resolves the author from
 * `HOME`'s gitconfig. Proxy variables pass through in both casings.
 */
const POSIX_INHERITED: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'SSH_AUTH_SOCK',
  'NO_COLOR',
  'GIT_TERMINAL_PROMPT',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
])

/**
 * The Windows counterpart, matched case-insensitively per the platform's
 * environment semantics. `USERNAME` is excluded for symmetry with POSIX
 * `USER`.
 */
const WINDOWS_INHERITED: ReadonlySet<string> = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
])

/**
 * Build the explicit `env` layer of a delegation spawn spec: the caller's
 * entries (scoped home variable, credentials, endpoint overrides) plus an
 * `undefined` tombstone for every ambient key outside the platform's
 * inheritance allowlist. The result only makes sense as a
 * `SubprocessSpawnSpec.env` — the subprocess seam merges it over
 * `scrubbedParentEnv()`, so allowlisted keys arrive by inheritance and never
 * appear here, while tombstoned keys are removed from the child. Caller's
 * entries always win, including over the allowlist. Anything the child truly
 * needs beyond the allowlist must be passed explicitly by the provider, which
 * is the point: the delegation env is reviewed, not inherited by accident.
 *
 * Inside {@link withMemberProcessIdentity} the layer also names the member
 * ({@link memberIdentityEnv}); the provider's own entries still win.
 * @param extra - the provider's explicit entries (and any deliberate
 *   tombstones) for this spawn.
 * @returns the explicit env layer to hand to `ctx.subprocess.spawn`.
 */
export function delegationEnv(extra: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const windows = process.platform === 'win32'
  const normalize = (key: string): string => (windows ? key.toUpperCase() : key)
  const explicit = new Set(Object.keys(extra).map(normalize))
  const inherited = windows ? WINDOWS_INHERITED : POSIX_INHERITED
  const env: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(scrubbedParentEnv())) {
    if (explicit.has(normalize(key)) || inherited.has(normalize(key))) continue
    env[key] = undefined
  }
  const identity = identityStore.getStore()
  return { ...env, ...identity === undefined ? {} : memberIdentityEnv(identity), ...extra }
}
