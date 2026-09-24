/**
 * Controlled experiment units: lifecycle management for isolated, reproducible
 * Milestones M1–M2 ship the service face (`ctx.lab`) with the docker provider:
 * `acquire` / `populate` / `collect` / `checkpoint` / `verify` / `archive` /
 * `release` / `status`, environment fingerprints into mission refs, the
 * releasable gate at release, and the `maxConcurrentUnits` safety valve.
 * The CLI is the rest of M2, the model tools are M3.
 *
 * lab holds no state machine and judges nothing: content arrives as plain
 * directory paths (no code-level datasets dependency), and mission is an
 * optional probed face — absent, registration warns-and-skips and `release`
 * degrades to an explicit force plus a warning.
 *
 * @module @khorsheed/dsh-lab
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import { DockerProvider } from './docker.ts'
import { LabService } from './service.ts'
import { resolveStateDir } from './state.ts'
import type { Exec, Lab, MissionFace } from './types.ts'

/** Default held-unit ceiling (a safety valve, not a scheduler). */
const DEFAULT_MAX_CONCURRENT_UNITS = 4

/** Plugin configuration. */
export interface LabConfig {
  /** Held-unit ceiling; `acquire` refuses at and above it. */
  maxConcurrentUnits?: number
  /**
   * Where the authority-free fingerprint mirror is written; defaults to
   * `$DSH_HOME/lab`, else `<cwd>/.dsh-lab-state`. Deleting it loses nothing —
   * the daemon's labels remain the registry of record.
   */
  stateDir?: string
}

export const Config: z = z.object({
  maxConcurrentUnits: z.natural().min(1).default(DEFAULT_MAX_CONCURRENT_UNITS),
  stateDir: z.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    lab: Lab
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'lab'

/** Required services: the subprocess runtime the providers shell out through. */
export const inject = ['subprocess']

/**
 * Mount the lab service.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: LabConfig): void {
  const service = new LabService({
    providers: { docker: new DockerProvider(subprocessExec(ctx)) },
    maxConcurrentUnits: config.maxConcurrentUnits ?? DEFAULT_MAX_CONCURRENT_UNITS,
    stateDir: resolveStateDir(config.stateDir),
    getMission: () => (ctx.get as (service: string) => unknown).call(ctx, 'mission') as MissionFace | undefined,
    warn: (message) => {
      ctx.logger(name).warn(message)
    },
  })
  ctx.provide('lab', service)
}

/**
 * Adapt `ctx.subprocess` to the providers' {@link Exec} runner: spawn
 * collected, await settlement, read the batch result. A `timeoutMs` bound
 * aborts the spawn (SIGTERM → grace → SIGKILL on the client tree); the
 * in-container pid stays recorded for the release-time sweep.
 */
function subprocessExec(ctx: Context): Exec {
  return async (argv, options) => {
    const controller = options?.timeoutMs !== undefined ? new AbortController() : undefined
    const timer = options?.timeoutMs !== undefined
      ? setTimeout(() => controller?.abort(), options.timeoutMs)
      : undefined
    try {
      const handle = ctx.subprocess.spawn({
        argv,
        cwd: process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 16 * 1024 * 1024 },
          stderr: { maxBytes: 1024 * 1024 },
        },
        graceMs: 5000,
        ...(controller !== undefined ? { signal: controller.signal } : {}),
      })
      const outcome = await handle.done
      return {
        exitCode: outcome.exitCode ?? -1,
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
        timedOut: controller?.signal.aborted === true,
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

export { COMPONENTS_LABEL, DockerProvider } from './docker.ts'
export type { DockerProviderOptions } from './docker.ts'
export {
  canonicalJson, componentsFor, FINGERPRINT_SCHEME, hashComponents, isComposite,
  normalizeCpus, normalizeMemory, parseComponents, shortFingerprint,
} from './fingerprint.ts'
export { LAB_ANNOTATION_NS, LabService } from './service.ts'
export type { LabServiceOptions } from './service.ts'
export { removeUnitState, resolveStateDir, unitStateFile, writeUnitState } from './state.ts'
export type { UnitStateRecord } from './state.ts'
export type * from './types.ts'
