import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

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
  return { ...env, ...extra }
}
