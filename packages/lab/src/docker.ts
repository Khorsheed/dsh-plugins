/**
 * Docker provider: one unit = one detached container, labeled so the daemon
 * itself is the registry of record (a host restart loses nothing — the
 * service rebuilds from `listManaged`).
 *
 * Orphan-process compensation (the measured `docker exec` orphan problem:
 * killing the host client leaves the in-container process alive): every
 * in-container command goes through {@link DockerProvider.execInUnit}, whose
 * wrapper records its own pid under {@link PID_DIR}; {@link terminate} first
 * sweeps those pids with SIGTERM inside the container, then removes the
 * container (which SIGKILLs whatever remains). Coverage is the provider's own
 * exec path only — processes others exec into the unit are out of lab's
 * reach, as the proposal's risk section states.
 */
import { componentsFor, hashComponents, normalizeCpus, normalizeMemory } from './fingerprint.ts'
import {
  DEFAULT_WORKSPACE,
  type AcquireSpec, type CollectOptions, type EnvironmentFingerprint, type Exec, type ExecResult,
  type ManagedResource, type PopulateOptions, type UnitProvider, type VerifyOptions, type VerifyResult,
} from './types.ts'

const MANAGED_LABEL = 'dsh-lab.managed'
const UNIT_LABEL = 'dsh-lab.unit'
const MISSION_LABEL = 'dsh-lab.mission'
const RUN_LABEL = 'dsh-lab.run'
const FINGERPRINT_LABEL = 'dsh-lab.fingerprint'
/** Label carrying the fingerprint's component JSON, so reconcile recovers it without a state file. */
export const COMPONENTS_LABEL = 'dsh-lab.fingerprint-components'
const WORKSPACE_LABEL = 'dsh-lab.workdir'

/** In-container directory holding one pidfile per provider-spawned process. */
const PID_DIR = '/run/dsh-lab/pids'

/** In-container scratch directory verify material is copied into. */
const VERIFY_DIR = '/run/dsh-lab/verify'

/** Docker provider tuning. */
export interface DockerProviderOptions {
  /** Pause between the in-container SIGTERM sweep and `docker rm -f`; defaults to 2000. */
  terminateGraceMs?: number
  /** Wait hook (tests substitute a no-op). */
  sleep?: (ms: number) => Promise<void>
  /** Clock hook (tests). */
  now?: () => number
}

/** The docker CLI provider for {@link import('./types.ts').UnitProvider}. */
export class DockerProvider implements UnitProvider {
  readonly kind = 'docker'
  private readonly terminateGraceMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  /**
   * @param exec - host command runner (`docker …` is prefixed here).
   * @param options - tuning knobs.
   */
  constructor(
    private readonly exec: Exec,
    options: DockerProviderOptions = {},
  ) {
    this.terminateGraceMs = options.terminateGraceMs ?? 2000
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * The composite fingerprint: the resolved image digest is only one of four
   * components. The image resolves first (pulling when absent) because it is
   * the one component that needs the daemon; the rest come from the spec.
   */
  async fingerprint(spec: AcquireSpec): Promise<EnvironmentFingerprint> {
    let image = await this.inspectImage(spec.image)
    if (image === undefined) {
      await this.run(['pull', spec.image])
      image = await this.inspectImage(spec.image)
    }
    if (image === undefined) {
      throw new Error(`lab: cannot resolve an environment fingerprint for image ${JSON.stringify(spec.image)}`)
    }
    const components = componentsFor(spec, image)
    return { fingerprint: hashComponents(components), components }
  }

  /** The image component is the first repo digest, falling back to the local image id. */
  private async inspectImage(image: string): Promise<string | undefined> {
    const result = await this.docker(['image', 'inspect', image, '--format', '{{json .RepoDigests}} {{.Id}}'])
    if (result.exitCode !== 0) return undefined
    const [digestsJson, id] = result.stdout.trim().split(' ')
    const digests = JSON.parse(digestsJson ?? '[]') as string[]
    return digests[0] ?? id
  }

  async acquire(id: string, spec: AcquireSpec, fingerprint: EnvironmentFingerprint): Promise<string> {
    const resource = `dsh-lab-${id}`
    const argv = [
      'run', '-d', '--name', resource,
      '--label', `${MANAGED_LABEL}=true`,
      '--label', `${UNIT_LABEL}=${id}`,
      '--label', `${FINGERPRINT_LABEL}=${fingerprint.fingerprint}`,
      // The components ride the daemon too: reconcile after a host restart
      // must recover WHY two units share (or do not share) a fingerprint,
      // with no host-side file in the trust path.
      '--label', `${COMPONENTS_LABEL}=${JSON.stringify(fingerprint.components)}`,
      '--label', `${WORKSPACE_LABEL}=${spec.workdir ?? DEFAULT_WORKSPACE}`,
    ]
    if (spec.missionId !== undefined) argv.push('--label', `${MISSION_LABEL}=${spec.missionId}`)
    if (spec.runId !== undefined) argv.push('--label', `${RUN_LABEL}=${spec.runId}`)
    // Declared ceilings are applied, not merely hashed — a fingerprint that
    // claims a limit the container does not carry would be a lie.
    if (spec.resources?.cpus !== undefined) argv.push('--cpus', normalizeCpus(spec.resources.cpus))
    if (spec.resources?.memory !== undefined) argv.push('--memory', normalizeMemory(spec.resources.memory))
    for (const mount of spec.mounts ?? []) {
      argv.push('--mount', `type=bind,source=${mount.source},target=${mount.target}${mount.readonly === true ? ',readonly' : ''}`)
    }
    for (const [key, value] of Object.entries(spec.env ?? {})) argv.push('--env', `${key}=${value}`)
    if (spec.workdir !== undefined) argv.push('--workdir', spec.workdir)
    argv.push(spec.image, ...(spec.command ?? ['sleep', 'infinity']))
    await this.run(argv)
    await this.run(['exec', resource, 'mkdir', '-p', PID_DIR])
    return resource
  }

  async populate(resource: string, options: PopulateOptions & { target: string }): Promise<void> {
    const mkdir = await this.execInUnit(resource, ['mkdir', '-p', options.target])
    if (mkdir.exitCode !== 0) throw new Error(`lab: cannot create ${options.target} in ${resource}: ${mkdir.stderr.trim()}`)
    await this.run(['cp', `${options.source}/.`, `${resource}:${options.target}`])
    // docker cp preserves source mtimes, so without a stamp a freshly
    // populated unit would look idle for the source's whole age — a fake
    // reading in exactly the spot the stuck-detector must trust. The marker
    // file's mtime is the activity baseline (and lands in later archives as
    // the populate timestamp).
    await this.execInUnit(resource, ['touch', `${options.target}/.lab-materialized`])
  }

  async collect(resource: string, options: CollectOptions): Promise<void> {
    await this.run(['cp', `${resource}:${options.source}/.`, options.target])
  }

  async checkpoint(resource: string, workspace: string, name: string): Promise<string> {
    const inRepo = await this.execInUnit(resource, ['git', '-C', workspace, 'rev-parse', '--is-inside-work-tree'])
    if (inRepo.exitCode !== 0) {
      // First checkpoint on a plain populated workspace: initialize the repo
      // the tag needs. A read-only mounted workspace fails loud here — it
      // cannot be committed, which is the correct signal.
      await this.execChecked(resource, ['git', '-C', workspace, 'init'])
    }
    await this.execChecked(resource, ['git', '-C', workspace, 'add', '-A'])
    await this.execChecked(resource, [
      'git', '-c', 'user.name=dsh-lab', '-c', 'user.email=dsh-lab@localhost',
      '-C', workspace, 'commit', '--allow-empty', '-m', name,
    ])
    await this.execChecked(resource, ['git', '-C', workspace, 'tag', '-f', name])
    const rev = await this.execChecked(resource, ['git', '-C', workspace, 'rev-parse', name])
    return rev.stdout.trim()
  }

  async verify(resource: string, workspace: string, options: VerifyOptions): Promise<VerifyResult> {
    if (options.source !== undefined) {
      await this.execChecked(resource, ['rm', '-rf', VERIFY_DIR])
      await this.execChecked(resource, ['mkdir', '-p', VERIFY_DIR])
      await this.run(['cp', `${options.source}/.`, `${resource}:${VERIFY_DIR}`])
    }
    const started = this.now()
    try {
      const result = await this.execInUnit(resource, options.command, { workdir: workspace, ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) })
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: this.now() - started,
        timedOut: result.timedOut === true,
      }
    } finally {
      if (options.source !== undefined) {
        // Material removal is best-effort: a dead unit must not mask the run's
        // recorded outcome, and release reaps the container anyway.
        await this.execInUnit(resource, ['rm', '-rf', VERIFY_DIR])
      }
    }
  }

  async activity(resource: string, workspace: string): Promise<{ mtime?: number; cpuUsageUsec?: number }> {
    const facts: { mtime?: number; cpuUsageUsec?: number } = {}
    // Primary signal: newest workspace file. Work inside the unit writes
    // files; lab is not invoked meanwhile, so verb-call timestamps would be
    // a fake metric. GNU `stat -c` first, `date -r` (busybox) as fallback —
    // both absent means no reading, which is not an error.
    const mtime = await this.execInUnit(resource, [
      'sh', '-c',
      'find "$1" -type f -exec stat -c %Y {} + 2>/dev/null || find "$1" -type f -exec date -r {} +%s 2>/dev/null',
      'activity', workspace,
    ])
    if (mtime.exitCode === 0) {
      const newest = mtime.stdout.split('\n').map((line) => Number(line.trim())).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a)[0]
      if (newest !== undefined) facts.mtime = newest * 1000
    }
    // Secondary: cumulative container CPU (cgroup v2 cpu.stat, v1 cpuacct).
    const cpu = await this.execInUnit(resource, ['cat', '/sys/fs/cgroup/cpu.stat'])
    if (cpu.exitCode === 0) {
      const usage = /^usage_usec (\d+)$/m.exec(cpu.stdout)?.[1]
      if (usage !== undefined) facts.cpuUsageUsec = Number(usage)
    } else {
      const v1 = await this.execInUnit(resource, ['cat', '/sys/fs/cgroup/cpuacct/cpuacct.usage'])
      if (v1.exitCode === 0) {
        const nanos = Number(v1.stdout.trim())
        if (Number.isFinite(nanos) && nanos > 0) facts.cpuUsageUsec = Math.floor(nanos / 1000)
      }
    }
    return facts
  }

  async listManaged(): Promise<ManagedResource[]> {
    const ps = await this.docker(['ps', '-a', '--filter', `label=${MANAGED_LABEL}=true`, '--format', '{{.Names}}'])
    if (ps.exitCode !== 0) throw new Error(`lab: docker ps failed (exit ${ps.exitCode}): ${ps.stderr.trim()}`)
    const names = ps.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    if (names.length === 0) return []
    const inspect = await this.docker(['inspect', ...names])
    if (inspect.exitCode !== 0) throw new Error(`lab: docker inspect failed (exit ${inspect.exitCode}): ${inspect.stderr.trim()}`)
    const parsed = JSON.parse(inspect.stdout) as {
      Name?: string
      Created?: string
      Config?: { Labels?: Record<string, string> }
      State?: { Running?: boolean }
    }[]
    const resources: ManagedResource[] = []
    for (const entry of parsed) {
      const labels = entry.Config?.Labels ?? {}
      const id = labels[UNIT_LABEL]
      const name = (entry.Name ?? '').replace(/^\//, '')
      if (id === undefined || name === '') continue
      const resource: ManagedResource = {
        id,
        resource: name,
        labels,
        running: entry.State?.Running === true,
      }
      const created = Date.parse(entry.Created ?? '')
      if (!Number.isNaN(created)) resource.createdAt = created
      resources.push(resource)
    }
    return resources
  }

  async terminate(resource: string): Promise<void> {
    // Best-effort graceful sweep: TERM every pidfile-recorded process. The
    // container may already be stopped — that failure is expected and ignored.
    await this.docker([
      'exec', resource, 'sh', '-c',
      `for f in ${PID_DIR}/*.pid; do [ -f "$f" ] || continue; kill -TERM "$(cat "$f")" 2>/dev/null || true; done`,
    ])
    await this.sleep(this.terminateGraceMs)
    await this.run(['rm', '-f', resource])
  }

  /**
   * Run a command inside the unit with orphan compensation: the wrapper
   * records its own pid (which `exec` forwards to the real command) under
   * {@link PID_DIR} so {@link terminate} can reach it after the host client
   * is gone. The result is returned raw — a non-zero exit is data (verify
   * records it verbatim), not an exception.
   */
  private async execInUnit(resource: string, argv: string[], options?: { workdir?: string; timeoutMs?: number }): Promise<ExecResult> {
    const full = ['exec']
    if (options?.workdir !== undefined) full.push('--workdir', options.workdir)
    full.push(resource, 'sh', '-c', `echo $$ > ${PID_DIR}/$$.pid; exec "$@"`, 'dsh-lab', ...argv)
    return this.docker(full, options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined)
  }

  /** {@link execInUnit} variant for setup steps where a failure IS an error. */
  private async execChecked(resource: string, argv: string[]): Promise<ExecResult> {
    const result = await this.execInUnit(resource, argv)
    if (result.exitCode !== 0) {
      throw new Error(`lab: in-unit ${argv[0] ?? ''} failed in ${resource} (exit ${result.exitCode}): ${result.stderr.trim()}`)
    }
    return result
  }

  /** Invoke the docker CLI — the one binary every provider command prefixes. */
  private docker(argv: string[], options?: { timeoutMs?: number }): Promise<ExecResult> {
    return this.exec(['docker', ...argv], options)
  }

  /** Run one docker invocation, throwing with stderr context on failure. */
  private async run(argv: string[]): Promise<void> {
    const result = await this.docker(argv)
    if (result.exitCode !== 0) {
      throw new Error(`lab: docker ${argv[0] ?? ''} failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
    }
  }
}
