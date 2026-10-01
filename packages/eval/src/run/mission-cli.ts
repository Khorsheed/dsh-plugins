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
 * The projection is read from `dsh-mission list --run <id> --json` — one
 * JSON document carrying a schema version (`dsh-mission.list/1`, T89). Until
 * T89 this module parsed the human table's padded columns, which any column
 * change would have silently broken; the table is for people now and nothing
 * here reads it. A mission CLI predating `--json` refuses the flag, and that
 * refusal is turned into a sentence naming the upgrade.
 * @module @khorsheed/dsh-eval
 */
import { execFile, execFileSync } from 'node:child_process'
import type { MissionFinalizeFace } from '../faces.ts'

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

/** The `dsh-mission list --json` document version this module reads. */
export const MISSION_LIST_SCHEMA = 'dsh-mission.list/1'

/** What an older `dsh-mission` (no `list --json`) says when handed the flag. */
const OLD_CLI_REFUSAL = '--json requires a value'

/**
 * The sentence for a mission CLI older than `list --json`.
 * @param bin - the binary that refused.
 */
export function oldMissionCliHint(bin: string): string {
  return `${JSON.stringify(bin)} predates \`dsh-mission list --json\` (dsh-mission T89) — `
    + 'upgrade the dsh-mission CLI; eval no longer reads the human-readable table'
}

/**
 * Parse `dsh-mission list --json` into the rows finalize needs.
 * @param stdout - the CLI's output.
 * @returns each mission's id and state, in the CLI's order.
 * @throws {@link MissionCliError} when the output is not a `dsh-mission.list/1` document.
 */
export function parseMissionList(stdout: string): Array<{ id: string; state: string }> {
  let document: unknown
  try {
    document = JSON.parse(stdout)
  } catch {
    throw new MissionCliError('dsh-mission list --json did not print JSON — is the CLI older than T89?')
  }
  const doc = document as { schema?: unknown; missions?: unknown }
  if (typeof document !== 'object' || document === null || doc.schema !== MISSION_LIST_SCHEMA || !Array.isArray(doc.missions)) {
    throw new MissionCliError(
      `dsh-mission list --json printed schema ${JSON.stringify(doc?.schema ?? null)}; this eval reads ${MISSION_LIST_SCHEMA}`,
    )
  }
  return doc.missions.flatMap((row: unknown) => {
    const r = row as { id?: unknown; state?: unknown } | null
    return typeof r?.id === 'string' && typeof r.state === 'string' ? [{ id: r.id, state: r.state }] : []
  })
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
        // `--json` LAST: an older CLI then fails on it as a value-less flag,
        // which is the signal the hint below turns into a sentence.
        stdout = execFileSync(bin, ['list', '--run', runId, ...dataDirArgs, '--json'], {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr
        if (stderr?.includes(OLD_CLI_REFUSAL) === true) throw new MissionCliError(oldMissionCliHint(bin))
        throw new MissionCliError(
          stderr !== undefined && stderr.trim() !== '' ? stderr.trim() : notFoundHint(bin, error),
        )
      }
      return { rows: parseMissionList(stdout) }
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
