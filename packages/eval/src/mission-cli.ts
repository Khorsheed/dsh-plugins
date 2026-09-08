/**
 * A {@link MissionFinalizeFace} backed by the `dsh-mission` CLI, so
 * `dsh-eval finalize` works outside a host.
 *
 * The constraint that shapes this module: eval imports NOTHING from a sibling
 * `@khorsheed/*` package, and outside a host there is no `ctx.mission` to
 * call either. A child process is the only remaining seam, and it is the same
 * seam a person uses by hand — which is precisely what pilot A had to do, one
 * `dsh-mission transition` at a time.
 *
 * The projection is parsed from `dsh-mission list --run`, whose row format is
 * `id bucket state labels plan`, space-separated with padding. Only the first
 * three columns are read, and a line that does not start with three tokens is
 * ignored (the header and the trailing count).
 * @module @khorsheed/dsh-eval
 */
import { execFile, execFileSync } from 'node:child_process'
import type { MissionFinalizeFace } from './faces.ts'

/** How to reach the `dsh-mission` CLI and which ledger to drive. */
export interface MissionCliOptions {
  /** The binary; default `$DSH_MISSION_CLI`, then `dsh-mission` on PATH. */
  bin?: string
  /** mission's `--data-dir`; omitted, the CLI resolves its own default. */
  dataDir?: string
}

/** Thrown when the `dsh-mission` child process cannot run or refuses. */
export class MissionCliError extends Error {}

function binOf(options: MissionCliOptions): string {
  const explicit = options.bin ?? process.env['DSH_MISSION_CLI']
  return explicit !== undefined && explicit !== '' ? explicit : 'dsh-mission'
}

function notFoundHint(bin: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes('ENOENT')) return message
  return `cannot run ${JSON.stringify(bin)} — install the dsh-mission CLI, or point DSH_MISSION_CLI at it`
}

/**
 * One row of `dsh-mission list`: `id bucket state …`. Returns null for the
 * header line, the `(N mission(s))` tail, and anything else unparseable.
 */
export function parseMissionRow(line: string): { id: string; state: string } | null {
  const match = /^(\S+)\s+(\S+)\s+(\S+)(?:\s|$)/.exec(line)
  if (match === null) return null
  const [, id, , state] = match
  if (id === undefined || state === undefined) return null
  if (id === 'id') return null // the column header
  return { id, state }
}

/**
 * Build a finalize face that shells out to `dsh-mission`.
 * @param options - binary and data directory.
 * @returns the face `finalizeRun` drives.
 */
export function missionCliFace(options: MissionCliOptions = {}): MissionFinalizeFace {
  const bin = binOf(options)
  const dataDirArgs = options.dataDir !== undefined ? ['--data-dir', options.dataDir] : []

  const run = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
    execFile(bin, [...args, ...dataDirArgs], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      const detail = stderr.trim() !== '' ? stderr.trim() : notFoundHint(bin, error)
      reject(new MissionCliError(detail))
    })
  })

  return {
    runStatus(runId: string): { rows: ReadonlyArray<{ id: string; state: string }> } {
      let stdout: string
      try {
        stdout = execFileSync(bin, ['list', '--run', runId, ...dataDirArgs], {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr
        throw new MissionCliError(
          stderr !== undefined && stderr.trim() !== '' ? stderr.trim() : notFoundHint(bin, error),
        )
      }
      const rows = stdout.split('\n').map(parseMissionRow).filter((row): row is { id: string; state: string } => row !== null)
      return { rows }
    },
    // `by` is accepted for face compatibility and dropped: the mission CLI
    // records every write as `cli`, which is the honest author here.
    async transition(missionId, to, transitionOptions) {
      const args = ['transition', missionId, to]
      if (transitionOptions?.runId !== undefined) args.push('--run', transitionOptions.runId)
      if (transitionOptions?.note !== undefined) args.push('--note', transitionOptions.note)
      const stdout = await run(args)
      return { changed: !stdout.includes('no-op') }
    },
    async annotate(missionId, ns, payload, annotateOptions) {
      const args = ['annotate', missionId, '--ns', ns, '--payload', JSON.stringify(payload)]
      if (annotateOptions?.runId !== undefined) args.push('--run', annotateOptions.runId)
      const stdout = await run(args)
      return { added: !stdout.includes('no-op') }
    },
  }
}
