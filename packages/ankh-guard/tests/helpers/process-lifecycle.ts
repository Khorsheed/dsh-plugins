import { execFileSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  findPidsOnPort, processGroupId, processIdentity, processIdentityMatches,
  signalProcessIdentity, type ProcessIdentity,
} from '../../src/processes.ts'
import {
  appendTestLifecycleEvent, appendTestLifecycleEventForProcess, registerTestProcess,
  TEST_PROCESS_PORT_ENV, TEST_PROCESS_ROLE_ENV, TEST_PROCESS_TEMP_ROOT_ENV,
  TEST_REGISTER_BIN_ENV, TEST_RUN_DIR_ENV, TEST_RUN_TOKEN_ENV, TEST_SLEEP_SCALE_ENV,
  type TestLifecycleEvent, type TestProcessLeaseRecord,
} from '../../src/test-seam.ts'

const LEASE_SCHEMA_VERSION = 1
const DEFAULT_LIVE_REPORT_AGE_MS = 60 * 60_000

interface RunRecord {
  version: 1
  runToken: string
  createdAt: number
  owner: ProcessIdentity
  cwd: string
}

interface PortLeaseRecord {
  version: 1
  runToken: string
  port: number
  createdAt: number
  owner: ProcessIdentity
  runDir: string
}

export interface MachineLeaseFinding<T> {
  record: T
  file: string
  ageMs: number
  run?: RunRecord
}

export interface MachineLeaseReport {
  root: string
  reclaimable: Array<MachineLeaseFinding<TestProcessLeaseRecord | PortLeaseRecord>>
  overAgeLive: Array<MachineLeaseFinding<TestProcessLeaseRecord | PortLeaseRecord>>
  activeLive: Array<MachineLeaseFinding<TestProcessLeaseRecord | PortLeaseRecord>>
  unreadable: Array<{ file: string; error: string }>
}

function leaseRoot(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown'
  return join(tmpdir(), `dsh-ankh-guard-test-leases-${uid}`)
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe test lease directory: ${path}`)
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`test lease directory is not owned by uid ${process.getuid()}: ${path}`)
  }
  chmodSync(path, 0o700)
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })
}

function reserveEphemeralPort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {})
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve({ server, port: (server.address() as AddressInfo).port })
    })
  })
}

function readProcessRecords(runDir: string): TestProcessLeaseRecord[] {
  return scanProcessRecords(runDir).records
}

function scanProcessRecords(runDir: string): {
  records: TestProcessLeaseRecord[]
  unreadable: Array<{ file: string; error: string }>
} {
  const dir = join(runDir, 'processes')
  if (!existsSync(dir)) return { records: [], unreadable: [] }
  const records: TestProcessLeaseRecord[] = []
  const unreadable: Array<{ file: string; error: string }> = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      const record = readJson<TestProcessLeaseRecord>(file)
      if (record.version !== 1 || record.pid <= 0 || record.startToken === '') throw new Error('unsupported process lease')
      records.push(record)
    } catch (error) {
      unreadable.push({ file, error: String(error) })
    }
  }
  return { records: records.sort((left, right) => left.registeredAt - right.registeredAt), unreadable }
}

function readEvents(runDir: string): TestLifecycleEvent[] {
  const dir = join(runDir, 'events')
  if (!existsSync(dir)) return []
  const events: TestLifecycleEvent[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    try {
      for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
        if (line !== '') events.push(JSON.parse(line) as TestLifecycleEvent)
      }
    } catch { /* the partial file remains available in the preserved run dir */ }
  }
  return events.sort((left, right) => left.wallTimeMs - right.wallTimeMs)
}

function signalRegisteredGroup(record: TestProcessLeaseRecord, signal: NodeJS.Signals): 'signalled' | 'gone' | 'mismatch' {
  try {
    process.kill(record.pid, 'SIGSTOP')
  } catch {
    return 'gone'
  }
  if (!processIdentityMatches(record) || processGroupId(record.pid) !== record.pgid || record.pgid !== record.pid) {
    try { process.kill(record.pid, 'SIGCONT') } catch { /* already gone */ }
    return 'mismatch'
  }
  try {
    process.kill(-record.pgid, signal)
    if (signal !== 'SIGKILL') {
      try { process.kill(-record.pgid, 'SIGCONT') } catch { /* group exited */ }
    }
    return 'signalled'
  } catch {
    try { process.kill(record.pid, 'SIGCONT') } catch { /* already gone */ }
    return processIdentityMatches(record) ? 'mismatch' : 'gone'
  }
}

function signalRecord(record: TestProcessLeaseRecord, signal: NodeJS.Signals): 'signalled' | 'gone' | 'mismatch' {
  if (record.pid === process.pid) return 'mismatch'
  return record.groupRoot
    ? signalRegisteredGroup(record, signal)
    : signalProcessIdentity(record, signal)
}

async function waitForNoMatchingProcesses(runDir: string, timeoutMs: number): Promise<TestProcessLeaseRecord[]> {
  const deadline = performance.now() + timeoutMs
  let live: TestProcessLeaseRecord[] = []
  do {
    live = readProcessRecords(runDir).filter(record => record.pid !== process.pid && processIdentityMatches(record))
    if (live.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
      live = readProcessRecords(runDir).filter(record => record.pid !== process.pid && processIdentityMatches(record))
      if (live.length === 0) return []
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (performance.now() < deadline)
  return live
}

/** One Vitest case's immutable process/port ownership ledger. */
export class TestProcessLifecycle {
  readonly root: string
  readonly runDir: string
  readonly runToken: string
  private readonly previousEnv = new Map<string, string | undefined>()
  private readonly portRecords = new Map<number, string>()
  private preserveEvidence = false

  constructor(private readonly registerBin: string) {
    this.root = leaseRoot()
    this.runToken = randomUUID()
    this.runDir = join(this.root, 'runs', this.runToken)
    ensurePrivateDirectory(this.root)
    ensurePrivateDirectory(join(this.root, 'runs'))
    ensurePrivateDirectory(join(this.root, 'ports'))
    ensurePrivateDirectory(this.runDir)
    const owner = processIdentity(process.pid)
    if (owner === null) throw new Error(`cannot capture test-run owner identity for pid ${process.pid}`)
    const run: RunRecord = { version: LEASE_SCHEMA_VERSION, runToken: this.runToken, createdAt: Date.now(), owner, cwd: process.cwd() }
    writeFileSync(join(this.runDir, 'run.json'), `${JSON.stringify(run)}\n`, { flag: 'wx', mode: 0o600 })
    this.installEnv(TEST_RUN_DIR_ENV, this.runDir)
    this.installEnv(TEST_RUN_TOKEN_ENV, this.runToken)
    this.installEnv(TEST_REGISTER_BIN_ENV, registerBin)
    this.installEnv(TEST_SLEEP_SCALE_ENV, '0.05')
  }

  private installEnv(name: string, value: string): void {
    this.previousEnv.set(name, process.env[name])
    process.env[name] = value
  }

  childEnv(role: string, base: NodeJS.ProcessEnv = process.env, options: { port?: number; tempRoot?: string } = {}): NodeJS.ProcessEnv {
    return {
      ...base,
      [TEST_RUN_DIR_ENV]: this.runDir,
      [TEST_RUN_TOKEN_ENV]: this.runToken,
      [TEST_REGISTER_BIN_ENV]: this.registerBin,
      [TEST_SLEEP_SCALE_ENV]: process.env[TEST_SLEEP_SCALE_ENV] ?? '0.05',
      [TEST_PROCESS_ROLE_ENV]: role,
      ...(options.port === undefined ? {} : { [TEST_PROCESS_PORT_ENV]: String(options.port) }),
      ...(options.tempRoot === undefined ? {} : { [TEST_PROCESS_TEMP_ROOT_ENV]: options.tempRoot }),
    }
  }

  private eventEnv(role: string, options: { port?: number; tempRoot?: string } = {}): NodeJS.ProcessEnv {
    return this.childEnv(role, {}, options)
  }

  track(child: ChildProcess, role: string, options: { port?: number; tempRoot?: string } = {}): TestProcessLeaseRecord | null {
    const pid = child.pid
    if (pid === undefined) throw new Error(`${role} spawn returned no pid`)
    const env = this.eventEnv(role, options)
    const record = registerTestProcess(pid, role, {
      env,
      source: 'parent-observer',
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.tempRoot === undefined ? {} : { tempRoot: options.tempRoot }),
    })
    appendTestLifecycleEventForProcess(pid, role, 'child-spawned', { childPid: pid, role }, 'parent-observer', env)
    child.once('exit', (code, signal) => {
      appendTestLifecycleEventForProcess(pid, role, 'child-exit-callback', { childPid: pid, code, signal: signal ?? '' }, 'node-exit-callback', env)
    })
    child.once('close', (code, signal) => {
      appendTestLifecycleEventForProcess(pid, role, 'child-close-callback', { childPid: pid, code, signal: signal ?? '' }, 'node-close-callback', env)
    })
    return record
  }

  /** Signal only the captured start identity for a directly spawned child. */
  signal(child: ChildProcess, signal: NodeJS.Signals): 'signalled' | 'gone' | 'mismatch' {
    const pid = child.pid
    if (pid === undefined) return 'gone'
    const record = readProcessRecords(this.runDir).find(candidate => candidate.pid === pid && processIdentityMatches(candidate))
    if (record === undefined) return 'gone'
    return signalRecord(record, signal)
  }

  /** Freeze/revalidate and signal only one direct child, without widening to its group/tree. */
  signalExact(child: ChildProcess, signal: NodeJS.Signals): 'signalled' | 'gone' | 'mismatch' {
    const pid = child.pid
    if (pid === undefined) return 'gone'
    const record = readProcessRecords(this.runDir).find(candidate => candidate.pid === pid && processIdentityMatches(candidate))
    if (record === undefined) return 'gone'
    try {
      process.kill(pid, 'SIGSTOP')
    } catch {
      return 'gone'
    }
    if (!processIdentityMatches(record)) {
      try { process.kill(pid, 'SIGCONT') } catch { /* already gone */ }
      return 'mismatch'
    }
    try {
      process.kill(pid, signal)
      if (signal !== 'SIGKILL' && signal !== 'SIGSTOP') process.kill(pid, 'SIGCONT')
      return 'signalled'
    } catch {
      try { process.kill(pid, 'SIGCONT') } catch { /* already gone */ }
      return processIdentityMatches(record) ? 'mismatch' : 'gone'
    }
  }

  /**
   * Stop runtime identities explicitly registered for a leased port. The
   * number only indexes this run's ledger; it never discovers or authorizes
   * an arbitrary machine process.
   */
  async stopPortProcesses(port: number): Promise<number> {
    const runtimeRoles = new Set(['instance-wrapper', 'instance-listener', 'crash-page', 'restart-instance-root', 'fixture-port-runtime'])
    const records = readProcessRecords(this.runDir).filter(record =>
      record.port === port && runtimeRoles.has(record.role) && processIdentityMatches(record),
    )
    for (const record of records.reverse()) signalProcessIdentity(record, 'SIGKILL')
    const deadline = performance.now() + 2_000
    while (records.some(processIdentityMatches) && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const survivors = records.filter(processIdentityMatches)
    if (survivors.length > 0) throw new Error(`registered port runtimes survived SIGKILL:\n${this.diagnostics()}`)
    return records.length
  }

  /** Allocate a cross-worktree port lease; the reservation stays bound until the durable lease exists. */
  async acquirePort(): Promise<number> {
    const owner = processIdentity(process.pid)
    if (owner === null) throw new Error(`cannot capture port-lease owner identity for pid ${process.pid}`)
    for (let attempt = 1; attempt <= 64; attempt++) {
      const { server, port } = await reserveEphemeralPort()
      const file = join(this.root, 'ports', `${port}.json`)
      const record: PortLeaseRecord = {
        version: LEASE_SCHEMA_VERSION, runToken: this.runToken, port,
        createdAt: Date.now(), owner, runDir: this.runDir,
      }
      let acquired = false
      try {
        writeFileSync(file, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 })
        acquired = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          await closeServer(server)
          throw error
        }
        try {
          const incumbentBytes = readFileSync(file, 'utf8')
          const incumbent = JSON.parse(incumbentBytes) as PortLeaseRecord
          if (!processIdentityMatches(incumbent.owner)) {
            appendTestLifecycleEvent('port-lease-collision', { port, attempt, incumbent: 'dead' }, 'parent-observer', this.eventEnv('port-allocator'))
            const quarantine = `${file}.stale-${this.runToken}`
            try {
              renameSync(file, quarantine)
              unlinkSync(quarantine)
            } catch { /* another allocator won the stale-record race */ }
          } else {
            appendTestLifecycleEvent('port-lease-collision', { port, attempt, incumbent: 'live' }, 'parent-observer', this.eventEnv('port-allocator'))
          }
        } catch {
          appendTestLifecycleEvent('port-lease-collision', { port, attempt, incumbent: 'unreadable' }, 'parent-observer', this.eventEnv('port-allocator'))
          // Unreadable records remain for leak-report diagnosis.
        }
      }
      if (acquired) {
        this.portRecords.set(port, file)
        appendTestLifecycleEvent('port-lease-acquired', { port, attempt }, 'parent-observer', this.eventEnv('port-allocator'))
        await closeServer(server)
        return port
      }
      await closeServer(server)
    }
    throw new Error('could not acquire an isolated loopback port after 64 attempts')
  }

  events(): TestLifecycleEvent[] {
    return readEvents(this.runDir)
  }

  diagnostics(): string {
    const processScan = scanProcessRecords(this.runDir)
    const events = this.events()
    let processTable = ''
    try { processTable = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command='], { encoding: 'utf8' }) } catch {}
    const processStates = processScan.records.map(record => ({
      record,
      currentIdentity: processIdentity(record.pid),
      matches: processIdentityMatches(record),
      processRow: processTable.split('\n').find(line => Number(/^\s*(\d+)/.exec(line)?.[1]) === record.pid)?.trim() ?? null,
    }))
    const watchdogLogs = [...new Set(processScan.records.flatMap(record => record.tempRoot === undefined ? [] : [join(record.tempRoot, 'watchdog.log')]))]
      .flatMap(file => {
        try { return [{ file, tail: readFileSync(file, 'utf8').slice(-12_000) }] } catch { return [] }
      })
    return JSON.stringify({
      runToken: this.runToken,
      expectedPorts: [...new Set([...this.portRecords.keys(), ...processScan.records.flatMap(record => record.port === undefined ? [] : [record.port])])],
      processStates,
      unreadableProcessRecords: processScan.unreadable,
      watchdogLogs,
      events,
    }, null, 2)
  }

  retainEvidence(): void {
    this.preserveEvidence = true
  }

  /** TERM → bounded wait → KILL → bounded wait over identities registered so far and during teardown. */
  async stopAll(): Promise<void> {
    const initialRecords = readProcessRecords(this.runDir)
    for (const record of initialRecords.reverse()) {
      if (processIdentityMatches(record)) signalRecord(record, 'SIGTERM')
    }
    let survivors = initialRecords.length === 0 ? [] : await waitForNoMatchingProcesses(this.runDir, 2_000)
    for (const record of survivors.reverse()) signalRecord(record, 'SIGKILL')
    survivors = await waitForNoMatchingProcesses(this.runDir, 2_000)
    if (survivors.length > 0) {
      throw new Error(`registered test processes survived TERM/KILL:\n${this.diagnostics()}`)
    }
    const unreadable = scanProcessRecords(this.runDir).unreadable
    if (unreadable.length > 0) {
      throw new Error(`unreadable process leases prevent complete teardown proof:\n${this.diagnostics()}`)
    }
  }

  async teardown(): Promise<void> {
    let failure: Error | undefined
    try {
      await this.stopAll()
      const ports = new Set<number>([
        ...this.portRecords.keys(),
        ...readProcessRecords(this.runDir).flatMap(record => record.port === undefined ? [] : [record.port]),
      ])
      const occupied = [...ports].map(port => ({ port, pids: findPidsOnPort(port) })).filter(item => item.pids.length > 0)
      if (occupied.length > 0) throw new Error(`registered ports still have listeners: ${JSON.stringify(occupied)}\n${this.diagnostics()}`)
      for (const [port, file] of this.portRecords) {
        try {
          const record = readJson<PortLeaseRecord>(file)
          if (record.runToken === this.runToken && record.port === port) unlinkSync(file)
        } catch { /* retain unreadable/mismatched evidence */ }
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    } finally {
      for (const [name, value] of this.previousEnv) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      if (failure === undefined && !this.preserveEvidence) rmSync(this.runDir, { recursive: true, force: true })
    }
    if (failure !== undefined) throw failure
  }
}

function collectJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    let info
    try { info = statSync(path) } catch { continue }
    if (info.isDirectory()) out.push(...collectJsonFiles(path))
    else if (name.endsWith('.json')) out.push(path)
  }
  return out
}

/** Read-only machine lease audit; it deliberately never sends signals or removes records. */
export function inspectMachineTestLeases(now = Date.now(), liveReportAgeMs = DEFAULT_LIVE_REPORT_AGE_MS): MachineLeaseReport {
  const root = leaseRoot()
  const report: MachineLeaseReport = { root, reclaimable: [], overAgeLive: [], activeLive: [], unreadable: [] }
  if (!existsSync(root)) return report
  const processFiles = collectJsonFiles(join(root, 'runs')).filter(file => basename(file) !== 'run.json')
  for (const file of processFiles) {
    try {
      const record = readJson<TestProcessLeaseRecord>(file)
      if (record.version !== 1 || record.startToken === '') throw new Error('unsupported process lease')
      let run: RunRecord | undefined
      try { run = readJson<RunRecord>(join(dirname(dirname(file)), 'run.json')) } catch { /* reported through the record's path */ }
      const finding = { record, file, ageMs: Math.max(0, now - record.registeredAt), ...(run === undefined ? {} : { run }) }
      if (!processIdentityMatches(record)) report.reclaimable.push(finding)
      else if (finding.ageMs >= liveReportAgeMs) report.overAgeLive.push(finding)
      else report.activeLive.push(finding)
    } catch (error) {
      report.unreadable.push({ file, error: String(error) })
    }
  }
  for (const file of collectJsonFiles(join(root, 'ports'))) {
    try {
      const record = readJson<PortLeaseRecord>(file)
      if (record.version !== 1) throw new Error('unsupported port lease')
      let run: RunRecord | undefined
      try { run = readJson<RunRecord>(join(record.runDir, 'run.json')) } catch { /* reported through the record's path */ }
      const finding = { record, file, ageMs: Math.max(0, now - record.createdAt), ...(run === undefined ? {} : { run }) }
      if (!processIdentityMatches(record.owner)) report.reclaimable.push(finding)
      else if (finding.ageMs >= liveReportAgeMs) report.overAgeLive.push(finding)
      else report.activeLive.push(finding)
    } catch (error) {
      report.unreadable.push({ file, error: String(error) })
    }
  }
  return report
}

/** Render only credential-free ownership evidence for a human cleanup decision. */
export function formatMachineLeaseReport(report: MachineLeaseReport): string {
  const lines = [`Ankh Guard test lease report: ${report.root}`]
  const render = (label: string, findings: Array<MachineLeaseFinding<TestProcessLeaseRecord | PortLeaseRecord>>): void => {
    lines.push(`${label}: ${findings.length}`)
    for (const finding of findings) {
      const record = finding.record
      const identity = 'pid' in record ? record : record.owner
      const role = 'role' in record ? record.role : 'port-lease'
      const pgid = 'pgid' in record ? record.pgid : '-'
      const tempRoot = 'tempRoot' in record ? record.tempRoot : undefined
      lines.push(
        `  ${finding.file} ageMs=${finding.ageMs} pid=${identity.pid} pgid=${pgid} startToken=${identity.startToken}`
        + ` role=${role}${'port' in record && record.port !== undefined ? ` port=${record.port}` : ''}`
        + `${tempRoot === undefined ? '' : ` tempRoot=${tempRoot}`}`
        + `${finding.run === undefined ? '' : ` runOwner=${finding.run.owner.pid}/${finding.run.owner.startToken} cwd=${finding.run.cwd}`}`,
      )
    }
  }
  render('reclaimable-dead', report.reclaimable)
  render('over-age-live-human-review', report.overAgeLive)
  render('active-live', report.activeLive)
  lines.push(`unreadable: ${report.unreadable.length}`)
  for (const finding of report.unreadable) lines.push(`  ${finding.file}: ${finding.error}`)
  return `${lines.join('\n')}\n`
}
