/**
 * Where a probe's process runs. The protocol §6.7 contract — argv, the three
 * exit states, the verdict file, the backfill order — is the same wherever it
 * runs; the only thing that varies is whether the process is spawned on the
 * host or inside the cell's unit. So that difference is ONE interface with
 * two implementations, and {@link import('./judge.ts').runProbes} drives
 * either without knowing which it has.
 *
 * Both executors are handed the SAME host-side judging directory: the two
 * verify layers are materialized there in the dataset's own relative layout
 * (an item probe reaches the shared library by the path that resolves in the
 * repository), and the rubric rides beside it. The host executor runs out of
 * that directory; the unit executor hands it to `lab.verify` as the material
 * it copies in, runs the probe against `/workspace`, and brings the verdicts
 * back with `lab.collect`. The verdicts are written OUTSIDE the workspace on
 * purpose — the archive is the player's work, not the judging output.
 * @module @khorsheed/dsh-eval
 */
import { execFile } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { LabFace } from './faces.ts'
import { UNIT_VERDICTS_DIR, UNIT_WORKSPACE } from './unit.ts'

/** One probe run, in coordinates RELATIVE to the judging directory. */
export interface ProbeExecution {
  /** The probe file, relative to the judging directory root. */
  file: string
  /** True for a `.sh` probe (run with `sh`), false for a `.mjs` one (run with node). */
  shell: boolean
  /** The probe's working directory, relative to the judging directory root. */
  cwd: string
  /** A file-name-safe key for this probe — where its verdict file lands. */
  slug: string
  /** The rubric, relative to the judging directory root; null when the item ships none. */
  rubric: string | null
  /** Wall-clock cap for this probe. */
  timeoutMs: number
}

/** What one probe process amounted to, before the verdict file is read. */
export interface ProbeExecResult {
  /** Exit code; null when no process ever produced one (spawn failure, kill). */
  code: number | null
  stderr: string
  /** Set when there is no exit code to report — the reason replaces it. */
  spawnError?: string
}

/**
 * The seam between "run this probe" and "where probes run". Implementations
 * are stateful across one cell: `run` per probe, `collect` once, `outFile` to
 * read what was written, `discard` to destroy the judging material — the
 * verify layer is the answer key and does not outlive its use (architecture
 * §4).
 */
export interface ProbeExecutor {
  /** `host` or `unit` — recorded in the probes annotation so a bundle says where its verdicts came from. */
  readonly where: 'host' | 'unit'
  /** Run one probe. Never throws: a failure is an exit code and a reason. */
  run(execution: ProbeExecution): Promise<ProbeExecResult>
  /** Bring every verdict file onto the host. Called once, after the last probe. */
  collect(): Promise<{ ok: true } | { ok: false; error: string }>
  /** Host path of one probe's verdict file — valid after {@link ProbeExecutor.collect}. */
  outFile(execution: ProbeExecution): string
  /** Destroy the judging material, host side and unit side. Best effort. */
  discard(): Promise<void>
}

/** Single-quote a literal for an `sh -c` script. */
function quote(literal: string): string {
  return `'${literal.replaceAll("'", `'\\''`)}'`
}

/** Spawn one probe on the host and capture its exit code (never throws). */
function spawnProbe(command: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<ProbeExecResult> {
  return new Promise((resolvePromise) => {
    // The probe's stderr IS judged output: its first line becomes a skipped
    // probe's reason and the failure detail of a failed one (judge.ts). Node's
    // own process warnings are not the probe's output — with NODE_USE_ENV_PROXY
    // set in the host shell, every Node process prints an "EnvHttpProxyAgent is
    // experimental" warning at startup, and that warning became the recorded
    // reason instead of the probe's message. Node process warnings are
    // suppressed in the child; the probe's own console.warn/console.error
    // output is untouched (they are not process warnings).
    const env = { ...process.env, NODE_NO_WARNINGS: '1' }
    execFile(command, [...args], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env }, (error, _stdout, stderr) => {
      if (error === null) return resolvePromise({ code: 0, stderr: String(stderr) })
      const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null
      resolvePromise({
        code,
        stderr: String(stderr),
        ...(code === null ? { spawnError: error.message } : {}),
      })
    })
  })
}

/**
 * The host executor — the run loop's behavior before containers existed, kept
 * byte-for-byte: the probe is spawned in the judging directory with the cell
 * directory as `--cell`, and its verdict file is already on the host.
 * @param options.probeDir - the host judging directory.
 * @param options.cellDir - the player's cell directory (probes READ it; they never run inside it).
 */
export function hostProbeExecutor(options: { probeDir: string; cellDir: string }): ProbeExecutor {
  const outDir = join(options.probeDir, '.out')
  return {
    where: 'host',
    outFile: (execution) => join(outDir, `${execution.slug}.json`),
    async run(execution) {
      mkdirSync(outDir, { recursive: true })
      const args = [
        join(options.probeDir, execution.file),
        '--cell', options.cellDir,
        ...(execution.rubric !== null ? ['--rubric', join(options.probeDir, execution.rubric)] : []),
        '--out', join(outDir, `${execution.slug}.json`),
      ]
      return await spawnProbe(
        execution.shell ? '/bin/sh' : process.execPath,
        args,
        join(options.probeDir, execution.cwd),
        execution.timeoutMs,
      )
    },
    // Nothing to bring back: the probe wrote straight onto the host.
    collect: async () => ({ ok: true }),
    async discard() {
      discardDir(options.probeDir)
    },
  }
}

/**
 * The unit executor: the same probe, the same argv, inside the cell's own
 * container.
 *
 * Three placements are deliberate. The judging material goes in through
 * `lab.verify`'s own scratch directory, which lab removes after every call —
 * the answer key never lingers in the unit and never enters the image. The
 * `--out` path is a directory OUTSIDE `/workspace`, so the archive (which is
 * the workspace) carries no judging output. And the verdicts come back with
 * one `lab.collect` after the last probe rather than one per probe: the
 * result is a single, small, registered artifact instead of a stream of them.
 * @param options.lab - the lab face.
 * @param options.unitId - the cell's unit.
 * @param options.probeDir - the host judging directory, handed to verify as material.
 * @param options.collectDir - host directory the verdict tree is collected into.
 * @param options.artifactPath - that directory, relative to the attempt's run-data directory.
 */
export function unitProbeExecutor(options: {
  lab: LabFace
  unitId: string
  probeDir: string
  collectDir: string
  artifactPath: string
}): ProbeExecutor {
  const material = '/run/dsh-lab/verify'
  let ran = false
  return {
    where: 'unit',
    outFile: (execution) => join(options.collectDir, execution.slug, 'verdicts.json'),
    async run(execution) {
      ran = true
      const out = `${UNIT_VERDICTS_DIR}/${execution.slug}`
      const argv = [
        quote(`${material}/${execution.file}`),
        '--cell', quote(UNIT_WORKSPACE),
        ...(execution.rubric !== null ? ['--rubric', quote(`${material}/${execution.rubric}`)] : []),
        '--out', quote(`${out}/verdicts.json`),
      ]
      const script = `mkdir -p ${quote(out)} && cd ${quote(`${material}/${execution.cwd}`)}`
        + ` && exec ${execution.shell ? 'sh' : 'node'} ${argv.join(' ')}`
      const result = await options.lab.verify(options.unitId, {
        command: ['sh', '-c', script],
        source: options.probeDir,
        timeoutMs: execution.timeoutMs,
      })
      if (result.timedOut) {
        return {
          code: null,
          stderr: result.stderr,
          spawnError: `the probe exceeded ${Math.round(execution.timeoutMs / 1000)}s inside the unit and was terminated`,
        }
      }
      return { code: result.exitCode, stderr: result.stderr }
    },
    async collect() {
      // Nothing ran, so there is nothing in the unit to copy — and asking for
      // a directory that was never created would fail for the wrong reason.
      if (!ran) return { ok: true }
      try {
        await options.lab.collect(options.unitId, {
          source: UNIT_VERDICTS_DIR,
          target: options.collectDir,
          kind: 'probe-verdicts',
          artifactPath: options.artifactPath,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async discard() {
      if (ran) {
        // The judging scratch does not outlive its use inside the unit either.
        // lab already removed its own material directory after each call; this
        // is the one directory the ORCHESTRATOR asked the probes to write to.
        try {
          await options.lab.verify(options.unitId, { command: ['sh', '-c', `rm -rf ${quote(UNIT_VERDICTS_DIR)}`] })
        } catch {
          // A unit that is already gone is not a run failure; release reaps it.
        }
      }
      discardDir(options.probeDir)
    },
  }
}

/** Remove a directory, best effort (the verify layer never outlives its use). */
export function discardDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // A probe that left an unremovable file behind is not a run failure.
  }
}
