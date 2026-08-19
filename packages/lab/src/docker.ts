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
import type {
  AcquireSpec, CollectOptions, Exec, ManagedResource, PopulateOptions, UnitProvider,
} from './types.ts'

const MANAGED_LABEL = 'dsh-lab.managed'
const UNIT_LABEL = 'dsh-lab.unit'
const MISSION_LABEL = 'dsh-lab.mission'
const RUN_LABEL = 'dsh-lab.run'
const FINGERPRINT_LABEL = 'dsh-lab.fingerprint'

/** In-container directory holding one pidfile per provider-spawned process. */
const PID_DIR = '/run/dsh-lab/pids'

/** Docker provider tuning. */
export interface DockerProviderOptions {
  /** Pause between the in-container SIGTERM sweep and `docker rm -f`; defaults to 2000. */
  terminateGraceMs?: number
  /** Wait hook (tests substitute a no-op). */
  sleep?: (ms: number) => Promise<void>
}

/** The docker CLI provider for {@link import('./types.ts').UnitProvider}. */
export class DockerProvider implements UnitProvider {
  readonly kind = 'docker'
  private readonly terminateGraceMs: number
  private readonly sleep: (ms: number) => Promise<void>

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
  }

  async fingerprint(spec: AcquireSpec): Promise<string> {
    const local = await this.inspectImage(spec.image)
    if (local !== undefined) return local
    await this.run(['pull', spec.image])
    const pulled = await this.inspectImage(spec.image)
    if (pulled === undefined) {
      throw new Error(`lab: cannot resolve an environment fingerprint for image ${JSON.stringify(spec.image)}`)
    }
    return pulled
  }

  /** The fingerprint is the first repo digest, falling back to the local image id. */
  private async inspectImage(image: string): Promise<string | undefined> {
    const result = await this.exec(['image', 'inspect', image, '--format', '{{json .RepoDigests}} {{.Id}}'])
    if (result.exitCode !== 0) return undefined
    const [digestsJson, id] = result.stdout.trim().split(' ')
    const digests = JSON.parse(digestsJson ?? '[]') as string[]
    return digests[0] ?? id
  }

  async acquire(id: string, spec: AcquireSpec, fingerprint: string): Promise<string> {
    const resource = `dsh-lab-${id}`
    const argv = [
      'run', '-d', '--name', resource,
      '--label', `${MANAGED_LABEL}=true`,
      '--label', `${UNIT_LABEL}=${id}`,
      '--label', `${FINGERPRINT_LABEL}=${fingerprint}`,
    ]
    if (spec.missionId !== undefined) argv.push('--label', `${MISSION_LABEL}=${spec.missionId}`)
    if (spec.runId !== undefined) argv.push('--label', `${RUN_LABEL}=${spec.runId}`)
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
    await this.execInUnit(resource, ['mkdir', '-p', options.target])
    await this.run(['cp', `${options.source}/.`, `${resource}:${options.target}`])
  }

  async collect(resource: string, options: CollectOptions): Promise<void> {
    await this.run(['cp', `${resource}:${options.source}/.`, options.target])
  }

  async listManaged(): Promise<ManagedResource[]> {
    const ps = await this.exec(['ps', '-a', '--filter', `label=${MANAGED_LABEL}=true`, '--format', '{{.Names}}'])
    if (ps.exitCode !== 0) throw new Error(`lab: docker ps failed (exit ${ps.exitCode}): ${ps.stderr.trim()}`)
    const names = ps.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    if (names.length === 0) return []
    const inspect = await this.exec(['inspect', ...names])
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
    await this.exec([
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
   * is gone.
   */
  private async execInUnit(resource: string, argv: string[]): Promise<void> {
    await this.run(['exec', resource, 'sh', '-c', `echo $$ > ${PID_DIR}/$$.pid; exec "$@"`, 'dsh-lab', ...argv])
  }

  /** Run one docker invocation, throwing with stderr context on failure. */
  private async run(argv: string[]): Promise<void> {
    const result = await this.exec(argv)
    if (result.exitCode !== 0) {
      throw new Error(`lab: docker ${argv[0] ?? ''} failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
    }
  }
}
