import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli, type CliIo } from '../src/cli-core.ts'
import { install } from '../src/invariant.ts'
import { MissionService } from '../src/service.ts'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TSX = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')
const CLI = join(REPO_ROOT, 'packages', 'mission', 'src', 'cli.ts')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: { stdout: line => stdout.push(line), stderr: line => stderr.push(line) },
    out: () => stdout.join(''),
    err: () => stderr.join(''),
  }
}

/** Run the CLI as a real subprocess (source form via tsx) against a data dir. */
async function cliProcess(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath, ['--import', TSX, CLI, ...args, '--data-dir', dir], { timeout: 60_000 },
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('CLI semantics', () => {
  it('is-releasable exits 0/1', async () => {
    const template = {
      states: ['work', 'releasable'],
      transitions: [{ from: 'work', to: 'releasable', guard: { type: 'attested', key: 'ok' } }],
      releasableStates: ['releasable'],
    }
    writeFileSync(join(dir, 't.json'), JSON.stringify(template))
    const c = capture()
    expect(await runCli(['run', 'create', '--template', join(dir, 't.json'), '--id', 'r', '--data-dir', dir], c.io)).toBe(0)
    expect(await runCli(['create', '--run', 'r', '--id', 'm', '--data-dir', dir], c.io)).toBe(0)
    expect(await runCli(['is-releasable', 'm', '--run', 'r', '--data-dir', dir], c.io)).toBe(1)
    expect(await runCli(['attest', 'm', '--key', 'ok', '--run', 'r', '--data-dir', dir], c.io)).toBe(0)
    expect(await runCli(['transition', 'm', 'releasable', '--run', 'r', '--data-dir', dir], c.io)).toBe(0)
    expect(await runCli(['is-releasable', 'm', '--run', 'r', '--data-dir', dir], c.io)).toBe(0)
  })

  it('run lint exits 1 on errors, 0 with warnings only', async () => {
    const bad = {
      states: ['work', 'releasable'],
      transitions: [{ from: 'work', to: 'releasable' }],
      releasableStates: ['releasable'],
    }
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad))
    const c1 = capture()
    expect(await runCli(['run', 'lint', '--template', join(dir, 'bad.json'), '--data-dir', dir], c1.io)).toBe(1)
    expect(c1.err()).toMatch(/without a guard/)

    const warn = {
      states: ['work', 'releasable', 'dropped'],
      transitions: [
        { from: 'work', to: 'releasable', guard: { type: 'attested', key: 'ok' } },
        { from: 'work', to: 'dropped' },
      ],
      releasableStates: ['releasable'],
    }
    writeFileSync(join(dir, 'warn.json'), JSON.stringify(warn))
    const c2 = capture()
    expect(await runCli(['run', 'lint', '--template', join(dir, 'warn.json'), '--data-dir', dir], c2.io)).toBe(0)
    expect(c2.out()).toMatch(/warning/)
  })

  it('run status prints the five-bucket projection table', async () => {
    const c = capture()
    await runCli(['create', '--id', 'a', '--title', 'first', '--data-dir', dir], c.io)
    await runCli(['create', '--id', 'b', '--depends-on', 'a', '--data-dir', dir], c.io)
    const runId = 'default'
    const status = capture()
    expect(await runCli(['run', 'status', runId, '--data-dir', dir], status.io)).toBe(0)
    expect(status.out()).toMatch(/a\s+ready\s+queued/)
    expect(status.out()).toMatch(/b\s+blocked\s+queued\s+-\s+waiting: a/)
    expect(status.out()).toMatch(/buckets:.*ready=1.*blocked=1/)
  })

  it('usage errors exit 2', async () => {
    const c = capture()
    expect(await runCli(['transition', 'only-one', '--data-dir', dir], c.io)).toBe(2)
    expect(await runCli(['nonsense', '--data-dir', dir], c.io)).toBe(2)
  })
})

describe('registration verbs (lab CLI mode)', () => {
  it('set-refs writes resource/fingerprint/sessions; repeat --session unions', async () => {
    const service = new MissionService(dir)
    await service.create({ id: 'm' })
    const c = capture()
    expect(await runCli(['set-refs', 'm', '--resource', 'box-1', '--fingerprint', 'sha256:abc', '--session', 's-1', '--data-dir', dir], c.io)).toBe(0)
    expect(await runCli(['set-refs', 'm', '--session', 's-1', '--session', 's-2', '--data-dir', dir], c.io)).toBe(0)
    const attempt = service.get('m').mission.attempts[0]
    expect(attempt?.refs).toEqual({ resource: 'box-1', fingerprint: 'sha256:abc', sessions: ['s-1', 's-2'] })
  })

  it('set-refs: missing mission exits 1, no flags exits 2', async () => {
    const c = capture()
    expect(await runCli(['set-refs', 'ghost', '--resource', 'x', '--data-dir', dir], c.io)).toBe(1)
    expect(c.err()).toMatch(/does not exist/)
    expect(await runCli(['set-refs', 'm', '--data-dir', dir], c.io)).toBe(2)
    expect(await runCli(['set-refs', '--data-dir', dir], c.io)).toBe(2)
  })

  it('add-artifact indexes and dedups; conflicting kind exits 1; missing flags exit 2', async () => {
    const service = new MissionService(dir)
    await service.create({ id: 'm' })
    const c = capture()
    // A missing path is a business failure (exit 1), never a ghost registration.
    expect(await runCli(['add-artifact', 'm', '--path', 'report.json', '--kind', 'collect', '--data-dir', dir], c.io)).toBe(1)
    expect(c.err()).toMatch(/does not exist/)
    mkdirSync(service.store.attemptDataDir('default', 'm', 1), { recursive: true })
    writeFileSync(join(service.store.attemptDataDir('default', 'm', 1), 'report.json'), '{}\n')
    expect(await runCli(['add-artifact', 'm', '--path', 'report.json', '--kind', 'collect', '--data-dir', dir], c.io)).toBe(0)
    expect(c.out()).toMatch(/artifact indexed/)
    expect(await runCli(['add-artifact', 'm', '--path', 'report.json', '--kind', 'collect', '--data-dir', dir], c.io)).toBe(0)
    expect(c.out()).toMatch(/no-op/)
    expect(await runCli(['add-artifact', 'm', '--path', 'report.json', '--kind', 'archive', '--data-dir', dir], c.io)).toBe(1)
    expect(c.err()).toMatch(/already indexed/)
    expect(await runCli(['add-artifact', 'm', '--path', 'report.json', '--data-dir', dir], c.io)).toBe(2)
    expect(service.get('m').mission.attempts[0]?.artifacts).toHaveLength(1)
  })

  it('add-checkpoint records and merges with submit\'s no-ref checkpoint; usage exits 2', async () => {
    const service = new MissionService(dir)
    await service.create({ id: 'm' })
    await service.submit('m', { files: [{ path: 'a.txt', content: '1' }], checkpoint: 'round-1' })
    const c = capture()
    expect(await runCli(['add-checkpoint', 'm', '--name', 'round-1', '--ref', 'tag-9', '--artifact', 'b.txt', '--data-dir', dir], c.io)).toBe(0)
    expect(c.out()).toMatch(/checkpoint recorded/)
    const attempt = service.get('m').mission.attempts[0]
    expect(attempt?.checkpoints).toHaveLength(1)
    expect(attempt?.checkpoints[0]).toMatchObject({ name: 'round-1', ref: 'tag-9', artifacts: ['a.txt', 'b.txt'] })
    // Same ref, nothing new → no-op; conflicting ref → business failure 1.
    expect(await runCli(['add-checkpoint', 'm', '--name', 'round-1', '--ref', 'tag-9', '--data-dir', dir], c.io)).toBe(0)
    expect(c.out()).toMatch(/no-op/)
    expect(await runCli(['add-checkpoint', 'm', '--name', 'round-1', '--ref', 'other', '--data-dir', dir], c.io)).toBe(1)
    expect(await runCli(['add-checkpoint', 'm', '--data-dir', dir], c.io)).toBe(2)
  })

  it('CLI writes land in the same store the service reads (and --run scopes the lookup)', async () => {
    const service = new MissionService(dir)
    await service.runCreate({ template: { states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }] }, runId: 'r1' })
    await service.create({ runId: 'r1', id: 'm' })
    const c = capture()
    // Without --run the id is unique here, so the bare form works…
    expect(await runCli(['set-refs', 'm', '--resource', 'box', '--data-dir', dir], c.io)).toBe(0)
    // …and the scoped form writes the same record the service face reads.
    mkdirSync(service.store.attemptDataDir('r1', 'm', 1), { recursive: true })
    writeFileSync(join(service.store.attemptDataDir('r1', 'm', 1), 'x'), 'x\n')
    expect(await runCli(['add-artifact', 'm', '--run', 'r1', '--path', 'x', '--kind', 'k', '--data-dir', dir], c.io)).toBe(0)
    const { run, mission } = service.get('m', 'r1')
    expect(run.id).toBe('r1')
    expect(mission.attempts[0]?.refs.resource).toBe('box')
    expect(mission.attempts[0]?.artifacts).toHaveLength(1)
  })
})

describe('one store, many writers', () => {
  it('the service and CLI subprocesses write the same store without losing a write', async () => {
    const service = new MissionService(dir)
    await service.create({ id: 'm' })
    // 4 in-process service writes racing 4 CLI subprocess writes on one run file.
    const cliWrites = [0, 1, 2, 3].map(i =>
      cliProcess(['annotate', 'm', '--ns', 'script', '--payload', JSON.stringify({ from: 'cli', i }), '--data-dir', dir]))
    const serviceWrites = [0, 1, 2, 3].map(i =>
      service.annotate('m', 'lab', { from: 'service', i }))
    const results = await Promise.all([...cliWrites, ...serviceWrites])
    for (const r of results.slice(0, 4) as Array<{ code: number; stderr: string }>) {
      expect(r.code, r.stderr).toBe(0)
    }
    const { mission } = service.get('m')
    const cliPayloads = mission.annotations.filter(a => a.ns === 'script').map(a => (a.payload as { i: number }).i).sort()
    const servicePayloads = mission.annotations.filter(a => a.ns === 'lab').map(a => (a.payload as { i: number }).i).sort()
    expect(cliPayloads).toEqual([0, 1, 2, 3])
    expect(servicePayloads).toEqual([0, 1, 2, 3])
    expect(mission.annotations).toHaveLength(8)
  }, 120_000)

  it('concurrent in-process updates serialize on the lock', async () => {
    const a = new MissionService(dir)
    const b = new MissionService(dir)
    await a.create({ id: 'm' })
    await Promise.all([
      ...[0, 1, 2].map(i => a.annotate('m', 'x', { i })),
      ...[3, 4, 5].map(i => b.annotate('m', 'x', { i })),
    ])
    const { mission } = a.get('m')
    expect(mission.annotations.map(an => (an.payload as { i: number }).i).sort()).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('invariant companion', () => {
  function withHome(home: string, fn: () => void): void {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      fn()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  }

  it('passes on healthy run files, fails loud on malformed ones', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mission-home-'))
    try {
      withHome(home, () => {
        const failures: string[] = []
        install({} as never, (message: string) => { failures.push(message) })
        expect(failures).toEqual([]) // no data root at all → nothing to check
      })
      const service = new MissionService(join(home, 'state', 'mission'))
      await service.create({ id: 'm' })
      withHome(home, () => {
        const failures: string[] = []
        install({} as never, (message: string) => { failures.push(message) })
        expect(failures).toEqual([])
      })
      writeFileSync(join(home, 'state', 'mission', 'runs', 'broken.json'), 'not json')
      withHome(home, () => {
        const failures: string[] = []
        install({} as never, (message: string) => { failures.push(message) })
        expect(failures).toHaveLength(1)
        expect(failures[0]).toMatch(/malformed/)
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
