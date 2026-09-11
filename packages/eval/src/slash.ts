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
import { EvalProvisionRefused } from './provision.ts'
import { EvalRunRefused } from './run.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { EvalService } from './service.ts'

const USAGE = `usage:
  /eval run <plan.json> [--wait] [--concurrency N] [--dry-run] [--finalize] [--out DIR]
           [--retries N] [--only id,id] [--max-cells N] [--ignore-readiness]
  /eval finalize <runId>
  /eval conditions list [--repo DIR] [--dataset ID]
  /eval conditions diff <a> <b> [--repo DIR] [--dataset ID]
  /eval conditions provision <condition.json> --repo <working copy>

  conditions provision is the ONE writer of conditions/<id>.lock.json. It
  resolves the condition's (harness, scope) to a real scoped home, refuses
  unless that scope holds a credential (and prints the login command —
  provision never logs in and never copies a credential), checks the
  declaration against that scope's effective settings field by field, hashes
  the home, and writes the lock. permissions or model.endpoint disagreeing is
  an error and no lock is written. --repo names the WORKING COPY it may write
  into; nothing is committed.
  conditions list shows every declaration with its hash, lock state and
  provisioned snapshot. conditions diff prints which fields two declarations
  differ on and what each says — facts only, no recommendation.

  run STARTS an evaluation run and answers immediately with a job id and a run
  id: the run is a background job, so it outlives this turn, this session, and
  the browser tab that dispatched it. Read its log with the job_output tool
  (or job_list / job_kill) — job_kill is the ONE way to stop a run. --wait
  keeps the old behavior instead: the reply comes when the run finishes, which
  is what you want interactively for a short --dry-run or a one-cell plan, and
  what you must not use for a long run.

  The invoking session becomes the run's originSession and the parent of every
  delegation, as long as it still has a live agent; a run started without one
  (from the Remote face, e.g. CI) opens its own session for the delegations
  and closes it when the run ends.
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
  const VALUE_FLAGS = new Set(['--concurrency', '--out', '--retries', '--only', '--max-cells', '--repo', '--dataset'])
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
/**
 * The reply of a STARTED run: two ids, where the log is, and the one way to
 * stop it. Deliberately short — the run has produced nothing yet, and a reply
 * that padded this with a plan summary would read like a result.
 * @param handle - what `runStart` answered with.
 * @returns the success text.
 */
function renderStarted(handle: {
  jobId: string
  runId: string
  parentSessionId: string
  ownParentSession?: boolean
}): string {
  return [
    `eval run started — job ${handle.jobId} · run ${handle.runId}`,
    handle.ownParentSession === true
      ? `parent session: ${handle.parentSessionId} (opened for this run; it closes when the run ends)`
      : `parent session: ${handle.parentSessionId} (this session — the run outlives this turn either way)`,
    `log: job_output ${handle.jobId} · status: job_list · stop: job_kill ${handle.jobId}`,
    'the run keeps going if you close this tab; job_kill is the only way to stop it',
  ].join('\n')
}

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

/**
 * Handle `/eval conditions <list|diff|provision>`.
 *
 * provision lives HERE rather than on the CLI because it needs the harness
 * family: the scoped home, its credential grade and its effective settings are
 * all local-agent's, and the CLI has no host to ask. Same reason `/eval run`
 * is a slash command (decision 1) — the acts that touch a real instance start
 * from a live session.
 */
async function handleConditions(service: EvalService, args: SlashArgs, invocation: CommandInvocation): Promise<CommandResult> {
  const [sub, ...rest] = args.positionals
  const session = { id: String(invocation.agent.session.id) }
  const repo = flagOf(args, '--repo')
  const dataset = flagOf(args, '--dataset')
  const unknown = [...args.switches]
  if (unknown.length > 0) return { kind: 'error', text: `unknown option(s): ${unknown.join(' ')}\n\n${USAGE}` }

  if (sub === 'list') {
    if (rest.length > 0) return { kind: 'error', text: `conditions list takes no positional arguments\n\n${USAGE}` }
    try {
      const report = await service.conditions({
        session,
        ...(repo !== undefined ? { repo } : {}),
        ...(dataset !== undefined ? { dataset } : {}),
      })
      return { kind: 'success', text: renderConditionList(report) }
    } catch (error) {
      return { kind: 'error', text: `eval conditions list refused: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  if (sub === 'diff') {
    const [a, b, ...extra] = rest
    if (a === undefined || b === undefined || extra.length > 0) {
      return { kind: 'error', text: `conditions diff wants exactly two conditions (id or path)\n\n${USAGE}` }
    }
    try {
      const diff = await service.conditionDiff({
        a,
        b,
        session,
        ...(repo !== undefined ? { repo } : {}),
        ...(dataset !== undefined ? { dataset } : {}),
      })
      return { kind: 'success', text: renderConditionDiff(diff) }
    } catch (error) {
      return { kind: 'error', text: `eval conditions diff refused: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  if (sub === 'provision') {
    const [target, ...extra] = rest
    if (target === undefined || extra.length > 0) {
      return { kind: 'error', text: `conditions provision wants exactly one condition file\n\n${USAGE}` }
    }
    if (repo === undefined) {
      return {
        kind: 'error',
        text: 'conditions provision wants --repo <working copy>: it writes the lock into that copy and nowhere else'
          + ' (the shared checkout stays read-only — point it at your own worktree)',
      }
    }
    let report: Awaited<ReturnType<EvalService['provision']>>
    try {
      report = await service.provision(target, { repo })
    } catch (error) {
      const diagnostics = error instanceof EvalProvisionRefused ? error.diagnostics.map(d => `  [${d.code}] ${d.message}`) : []
      const text = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: diagnostics.length === 0 ? `eval provision refused: ${text}` : `eval provision refused: ${text}\n${diagnostics.join('\n')}` }
    }
    const body = renderProvision(report)
    return report.written ? { kind: 'success', text: body } : { kind: 'error', text: body }
  }

  return {
    kind: 'error',
    text: sub === undefined
      ? `conditions wants a verb (list, diff, provision)\n\n${USAGE}`
      : `unknown conditions verb ${JSON.stringify(sub)} (want list, diff, provision)\n\n${USAGE}`,
  }
}

/** One line per condition: hash, lock state, and what provision recorded. */
function renderConditionList(report: { repo: string; datasets: string[]; conditions: Array<{
  id: string
  dataset: string
  harness: { name: string | null }
  model: { declared: string | null }
  sha: string | null
  status: string
  lock: { present: boolean; matches: boolean; homeSha: string | null; provisioned: { at: number; cliVersion: string | null } | null }
}> }): string {
  const body: string[] = [`conditions in ${report.repo} (${report.datasets.join(', ') || 'no dataset set declares any'}):`]
  for (const condition of report.conditions) {
    const lock = !condition.lock.present
      ? 'no lock'
      : `${condition.lock.matches ? 'lock ok' : 'LOCK STALE'}${condition.lock.homeSha === null ? ', home not provisioned' : ''}`
    const provisioned = condition.lock.provisioned === null
      ? 'no provisioned record'
      : `provisioned ${new Date(condition.lock.provisioned.at).toISOString()}${condition.lock.provisioned.cliVersion === null ? '' : ` · cli ${condition.lock.provisioned.cliVersion}`}`
    body.push(`  ${condition.id} (${condition.dataset}) — ${condition.status} · ${condition.harness.name ?? '—'}`
      + ` · model ${condition.model.declared ?? '—'} · sha ${condition.sha === null ? '—' : `${condition.sha.slice(0, 12)}…`}`
      + ` · ${lock} · ${provisioned}`)
  }
  if (report.conditions.length === 0) body.push('  (none)')
  return body.join('\n')
}

/** What differs, and what each side says. No recommendation — that is the point. */
function renderConditionDiff(diff: {
  a: { id: string; sha: string | null }
  b: { id: string; sha: string | null }
  identical: boolean
  notesOnly: boolean
  differences: Array<{ path: string; a?: unknown; b?: unknown }>
}): string {
  const body: string[] = [
    `${diff.a.id} (${diff.a.sha === null ? 'invalid' : `${diff.a.sha.slice(0, 12)}…`})`
    + ` vs ${diff.b.id} (${diff.b.sha === null ? 'invalid' : `${diff.b.sha.slice(0, 12)}…`})`,
  ]
  if (diff.differences.length === 0) {
    body.push('identical, field for field.')
    return body.join('\n')
  }
  const show = (value: unknown): string => (value === undefined ? '(absent)' : JSON.stringify(value))
  for (const difference of diff.differences) {
    body.push(`  ${difference.path}: ${show(difference.a)}  |  ${show(difference.b)}`)
  }
  const substantive = diff.differences.filter(difference => difference.path !== 'notes')
  body.push(diff.identical
    ? `same condition hash${diff.notesOnly ? ' — only notes differ, and notes are excluded from the hash' : ''}`
    : `${substantive.length} field(s) differ: ${substantive.map(difference => difference.path).join(', ')}`)
  return body.join('\n')
}

/** The provision reply: the five steps, whether the lock landed, and why not. */
function renderProvision(report: Awaited<ReturnType<EvalService['provision']>>): string {
  const body: string[] = [
    `provision ${report.condition} — ${report.harness}${report.scope === null ? ' (default scope)' : `@${report.scope}`}`,
    `  scoped home: ${report.homeDir}`,
    `  credential: ${report.credentialState}`,
  ]
  for (const row of report.checks) {
    const mark = row.status === 'match' ? '✓' : row.status === 'mismatch' ? (row.severity === 'error' ? '✗' : '!') : '·'
    body.push(`  ${mark} ${row.field}: declared ${JSON.stringify(row.declared)} / scope ${JSON.stringify(row.effective)} — ${row.detail}`)
  }
  if (report.home !== null) {
    body.push(`  home.sha: ${report.home.sha} (${report.home.files} config file(s) hashed, ${report.home.denied} skipped)`)
  }
  for (const warning of report.warnings) body.push(`  ! [${warning.code}] ${warning.message}`)
  for (const error of report.errors) body.push(`  ✗ [${error.code}] ${error.message}`)
  body.push(report.written
    ? `lock written → ${report.lockPath}`
    : 'NO LOCK WRITTEN — fix the above and provision again')
  return body.join('\n')
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
  if (sub === 'conditions') return await handleConditions(service, args, invocation)
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
  const runOptions = {
    parentSessionId,
    ...(concurrency !== undefined ? { concurrency } : {}),
    dryRun: args.switches.has('--dry-run'),
    finalize: args.switches.has('--finalize'),
    ...(flagOf(args, '--out') !== undefined ? { exportsDir: flagOf(args, '--out') as string } : {}),
    ...(retries !== undefined ? { retryInfrastructure: retries } : {}),
    ...(only.length > 0 ? { only } : {}),
    ...(maxCells !== undefined ? { maxCells } : {}),
    ignoreReadiness: args.switches.has('--ignore-readiness'),
  }
  // A dry run is offline and finishes in the turn: making it a background job
  // would hand back an id for work that is already done. `--wait` is the
  // explicit ask for the old synchronous shape, and a composition without a
  // job registry falls back to it (saying so) rather than refusing the run.
  const wait = args.switches.has('--wait') || runOptions.dryRun
  if (!wait && service.runJobsAvailable()) {
    try {
      const handle = await service.runStart(planPath, {
        ...runOptions,
        ...(invocation.agent.session.header?.cwd === undefined ? {} : { cwd: invocation.agent.session.header.cwd }),
        label: `eval run ${planPath}`,
      })
      return { kind: 'success', text: renderStarted(handle) }
    } catch (error) {
      // Starting is a cheap, synchronous-ish act (validation happens inside
      // the run): what can fail here is the wiring — no job registry, no live
      // parent agent — and naming it beats a background job that never was.
      return { kind: 'error', text: `eval run could not start: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const lines: string[] = []
  if (!wait) {
    lines.push('this composition mounts no jobs service, so the run is waited on in this turn'
      + ' — the reply comes when it finishes, and closing this surface stops it')
  }
  try {
    const report = await service.run(planPath, {
      ...runOptions,
      log: (message) => { lines.push(message) },
    })
    return renderReport(lines, report)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    // The refusal path carries the evidence, not just the verdict. `lines`
    // already holds one `readiness <condition>: NOT READY — <reason>` per
    // probed condition, and an EvalRunRefused carries the diagnostics that
    // stopped it; dropping both here turns T23's whole point ("print the 401,
    // not 'a condition failed'") back into "a condition failed" for anyone
    // driving through /eval run. The refusal message stays the first line, so
    // a reader who only sees a truncated summary still sees the verdict.
    const diagnostics = error instanceof EvalRunRefused
      ? error.diagnostics.map(d => `  [${d.code}] ${d.message}`)
      : []
    const evidence = [...lines.map(line => `  ${line}`), ...diagnostics]
    return {
      kind: 'error',
      text: evidence.length === 0 ? `eval refused: ${text}` : `eval refused: ${text}\n${evidence.join('\n')}`,
    }
  }
}

/** Register the `/eval` command on the host's command registry. */
export function registerEvalSlash(ctx: Context, service: EvalService): void {
  ctx.commands.register({
    name: 'eval',
    description: 'Evaluation runs: /eval run <plan.json> starts a run from this session (dry-run validates and prints the order without executing); /eval finalize <runId> walks an already-archived run through the release gate; /eval conditions list|diff|provision reads the condition registry and writes the one lock that anchors it.',
    input: { hint: 'run <plan.json> [--concurrency N] [--dry-run] [--finalize] [--out DIR] [--retries N] [--only ids] [--max-cells N] [--ignore-readiness] | finalize <runId> | conditions list|diff|provision' },
    handler: (invocation: CommandInvocation) => handleEvalCommand(service, invocation),
  })
}
