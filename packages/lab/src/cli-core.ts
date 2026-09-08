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
import { shortFingerprint } from './fingerprint.ts'
import { LabService } from './service.ts'
import { resolveStateDir } from './state.ts'
import type { AcquireSpec, Exec, ExecResult, MissionFace, MissionSnapshot, MountSpec, UnitStatus } from './types.ts'

/** Injected output channels. */
export interface CliIo {
  /** Write to stdout (data). */
  stdout: (text: string) => void
  /** Write to stderr (diagnostics). */
  stderr: (text: string) => void
}

const USAGE = `dsh-lab <verb> [options]

  acquire --image IMG [--mission ID] [--run ID] [--mount SRC:DST[:ro]]... [--volume NAME:DST[:ro]]...
          [--env K=V]... [--cpus N] [--memory SIZE] [--network NET] [--user UID[:GID]]
          [--workdir DIR] [--command JSON]
  populate UNIT --source DIR [--target DIR] [--manifest FILE] [--artifact-path P]
  collect UNIT --source DIR --target DIR [--kind K] [--artifact-path P]
  checkpoint UNIT --name NAME
  verify UNIT [--source DIR] [--timeout-ms MS] -- CMD [ARGS...]
  archive UNIT --target DIR [--kind K] [--artifact-path P]
  release UNIT [--force]
  status [UNIT] [--json]
  fingerprint UNIT | --image IMG [the same spec flags acquire takes]

Global: --max-concurrent N (acquire ceiling, default 4), --state-dir DIR
Exit codes: 0 ok, 1 failure/refused, 2 usage.

The environment fingerprint is composite: image digest + CPU/memory ceilings +
mount layout (container paths only) + injected env KEY names (never values) +
docker network + in-container user. Without --network the unit lands on
docker's default bridge, which HAS egress. \`fingerprint\` prints it with the
components it was computed from — with a UNIT for one held unit, or with an
acquire-shaped spec to resolve one without acquiring anything (diff two of
those to see which component differs).

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
        if (i >= args.length) {
          // Value-less at the end: let validation classify it (missing value
          // for a known flag vs unknown flag).
          parsed.bools.add(key)
          break
        }
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

/** Flags every verb accepts (service wiring, not verb semantics). */
const GLOBAL_VALUE_FLAGS = ['max-concurrent', 'state-dir']

/** Flags each verb accepts. Unknown flags are a usage error — with or without a value (a misspelled `--manifest-path` must never exit 0). */
const VERB_FLAGS: Record<string, { values: string[]; booleans: string[] }> = {
  acquire: { values: ['image', 'mission', 'run', 'mount', 'volume', 'env', 'cpus', 'memory', 'network', 'user', 'workdir', 'command'], booleans: ['help'] },
  populate: { values: ['source', 'target', 'manifest', 'artifact-path'], booleans: ['help'] },
  collect: { values: ['source', 'target', 'kind', 'artifact-path'], booleans: ['help'] },
  checkpoint: { values: ['name'], booleans: ['help'] },
  verify: { values: ['source', 'timeout-ms'], booleans: ['help'] },
  archive: { values: ['target', 'kind', 'artifact-path'], booleans: ['help'] },
  release: { values: [], booleans: ['force', 'help'] },
  status: { values: [], booleans: ['help', 'json'] },
  fingerprint: { values: ['image', 'mount', 'volume', 'env', 'cpus', 'memory', 'network', 'user'], booleans: ['help'] },
}

/** Reject any flag the verb does not know (parse-time consumption already recorded it). */
function validateFlags(parsed: Parsed, verb: string): void {
  const known = VERB_FLAGS[verb]
  if (known === undefined) throw new UsageError(`unknown verb ${JSON.stringify(verb)}`)
  const values = [...known.values, ...GLOBAL_VALUE_FLAGS]
  for (const key of parsed.flags.keys()) {
    if (!values.includes(key)) throw new UsageError(`unknown flag --${key} for ${verb}`)
  }
  for (const key of parsed.bools) {
    if (known.booleans.includes(key)) continue
    if (values.includes(key)) throw new UsageError(`missing value for --${key}`)
    throw new UsageError(`unknown flag --${key} for ${verb}`)
  }
}

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

/**
 * Parse `SRC:DST[:ro]` into a mount spec. The kind is chosen by which FLAG the
 * value came from, never inferred from the source text: docker's `-v` guesses
 * bind-vs-volume from whether the source looks like a path, and a relative
 * path silently becoming a volume is not a guess worth inheriting.
 */
function parseMount(raw: string, type: 'bind' | 'volume'): MountSpec {
  const flag = type === 'bind' ? 'mount' : 'volume'
  const want = type === 'bind' ? 'SRC:DST[:ro]' : 'NAME:DST[:ro]'
  const parts = raw.split(':')
  if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
    throw new UsageError(`bad --${flag} ${JSON.stringify(raw)} (want ${want})`)
  }
  const mount: MountSpec = { source: parts[0] as string, target: parts[1] as string }
  if (parts[2] === 'ro') mount.readonly = true
  if (type === 'volume') mount.type = 'volume'
  return mount
}

/**
 * The spec fields `acquire` and `fingerprint` share — everything the composite
 * fingerprint is computed from, so `fingerprint` can answer for a unit that
 * has not been acquired.
 */
function specFromFlags(parsed: Parsed): AcquireSpec {
  const spec: AcquireSpec = {
    image: required(parsed, 'image'),
    mounts: [
      ...(parsed.flags.get('mount') ?? []).map((raw) => parseMount(raw, 'bind')),
      ...(parsed.flags.get('volume') ?? []).map((raw) => parseMount(raw, 'volume')),
    ],
  }
  const env: Record<string, string> = {}
  for (const pair of parsed.flags.get('env') ?? []) {
    const eq = pair.indexOf('=')
    if (eq === -1) throw new UsageError(`bad --env ${JSON.stringify(pair)} (want K=V)`)
    env[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  if (Object.keys(env).length > 0) spec.env = env
  const cpus = one(parsed, 'cpus')
  const memory = one(parsed, 'memory')
  if (cpus !== undefined || memory !== undefined) {
    spec.resources = {
      ...(cpus !== undefined ? { cpus } : {}),
      ...(memory !== undefined ? { memory } : {}),
    }
  }
  const network = one(parsed, 'network')
  if (network !== undefined) {
    if (network === '') throw new UsageError('--network wants a docker network name, or "none"')
    spec.network = network
  }
  const user = one(parsed, 'user')
  if (user !== undefined) {
    if (user === '') throw new UsageError('--user wants UID[:GID] or a user name')
    spec.user = user
  }
  return spec
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
    validateFlags(parsed, command)
    const mission = await probeMission(exec)
    const provider = new DockerProvider(exec)
    const service = new LabService({
      providers: { docker: provider },
      maxConcurrentUnits: Number(one(parsed, 'max-concurrent') ?? '4'),
      stateDir: resolveStateDir(one(parsed, 'state-dir')),
      getMission: () => (mission ? cliMissionFace(exec) : undefined),
      warn,
    })
    switch (command) {
      case 'acquire': {
        const spec = specFromFlags(parsed)
        const missionId = one(parsed, 'mission')
        if (missionId !== undefined) spec.missionId = missionId
        const runId = one(parsed, 'run')
        if (runId !== undefined) spec.runId = runId
        const workdir = one(parsed, 'workdir')
        if (workdir !== undefined) spec.workdir = workdir
        const cmd = one(parsed, 'command')
        if (cmd !== undefined) spec.command = JSON.parse(cmd) as string[]
        io.stdout(`${JSON.stringify(await service.acquire(spec), null, 2)}\n`)
        return 0
      }
      case 'fingerprint': {
        // Two questions, one verb: what IS this held unit's environment, and
        // what WOULD this spec's environment be. The second acquires nothing,
        // so two of them can be diffed before a run to see which component
        // would make the cells incomparable.
        const unitId = parsed.positional[0]
        if (unitId !== undefined) {
          const [row] = await service.status(unitId)
          io.stdout(`${JSON.stringify({
            unit: row?.id,
            fingerprint: row?.fingerprint,
            components: row?.fingerprintComponents ?? null,
          }, null, 2)}\n`)
          return 0
        }
        io.stdout(`${JSON.stringify(await provider.fingerprint(specFromFlags(parsed)), null, 2)}\n`)
        return 0
      }
      case 'populate': {
        const target = one(parsed, 'target')
        const manifestPath = one(parsed, 'manifest')
        const artifactPath = one(parsed, 'artifact-path')
        const manifest = await service.populate(requiredPositional(parsed), {
          source: required(parsed, 'source'),
          ...(target !== undefined ? { target } : {}),
          ...(manifestPath !== undefined ? { manifestPath } : {}),
          ...(artifactPath !== undefined ? { artifactPath } : {}),
        })
        io.stdout(`${JSON.stringify({ sha: manifest.sha, count: manifest.count }, null, 2)}\n`)
        return 0
      }
      case 'collect': {
        const kind = one(parsed, 'kind')
        const artifactPath = one(parsed, 'artifact-path')
        await service.collect(requiredPositional(parsed), {
          source: required(parsed, 'source'),
          target: required(parsed, 'target'),
          ...(kind !== undefined ? { kind } : {}),
          ...(artifactPath !== undefined ? { artifactPath } : {}),
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
        const artifactPath = one(parsed, 'artifact-path')
        await service.archive(requiredPositional(parsed), {
          target: required(parsed, 'target'),
          ...(kind !== undefined ? { kind } : {}),
          ...(artifactPath !== undefined ? { artifactPath } : {}),
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
 * mission face, absent-tolerant), the materialization hash, and the
 * environment fingerprint — identical TASK hashes across rows are the
 * fairness proof and identical ENV hashes the comparability proof, both
 * visible at a glance. `dsh-lab fingerprint UNIT` expands an ENV cell into
 * the components behind it.
 */
function renderStatusTable(rows: UnitStatus[], now = Date.now()): string {
  if (rows.length === 0) return 'no units\n'
  const cells = rows.map((row) => [
    row.id,
    row.missionState !== undefined ? `${row.missionId ?? '?'}:${row.missionState}` : (row.missionId ?? '-'),
    row.running ? `up ${ageCompact(now - row.createdAt)}` : 'exited',
    row.lastActivityAt !== undefined ? `${ageCompact(now - row.lastActivityAt)} ago` : '-',
    row.taskHash ?? '-',
    row.fingerprint === '' ? '-' : shortFingerprint(row.fingerprint),
    row.missionLabels !== undefined ? Object.entries(row.missionLabels).map(([k, v]) => `${k}=${v}`).join(',') : '',
  ])
  const header = ['UNIT', 'MISSION', 'CONTAINER', 'LAST-ACTIVITY', 'TASK', 'ENV', 'LABELS']
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => (row[i] ?? '').length)))
  const render = (row: string[]): string => row.map((cell, i) => (cell ?? '').padEnd(widths[i] as number)).join('  ').trimEnd()
  return `${render(header)}\n${cells.map(render).join('\n')}\n`
}
