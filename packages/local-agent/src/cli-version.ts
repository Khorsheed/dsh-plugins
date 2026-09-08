/**
 * The family's CLI version probe: one bounded `<cli> --version` spawn whose
 * answer is cached against the executable's own identity (resolved path +
 * mtime + size), so a status surface can report `cliVersion` without paying a
 * spawn per call and without ever reporting a stale version across an upgrade.
 *
 * The probe exists because `cliVersion` is a condition-hash input for the
 * evaluation (`LocalAgentEffectiveSettings`), and the CLI's self-reported
 * version is the only value a harness can state honestly: the scoped config
 * never names it, and a package-manifest read would name whatever the host
 * happens to resolve, not the binary a delegation round actually spawns.
 *
 * Degrade, never explode: an unresolvable executable, a non-zero exit, a
 * timeout, or output with no version-shaped token all resolve `undefined` —
 * the absent field is the honest condition input, exactly as
 * `LocalAgentEffectiveSettings` specifies for a knob a harness cannot read.
 * @module @khorsheed/dsh-local-agent/cli-version
 */

import { statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** How long one `--version` probe may run before it is terminated. */
export const CLI_VERSION_PROBE_TIMEOUT_MS = 5_000

/**
 * How long a FAILED probe is remembered. A success is cached against the
 * executable's identity and never expires (a new binary is a new key), but a
 * failure may be transient (a machine under load hitting the timeout), so it
 * expires instead of poisoning the field until the next CLI upgrade.
 */
export const CLI_VERSION_FAILURE_TTL_MS = 60_000

/** SIGTERM to SIGKILL grace for a probe that ignores the timeout's terminate. */
const PROBE_GRACE_MS = 2_000

/** In-memory cap per collected probe stream; a version banner is a few bytes. */
const PROBE_OUTPUT_MAX_BYTES = 4 * 1024

/**
 * A version-shaped token: `1.2.3` with an optional prerelease/build tail.
 * Every family CLI prints one inside a banner of its own shape — codex
 * `codex-cli 0.144.0`, claude `2.1.263 (Claude Code)`, kimi a bare `0.39.1`,
 * dsh `0.1.1-rc.2` — so the token, not the banner, is what this parses.
 */
const VERSION_TOKEN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z][0-9A-Za-z.-]*)?/

/**
 * The version token inside a `--version` banner.
 * @param output - the probe's collected output.
 * @returns the first version-shaped token, or undefined when there is none.
 */
export function parseCliVersion(output: string): string | undefined {
  return VERSION_TOKEN.exec(output)?.[0]
}

/** One `<cli> --version` probe request. */
export interface CliVersionProbe {
  /**
   * The probe argv. `argv[0]` is the executable (resolved against `PATH` when
   * it carries no separator); the rest are the version flags, plus — for a
   * launcher-style argv such as the sub-dsh's `node … bin.js --version` — the
   * entry script, which is what actually carries the version.
   */
  readonly argv: readonly string[]
  /** Working directory for the probe; the harness's scoped home is always safe. */
  readonly cwd: string
  /** The shared subprocess seam (`ctx.subprocess.spawn`). */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /**
   * Explicit environment layer, normally `delegationEnv({ <HOME_VAR>: homeDir })`
   * so the probe reads the SCOPED home like a delegation round would, never
   * the user's own installation.
   */
  readonly env?: NodeJS.ProcessEnv | undefined
  /** Probe deadline; defaults to {@link CLI_VERSION_PROBE_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined
}

/** One cache slot: the in-flight or settled probe, plus its failure moment. */
interface CacheEntry {
  readonly promise: Promise<string | undefined>
  /** Epoch ms the probe resolved WITHOUT a version; absent while in flight or on success. */
  failedAt?: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Forget every cached probe. Exists for tests (whose stub executables and stub
 * spawns must not inherit another test's answer) and for a caller that must
 * force a re-probe; ordinary callers never need it, because a CLI upgrade
 * changes the cache key by itself.
 */
export function clearCliVersionCache(): void {
  cache.clear()
}

/** `path:mtimeMs:size` for an existing file, undefined when it is not one. */
function stampFile(path: string): string | undefined {
  try {
    const stats = statSync(path)
    return stats.isFile() ? `${path}:${stats.mtimeMs}:${stats.size}` : undefined
  } catch {
    return undefined
  }
}

/** Whether an argv entry names a path rather than a bare command or a flag. */
function looksLikePath(entry: string): boolean {
  return entry.includes('/') || (process.platform === 'win32' && entry.includes('\\'))
}

/**
 * Resolve `argv[0]` to a real file: used as-is when it names a path,
 * otherwise searched along `PATH` (with `PATHEXT` on Windows) exactly as the
 * spawn seam will resolve it.
 */
function resolveExecutable(command: string): string | undefined {
  if (command === '') return undefined
  if (looksLikePath(command)) return stampFile(isAbsolute(command) ? command : resolve(command))
  const extensions = process.platform === 'win32'
    ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';')
    : ['']
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const stamped = stampFile(join(dir, command + extension))
      if (stamped !== undefined) return stamped
    }
  }
  return undefined
}

/**
 * The cache key: the identity of every argv entry that names an existing file
 * — the executable, plus a launcher argv's entry script. An upgrade rewrites
 * one of those files, which changes the key, which re-probes. An executable
 * that resolves to nothing keys on the raw argv instead, so a CLI that is not
 * installed is not probed once per status call either.
 */
function cacheKey(argv: readonly string[]): string {
  const parts = [resolveExecutable(argv[0] ?? '') ?? `argv:${argv[0] ?? ''}`]
  for (const entry of argv.slice(1)) {
    if (!looksLikePath(entry)) continue
    const stamped = stampFile(isAbsolute(entry) ? entry : resolve(entry))
    if (stamped !== undefined) parts.push(stamped)
  }
  return parts.join(' ')
}

/** Spawn the probe once and map its output to a version; never throws. */
async function runProbe(probe: CliVersionProbe): Promise<string | undefined> {
  try {
    const child = probe.spawn({
      argv: [...probe.argv],
      cwd: probe.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: PROBE_OUTPUT_MAX_BYTES },
        stderr: { maxBytes: PROBE_OUTPUT_MAX_BYTES },
      },
      graceMs: PROBE_GRACE_MS,
      signal: AbortSignal.timeout(probe.timeoutMs ?? CLI_VERSION_PROBE_TIMEOUT_MS),
      ...probe.env === undefined ? {} : { env: probe.env },
    })
    const outcome = await child.done
    // A non-zero exit (or a signal from the timeout) means the CLI did not
    // answer the question asked. Parsing its diagnostics would invent a
    // version out of an error message, so the honest answer is absence.
    if (outcome.exitCode !== 0) return undefined
    const stdout = child.collected.stdout?.readFrom(0).text ?? ''
    const stderr = child.collected.stderr?.readFrom(0).text ?? ''
    return parseCliVersion(`${stdout}\n${stderr}`)
  } catch {
    return undefined
  }
}

/**
 * The CLI's own version, probed at most once per executable identity.
 * Concurrent callers share one in-flight probe; a success is remembered until
 * the binary changes; a failure is remembered for
 * {@link CLI_VERSION_FAILURE_TTL_MS} so a transient miss recovers without
 * spawning per status call.
 * @param probe - the probe request.
 * @returns the version, or undefined when the CLI cannot be asked.
 */
export async function probeCliVersion(probe: CliVersionProbe): Promise<string | undefined> {
  const key = cacheKey(probe.argv)
  const cached = cache.get(key)
  if (cached !== undefined && (cached.failedAt === undefined || Date.now() - cached.failedAt < CLI_VERSION_FAILURE_TTL_MS)) {
    return cached.promise
  }
  const entry: CacheEntry = { promise: runProbe(probe) }
  cache.set(key, entry)
  const version = await entry.promise
  if (version === undefined) entry.failedAt = Date.now()
  return version
}
