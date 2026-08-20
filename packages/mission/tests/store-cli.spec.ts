import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
