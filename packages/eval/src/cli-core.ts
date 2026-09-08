/**
 * Implementation of the `dsh-eval` CLI: the offline verbs over the same
 * {@link EvalService} kernel the in-host plugin provides. Nothing here needs
 * the host — the CLI builds the kernel directly, so scripts get identical
 * behavior with or without the plugin mounted.
 *
 * Data goes to stdout (JSON where the verb produces a value), diagnostics to
 * stderr. Exit codes: 0 ok, 1 failure/refused, 2 usage.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { EvalService } from './service.ts'
import { CONDITION_ID_RE } from './schema.ts'
import { finalizeRun } from './finalize.ts'
import { missionCliFace } from './mission-cli.ts'

/** Injected output channels. */
export interface CliIo {
  /** Write to stdout (data). */
  stdout: (text: string) => void
  /** Write to stderr (diagnostics). */
  stderr: (text: string) => void
}

const USAGE = `dsh-eval <verb> [options]

  validate <plan.json>              Validate a plan against dataseek.plan/1 and
                                    resolve its conditions offline: schema,
                                    judge/expectedNs cross-checks, condition
                                    declarations, locks, stage schemas.
                                    Report as stdout JSON; exit 0 when valid
                                    (warnings allowed), 1 when errors remain.
  run <plan.json> --dry-run         Offline rehearsal: validate, generate the
                                    run template, expand the matrix, print the
                                    seeded execution order. [--only id,id] and
                                    [--max-cells N] rehearse a subset of the
                                    matrix. Without --dry-run the CLI REFUSES:
                                    a run starts from a live session
                                    (/eval run) — outside one there is no
                                    parent agent to delegate through.
  finalize <runId>                  Walk every 'archived' cell of a run through
                                    archived → releasable → released, the same
                                    gate /eval run --finalize takes, and list
                                    every cell that was not archived with its
                                    state. A refused gate is recorded, never
                                    forced. Outside a host there is no mission
                                    service, so this drives the dsh-mission CLI
                                    in a child process: [--data-dir DIR] picks
                                    the ledger, [--mission-cli PATH] (or
                                    $DSH_MISSION_CLI) the binary.
  template <manifest.yml>           Print the run template generated from a
                                    dataset-suite manifest (stages, guards,
                                    archive gate) as stdout JSON. [--stages
                                    a,b] selects a subset (default: every
                                    manifest stage).
  conditions hash <condition.json>  sha256 of the condition document's
                                    canonical JSON (notes excluded); the file
                                    must be a valid dataseek.condition/1.
  report <bundleDir> [--out DIR]    Build report/results.jsonl (one verdict per
                                    line) and report/summary.md (four
                                    invariants, paired comparison) from a
                                    mission export bundle. --out redirects the
                                    output directory. Exit 0 when the report
                                    was written (comparison may still be
                                    refused by the invariants — read summary.md).

Data goes to stdout as JSON; diagnostics to stderr.
Exit codes: 0 ok, 1 failure/refused, 2 usage.
`

class UsageError extends Error {}

/**
 * Split a verb's arguments into `--flag value` pairs, bare `--switches`, and
 * positionals. `valueFlags` names the flags that take a value (both
 * `--flag value` and `--flag=value` forms); everything else starting with
 * `--` is a switch, so an unknown option is reported by the caller rather
 * than swallowing the next argument.
 */
function splitOptions(argv: readonly string[], valueFlags: readonly string[]): {
  values: Map<string, string[]>
  switches: Set<string>
  leftovers: string[]
} {
  const wanted = new Set(valueFlags)
  const values = new Map<string, string[]>()
  const switches = new Set<string>()
  const leftovers: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (!arg.startsWith('--')) {
      if (arg !== '') leftovers.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    if (!wanted.has(name)) {
      switches.add(arg)
      continue
    }
    let value: string | undefined
    if (eq === -1) {
      value = argv[i + 1]
      i++
    } else {
      value = arg.slice(eq + 1)
    }
    if (value === undefined || value === '') throw new UsageError(`${name} wants a value`)
    values.set(name, [...values.get(name) ?? [], value])
  }
  return { values, switches, leftovers }
}

/** The condition id is the declaration's file name. */
function conditionIdFromPath(path: string): string {
  const id = basename(path).replace(/\.json$/, '')
  if (!CONDITION_ID_RE.test(id)) {
    throw new Error(`condition file name ${JSON.stringify(basename(path))} does not yield a usable condition id`)
  }
  return id
}

/**
 * Run the CLI.
 * @param argv - arguments after the bin name.
 * @param io - output channels.
 * @returns the process exit code.
 */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [verb, ...rest] = argv
  if (verb === undefined) {
    io.stdout(USAGE)
    return 2
  }
  if (verb === 'help' || verb === '--help') {
    io.stdout(USAGE)
    return 0
  }
  const service = new EvalService()
  try {
    switch (verb) {
      case 'validate': {
        const [planPath, ...extra] = rest
        if (planPath === undefined) throw new UsageError('validate wants a plan path')
        if (extra.length > 0) throw new UsageError(`unexpected argument(s): ${extra.join(' ')}`)
        const report = await service.validatePlan(planPath)
        io.stdout(`${JSON.stringify(report, null, 2)}\n`)
        io.stderr(`dsh-eval: ${report.ok ? 'valid' : 'INVALID'} — ${report.errors.length} error(s), ${report.warnings.length} warning(s)\n`)
        return report.ok ? 0 : 1
      }
      case 'run': {
        const [planPath, ...extra] = rest
        if (planPath === undefined) throw new UsageError('run wants a plan path')
        const { values, switches, leftovers } = splitOptions(extra, ['--only', '--max-cells'])
        const dryRun = switches.has('--dry-run')
        switches.delete('--dry-run')
        const unknown = [...switches, ...leftovers]
        if (unknown.length > 0) {
          throw new UsageError(`unexpected argument(s) for run: ${unknown.join(' ')} — the CLI runs --dry-run only (a live run starts from a session: /eval run)`)
        }
        if (!dryRun) {
          io.stderr(`dsh-eval: refusing: a run starts from a live session (/eval run) — outside one there is no parent agent to delegate through. Re-run with --dry-run for the offline rehearsal.\n`)
          return 1
        }
        const only = (values.get('--only') ?? []).flatMap(value => value.split(',')).map(id => id.trim()).filter(id => id !== '')
        const maxCellsRaw = values.get('--max-cells')?.[0]
        const maxCells = maxCellsRaw === undefined ? undefined : Number(maxCellsRaw)
        if (maxCells !== undefined && (!Number.isInteger(maxCells) || maxCells < 1)) {
          throw new UsageError(`--max-cells wants a positive integer, got ${JSON.stringify(maxCellsRaw)}`)
        }
        const report = await service.run(planPath, {
          dryRun: true,
          ...(only.length > 0 ? { only } : {}),
          ...(maxCells !== undefined ? { maxCells } : {}),
        })
        io.stdout(`${JSON.stringify({ planSha: report.meta.planSha, conditions: report.meta.conditions, order: report.meta.order, concurrency: report.meta.concurrency, subset: report.subset, template: report.template }, null, 2)}\n`)
        const sequence = (report.meta.order as { sequence: string[] }).sequence
        io.stderr(`dsh-eval: dry-run ok — ${sequence.length} of ${report.subset.totalCells} cell(s), order seeded (order.sequence)\n`)
        return 0
      }
      case 'finalize': {
        const { values, switches, leftovers } = splitOptions(rest, ['--data-dir', '--mission-cli'])
        const [runId, ...extraPositionals] = leftovers
        if (runId === undefined) throw new UsageError('finalize wants a run id')
        if (extraPositionals.length > 0 || switches.size > 0) {
          throw new UsageError(`unexpected argument(s): ${[...extraPositionals, ...switches].join(' ')}`)
        }
        const dataDir = values.get('--data-dir')?.[0]
        const bin = values.get('--mission-cli')?.[0]
        const mission = missionCliFace({
          ...(dataDir !== undefined ? { dataDir } : {}),
          ...(bin !== undefined ? { bin } : {}),
        })
        const report = await finalizeRun(mission, runId, { by: 'dsh-eval-cli', log: (message) => { io.stderr(`dsh-eval: ${message}\n`) } })
        io.stdout(`${JSON.stringify(report, null, 2)}\n`)
        const skips = Object.entries(report.skippedByState).map(([state, count]) => `${count} ${state}`).join(', ')
        io.stderr(`dsh-eval: finalize ${report.runId} — ${report.released} released, ${report.refused} gate-refused, `
          + `${report.skipped} skipped${skips === '' ? '' : ` (${skips})`}\n`)
        // A refused gate is a real outcome the operator must see, not a
        // crash: exit 1 so a script notices, with the per-cell reasons above.
        return report.refused > 0 ? 1 : 0
      }
      case 'template': {
        const [manifestPath, ...extra] = rest
        if (manifestPath === undefined) throw new UsageError('template wants a manifest path')
        const stagesFlag = extra.indexOf('--stages')
        const leftovers = extra.filter((token, i) => token !== '--stages' && extra[i - 1] !== '--stages')
        if (leftovers.length > 0) throw new UsageError(`unexpected argument(s): ${leftovers.join(' ')}`)
        const stages = stagesFlag >= 0 ? (extra[stagesFlag + 1] ?? '').split(',').map(s => s.trim()).filter(s => s !== '') : undefined
        if (stages !== undefined && stages.length === 0) throw new UsageError('--stages wants a comma-separated stage list')
        const template = await service.generateTemplate(manifestPath, ...(stages !== undefined ? [{ stages }] : []))
        io.stdout(`${JSON.stringify(template, null, 2)}\n`)
        io.stderr(`dsh-eval: template generated from ${manifestPath} (${template.states.length} states, ${template.transitions.length} transitions)\n`)
        return 0
      }
      case 'conditions': {
        const [sub, target, ...extra] = rest
        if (sub !== 'hash') {
          throw new UsageError(sub === undefined
            ? 'conditions wants a verb (hash)'
            : `unknown conditions verb ${JSON.stringify(sub)} (want hash)`)
        }
        if (target === undefined) throw new UsageError('conditions hash wants a condition file')
        if (extra.length > 0) throw new UsageError(`unexpected argument(s): ${extra.join(' ')}`)
        let document: unknown
        try {
          document = JSON.parse(await readFile(target, 'utf8'))
        } catch (error) {
          throw new Error(`cannot read condition ${target}: ${error instanceof Error ? error.message : String(error)}`)
        }
        const id = conditionIdFromPath(target)
        const { sha, warnings } = service.hashCondition(document)
        io.stdout(`${JSON.stringify({ id, sha, warnings }, null, 2)}\n`)
        io.stderr(`dsh-eval: ${id} sha ${sha.slice(0, 12)}… (${warnings.length} unresolved field(s))\n`)
        return 0
      }
      case 'report': {
        const positional: string[] = []
        let outDir: string | undefined
        for (let i = 0; i < rest.length; i++) {
          const arg = rest[i] ?? ''
          if (arg === '--out') {
            outDir = rest[i + 1]
            if (outDir === undefined) throw new UsageError('--out wants a directory')
            i++
          } else if (arg.startsWith('--out=')) {
            outDir = arg.slice('--out='.length)
            if (outDir === '') throw new UsageError('--out wants a directory')
          } else if (arg.startsWith('--')) {
            throw new UsageError(`unknown option ${JSON.stringify(arg)}`)
          } else if (arg.length > 0) {
            positional.push(arg)
          }
        }
        const [bundleDir, ...extra] = positional
        if (bundleDir === undefined) throw new UsageError('report wants a bundle directory')
        if (extra.length > 0) throw new UsageError(`unexpected argument(s): ${extra.join(' ')}`)
        const options: { out?: string } = {}
        if (outDir !== undefined) options.out = outDir
        const result = await service.report(bundleDir, options)
        const invariants = Object.fromEntries(result.report.invariants.map(check => [check.id, check.status]))
        io.stdout(`${JSON.stringify({
          bundleDir: result.bundleDir,
          outDir: result.outDir,
          resultsPath: result.resultsPath,
          summaryPath: result.summaryPath,
          rows: result.rowCount,
          comparisonAllowed: result.report.comparisonAllowed,
          toolOnlyNs: result.report.toolOnlyNs,
          invariants,
        }, null, 2)}\n`)
        io.stderr(`dsh-eval: report → ${result.resultsPath} + ${result.summaryPath} (${result.rowCount} verdict row(s), comparison ${result.report.comparisonAllowed ? 'allowed' : 'REFUSED by invariants'})\n`)
        return 0
      }
      default:
        throw new UsageError(`unknown verb ${JSON.stringify(verb)}`)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`dsh-eval: ${error.message}\n\n${USAGE}`)
      return 2
    }
    io.stderr(`dsh-eval: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
