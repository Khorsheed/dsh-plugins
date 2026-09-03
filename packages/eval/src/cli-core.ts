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
  conditions hash <condition.json>  sha256 of the condition document's
                                    canonical JSON (notes excluded); the file
                                    must be a valid dataseek.condition/1.

Data goes to stdout as JSON; diagnostics to stderr.
Exit codes: 0 ok, 1 failure/refused, 2 usage.
`

class UsageError extends Error {}

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
