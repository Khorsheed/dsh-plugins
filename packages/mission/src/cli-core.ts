/**
 * The `dsh-mission` CLI implementation: same store, same semantics as the
 * service face and the model tools — usable from scripts and while the host
 * is down. Pure and side-effect-free so the slash face and tests can import
 * it; `cli.ts` is the thin bin entry on top (the entry guard must live in the
 * entry module itself — tsdown chunks any module another entry imports, which
 * would strand a guard here in a shared chunk and kill the bin silently).
 *
 * Exit codes: 0 ok / releasable; 1 failure / NOT releasable / lint errors;
 * 2 usage error.
 */
import { readFileSync } from 'node:fs'
import { resolveDataDir } from './defaults.ts'
import { MissionService } from './service.ts'
import type { MissionView, RunRecord } from './types.ts'

/** stdout/stderr sink (injected so tests capture output). */
export interface CliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const USAGE = `usage: dsh-mission <command> [args] [--data-dir DIR]
commands:
  run create --template FILE [--id ID] [--meta JSON]
  run lint --template FILE                      lint a template (errors refuse; exit 1 on errors)
  run list
  run status RUN_ID                             five-bucket projection table
  create [--run ID] [--id ID] [--title T] [--label k=v]... [--depends-on a,b] [--scheduled-at MS]
  list [--run ID] [--bucket B] [--label k=v]...
  get MISSION_ID [--run ID]
  transition MISSION_ID TO [--note N] [--run ID]
  submit MISSION_ID [--file SRC[:DEST]]... [--json JSON | --json-file F] [--checkpoint NAME] [--run ID]
  annotate MISSION_ID --ns NS --payload JSON [--run ID]
  attest MISSION_ID --key K [--note N] [--run ID]
  retry MISSION_ID [--run ID]
  is-releasable MISSION_ID [--run ID]           exit 0 = releasable, 1 = not
flags:
  --data-dir DIR   data root (default: $DSH_HOME/state/mission, else <cwd>/.dsh-mission)
`

/** Parsed invocation. */
interface Parsed {
  command: string[]
  dataDir: string
  flags: Map<string, string[]>
  positionals: string[]
}

function parse(argv: readonly string[]): Parsed {
  const flags = new Map<string, string[]>()
  const positionals: string[] = []
  let dataDir = ''
  const command: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '--help' || arg === '-h') throw new Error(USAGE)
    if (arg.startsWith('--')) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value\n\n${USAGE}`)
      if (arg === '--data-dir') {
        dataDir = value
      } else {
        const list = flags.get(arg) ?? []
        list.push(value)
        flags.set(arg, list)
      }
      i++
      continue
    }
    // The first one or two positionals form the command path (e.g. `run lint`).
    if (command.length === 0 && (arg === 'run')) command.push(arg)
    else if (command.length === 1 && command[0] === 'run' && positionals.length === 0
      && ['create', 'lint', 'list', 'status'].includes(arg)) command.push(arg)
    else positionals.push(arg)
  }
  if (command.length === 0) {
    const first = positionals.shift()
    if (first === undefined) throw new Error(USAGE)
    command.push(first)
  }
  return { command, dataDir, flags, positionals }
}

function flag(parsed: Parsed, name: string): string | undefined {
  const values = parsed.flags.get(name)
  return values === undefined ? undefined : values[values.length - 1]
}

function flagAll(parsed: Parsed, name: string): string[] {
  return parsed.flags.get(name) ?? []
}

function requireFlag(parsed: Parsed, name: string): string {
  const value = flag(parsed, name)
  if (value === undefined) throw new Error(`${name} is required\n\n${USAGE}`)
  return value
}

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`invalid JSON for ${what}: ${String(error)}`)
  }
}

function parseLabels(parsed: Parsed): Record<string, string> | undefined {
  const pairs = flagAll(parsed, '--label')
  if (pairs.length === 0) return undefined
  const labels: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0) throw new Error(`--label expects k=v, got ${JSON.stringify(pair)}`)
    labels[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return labels
}

/** Render one mission row for tables (shared by the CLI and the slash face). */
export function rowLine(view: MissionView): string {
  const labels = Object.entries(view.labels).map(([k, v]) => `${k}=${v}`).join(',')
  const plan: string[] = []
  if (view.dependsOn !== undefined && view.dependsOn.length > 0) {
    plan.push(view.blockedOn.length > 0 ? `waiting: ${view.blockedOn.join(', ')}` : `after: ${view.dependsOn.join(', ')}`)
  }
  if (view.scheduledAt !== undefined) plan.push(`at: ${new Date(view.scheduledAt).toISOString()}`)
  return [
    view.id.padEnd(16),
    view.bucket.padEnd(10),
    view.state.padEnd(12),
    (labels || '-').padEnd(18),
    plan.join('  ') || '-',
  ].join(' ').trimEnd()
}

/**
 * Render the five-bucket status table of one run as text — shared by the CLI
 * (`run status`) and the slash face (`/mission run status`).
 * @param service - the mission service over the data root.
 * @param runId - the run to project.
 * @returns the table text (no trailing newline).
 */
export function renderStatus(service: MissionService, runId: string): string {
  const status = service.runStatus(runId)
  const run = status.run
  const lines = [
    `run ${run.id}${run.templateName !== undefined ? ` (template ${run.templateName})` : ''} state=${run.state} missions=${run.missions}`,
    `${'id'.padEnd(16)}${'bucket'.padEnd(10)}${'state'.padEnd(12)}${'labels'.padEnd(18)}plan`,
    ...status.rows.map(row => rowLine(row)),
    `buckets: ${Object.entries(status.buckets).map(([b, ids]) => `${b}=${ids.length}`).join('  ')}`,
  ]
  if (status.unreleased.length > 0) {
    lines.push(`⚠ holding resource but not releasable: ${status.unreleased.join(', ')}`)
  }
  return lines.join('\n')
}

function printStatus(io: CliIo, service: MissionService, runId: string): void {
  io.stdout(`${renderStatus(service, runId)}\n`)
}

function missionDetail(run: RunRecord, missionId: string): unknown {
  const mission = run.missions.find(m => m.id === missionId)
  return { runId: run.id, mission }
}

/**
 * Run one CLI invocation against the store.
 * @param argv - arguments (without node/script entries).
 * @param io - output sinks.
 * @returns the process exit code.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parse(argv)
  } catch (error) {
    io.stderr(`${String(error)}\n`)
    return 2
  }
  const service = new MissionService(resolveDataDir(parsed.dataDir))
  const runId = flag(parsed, '--run')
  try {
    switch (parsed.command.join(' ')) {
      case 'run create': {
        const template = requireFlag(parsed, '--template')
        const metaRaw = flag(parsed, '--meta')
        const explicitId = flag(parsed, '--id')
        const result = await service.runCreate({
          templatePath: template,
          ...(explicitId !== undefined ? { runId: explicitId } : {}),
          ...(metaRaw !== undefined ? { meta: parseJson(metaRaw, '--meta') as Record<string, unknown> } : {}),
          by: 'cli',
        })
        for (const warning of result.lint.warnings) io.stderr(`lint warning: ${warning}\n`)
        io.stdout(`run ${result.run.id}: ${result.run.missions.length} mission(s)${result.existed ? ' (already existed)' : ''}\n`)
        return 0
      }
      case 'run lint': {
        const template = requireFlag(parsed, '--template')
        const result = service.lintTemplateFile(template)
        for (const warning of result.warnings) io.stdout(`warning: ${warning}\n`)
        for (const error of result.errors) io.stderr(`error: ${error}\n`)
        if (result.errors.length > 0) {
          io.stderr(`lint FAILED (${result.errors.length} error(s)) — a run create with this template is refused\n`)
          return 1
        }
        io.stdout(`lint ok${result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ''}\n`)
        return 0
      }
      case 'run list': {
        io.stdout(`${JSON.stringify(service.runList(), null, 2)}\n`)
        return 0
      }
      case 'run status': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`run status requires a RUN_ID\n\n${USAGE}`)
          return 2
        }
        printStatus(io, service, id)
        return 0
      }
      case 'create': {
        const labels = parseLabels(parsed)
        const dependsRaw = flag(parsed, '--depends-on')
        const scheduledRaw = flag(parsed, '--scheduled-at')
        const scheduledAt = scheduledRaw === undefined ? undefined : Number(scheduledRaw)
        if (scheduledAt !== undefined && !Number.isFinite(scheduledAt)) {
          io.stderr('--scheduled-at must be epoch milliseconds\n')
          return 2
        }
        const explicitId = flag(parsed, '--id')
        const title = flag(parsed, '--title')
        const { run, mission, existed } = await service.create({
          ...(runId !== undefined ? { runId } : {}),
          ...(explicitId !== undefined ? { id: explicitId } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(labels !== undefined ? { labels } : {}),
          ...(dependsRaw !== undefined ? { dependsOn: dependsRaw.split(',').filter(d => d !== '') } : {}),
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
          by: 'cli',
        })
        const state = mission.attempts[mission.currentAttempt - 1]?.state
        io.stdout(`mission ${mission.id} in run ${run.id} (state ${state ?? '?'})${existed ? ' — already existed' : ''}\n`)
        return 0
      }
      case 'list': {
        const labels = parseLabels(parsed)
        const bucket = flag(parsed, '--bucket')
        const views = service.list({
          ...(runId !== undefined ? { runId } : {}),
          ...(bucket !== undefined ? { bucket } : {}),
          ...(labels !== undefined ? { labels } : {}),
        })
        for (const view of views) io.stdout(`${rowLine(view)}\n`)
        io.stdout(`(${views.length} mission(s))\n`)
        return 0
      }
      case 'get': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`get requires a MISSION_ID\n\n${USAGE}`)
          return 2
        }
        const { run, mission } = service.get(id, runId)
        io.stdout(`${JSON.stringify(missionDetail(run, mission.id), null, 2)}\n`)
        return 0
      }
      case 'transition': {
        const [id, to] = parsed.positionals
        if (id === undefined || to === undefined) {
          io.stderr(`transition requires MISSION_ID and TO\n\n${USAGE}`)
          return 2
        }
        const note = flag(parsed, '--note')
        const result = await service.transition(id, to, {
          ...(note !== undefined ? { note } : {}),
          ...(runId !== undefined ? { runId } : {}),
          by: 'cli',
        })
        io.stdout(result.changed ? `${result.from} → ${result.to}\n` : `already in ${result.to} (no-op)\n`)
        return 0
      }
      case 'submit': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`submit requires a MISSION_ID\n\n${USAGE}`)
          return 2
        }
        const files = flagAll(parsed, '--file').map((spec) => {
          const colon = spec.indexOf(':')
          const src = colon < 0 ? spec : spec.slice(0, colon)
          const dest = colon < 0 ? spec.split('/').pop() as string : spec.slice(colon + 1)
          return { path: dest, content: readFileSync(src).toString('base64'), encoding: 'base64' as const }
        })
        const jsonRaw = flag(parsed, '--json')
        const jsonFile = flag(parsed, '--json-file')
        if (jsonRaw !== undefined && jsonFile !== undefined) {
          io.stderr('--json and --json-file are mutually exclusive\n')
          return 2
        }
        const json = jsonRaw !== undefined
          ? parseJson(jsonRaw, '--json')
          : jsonFile !== undefined ? parseJson(readFileSync(jsonFile, 'utf8'), jsonFile) : undefined
        const checkpoint = flag(parsed, '--checkpoint')
        const result = await service.submit(id, {
          ...(files.length > 0 ? { files } : {}),
          ...(json !== undefined ? { json } : {}),
          ...(checkpoint !== undefined ? { checkpoint } : {}),
          ...(runId !== undefined ? { runId } : {}),
          by: 'cli',
        })
        io.stdout(`submitted: ${result.written.length} file(s) written, ${result.artifacts} artifact(s) indexed, checkpoint ${result.checkpoint}\n`)
        return 0
      }
      case 'annotate': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`annotate requires a MISSION_ID\n\n${USAGE}`)
          return 2
        }
        const ns = requireFlag(parsed, '--ns')
        const payload = parseJson(requireFlag(parsed, '--payload'), '--payload')
        const result = await service.annotate(id, ns, payload, { ...(runId !== undefined ? { runId } : {}), by: 'cli' })
        io.stdout(result.added ? 'annotation appended\n' : 'identical annotation already present (no-op)\n')
        return 0
      }
      case 'attest': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`attest requires a MISSION_ID\n\n${USAGE}`)
          return 2
        }
        const key = requireFlag(parsed, '--key')
        const note = flag(parsed, '--note')
        const result = await service.attest(id, key, {
          ...(note !== undefined ? { note } : {}),
          ...(runId !== undefined ? { runId } : {}),
          by: 'cli',
        })
        io.stdout(result.added ? 'attested\n' : 'already attested (no-op)\n')
        return 0
      }
      case 'retry': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`retry requires a MISSION_ID\n\n${USAGE}`)
          return 2
        }
        const result = await service.retry(id, { ...(runId !== undefined ? { runId } : {}), by: 'cli' })
        io.stdout(`attempt ${result.attempt} opened\n`)
        return 0
      }
      case 'is-releasable': {
        const id = parsed.positionals[0]
        if (id === undefined) {
          io.stderr(`is-releasable requires a MISSION_ID\n\n${USAGE}`)
          return 2
        }
        const releasable = service.isReleasable(id, runId)
        io.stdout(releasable ? 'releasable\n' : 'not releasable\n')
        return releasable ? 0 : 1
      }
      default:
        io.stderr(`unknown command ${parsed.command.join(' ')}\n\n${USAGE}`)
        return 2
    }
  } catch (error) {
    io.stderr(`${String(error)}\n`)
    return 1
  }
}
