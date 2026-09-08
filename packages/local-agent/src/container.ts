/**
 * Container exec transport for one delegation round: rewrite a CLI launch
 * (argv + explicit env layer) into the `docker exec` form that runs the SAME
 * argv inside an already-acquired container. Nothing downstream of the spawn
 * changes — stdio stays piped, the stream parsers, settle chain, readback and
 * delegation recording are byte-for-byte the host path's.
 *
 * The transport owns exactly one docker verb, `exec`. Acquiring, inspecting,
 * mounting and destroying a container belong to the caller (lab); a provider
 * that reached for another verb would be running an experiment nobody
 * declared.
 * @module @khorsheed/dsh-local-agent/container
 */

import { delegationEnv } from './env.ts'
import type { DelegationExecTarget } from './types.ts'

/**
 * Docker client configuration a delegation must not lose when the CLI moves
 * into a container: without them the `docker exec` would talk to the wrong
 * daemon (or none). They are read from the HOST process environment, apply to
 * the docker CLI itself, and never reach the container.
 */
const DOCKER_CLIENT_ENV: readonly string[] = [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_API_VERSION',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
]

/** A valid POSIX environment variable name (no `=`, no NUL, not empty). */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One CLI launch: the argv a provider would spawn and its explicit env layer. */
export interface ContainerExecLaunch {
  /** The CLI argv (`['codex', 'exec', …]`), unchanged by the transport. */
  readonly argv: readonly string[]
  /**
   * The provider's explicit env layer as {@link delegationEnv} built it:
   * defined entries are the round's own variables, `undefined` entries are
   * tombstones for the shared scrub and carry no value to forward.
   */
  readonly env: Readonly<NodeJS.ProcessEnv>
}

/**
 * Validate one exec target, failing loud on the shapes docker would reject
 * later (or, worse, misread as its own flags).
 * @param target - the caller's exec target.
 * @param who - the provider name, for the error message.
 * @throws when the container name or workdir is empty, flag-shaped, or (for
 *   the workdir) not absolute, or when an env key is not a variable name.
 */
function assertTarget(target: DelegationExecTarget, who: string): void {
  if (target.container === '' || target.container.startsWith('-')) {
    throw new Error(`${who}: the container exec target needs a container name, got ${JSON.stringify(target.container)}`)
  }
  if (!target.workdir.startsWith('/')) {
    throw new Error(`${who}: the container exec target's workdir must be an absolute in-container path, got ${JSON.stringify(target.workdir)}`)
  }
  for (const key of Object.keys(target.env ?? {})) {
    if (!ENV_NAME.test(key)) {
      throw new Error(`${who}: ${JSON.stringify(key)} is not a usable environment variable name for the container exec target`)
    }
  }
}

/**
 * Rewrite a host CLI launch into its container form:
 * `docker exec -w <workdir> [-e NAME…] <container> <original argv>`.
 *
 * **Values never ride the argv.** Each forwarded variable appears as a
 * NAME-only `-e` flag, and the docker CLI resolves it from its OWN
 * environment — which this function also returns. A credential the provider
 * resolved (the sub-dsh API key) therefore stays out of the host process
 * table, exactly as it does on the host path. Names are sorted, so one launch
 * always produces one argv.
 *
 * What gets forwarded: every DEFINED entry of the provider's explicit env
 * layer (tombstones carry no value and are dropped), overridden per key by
 * the target's own `env` — the caller's entries are the in-container truth
 * (`CODEX_HOME=/creds/codex` replacing the host scoped-home path). The
 * ambient allowlist (`PATH`, `HOME`, the proxy variables) is deliberately NOT
 * forwarded: inside the container those belong to the image and the `docker
 * run` that created it, not to the host that is driving it.
 * @param target - the container, in-container workdir, and env overrides.
 * @param launch - the argv and explicit env layer of the host launch.
 * @param who - the provider name, for error messages.
 * @returns the argv and env for `ctx.subprocess.spawn` (the docker client).
 */
export function containerExecSpawn(
  target: DelegationExecTarget,
  launch: ContainerExecLaunch,
  who: string,
): { argv: string[]; env: NodeJS.ProcessEnv } {
  assertTarget(target, who)
  const forwarded: Record<string, string> = {}
  for (const [key, value] of Object.entries(launch.env)) {
    if (value !== undefined && ENV_NAME.test(key)) forwarded[key] = value
  }
  for (const [key, value] of Object.entries(target.env ?? {})) forwarded[key] = value
  const names = Object.keys(forwarded).sort()
  const client: NodeJS.ProcessEnv = {}
  for (const key of DOCKER_CLIENT_ENV) {
    const value = process.env[key]
    if (value !== undefined) client[key] = value
  }
  return {
    argv: [
      'docker',
      'exec',
      '-w',
      target.workdir,
      ...names.flatMap(name => ['-e', name]),
      target.container,
      ...launch.argv,
    ],
    // The docker client is the process being spawned, so it carries the
    // forwarded VALUES (the `-e NAME` flags read them here) plus its own
    // daemon coordinates, under the same scrub the host path uses.
    env: delegationEnv({ ...client, ...forwarded }),
  }
}

/**
 * Require the caller to name the CLI's scoped home as an IN-CONTAINER path.
 * Every harness points its CLI at a scoped home through one environment
 * variable, and the provider's own value is a host path: forwarded verbatim
 * it would send the CLI to a directory that does not exist inside the unit,
 * where it would silently start from an empty state — no credentials, no
 * rollout to read back, and a delegation that fails for a reason nothing in
 * the output names. The caller bind-mounts the host scoped home and declares
 * where it landed; a target that forgets fails before anything spawns.
 * @param target - the caller's exec target.
 * @param key - the harness's scoped-home variable (`CODEX_HOME`, …).
 * @param who - the provider name, for the error message.
 * @returns the declared in-container scoped home.
 * @throws when the target does not declare the variable.
 */
export function containerScopedHome(
  target: DelegationExecTarget,
  key: string,
  who: string,
): string {
  const value = target.env?.[key]
  if (value === undefined || value === '') {
    throw new Error(
      `${who}: a container exec target must declare ${key} as the in-container path of the scoped home `
      + '(bind-mount the host scoped home read-write and name its mount point) — the host path means nothing inside the unit',
    )
  }
  return value
}
