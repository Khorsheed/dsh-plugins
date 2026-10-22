/**
 * The T89 seams other plugins consume: the attempt data-dir verb, run-level
 * annotations, the gated export on the service face, and the machine-readable
 * `list --json` / `get --json` CLI output.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET_SCHEMA, LIST_SCHEMA, runCli, type CliIo } from '../src/cli-core.ts'
import { datasetsLayerProbe } from '../src/gate.ts'
import { MissionService } from '../src/service.ts'

let dir: string
let service: MissionService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-seams-'))
  service = new MissionService(dir)
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

describe('attemptDataDir', () => {
  it('is the store layout, pure, and refuses unsafe ids', async () => {
    await service.create({ id: 'm' })
    const path = service.attemptDataDir('default', 'm', 2)
    expect(path).toBe(join(dir, 'runs', 'default', 'data', 'm', 'attempt-2'))
    expect(existsSync(path)).toBe(false)
    expect(() => service.attemptDataDir('../x', 'm', 1)).toThrow(/not a usable id/)
  })
})

describe('run-level annotations', () => {
  it('append-only, ns-isolated, identical payload is a no-op', async () => {
    await service.create({ id: 'm' })
    expect(service.runAnnotations('default')).toEqual([])
    expect(await service.annotateRun('default', 'a', { k: 1 }, { by: 'x', now: 10 })).toEqual({ added: true })
    expect(await service.annotateRun('default', 'a', { k: 1 }, { now: 11 })).toEqual({ added: false })
    expect(await service.annotateRun('default', 'b', { k: 1 }, { now: 12 })).toEqual({ added: true })
    expect(service.runAnnotations('default')).toEqual([
      { ns: 'a', payload: { k: 1 }, createdAt: 10, by: 'x' },
      { ns: 'b', payload: { k: 1 }, createdAt: 12, by: 'service' },
    ])
    expect(service.runAnnotations('default', 'b').map(a => a.ns)).toEqual(['b'])
    // mission-level annotations are a separate list
    expect(service.get('m', 'default').mission.annotations).toEqual([])
    await expect(service.annotateRun('default', '', {})).rejects.toThrow(/non-empty/)
    await expect(service.annotateRun('nope', 'a', {})).rejects.toThrow(/does not exist/)
  })

  it('an older run file (no annotations field) reads as empty', async () => {
    await service.create({ id: 'm' })
    const file = service.store.runFile('default')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect('annotations' in raw).toBe(false)
    expect(service.runAnnotations('default')).toEqual([])
  })

  it('the bundle carries them in run.json; a run without them exports as before', async () => {
    await service.create({ id: 'm' })
    const plain = service.exportRun({ runId: 'default', outDir: join(dir, 'e1') })
    expect('annotations' in JSON.parse(readFileSync(join(plain.bundleDir, 'run.json'), 'utf8'))).toBe(false)
    await service.annotateRun('default', 'note', { at: 1 }, { now: 5 })
    const withNotes = service.exportRun({ runId: 'default', outDir: join(dir, 'e2') })
    const run = JSON.parse(readFileSync(join(withNotes.bundleDir, 'run.json'), 'utf8')) as { annotations: unknown[] }
    expect(run.annotations).toEqual([{ ns: 'note', payload: { at: 1 }, createdAt: 5, by: 'service' }])
  })

  it('CLI run annotate / run annotations', async () => {
    await service.create({ id: 'm' })
    const c = capture()
    expect(await runCli(['run', 'annotate', 'default', '--ns', 'n', '--payload', '{"a":1}', '--data-dir', dir], c.io)).toBe(0)
    expect(await runCli(['run', 'annotate', 'default', '--ns', 'n', '--payload', '{"a":1}', '--data-dir', dir], c.io)).toBe(0)
    expect(c.out()).toContain('no-op')
    const r = capture()
    expect(await runCli(['run', 'annotations', 'default', '--data-dir', dir], r.io)).toBe(0)
    expect(JSON.parse(r.out())).toMatchObject([{ ns: 'n', payload: { a: 1 }, by: 'cli' }])
  })
})

describe('gated export on the service face', () => {
  async function seedSnapshot(): Promise<string> {
    await service.create({ id: 'm' })
    const snap = join(dir, 'snap')
    mkdirSync(join(snap, 'answers'), { recursive: true })
    writeFileSync(join(snap, 'answers', 'a.md'), 'x\n')
    mkdirSync(join(snap, 'visible'), { recursive: true })
    writeFileSync(join(snap, 'visible', 'q.md'), 'q\n')
    return snap
  }

  it('refuses unconfirmed guarded layers fail-closed, exports when confirmed', async () => {
    const snap = await seedSnapshot()
    const request = { runId: 'default', outDir: join(dir, 'out'), layers: ['answers'], snapshotDir: snap, guarded: ['answers'] }
    expect((await service.exportPlanGated(request)).guardedLayers).toEqual(['answers'])
    await expect(service.exportRunGated({ ...request, confirmed: [] })).rejects.toThrow(/not confirmed: answers/)
    expect(existsSync(join(dir, 'out'))).toBe(false)
    const done = await service.exportRunGated({ ...request, confirmed: ['answers'] }, { now: 42 })
    expect(JSON.parse(readFileSync(join(done.bundleDir, 'manifest.json'), 'utf8')).exportedAt).toBe(42)
  })

  it('the installed probe guards layers the caller did not declare; no probe = declarations only', async () => {
    const snap = await seedSnapshot()
    const request = {
      runId: 'default', outDir: join(dir, 'out'), layers: ['answers', 'visible'], snapshotDir: snap,
      snapshot: { repo: '/repo', commit: 'c', dataset: 'd' },
    }
    expect((await service.exportPlanGated(request)).guardedLayers).toEqual([])
    service.setLayerProbe(datasetsLayerProbe(() => ({
      list: () => Promise.resolve({ dataset: { nonModelFacingLayers: ['answers'] } }),
    })))
    expect((await service.exportPlanGated(request)).guardedLayers).toEqual(['answers'])
    await expect(service.exportRunGated({ ...request, confirmed: [] })).rejects.toThrow(/not confirmed/)
  })

  it('a throwing or absent datasets service degrades to declarations only', async () => {
    const snap = await seedSnapshot()
    const request = {
      runId: 'default', outDir: join(dir, 'out'), layers: ['answers'], snapshotDir: snap,
      snapshot: { repo: '/repo', commit: 'c', dataset: 'd' },
    }
    service.setLayerProbe(datasetsLayerProbe(() => ({ list: () => Promise.reject(new Error('boom')) })))
    expect((await service.exportPlanGated(request)).guardedLayers).toEqual([])
    service.setLayerProbe(datasetsLayerProbe(() => undefined))
    expect((await service.exportPlanGated(request)).guardedLayers).toEqual([])
  })
})

describe('CLI --json', () => {
  it('list --json is one schema-versioned document', async () => {
    await service.create({ id: 'a', labels: { x: 'with space' } })
    await service.create({ id: 'b' })
    const c = capture()
    expect(await runCli(['list', '--json', '--run', 'default', '--data-dir', dir], c.io)).toBe(0)
    const doc = JSON.parse(c.out()) as { schema: string; missions: Array<{ id: string; state: string; labels: Record<string, string> }> }
    expect(doc.schema).toBe(LIST_SCHEMA)
    expect(doc.missions.map(m => [m.id, m.state])).toEqual([['a', 'queued'], ['b', 'queued']])
    expect(doc.missions[0]?.labels).toEqual({ x: 'with space' })
  })

  it('--json may come last or first; plain list is unchanged', async () => {
    await service.create({ id: 'a' })
    const last = capture()
    expect(await runCli(['list', '--run', 'default', '--json', '--data-dir', dir], last.io)).toBe(0)
    expect(JSON.parse(last.out()).schema).toBe(LIST_SCHEMA)
    const plain = capture()
    expect(await runCli(['list', '--run', 'default', '--data-dir', dir], plain.io)).toBe(0)
    expect(plain.out()).toContain('(1 mission(s))')
  })

  it('get --json adds the schema field; plain get keeps its document', async () => {
    await service.create({ id: 'a' })
    const json = capture()
    expect(await runCli(['get', 'a', '--json', '--run', 'default', '--data-dir', dir], json.io)).toBe(0)
    const doc = JSON.parse(json.out()) as { schema: string; runId: string; mission: { id: string } }
    expect(doc).toMatchObject({ schema: GET_SCHEMA, runId: 'default', mission: { id: 'a' } })
    const plain = capture()
    expect(await runCli(['get', 'a', '--run', 'default', '--data-dir', dir], plain.io)).toBe(0)
    expect('schema' in JSON.parse(plain.out())).toBe(false)
  })

  it('submit --json still takes a value', async () => {
    await service.create({ id: 'a' })
    const c = capture()
    expect(await runCli(['submit', 'a', '--json', '--run', 'default', '--data-dir', dir], c.io)).toBe(2)
    expect(c.err()).toMatch(/--json requires a value/)
  })
})
