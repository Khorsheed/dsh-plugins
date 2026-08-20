/**
 * The slash-command face of the mission service — the human interface, a thin
 * adapter over {@link MissionService} exactly like the model tools and the
 * CLI. One `/mission` command with subcommands (local-agent pattern): the
 * handler parses `invocation.rawInput` itself and takes the session context
 * from `invocation.agent` (the queue defaults to THIS session's runs; `run
 * create` records it as `originSession`; writes are recorded as
 * `slash:<sessionId>` in history). The status table rendering is shared with
 * the CLI ({@link renderStatus} / {@link rowLine}) — no duplicated logic.
 *
 * Export lives here with the same leak gate semantics as the CLI, adapted to
 * what a slash command honestly IS: a one-shot text invocation with NO
 * interactive confirmation channel. Guarded (modelFacing: false) layers need
 * a per-layer human confirmation, so `/mission export` REFUSES them and
 * points at the TTY CLI — a slash handler cannot ask a follow-up question,
 * and pretending a flag is a confirmation would be exactly the bypass the
 * gate exists against. Unguarded exports run straight through.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { renderStatus } from './cli-core.ts'
import { renderNsReport } from './export.ts'
import type { MissionService, RunSummary } from './service.ts'
import type { Bucket, MissionView } from './types.ts'

const USAGE = `usage:
  /mission queue [--run ID] [--bucket ready|scheduled|blocked|active|done] [--all]
  /mission run list
  /mission run status RUN_ID
  /mission run create --template FILE [--id ID] [--meta JSON]
  /mission retry MISSION_ID [--run ID]
  /mission export RUN_ID --out DIR [--layer NAME]... [--guarded NAME]... [--snapshot-dir DIR]
         [--snapshot-repo R --snapshot-commit C [--snapshot-dataset ID]]
         (guarded layers are refused here — the confirmation gate needs a TTY: dsh-mission export)`

const BUCKETS: readonly Bucket[] = ['ready', 'scheduled', 'blocked', 'active', 'done']

/** Parsed slash input: subcommand tokens, `--flag value` pairs, bare `--switches`. */
interface SlashArgs {
  positionals: string[]
  flags: Map<string, string[]>
  switches: Set<string>
}

/** Split raw input into tokens, honoring single/double quotes (for JSON values). */
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
  const VALUE_FLAGS = new Set(['--run', '--bucket', '--template', '--id', '--meta', '--out', '--snapshot-dir', '--snapshot-repo', '--snapshot-commit', '--snapshot-dataset', '--layer', '--guarded'])
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

function flagAllOf(args: SlashArgs, name: string): string[] {
  return args.flags.get(name) ?? []
}

/** The calling session id — origin filter default and write attribution. */
function sessionIdOf(invocation: CommandInvocation): string {
  return String(invocation.agent.session.id)
}

/** Compact human duration for the queue's duration column (`47m`, `2h`, `3d`). */
function humanDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** The plan/blocked cell: unmet dependencies first, then the one-shot schedule. */
function planCell(view: MissionView): string {
  const parts: string[] = []
  if (view.dependsOn !== undefined && view.dependsOn.length > 0) {
    parts.push(view.blockedOn.length > 0 ? `waiting: ${view.blockedOn.join(', ')}` : `after: ${view.dependsOn.join(', ')}`)
  }
  if (view.scheduledAt !== undefined) parts.push(`at: ${new Date(view.scheduledAt).toISOString()}`)
  return parts.join('  ') || '—'
}

/** Duration in the current state; only active/done rows carry one. */
function durationCell(view: MissionView, now: number): string {
  if (view.bucket !== 'active' && view.bucket !== 'done') return '—'
  return humanDuration(now - view.enteredCurrentAt)
}

/** Render one run's queue section: header row + one line per mission + leak warning. */
function renderQueueSection(run: RunSummary, views: MissionView[], now: number): string {
  const lines = [
    `run ${run.id}${run.templateName !== undefined ? ` (template ${run.templateName})` : ''} — ${views.length} mission(s)`,
    `${'#'.padEnd(10)}${'title'.padEnd(20)}${'bucket'.padEnd(11)}${'state'.padEnd(12)}${'plan/blocked'.padEnd(24)}duration`,
  ]
  for (const view of views) {
    lines.push([
      view.id.padEnd(10),
      (view.title ?? '—').padEnd(20),
      view.bucket.padEnd(11),
      view.state.padEnd(12),
      planCell(view).padEnd(24),
      durationCell(view, now),
    ].join('').trimEnd())
  }
  const held = views.filter(v => v.resourceHeld).map(v => v.id)
  if (held.length > 0) lines.push(`⚠ holding resource but not releasable: ${held.join(', ')}`)
  return lines.join('\n')
}

/** `/mission queue [--run ID] [--bucket B] [--all]` — the five-bucket queue table. */
function queue(service: MissionService, args: SlashArgs, invocation: CommandInvocation): CommandResult {
  if (args.positionals.length > 0) return { kind: 'error', text: USAGE }
  const bucket = flagOf(args, '--bucket')
  if (bucket !== undefined && !BUCKETS.includes(bucket as Bucket)) {
    return { kind: 'error', text: `unknown bucket ${JSON.stringify(bucket)} (one of ${BUCKETS.join(', ')})\n\n${USAGE}` }
  }
  const runId = flagOf(args, '--run')
  let runs: RunSummary[]
  if (runId !== undefined) {
    runs = service.runList().filter(r => r.id === runId)
    if (runs.length === 0) return { kind: 'error', text: `mission: run ${runId} does not exist` }
  } else if (args.switches.has('--all')) {
    runs = service.runList()
  } else {
    const sessionId = sessionIdOf(invocation)
    runs = service.runList().filter(r => r.originSession === sessionId)
  }
  const now = Date.now()
  const sections: string[] = []
  for (const run of runs) {
    const views = service.list({ runId: run.id, ...(bucket !== undefined ? { bucket } : {}) })
    if (views.length > 0) sections.push(renderQueueSection(run, views, now))
  }
  if (sections.length === 0) {
    const scope = runId !== undefined ? `run ${runId}`
      : args.switches.has('--all') ? 'any run'
        : "this session's runs"
    return {
      kind: 'success',
      text: `no missions in ${scope}${bucket !== undefined ? ` (bucket ${bucket})` : ''} — queue one with the mission_create tool or /mission run create`,
    }
  }
  return { kind: 'success', text: sections.join('\n\n') }
}

/** `/mission run list|status|create …` */
async function run(service: MissionService, args: SlashArgs, invocation: CommandInvocation): Promise<CommandResult> {
  const [sub, ...rest] = args.positionals
  switch (sub) {
    case 'list': {
      if (rest.length > 0) return { kind: 'error', text: USAGE }
      const runs = service.runList()
      if (runs.length === 0) return { kind: 'success', text: 'no runs yet — /mission run create --template FILE' }
      return {
        kind: 'success',
        text: runs.map(r => [
          r.id,
          r.templateName !== undefined ? `(template ${r.templateName})` : undefined,
          `state=${r.state}`,
          `missions=${r.missions}`,
          r.originSession !== undefined ? `origin=${r.originSession}` : undefined,
        ].filter(part => part !== undefined).join(' ')).join('\n'),
      }
    }
    case 'status': {
      const id = rest[0]
      if (id === undefined || rest.length > 1) return { kind: 'error', text: `run status requires a RUN_ID\n\n${USAGE}` }
      return { kind: 'success', text: renderStatus(service, id) }
    }
    case 'create': {
      if (rest.length > 0) return { kind: 'error', text: USAGE }
      const template = flagOf(args, '--template')
      if (template === undefined) return { kind: 'error', text: `run create requires --template FILE\n\n${USAGE}` }
      const metaRaw = flagOf(args, '--meta')
      let meta: Record<string, unknown> | undefined
      if (metaRaw !== undefined) {
        try {
          meta = JSON.parse(metaRaw) as Record<string, unknown>
        } catch (error) {
          return { kind: 'error', text: `invalid JSON for --meta: ${String(error)}` }
        }
      }
      const explicitId = flagOf(args, '--id')
      const result = await service.runCreate({
        templatePath: template,
        ...(explicitId !== undefined ? { runId: explicitId } : {}),
        ...(meta !== undefined ? { meta } : {}),
        originSession: sessionIdOf(invocation),
        by: `slash:${sessionIdOf(invocation)}`,
      })
      const warnings = result.lint.warnings.map(w => `lint warning: ${w}`)
      return {
        kind: 'success',
        text: [`run ${result.run.id}: ${result.run.missions.length} mission(s)${result.existed ? ' (already existed)' : ''}`, ...warnings].join('\n'),
      }
    }
    default:
      return { kind: 'error', text: USAGE }
  }
}

/** Slash-face extras: the optional datasets probe for layer-visibility metadata. */
export interface SlashExtras {
  /**
   * Resolve a snapshot's `modelFacing: false` layers through the datasets
   * plugin when it is mounted (ctx.get probe, duck-typed; null = unavailable —
   * the caller then trusts only explicit --guarded declarations).
   */
  resolveNonModelFacing?: (snapshot: { repo: string; commit?: string; dataset: string }) => Promise<string[] | null>
}

/** `/mission export RUN_ID --out DIR …` — unguarded only; guarded points at the TTY CLI. */
async function exportCmd(service: MissionService, args: SlashArgs, extras: SlashExtras | undefined): Promise<CommandResult> {
  const [id, ...rest] = args.positionals
  const out = flagOf(args, '--out')
  if (id === undefined || rest.length > 0 || out === undefined) {
    return { kind: 'error', text: `export requires RUN_ID and --out DIR\n\n${USAGE}` }
  }
  const layerNames = flagAllOf(args, '--layer')
  const snapshotDir = flagOf(args, '--snapshot-dir')
  const snapshotRepo = flagOf(args, '--snapshot-repo')
  const snapshotCommit = flagOf(args, '--snapshot-commit')
  const snapshotDataset = flagOf(args, '--snapshot-dataset')
  if ((snapshotRepo === undefined) !== (snapshotCommit === undefined)) {
    return { kind: 'error', text: `--snapshot-repo and --snapshot-commit go together\n\n${USAGE}` }
  }
  let guardedNames = flagAllOf(args, '--guarded')
  // Layer visibility from the datasets plugin when mounted and a dataset is named.
  if (snapshotRepo !== undefined && snapshotDataset !== undefined && extras?.resolveNonModelFacing !== undefined) {
    const probed = await extras.resolveNonModelFacing({
      repo: snapshotRepo,
      ...(snapshotCommit !== undefined ? { commit: snapshotCommit } : {}),
      dataset: snapshotDataset,
    })
    if (probed !== null) {
      guardedNames = [...new Set([...guardedNames, ...probed.filter(layer => layerNames.includes(layer))])]
    }
  }
  for (const g of guardedNames) {
    if (!layerNames.includes(g)) return { kind: 'error', text: `--guarded ${JSON.stringify(g)} is not an included --layer\n\n${USAGE}` }
  }
  const request = {
    runId: id,
    outDir: out,
    layers: layerNames.map(name => ({ name, guarded: guardedNames.includes(name) })),
    ...(snapshotDir !== undefined ? { snapshotDir } : {}),
    ...(snapshotRepo !== undefined && snapshotCommit !== undefined
      ? { snapshot: { repo: snapshotRepo, commit: snapshotCommit, ...(snapshotDataset !== undefined ? { dataset: snapshotDataset } : {}) } }
      : {}),
  }
  const plan = service.planExport(request)
  if (plan.guardedLayers.length > 0) {
    // A slash command cannot ask a follow-up question — no confirmation
    // channel exists here, so guarded layers are REFUSED and routed to the
    // TTY CLI. This is the gate working, not a limitation to paper over.
    return {
      kind: 'error',
      text: `export refused: the bundle would include guarded (modelFacing: false) layer(s): ${plan.guardedLayers.join(', ')}. `
        + 'A slash command has no interactive confirmation channel — run `dsh-mission export` in a terminal and confirm each layer.',
    }
  }
  const result = service.exportRun(request)
  const lines = [`exported ${result.bundleDir} (${result.files} files)`]
  if (result.nsReport !== null && plan.expectedNs !== null) {
    lines.push(...renderNsReport(plan.expectedNs, result.nsReport))
  }
  return { kind: 'success', text: lines.join('\n') }
}

/**
 * Dispatch one `/mission` invocation. Usage problems answer with the usage
 * text; service failures (unknown run/mission, guard or lint refusal) surface
 * as error results — the slash face never throws across the registry.
 */
export async function handleMissionCommand(
  service: MissionService,
  invocation: CommandInvocation,
  extras?: SlashExtras,
): Promise<CommandResult> {
  let tokens: string[]
  try {
    tokens = tokenize(invocation.rawInput)
  } catch {
    return { kind: 'error', text: USAGE }
  }
  const [sub, ...restTokens] = tokens
  let args: SlashArgs
  try {
    args = parseArgs(restTokens)
  } catch (error) {
    return { kind: 'error', text: `${String(error)}\n\n${USAGE}` }
  }
  try {
    switch (sub) {
      case undefined:
        return { kind: 'error', text: USAGE }
      case 'queue':
        return queue(service, args, invocation)
      case 'run':
        return await run(service, args, invocation)
      case 'export':
        return await exportCmd(service, args, extras)
      case 'retry': {
        const id = args.positionals[0]
        if (id === undefined || args.positionals.length > 1) {
          return { kind: 'error', text: `retry requires a MISSION_ID\n\n${USAGE}` }
        }
        const runId = flagOf(args, '--run')
        const result = await service.retry(id, {
          ...(runId !== undefined ? { runId } : {}),
          by: `slash:${sessionIdOf(invocation)}`,
        })
        return { kind: 'success', text: `attempt ${result.attempt} opened` }
      }
      default:
        return { kind: 'error', text: `unknown subcommand ${JSON.stringify(sub)}\n\n${USAGE}` }
    }
  } catch (error) {
    return { kind: 'error', text: String(error) }
  }
}

/** Register the `/mission` slash command on the plugin context. */
export function registerMissionSlash(ctx: Context, service: MissionService): void {
  // Optional integration: the datasets plugin's layer-visibility metadata for
  // the export leak gate. Probed per call with ctx.get — a composition without
  // datasets falls back to explicit --guarded declarations, nothing else changes.
  const resolveNonModelFacing: SlashExtras['resolveNonModelFacing'] = async (snapshot) => {
    const datasets = ctx.get('datasets') as {
      list?: (scope: { repo: string }, dataset?: string, commit?: string) => Promise<unknown>
    } | undefined
    if (typeof datasets?.list !== 'function') return null
    try {
      const result = await datasets.list(
        { repo: snapshot.repo },
        snapshot.dataset,
        ...(snapshot.commit !== undefined ? [snapshot.commit] : []),
      )
      if (typeof result !== 'object' || result === null) return null
      const summary = (result as { dataset?: { nonModelFacingLayers?: unknown } }).dataset
      const layers = summary?.nonModelFacingLayers
      if (!Array.isArray(layers)) return null
      return layers.filter((layer): layer is string => typeof layer === 'string')
    } catch {
      return null // no binding / unknown dataset / plugin shape drift — explicit declarations stand
    }
  }
  ctx.commands.register({
    name: 'mission',
    description: 'Mission queue and runs: five-bucket queue view, run list/status/create, retry, export '
      + '(guarded layers refuse here — the leak gate needs a TTY: dsh-mission export).',
    input: { hint: 'queue [--run ID] [--bucket B] [--all] | run list|status RUN_ID|create --template F | retry MISSION_ID | export RUN_ID --out DIR' },
    handler: invocation => handleMissionCommand(service, invocation, { resolveNonModelFacing }),
  })
}
