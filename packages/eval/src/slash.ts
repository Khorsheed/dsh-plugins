/**
 * The slash face of the eval orchestrator — the human interface. One `/eval`
 * command; today's verb is `run`, the HUMAN act of starting a run (decision
 * 1): the invoking session becomes the run's originSession and the parent of
 * every delegation. The handler is a thin adapter over `EvalService.run` —
 * the same kernel the CLI's dry-run prints.
 *
 * There is deliberately no run-class MODEL tool: starting a run stays a
 * person's decision, and the write-class verbs (materialize, submit,
 * transition, archive, export) are the orchestrator's service face, not
 * model surface.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { EvalService } from './service.ts'

const USAGE = `usage:
  /eval run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR]
           [--retries N] [--only id,id] [--max-cells N] [--ignore-readiness]
  /eval finalize <runId>

  run starts an evaluation run from a dataseek.plan/1 document. The invoking
  session becomes the run's originSession and the parent of every delegation.
  --dry-run validates, generates the template, expands the matrix, and prints
  the execution order — nothing executes. Before creating the run, every
  condition is probed with one minimal delegation (the readiness check: a
  harness that reports 'authenticated' can still 401 on every call); a failed
  condition refuses the whole run unless --ignore-readiness is given, and then
  its cells are recorded as skipped. --only and --max-cells run part of the
  matrix and record the subset in run.meta. Every cell is judged before it is
  archived (the item's probes write script verdicts; the plan's judge
  conditions write double-sampled llm-draft ones). The default run stops at
  'archived'; --finalize attempts releasable → released, which the archive
  gate allows once verdicts/ is non-empty.

  A plan that declares a unit segment runs every cell inside a container. Each
  condition's harness mounts THIS instance's own scoped home (the directory
  /<harness> login writes into) at the container path the condition declares,
  so a round's rollout lands where the delegation read-back reads it. Log in
  on this instance; nothing is staged or copied. The container path is serial,
  and without --finalize each cell's container survives the run — the release
  gate is the only destroy path, and a cell that stopped at 'archived' has not
  passed it.

  Before the run is created, every condition the plan names is probed with one
  minimal delegation — the judge conditions included, because a judge that
  cannot be delegated to costs the whole round's llm-draft verdicts.

  finalize is the re-entry point for a run that already stopped at 'archived':
  it walks every archived cell through the same gate and lists every cell that
  was not archived with its state. It never forces a refused gate.`

/** Parsed slash input: positional tokens, `--flag value` pairs, bare `--switches`. */
interface SlashArgs {
  positionals: string[]
  flags: Map<string, string[]>
  switches: Set<string>
}

/** Split raw input into tokens, honoring single/double quotes. */
function tokenize(raw: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw.charAt(i))) i++
    if (i >= raw.length) break
    const quote = raw[i] === '"' || raw[i] === "'" ? raw[i] as string : ''
    if (quote !== '') i++
    let token = ''
    while (i < raw.length && (quote !== '' ? raw[i] !== quote : !/\s/.test(raw.charAt(i)))) {
      token += raw[i]
      i++
    }
    if (quote !== '' && i < raw.length) i++ // closing quote
    tokens.push(token)
  }
  return tokens
}

/** Parse tokens into positionals / flags / switches; a value-less `--flag` throws. */
function parseArgs(tokens: readonly string[]): SlashArgs {
  const positionals: string[] = []
  const flags = new Map<string, string[]>()
  const switches = new Set<string>()
  const VALUE_FLAGS = new Set(['--concurrency', '--out', '--retries', '--only', '--max-cells'])
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    if (!VALUE_FLAGS.has(token)) {
      switches.add(token)
      continue
    }
    const value = tokens[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`)
    flags.set(token, [...flags.get(token) ?? [], value])
    i++
  }
  return { positionals, flags, switches }
}

function flagOf(args: SlashArgs, name: string): string | undefined {
  const values = args.flags.get(name)
  return values === undefined ? undefined : values[values.length - 1]
}

/** One line describing what part of the plan's matrix a run covered. */
function subsetLine(subset: { only: string[] | null; maxCells: number | null; totalCells: number; selectedCells: number }): string | null {
  const knobs: string[] = []
  if (subset.only !== null && subset.only.length > 0) knobs.push(`--only ${subset.only.join(',')}`)
  if (subset.maxCells !== null) knobs.push(`--max-cells ${subset.maxCells}`)
  if (knobs.length === 0) return null
  return `subset: ${knobs.join(' ')} — ${subset.selectedCells} of ${subset.totalCells} cell(s) (recorded in run.meta.subset)`
}

/** Render the run report as the command reply. */
function renderReport(lines: readonly string[], report: {
  runId: string
  dryRun: boolean
  meta: { order?: { sequence?: string[] }; units?: Array<{ condition: string; acquire?: Record<string, unknown>; errors?: Array<{ message: string }> }> }
  cells: Array<{ missionId: string; finalState: string; attempts: number; activeMs: number; halted?: boolean; skipped?: { reason: string }; rejected?: { stage: string; violations: string[] }; verdicts?: { script: number; llmDraft: number } }>
  readiness: Array<{ condition: string; role?: string; harness: string; ok: boolean; durationMs: number; observedModel: string | null; reason?: string }>
  subset: { only: string[] | null; maxCells: number | null; totalCells: number; selectedCells: number }
  bundleDir?: string
  exportError?: string
}): CommandResult {
  const body: string[] = [...lines]
  const subset = subsetLine(report.subset)
  if (subset !== null) body.push(subset)
  if (report.dryRun) {
    const sequence = report.meta.order?.sequence ?? []
    body.push(`dry-run — ${sequence.length} cell(s), execution order:`)
    for (const [i, missionId] of sequence.entries()) body.push(`  ${String(i + 1).padStart(3)}. ${missionId}`)
    for (const unit of report.meta.units ?? []) {
      // Env NAMES only, here as everywhere a spec is printed.
      body.push(unit.errors === undefined
        ? `unit ${unit.condition}: ${JSON.stringify(unit.acquire)}`
        : `unit ${unit.condition}: REFUSED — ${unit.errors.map(error => error.message).join('; ')}`)
    }
    body.push('(nothing executed — approve and run without --dry-run)')
    return { kind: 'success', text: body.join('\n') }
  }
  if (report.readiness.length > 0) {
    const failed = report.readiness.filter(record => !record.ok)
    body.push(`readiness: ${report.readiness.length - failed.length}/${report.readiness.length} condition(s) ready`)
    for (const record of failed) body.push(`  ✗ ${record.role === 'judge' ? 'judge ' : ''}${record.condition} (${record.harness}): ${record.reason ?? 'unknown'}`)
  }
  body.push(`run ${report.runId} — ${report.cells.length} cell(s):`)
  for (const cell of report.cells) {
    const notes: string[] = []
    if (cell.halted === true) notes.push('halted')
    if (cell.skipped !== undefined) notes.push(`skipped: ${cell.skipped.reason}`)
    if (cell.rejected !== undefined) notes.push(`rejected at ${cell.rejected.stage}`)
    if (cell.verdicts !== undefined && (cell.verdicts.script > 0 || cell.verdicts.llmDraft > 0)) {
      notes.push(`verdicts ${cell.verdicts.script} script / ${cell.verdicts.llmDraft} llm-draft`)
    }
    body.push(`  ${cell.missionId}: ${cell.finalState} · ${cell.attempts} attempt(s) · active ${(cell.activeMs / 60_000).toFixed(1)}min${notes.length > 0 ? ` · ${notes.join(', ')}` : ''}`)
  }
  if (report.bundleDir !== undefined) body.push(`bundle: ${report.bundleDir}`)
  if (report.exportError !== undefined) body.push(`export FAILED: ${report.exportError}`)
  return { kind: 'success', text: body.join('\n') }
}

/** Human-readable name of each skip class, for the finalize summary line. */
const SKIP_CATEGORY_LABEL: Record<string, string> = {
  'already-released': 'released（已终结）',
  interrupted: '中断（未走到 archived）',
  'not-started': 'pending（未开跑）',
}

/** Handle `/eval finalize <runId>` — the post-run release walk. */
async function handleFinalize(service: EvalService, args: SlashArgs): Promise<CommandResult> {
  const runId = args.positionals[0]
  if (runId === undefined || args.positionals.length > 1) {
    return { kind: 'error', text: 'finalize wants exactly one run id\n\n' + USAGE }
  }
  const lines: string[] = []
  let report: Awaited<ReturnType<EvalService['finalize']>>
  try {
    report = await service.finalize(runId, { log: (message) => { lines.push(message) } })
  } catch (error) {
    return { kind: 'error', text: `eval finalize refused: ${error instanceof Error ? error.message : String(error)}` }
  }
  const body: string[] = [...lines]
  body.push(`finalize ${report.runId} — ${report.cells.length} cell(s): ${report.released} released, ${report.refused} gate-refused, ${report.skipped} skipped`)
  const skipSummary = Object.entries(report.skippedByCategory)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${count} ${SKIP_CATEGORY_LABEL[category] ?? category}跳过`)
  if (skipSummary.length > 0) body.push(`  跳过: ${skipSummary.join('、')}`)
  for (const cell of report.cells) {
    const suffix = cell.action === 'released'
      ? 'archived → released'
      : cell.action === 'refused'
        ? `gate refused at ${cell.finalState} — ${cell.reason ?? 'unknown'}`
        : `skipped (${cell.state})`
    body.push(`  ${cell.missionId}: ${suffix}`)
  }
  return { kind: 'success', text: body.join('\n') }
}

/**
 * Handle one `/eval` invocation.
 * @param service - the eval service.
 * @param invocation - the command invocation (the calling session id is the
 *   run's parentSessionId).
 */
export async function handleEvalCommand(service: EvalService, invocation: CommandInvocation): Promise<CommandResult> {
  let tokens: string[]
  try {
    tokens = tokenize(invocation.rawInput)
  } catch {
    return { kind: 'error', text: USAGE }
  }
  const [sub, ...restTokens] = tokens
  if (sub === undefined || sub === 'help' || sub === '--help') {
    return { kind: 'success', text: USAGE }
  }
  let args: SlashArgs
  try {
    args = parseArgs(restTokens)
  } catch (error) {
    return { kind: 'error', text: `${String(error)}\n\n${USAGE}` }
  }
  if (sub === 'finalize') return await handleFinalize(service, args)
  if (sub !== 'run') {
    return { kind: 'error', text: `unknown /eval verb ${JSON.stringify(sub)}\n\n${USAGE}` }
  }
  const planPath = args.positionals[0]
  if (planPath === undefined || args.positionals.length > 1) {
    return { kind: 'error', text: 'run wants exactly one plan path\n\n' + USAGE }
  }
  let concurrency: number | undefined
  const concurrencyRaw = flagOf(args, '--concurrency')
  if (concurrencyRaw !== undefined) {
    concurrency = Number(concurrencyRaw)
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      return { kind: 'error', text: `--concurrency must be a positive integer, got ${JSON.stringify(concurrencyRaw)}` }
    }
  }
  let retries: number | undefined
  const retriesRaw = flagOf(args, '--retries')
  if (retriesRaw !== undefined) {
    retries = Number(retriesRaw)
    if (!Number.isInteger(retries) || retries < 0) {
      return { kind: 'error', text: `--retries must be a non-negative integer, got ${JSON.stringify(retriesRaw)}` }
    }
  }
  let maxCells: number | undefined
  const maxCellsRaw = flagOf(args, '--max-cells')
  if (maxCellsRaw !== undefined) {
    maxCells = Number(maxCellsRaw)
    if (!Number.isInteger(maxCells) || maxCells < 1) {
      return { kind: 'error', text: `--max-cells must be a positive integer, got ${JSON.stringify(maxCellsRaw)}` }
    }
  }
  // Repeatable and comma-separated both work; the union is what runs.
  const only = (args.flags.get('--only') ?? [])
    .flatMap(value => value.split(','))
    .map(id => id.trim())
    .filter(id => id !== '')
  const parentSessionId = String(invocation.agent.session.id)
  const lines: string[] = []
  try {
    const report = await service.run(planPath, {
      parentSessionId,
      ...(concurrency !== undefined ? { concurrency } : {}),
      dryRun: args.switches.has('--dry-run'),
      finalize: args.switches.has('--finalize'),
      ...(flagOf(args, '--out') !== undefined ? { exportsDir: flagOf(args, '--out') as string } : {}),
      ...(retries !== undefined ? { retryInfrastructure: retries } : {}),
      ...(only.length > 0 ? { only } : {}),
      ...(maxCells !== undefined ? { maxCells } : {}),
      ignoreReadiness: args.switches.has('--ignore-readiness'),
      log: (message) => { lines.push(message) },
    })
    return renderReport(lines, report)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `eval refused: ${text}` }
  }
}

/** Register the `/eval` command on the host's command registry. */
export function registerEvalSlash(ctx: Context, service: EvalService): void {
  ctx.commands.register({
    name: 'eval',
    description: 'Evaluation runs: /eval run <plan.json> starts a run from this session (dry-run validates and prints the order without executing); /eval finalize <runId> walks an already-archived run through the release gate.',
    input: { hint: 'run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N] [--only ids] [--max-cells N] [--ignore-readiness] | finalize <runId>' },
    handler: (invocation: CommandInvocation) => handleEvalCommand(service, invocation),
  })
}
