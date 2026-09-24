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
import { authenticateInstance, callInstance, runOnInstance } from './instance.ts'
import { EXPERIMENT_ID_RE } from './experiment-store.ts'
import type { EvalImportResult, EvalRunRequest } from './types.ts'

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
  run --experiment <id>             Start a run ON a running instance through its
      --instance URL                Remote face and follow the log to the end: the CI
                  [--token T]       door (no browser needed). An experiment lives in
                  [--no-follow]     the instance's \$DSH_HOME/state/eval/experiments
                  [--keep-units]    and pins its dataset {registry, set, commit}.
                  [--dry-run]       --token (or \$DSH_TOKEN) carries the instance's
                                    launch token; --no-follow prints the job and run
                                    ids and returns. Stopping it is job_kill on the
                                    instance — the one cancel path there is.
                                    run <plan.json> --instance URL still runs an old
                                    plan that was never imported (the path resolved
                                    ON THE INSTANCE); its runs pair to no experiment.
                                    Every cell walks the release gate as it
                                    finishes, so a container run holds one unit
                                    at a time; --keep-units stops each cell at
                                    'archived' and keeps its container for
                                    debugging (a matrix larger than lab's
                                    maxConcurrentUnits cannot finish that way).
                                    --finalize is accepted and means what the
                                    default already does.
  import --from <id>@<ref>          Bring old plans over from a registered dataset
         --instance URL             repository as experiments, through the instance
         [--plan NAME] [--token T]  (it holds the registry and the state root). Reads
                                    datasets/<set>/plans/*.json at <ref> with git show
                                    only and keeps every plan byte for byte, pinning
                                    the plan's own dataset.commit, else the ref's
                                    commit. Every condition a plan names goes into the
                                    condition library: an identical hash is the same
                                    condition; the same id with different content
                                    refuses the whole import with the differences
                                    listed, and nothing is written. --plan imports
                                    one plan (file stem or repo-relative path).
  run <plan.json> --dry-run         Offline rehearsal: validate, generate the
                                    run template, expand the matrix, print the
                                    seeded execution order. [--only id,id] and
                                    [--max-cells N] rehearse a subset of the
                                    matrix. A plan with a unit segment also
                                    prints one acquire spec per condition
                                    (env NAMES only; the mount source is the
                                    instance's own scoped home, named by
                                    shape). Without --dry-run the CLI
                                    REFUSES:
                                    a run starts from a live session
                                    (/eval run) — outside one there is no
                                    parent agent to delegate through.
  finalize <runId>                  Walk every 'archived' cell of a run through
                                    archived → releasable → released, the same
                                    gate a run takes as each cell finishes, and
                                    list every cell that was not archived with
                                    its state. A refused gate is recorded, never
                                    forced. Outside a host there is no mission
                                    service, so this drives the dsh-mission CLI
                                    in a child process: [--data-dir DIR] picks
                                    the ledger, [--mission-cli PATH] (or
                                    $DSH_MISSION_CLI) the binary. That child
                                    process is a ledger, not a lab, so this face
                                    releases no CONTAINER: reclaiming those is
                                    /eval finalize on the instance, or the
                                    report page's 回收 button.
  template <manifest.yml>           Print the run template generated from a
                                    dataset-suite manifest (stages, guards,
                                    archive gate) as stdout JSON. [--stages
                                    a,b] selects a subset (default: every
                                    manifest stage).
  conditions hash <condition.json>  sha256 of the condition document's
                                    canonical JSON (notes excluded); the file
                                    must be a valid dataseek.condition/1.
  conditions list                   Every condition in the deployment's library
                                    (\$DSH_HOME/state/eval/conditions): id, hash,
                                    lock state, whether the locked home still
                                    matches, and the provisioned snapshot the
                                    lock recorded. Read-only.
  conditions diff <a> <b>           Field-by-field difference between two
                                    library declarations (canonical deep compare;
                                    the hash excludes notes, the diff still shows
                                    them). Each side is a condition id or a
                                    path. Prints WHICH fields differ and what
                                    each side says — and nothing else: whether
                                    a pair is worth running is the reviewer's
                                    call, not a tool's.
  conditions provision <id>         Turn a library declaration into a real scoped
                                    home and write conditions/<id>.lock.json
                                    beside it. Needs the local-agent service (the
                                    credential grade and the scope's effective
                                    settings live there), so it runs from a
                                    live session: /eval conditions provision.
                                    Outside one this CLI refuses and says so.
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
/**
 * One numeric option, or undefined when absent.
 * @param values - the parsed value flags.
 * @param flag - the flag name.
 * @returns the number.
 * @throws {@link UsageError} when the value is not a positive integer.
 */
function numberOption(values: Map<string, string[]>, flag: string): number | undefined {
  const raw = values.get(flag)?.[0]
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`${flag} wants a non-negative integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

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
        const { values, switches, leftovers: positionals } = splitOptions(rest, [
          '--only', '--max-cells', '--instance', '--token', '--concurrency', '--retries', '--out', '--experiment',
        ])
        const experimentId = values.get('--experiment')?.[0]
        const [planPath, ...leftovers] = experimentId === undefined ? positionals : [undefined, ...positionals]
        if (experimentId !== undefined && !EXPERIMENT_ID_RE.test(experimentId)) {
          throw new UsageError(`--experiment wants an experiment id, got ${JSON.stringify(experimentId)}`)
        }
        if (experimentId === undefined && planPath === undefined) {
          throw new UsageError('run wants --experiment <id> (or, for an old plan, a plan path)')
        }
        const dryRun = switches.has('--dry-run')
        switches.delete('--dry-run')
        const instance = values.get('--instance')?.[0]
        const noFollow = switches.has('--no-follow')
        switches.delete('--no-follow')
        // Accepted and ignored: --finalize asked for what is now the default,
        // and failing a script that still passes it would be a refusal with
        // nothing behind it.
        switches.delete('--finalize')
        const keepUnits = switches.has('--keep-units')
        switches.delete('--keep-units')
        const ignoreReadiness = switches.has('--ignore-readiness')
        switches.delete('--ignore-readiness')
        const unknown = [...switches, ...leftovers]
        if (unknown.length > 0) {
          throw new UsageError(`unexpected argument(s) for run: ${unknown.join(' ')}`)
        }
        if (instance !== undefined) {
          // The instance path: this process is a CALLER, not an orchestrator.
          // The experiment (or an old plan's path) is resolved on the INSTANCE
          // — it holds the state root and the registry — so it is passed
          // through verbatim.
          const request: EvalRunRequest = {
            ...(experimentId !== undefined ? { experimentId } : { plan: planPath as string }),
            ...(dryRun ? { dryRun: true } : {}),
            ...(keepUnits ? { keepUnits: true } : {}),
            ...(ignoreReadiness ? { ignoreReadiness: true } : {}),
            ...(values.get('--out')?.[0] === undefined ? {} : { out: values.get('--out')?.[0] as string }),
            ...(numberOption(values, '--concurrency') === undefined ? {} : { concurrency: numberOption(values, '--concurrency') as number }),
            ...(numberOption(values, '--retries') === undefined ? {} : { retries: numberOption(values, '--retries') as number }),
            ...(numberOption(values, '--max-cells') === undefined ? {} : { maxCells: numberOption(values, '--max-cells') as number }),
            ...((values.get('--only') ?? []).flatMap(value => value.split(',')).map(id => id.trim()).filter(id => id !== '').length > 0
              ? { only: (values.get('--only') ?? []).flatMap(value => value.split(',')).map(id => id.trim()).filter(id => id !== '') }
              : {}),
          }
          const token = values.get('--token')?.[0] ?? process.env['DSH_TOKEN']
          try {
            const outcome = await runOnInstance(
              { baseUrl: instance, ...(token === undefined ? {} : { token }) },
              request,
              { write: line => { io.stdout(`${line}\n`) } },
              { follow: !noFollow },
            )
            io.stderr(`dsh-eval: ${outcome.status}${outcome.detail === undefined ? '' : ` — ${outcome.detail}`}\n`)
            return outcome.status === 'completed' || outcome.status === 'running' ? 0 : 1
          } catch (error) {
            io.stderr(`dsh-eval: ${error instanceof Error ? error.message : String(error)}\n`)
            return 1
          }
        }
        if (experimentId !== undefined) {
          io.stderr('dsh-eval: refusing: an experiment pins a registered dataset at a commit, and reading that pin needs the'
            + ' instance\'s datasets registry — pass --instance <url> (add --dry-run for the rehearsal there).\n')
          return 1
        }
        if (!dryRun) {
          io.stderr(`dsh-eval: refusing: a run starts from a live session (/eval run), or from a running instance (--instance <url>) — outside both there is no parent agent to delegate through. Re-run with --dry-run for the offline rehearsal.\n`)
          return 1
        }
        const only = (values.get('--only') ?? []).flatMap(value => value.split(',')).map(id => id.trim()).filter(id => id !== '')
        const maxCellsRaw = values.get('--max-cells')?.[0]
        const maxCells = maxCellsRaw === undefined ? undefined : Number(maxCellsRaw)
        if (maxCells !== undefined && (!Number.isInteger(maxCells) || maxCells < 1)) {
          throw new UsageError(`--max-cells wants a positive integer, got ${JSON.stringify(maxCellsRaw)}`)
        }
        const report = await service.run(planPath as string, {
          dryRun: true,
          ...(only.length > 0 ? { only } : {}),
          ...(maxCells !== undefined ? { maxCells } : {}),
        })
        io.stdout(`${JSON.stringify({
          planSha: report.meta.planSha,
          conditions: report.meta.conditions,
          order: report.meta.order,
          concurrency: report.meta.concurrency,
          // Present only for a plan with a unit segment: one acquire spec per
          // condition, env NAMES only (the rehearsal prints what a unit will
          // be built from, never a value it will be built with).
          ...(report.meta.units !== undefined ? { units: report.meta.units } : {}),
          subset: report.subset,
          template: report.template,
        }, null, 2)}\n`)
        const sequence = (report.meta.order as { sequence: string[] }).sequence
        io.stderr(`dsh-eval: dry-run ok — ${sequence.length} of ${report.subset.totalCells} cell(s), order seeded (order.sequence)\n`)
        return 0
      }
      case 'import':
        return await runImport(rest, io)
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
        // Said every time, because silence here would read as "and the
        // containers are gone" — which is exactly what this face cannot do.
        io.stderr('dsh-eval: containers were not touched (no lab on this face) —'
          + ` run /eval finalize ${report.runId} on the instance to reclaim the units\n`)
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
      case 'conditions':
        return await runConditions(service, rest, io)
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
          usagePath: result.usagePath,
          rows: result.rowCount,
          usageRows: result.usageRowCount,
          comparisonAllowed: result.report.comparisonAllowed,
          toolOnlyNs: result.report.toolOnlyNs,
          invariants,
        }, null, 2)}\n`)
        io.stderr(`dsh-eval: report → ${result.resultsPath} + ${result.usagePath} + ${result.summaryPath} (${result.rowCount} verdict row(s), ${result.usageRowCount} delegation round(s), comparison ${result.report.comparisonAllowed ? 'allowed' : 'REFUSED by invariants'})\n`)
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

/**
 * The `conditions` verb family: `hash`, `list`, `diff` — and `provision`,
 * which refuses here and names the surface that can do it.
 * @param service - the offline kernel.
 * @param rest - arguments after `conditions`.
 * @param io - output channels.
 * @returns the exit code.
 */
async function runConditions(service: EvalService, rest: readonly string[], io: CliIo): Promise<number> {
  const [sub, ...tail] = rest
  const VERBS = 'hash, list, diff, provision'
  if (sub === undefined) throw new UsageError(`conditions wants a verb (${VERBS})`)
  const { switches, leftovers } = splitOptions(tail, [])
  if (switches.size > 0) throw new UsageError(`unexpected option(s) for conditions ${sub}: ${[...switches].join(' ')}`)

  if (sub === 'hash') {
    const [target, ...extra] = leftovers
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

  if (sub === 'list') {
    if (leftovers.length > 0) throw new UsageError(`unexpected argument(s): ${leftovers.join(' ')}`)
    const report = await service.conditions()
    io.stdout(`${JSON.stringify(report, null, 2)}\n`)
    const ready = report.conditions.filter(condition => condition.status === 'ready').length
    const provisioned = report.conditions.filter(condition => condition.lock.provisioned !== null).length
    io.stderr(`dsh-eval: ${report.conditions.length} condition(s) in the library`
      + ` — ${ready} ready, ${provisioned} carrying a provisioned record\n`)
    return 0
  }

  if (sub === 'diff') {
    const [a, b, ...extra] = leftovers
    if (a === undefined || b === undefined) throw new UsageError('conditions diff wants two conditions (id or path)')
    if (extra.length > 0) throw new UsageError(`unexpected argument(s): ${extra.join(' ')}`)
    const diff = await service.conditionDiff({ a, b })
    io.stdout(`${JSON.stringify(diff, null, 2)}\n`)
    const substantive = diff.differences.filter(difference => difference.path !== 'notes')
    io.stderr(diff.identical
      ? `dsh-eval: ${diff.a.id} and ${diff.b.id} are identical${diff.notesOnly ? ' apart from notes (not a factor — notes are excluded from the hash)' : ''}\n`
      : `dsh-eval: ${diff.a.id} vs ${diff.b.id} — ${substantive.length} field(s) differ: ${substantive.map(difference => difference.path).join(', ')}\n`)
    return 0
  }

  if (sub === 'provision') {
    io.stderr('dsh-eval: refusing: provision resolves the condition\'s scoped home, grades its credential and reads that scope\'s'
      + ' effective settings — all three live in the local-agent service, which this process does not have.'
      + ' Run it from a live session: /eval conditions provision <condition id>.\n')
    return 1
  }

  throw new UsageError(`unknown conditions verb ${JSON.stringify(sub)} (want ${VERBS})`)
}

/**
 * `import --from <id>@<ref> --instance URL [--plan NAME]`: the instance holds
 * the datasets registry and the state root, so the import runs THERE and this
 * process prints what it did. Offline there is no registry to read a ref from.
 * @param rest - arguments after `import`.
 * @param io - output channels.
 * @returns the exit code.
 */
async function runImport(rest: readonly string[], io: CliIo): Promise<number> {
  const { values, switches, leftovers } = splitOptions(rest, ['--from', '--plan', '--instance', '--token'])
  const unknown = [...switches, ...leftovers]
  if (unknown.length > 0) throw new UsageError(`unexpected argument(s) for import: ${unknown.join(' ')}`)
  const from = values.get('--from')?.[0]
  if (from === undefined) throw new UsageError('import wants --from <registration id>@<ref>')
  const instance = values.get('--instance')?.[0]
  if (instance === undefined) {
    io.stderr('dsh-eval: refusing: import reads the dataset repository through the instance\'s datasets registry and writes'
      + ' into its state root — pass --instance <url>.\n')
    return 1
  }
  const plan = values.get('--plan')?.[0]
  const token = values.get('--token')?.[0] ?? process.env['DSH_TOKEN']
  const target = { baseUrl: instance, ...(token === undefined ? {} : { token }) }
  try {
    const cookie = await authenticateInstance(target)
    const report = await callInstance<EvalImportResult>(
      { ...target, ...(cookie === undefined ? {} : { cookie }) },
      'importExperiments',
      { request: { from, ...(plan === undefined ? {} : { plan }) } },
    )
    io.stdout(`${JSON.stringify(report, null, 2)}\n`)
    const created = report.experiments.filter(experiment => experiment.created).length
    io.stderr(`dsh-eval: import ${report.from} (${report.refCommit.slice(0, 7)}) — ${created} experiment(s) created, `
      + `${report.experiments.length - created} already there, ${report.skipped.length} skipped; conditions: `
      + `${report.conditionsAdded.length} added, ${report.conditionsSame.length} identical\n`)
    return 0
  } catch (error) {
    io.stderr(`dsh-eval: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
