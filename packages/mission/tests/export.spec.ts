import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import { runCli, type CliIo } from '../src/cli-core.ts'
import { MissionService } from '../src/service.ts'
import { handleMissionCommand, type SlashExtras } from '../src/slash.ts'

let dir: string
let service: MissionService
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-export-'))
  service = new MissionService(join(dir, 'data'))
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

/** A snapshot dir with two layers: visible + answers (guarded). */
function seedSnapshot(): string {
  const snap = join(dir, 'snapshot')
  mkdirSync(join(snap, 'visible'), { recursive: true })
  writeFileSync(join(snap, 'visible', 'task.md'), '# task\n')
  mkdirSync(join(snap, 'answers'), { recursive: true })
  writeFileSync(join(snap, 'answers', 'oracle.md'), '# answer\n')
  return snap
}

/** A run with two missions: one fully annotated, one carrying only an unlisted ns. */
async function seedRun(): Promise<void> {
  await service.runCreate({
    template: { states: ['pending', 'done'], transitions: [{ from: 'pending', to: 'done' }] },
    runId: 'r1',
    meta: { expectedNs: ['script', 'human-final'] },
  })
  await service.create({ runId: 'r1', id: 'cell-1' })
  await service.create({ runId: 'r1', id: 'cell-2' })
  await service.submit('cell-1', { runId: 'r1', files: [{ path: 'out.txt', content: 'v1' }] })
  await service.annotate('cell-1', 'script', { ok: true }, { runId: 'r1' })
  await service.annotate('cell-1', 'human-final', { ok: true }, { runId: 'r1' })
  await service.annotate('cell-2', 'llm-draft', { ok: 'maybe' }, { runId: 'r1' })
}

describe('bundle export', () => {
  it('writes a self-contained bundle: manifest, run, missions, artifacts, dataset layers', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const out = join(dir, 'exports')
    const result = service.exportRun({
      runId: 'r1', outDir: out,
      layers: [{ name: 'visible', guarded: false }],
      snapshotDir: snap,
      snapshot: { repo: '/repo', commit: 'abc123', dataset: 'suite-a' },
      now: 1_800_000_000_000,
    })
    const bundle = join(out, 'r1-bundle')
    expect(result.bundleDir).toBe(bundle)
    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest['runId']).toBe('r1')
    expect(manifest['snapshot']).toEqual({ repo: '/repo', commit: 'abc123', dataset: 'suite-a' })
    expect(manifest['guardedLayers']).toEqual([])
    const layers = manifest['layers'] as Array<{ name: string; contentHash: string; files: number }>
    expect(layers).toHaveLength(1)
    expect(layers[0]?.name).toBe('visible')
    expect(layers[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect((manifest['stateMachine'] as { states: string[] }).states).toEqual(['pending', 'done'])
    // Self-contained: every fact readable from the bundle alone.
    const run = JSON.parse(readFileSync(join(bundle, 'run.json'), 'utf8')) as { meta: { expectedNs: string[] } }
    expect(run.meta.expectedNs).toEqual(['script', 'human-final'])
    const attempt = JSON.parse(readFileSync(join(bundle, 'missions', 'cell-1', 'attempt-1', 'meta.json'), 'utf8')) as { state: string }
    expect(attempt.state).toBe('pending')
    const annotations = JSON.parse(readFileSync(join(bundle, 'missions', 'cell-1', 'attempt-1', 'annotations.json'), 'utf8')) as unknown[]
    expect(annotations).toHaveLength(2)
    expect(readFileSync(join(bundle, 'missions', 'cell-1', 'attempt-1', 'artifacts', 'out.txt'), 'utf8')).toBe('v1')
    expect(readFileSync(join(bundle, 'dataset', 'visible', 'task.md'), 'utf8')).toBe('# task\n')
    expect(existsSync(join(bundle, 'methodology.md'))).toBe(true)
  })

  it('the ns completeness report marks missing honestly and never substitutes', async () => {
    await seedRun()
    const plan = service.planExport({ runId: 'r1', outDir: join(dir, 'exports') })
    expect(plan.expectedNs).toEqual(['script', 'human-final'])
    const report = plan.nsReport
    expect(report).not.toBeNull()
    const cell1 = report?.find(c => c.missionId === 'cell-1')
    expect(cell1).toMatchObject({ expectedPresent: ['script', 'human-final'], missing: [], onlyUnlisted: false })
    const cell2 = report?.find(c => c.missionId === 'cell-2')
    // Only an unlisted ns present — flagged, not counted as covered.
    expect(cell2).toMatchObject({ present: ['llm-draft'], missing: ['script', 'human-final'], onlyUnlisted: true })
  })

  it('run status prints the per-cell missing report', async () => {
    await seedRun()
    const status = service.runStatus('r1')
    expect(status.nsReport).not.toBeNull()
    const c = capture()
    await runCli(['run', 'status', 'r1', '--data-dir', join(dir, 'data')], c.io)
    expect(c.out()).toMatch(/ns completeness \(expectedNs: script, human-final\)/)
    expect(c.out()).toMatch(/cell-1 attempt 1: complete/)
    expect(c.out()).toMatch(/cell-2 attempt 1: only unlisted ns present \[llm-draft\] — missing: script, human-final/)
  })

  it('refuses to overwrite an existing bundle', async () => {
    await seedRun()
    const out = join(dir, 'exports')
    service.exportRun({ runId: 'r1', outDir: out })
    expect(() => service.exportRun({ runId: 'r1', outDir: out })).toThrow(/already exists/)
  })

  it('layers without a snapshot dir are a loud error', async () => {
    await seedRun()
    expect(() => service.planExport({ runId: 'r1', outDir: join(dir, 'e'), layers: [{ name: 'visible', guarded: false }] }))
      .toThrow(/snapshot-dir/)
  })
})

describe('leak gate (CLI)', () => {
  it('non-TTY refuses guarded layers, exit 1, nothing written', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const out = join(dir, 'exports')
    const c = capture()
    const code = await runCli([
      'export', 'r1', '--out', out, '--snapshot-dir', snap,
      '--layer', 'visible', '--layer', 'answers', '--guarded', 'answers',
      '--data-dir', join(dir, 'data'),
    ], c.io, { isTTY: false })
    expect(code).toBe(1)
    expect(c.err()).toMatch(/export refused/)
    expect(c.err()).toMatch(/answers/)
    expect(existsSync(join(out, 'r1-bundle'))).toBe(false)
  })

  it('TTY with per-layer confirmation exports; a declined layer aborts before writing', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const out = join(dir, 'exports')
    const argv = [
      'export', 'r1', '--out', out, '--snapshot-dir', snap,
      '--layer', 'visible', '--layer', 'answers', '--guarded', 'answers',
      '--data-dir', join(dir, 'data'),
    ]
    const decline = capture()
    expect(await runCli(argv, decline.io, { isTTY: true, confirm: () => Promise.resolve(false) })).toBe(1)
    expect(decline.err()).toMatch(/not confirmed/)
    expect(existsSync(join(out, 'r1-bundle'))).toBe(false)

    const asked: string[] = []
    const accept = capture()
    const code = await runCli(argv, accept.io, {
      isTTY: true,
      confirm: (question) => { asked.push(question); return Promise.resolve(true) },
    })
    expect(code, accept.err()).toBe(0)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatch(/answers/)
    expect(existsSync(join(out, 'r1-bundle', 'dataset', 'answers', 'oracle.md'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(out, 'r1-bundle', 'manifest.json'), 'utf8')) as { guardedLayers: string[] }
    expect(manifest.guardedLayers).toEqual(['answers'])
  })

  it('unguarded exports need no TTY at all', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const c = capture()
    const code = await runCli([
      'export', 'r1', '--out', join(dir, 'exports'), '--snapshot-dir', snap,
      '--layer', 'visible', '--data-dir', join(dir, 'data'),
    ], c.io, { isTTY: false })
    expect(code, c.err()).toBe(0)
    expect(c.out()).toMatch(/exported .*r1-bundle/)
  })

  it('usage errors: missing --out, --guarded not in --layer', async () => {
    await seedRun()
    const c = capture()
    expect(await runCli(['export', 'r1', '--data-dir', join(dir, 'data')], c.io)).toBe(2)
    expect(await runCli([
      'export', 'r1', '--out', join(dir, 'e'), '--snapshot-dir', seedSnapshot(),
      '--layer', 'visible', '--guarded', 'answers', '--data-dir', join(dir, 'data'),
    ], c.io)).toBe(2)
  })
})

describe('leak gate (slash)', () => {
  const invoke = (rawInput: string, extras?: SlashExtras) =>
    handleMissionCommand(service, { rawInput, agent: { session: { id: 's1' } } } as unknown as CommandInvocation, extras)

  it('guarded layers are refused and routed to the TTY CLI', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const result = await invoke(`export r1 --out ${join(dir, 'e')} --snapshot-dir ${snap} --layer visible --layer answers --guarded answers`)
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toMatch(/no interactive confirmation channel/)
    expect((result as { text: string }).text).toMatch(/dsh-mission export/)
    expect(existsSync(join(dir, 'e'))).toBe(false)
  })

  it('the datasets probe marks guarded layers from metadata (no --guarded needed)', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const extras: SlashExtras = { resolveNonModelFacing: () => Promise.resolve(['answers']) }
    const result = await invoke(
      `export r1 --out ${join(dir, 'e')} --snapshot-dir ${snap} --layer visible --layer answers --snapshot-repo /repo --snapshot-commit abc --snapshot-dataset suite-a`,
      extras,
    )
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toMatch(/guarded/)
  })

  it('unguarded export succeeds through slash', async () => {
    await seedRun()
    const snap = seedSnapshot()
    const result = await invoke(`export r1 --out ${join(dir, 'e')} --snapshot-dir ${snap} --layer visible`)
    expect(result.kind).toBe('success')
    expect((result as { text: string }).text).toMatch(/exported .*r1-bundle/)
    expect((result as { text: string }).text).toMatch(/cell-2 attempt 1: only unlisted/)
  })
})
