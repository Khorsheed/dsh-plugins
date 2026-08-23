/**
 * Implementation of the `dsh-lab` CLI: one adapter over the same
 * {@link LabService} kernel the in-host plugin uses, with a
 * `child_process`-backed {@link Exec} and a mission face that spawns the
 * `dsh-mission` bin — the sanctioned script path (its `is-releasable` exit
 * code 0/1 exists for teardown scripts).
 *
 * Data goes to stdout (JSON where the verb produces a value), diagnostics to
 * stderr. Exit codes: 0 ok, 1 failure/refused, 2 usage.
 */
import { spawn } from 'node:child_process'
import { DockerProvider } from './docker.ts'
import { LabService } from './service.ts'
import type { Exec, ExecResult, MissionFace, MissionSnapshot, MountSpec, UnitStatus } from './types.ts'

/** Injected output channels. */
export interface CliIo {
  /** Write to stdout (data). */
  stdout: (text: string) => void
  /** Write to stderr (diagnostics). */
  stderr: (text: string) => void
}

const USAGE = `dsh-lab <verb> [options]

  acquire --image IMG [--mission ID] [--run ID] [--mount SRC:DST[:ro]]... [--env K=V]... [--workdir DIR] [--command JSON]
  populate UNIT --source DIR [--target DIR] [--manifest FILE]
  collect UNIT --source DIR --target DIR [--kind K]
  checkpoint UNIT --name NAME
  verify UNIT [--source DIR] [--timeout-ms MS] -- CMD [ARGS...]
  archive UNIT --target DIR [--kind K]
  release UNIT [--force]
  status [UNIT] [--json]

Global: --max-concurrent N (acquire ceiling, default 4)
Exit codes: 0 ok, 1 failure/refused, 2 usage.

Mission integration (when the dsh-mission bin is on PATH): release gates on
\`dsh-mission is-releasable\` (exit 0/1, anything else fails closed), and
refs / artifacts / checkpoints / annotations register through the mission
bin's verbs (set-refs / add-artifact / add-checkpoint / annotate). Without
the bin, registration warns and skips, and release needs --force.
`

/** A parsed command line: repeated flags collect, booleans are known per verb. */
interface Parsed {
  positional: string[]
  flags: Map<string, string[]>
  bools: Set<string>
  /** Everything after `--` (the verify command). */
  rest?: string[]
}

const BOOLEAN_FLAGS = new Set(['force', 'help', 'json'])

/** Parse `--flag`, `--key value` / `--key=value`, positionals, and the `--` tail. */
function parseArgs(args: string[]): Parsed {
  const parsed: Parsed = { positional: [], flags: new Map(), bools: new Set() }
  let i = 0
  while (i < args.length) {
    const arg = args[i] as string
    if (arg === '--') {
      parsed.rest = args.slice(i + 1)
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
      if (eq !== -1) {
        appendFlag(parsed, key, arg.slice(eq + 1))
      } else if (BOOLEAN_FLAGS.has(key)) {
        parsed.bools.add(key)
      } else {
        i += 1
        if (i >= args.length) throw new UsageError(`missing value for --${key}`)
        appendFlag(parsed, key, args[i] as string)
      }
    } else {
      parsed.positional.push(arg)
    }
    i += 1
  }
  return parsed
}

function appendFlag(parsed: Parsed, key: string, value: string): void {
  const list = parsed.flags.get(key) ?? []
  list.push(value)
  parsed.flags.set(key, list)
}

class UsageError extends Error {}

/** The one value of a flag, or undefined. */
function one(parsed: Parsed, key: string): string | undefined {
  const list = parsed.flags.get(key)
  return list === undefined ? undefined : list[list.length - 1]
}

/** The one required value of a flag. */
function required(parsed: Parsed, key: string): string {
  const value = one(parsed, key)
  if (value === undefined) throw new UsageError(`missing required --${key}`)
  return value
}

/** Parse `SRC:DST[:ro]` into a mount spec. */
function parseMount(raw: string): MountSpec {
  const parts = raw.split(':')
  if (parts.length < 2) throw new UsageError(`bad --mount ${JSON.stringify(raw)} (want SRC:DST[:ro])`)
  const mount: MountSpec = { source: parts[0] as string, target: parts[1] as string }
  if (parts[2] === 'ro') mount.readonly = true
  return mount
}

/** `child_process`-backed {@link Exec} with output caps and a SIGTERM→SIGKILL timeout. */
function childProcessExec(): Exec {
  return (argv, options) => new Promise((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = options?.timeoutMs !== undefined
      ? setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000).unref()
      }, options.timeoutMs)
      : undefined
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 16 * 1024 * 1024) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 1024 * 1024) stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer)
      const result: ExecResult = { exitCode: code ?? -1, stdout, stderr }
      if (timedOut) result.timedOut = true
      resolve(result)
    })
  })
}

/**
 * The CLI's mission face over the `dsh-mission` bin. Every verb the mission
 * CLI exposes is wired: set-refs / add-artifact / add-checkpoint / annotate /
 * is-releasable. Exit-code contract (mission side): 0 ok, anything else is a
 * failure with readable stderr — thrown here so LabService's registration
 * discipline (warn and skip) applies uniformly.
 */
function cliMissionFace(exec: Exec): MissionFace {
  const checked = async (argv: string[], what: string): Promise<void> => {
    const result = await exec(argv)
    if (result.exitCode !== 0) {
      throw new Error(`dsh-mission ${what} failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
    }
  }
  return {
    async setRefs(missionId, refs, options) {
      const argv = ['dsh-mission', 'set-refs', missionId]
      if (refs.resource !== undefined) argv.push('--resource', refs.resource)
      if (refs.fingerprint !== undefined) argv.push('--fingerprint', refs.fingerprint)
      for (const session of refs.sessions ?? []) argv.push('--session', session)
      if (options?.runId !== undefined) argv.push('--run', options.runId)
      await checked(argv, 'set-refs')
    },
    async addArtifact(missionId, artifact, options) {
      const argv = ['dsh-mission', 'add-artifact', missionId, '--path', artifact.path, '--kind', artifact.kind]
      if (options?.runId !== undefined) argv.push('--run', options.runId)
      await checked(argv, 'add-artifact')
      return { added: true }
    },
    async addCheckpoint(missionId, checkpoint, options) {
      const argv = ['dsh-mission', 'add-checkpoint', missionId, '--name', checkpoint.name]
      if (checkpoint.ref !== undefined) argv.push('--ref', checkpoint.ref)
      for (const artifact of checkpoint.artifacts ?? []) argv.push('--artifact', artifact)
      if (options?.runId !== undefined) argv.push('--run', options.runId)
      await checked(argv, 'add-checkpoint')
      return { added: true }
    },
    async annotate(missionId, ns, payload, options) {
      const argv = ['dsh-mission', 'annotate', missionId, '--ns', ns, '--payload', JSON.stringify(payload)]
      if (options?.runId !== undefined) argv.push('--run', options.runId)
      await checked(argv, 'annotate')
      return { added: true }
    },
    async isReleasable(missionId, runId) {
      const argv = ['dsh-mission', 'is-releasable', missionId]
      if (runId !== undefined) argv.push('--run', runId)
      const result = await exec(argv)
      if (result.exitCode === 0) return true
      if (result.exitCode === 1) return false
      throw new Error(`dsh-mission is-releasable failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
    },
    async get(missionId, runId) {
      const argv = ['dsh-mission', 'get', missionId]
      if (runId !== undefined) argv.push('--run', runId)
      const result = await exec(argv)
      if (result.exitCode !== 0) throw new Error(`dsh-mission get failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
      return JSON.parse(result.stdout) as { mission: MissionSnapshot }
    },
  }
}

/** The dsh-mission bin is present iff it spawns at all (any exit code counts). */
async function probeMission(exec: Exec): Promise<boolean> {
  try {
    await exec(['dsh-mission', '--help'])
    return true
  } catch {
    // Spawn-level failure (ENOENT): no mission bin on PATH.
    return false
  }
}

/**
 * Run the CLI.
 * @param argv - arguments after the bin name.
 * @param io - output channels.
 * @returns the process exit code.
 */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined) {
    io.stdout(USAGE)
    return 2
  }
  if (command === 'help' || command === '--help') {
    io.stdout(USAGE)
    return 0
  }
  const exec = childProcessExec()
  const warn = (message: string): void => io.stderr(`${message}\n`)
  try {
    const parsed = parseArgs(rest)
    if (parsed.bools.has('help')) {
      io.stdout(USAGE)
      return 0
    }
    const mission = await probeMission(exec)
    const service = new LabService({
      providers: { docker: new DockerProvider(exec) },
      maxConcurrentUnits: Number(one(parsed, 'max-concurrent') ?? '4'),
      getMission: () => (mission ? cliMissionFace(exec) : undefined),
      warn,
    })
    switch (command) {
      case 'acquire': {
        const spec: Parameters<LabService['acquire']>[0] = {
          image: required(parsed, 'image'),
          mounts: (parsed.flags.get('mount') ?? []).map(parseMount),
        }
        const missionId = one(parsed, 'mission')
        if (missionId !== undefined) spec.missionId = missionId
        const runId = one(parsed, 'run')
        if (runId !== undefined) spec.runId = runId
        const workdir = one(parsed, 'workdir')
        if (workdir !== undefined) spec.workdir = workdir
        const cmd = one(parsed, 'command')
        if (cmd !== undefined) spec.command = JSON.parse(cmd) as string[]
        const env: Record<string, string> = {}
        for (const pair of parsed.flags.get('env') ?? []) {
          const eq = pair.indexOf('=')
          if (eq === -1) throw new UsageError(`bad --env ${JSON.stringify(pair)} (want K=V)`)
          env[pair.slice(0, eq)] = pair.slice(eq + 1)
        }
        if (Object.keys(env).length > 0) spec.env = env
        io.stdout(`${JSON.stringify(await service.acquire(spec), null, 2)}\n`)
        return 0
      }
      case 'populate': {
        const target = one(parsed, 'target')
        const manifestPath = one(parsed, 'manifest')
        const manifest = await service.populate(requiredPositional(parsed), {
          source: required(parsed, 'source'),
          ...(target !== undefined ? { target } : {}),
          ...(manifestPath !== undefined ? { manifestPath } : {}),
        })
        io.stdout(`${JSON.stringify({ sha: manifest.sha, count: manifest.count }, null, 2)}\n`)
        return 0
      }
      case 'collect': {
        const kind = one(parsed, 'kind')
        await service.collect(requiredPositional(parsed), {
          source: required(parsed, 'source'),
          target: required(parsed, 'target'),
          ...(kind !== undefined ? { kind } : {}),
        })
        return 0
      }
      case 'checkpoint': {
        const { ref } = await service.checkpoint(requiredPositional(parsed), { name: required(parsed, 'name') })
        io.stdout(`${ref}\n`)
        return 0
      }
      case 'verify': {
        const verifyCommand = parsed.rest ?? []
        if (verifyCommand.length === 0) throw new UsageError('verify wants the command after `--`')
        const source = one(parsed, 'source')
        const timeout = one(parsed, 'timeout-ms')
        const result = await service.verify(requiredPositional(parsed), {
          command: verifyCommand,
          ...(source !== undefined ? { source } : {}),
          ...(timeout !== undefined ? { timeoutMs: Number(timeout) } : {}),
        })
        io.stdout(`${JSON.stringify(result, null, 2)}\n`)
        return 0
      }
      case 'archive': {
        const kind = one(parsed, 'kind')
        await service.archive(requiredPositional(parsed), {
          target: required(parsed, 'target'),
          ...(kind !== undefined ? { kind } : {}),
        })
        return 0
      }
      case 'release': {
        await service.release(requiredPositional(parsed), parsed.bools.has('force') ? { force: true } : undefined)
        return 0
      }
      case 'status': {
        const rows = await service.status(parsed.positional[0])
        if (parsed.bools.has('json')) {
          io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
        } else {
          io.stdout(renderStatusTable(rows))
        }
        return 0
      }
      default:
        throw new UsageError(`unknown verb ${JSON.stringify(command)}`)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`lab: ${error.message}\n\n${USAGE}`)
      return 2
    }
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function requiredPositional(parsed: Parsed): string {
  const value = parsed.positional[0]
  if (value === undefined) throw new UsageError('missing UNIT argument')
  return value
}

/** Milliseconds → compact age (`3m`, `2h14m`, `1d2h`). */
function ageCompact(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`
}

/**
 * The progress view: one row per unit joining container facts (running, age),
 * in-container activity, the mission state and coordinate labels (via the
 * mission face, absent-tolerant), and the materialization hash — identical
 * hashes across rows are the fairness proof, visible at a glance.
 */
function renderStatusTable(rows: UnitStatus[], now = Date.now()): string {
  if (rows.length === 0) return 'no units\n'
  const cells = rows.map((row) => [
    row.id,
    row.missionState !== undefined ? `${row.missionId ?? '?'}:${row.missionState}` : (row.missionId ?? '-'),
    row.running ? `up ${ageCompact(now - row.createdAt)}` : 'exited',
    row.lastActivityAt !== undefined ? `${ageCompact(now - row.lastActivityAt)} ago` : '-',
    row.taskHash ?? '-',
    row.missionLabels !== undefined ? Object.entries(row.missionLabels).map(([k, v]) => `${k}=${v}`).join(',') : '',
  ])
  const header = ['UNIT', 'MISSION', 'CONTAINER', 'LAST-ACTIVITY', 'TASK', 'LABELS']
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => (row[i] ?? '').length)))
  const render = (row: string[]): string => row.map((cell, i) => (cell ?? '').padEnd(widths[i] as number)).join('  ').trimEnd()
  return `${render(header)}\n${cells.map(render).join('\n')}\n`
}
